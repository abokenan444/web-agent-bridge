'use strict';

/**
 * WAB Protocol (WABP) - Entry Point
 * 
 * The WAB Protocol defines how agents communicate with sites, runtimes,
 * and each other. It is the foundation of the Agent OS.
 * 
 * Protocol message envelope:
 * {
 *   protocol: 'wabp',
 *   version: '1.0.0',
 *   id: '<unique-message-id>',
 *   type: 'request' | 'response' | 'event' | 'error',
 *   command: '<command-name>',
 *   agentId: '<agent-id>',
 *   traceId: '<trace-id>',
 *   spanId: '<span-id>',
 *   timestamp: <epoch-ms>,
 *   payload: { ... },
 *   signature: '<ed25519-signature>' // optional, for signed commands
 * }
 */

const crypto = require('crypto');
const schema = require('./schema');
const { CapabilityNegotiator } = require('./capabilities');

const PROTOCOL_NAME = 'wabp';
const PROTOCOL_VERSION = schema.PROTOCOL_VERSION;

const negotiator = new CapabilityNegotiator();

// ─── Message Factory ────────────────────────────────────────────────────────

function createMessage(type, command, payload, options = {}) {
  return {
    protocol: PROTOCOL_NAME,
    version: PROTOCOL_VERSION,
    id: `msg_${crypto.randomBytes(16).toString('hex')}`,
    type,
    command,
    agentId: options.agentId || null,
    traceId: options.traceId || `trace_${crypto.randomBytes(16).toString('hex')}`,
    spanId: options.spanId || `span_${crypto.randomBytes(8).toString('hex')}`,
    timestamp: Date.now(),
    payload,
    signature: options.signature || null,
  };
}

function createRequest(command, payload, options) {
  return createMessage('request', command, payload, options);
}

function createResponse(requestId, command, payload, options = {}) {
  const msg = createMessage('response', command, payload, options);
  msg.requestId = requestId;
  return msg;
}

function createError(requestId, command, code, message, options = {}) {
  return createResponse(requestId, command, {
    error: { code, message, timestamp: Date.now() },
  }, options);
}

function createEvent(eventName, payload, options) {
  return createMessage('event', eventName, payload, options);
}

// ─── Message Validation ─────────────────────────────────────────────────────

function validateMessage(msg) {
  const errors = [];
  if (!msg || typeof msg !== 'object') return { valid: false, errors: ['Message must be an object'] };
  if (msg.protocol !== PROTOCOL_NAME) errors.push(`Invalid protocol: expected ${PROTOCOL_NAME}`);
  if (!msg.id) errors.push('Missing message id');
  if (!['request', 'response', 'event', 'error'].includes(msg.type)) errors.push('Invalid message type');
  if (!msg.command) errors.push('Missing command');
  if (!msg.timestamp || typeof msg.timestamp !== 'number') errors.push('Invalid timestamp');

  // Validate command input for requests
  if (msg.type === 'request' && msg.payload) {
    const cmdValidation = schema.validateInput(msg.command, msg.payload);
    if (!cmdValidation.valid) {
      errors.push(...cmdValidation.errors.map(e => `${e.path}: ${e.message}`));
    }
  }

  return { valid: errors.length === 0, errors };
}

// ─── Protocol Handler ───────────────────────────────────────────────────────

class ProtocolHandler {
  constructor() {
    this._handlers = new Map();       // command → handler function
    this._middleware = [];             // pre-processing middleware
    this._eventListeners = new Map();  // event → listeners
  }

  /**
   * Register a command handler
   */
  handle(command, handler) {
    this._handlers.set(command, handler);
  }

  /**
   * Add middleware to the processing pipeline
   */
  use(middleware) {
    this._middleware.push(middleware);
  }

  /**
   * Subscribe to protocol events
   */
  on(event, listener) {
    if (!this._eventListeners.has(event)) this._eventListeners.set(event, []);
    this._eventListeners.get(event).push(listener);
  }

  /**
   * Process an incoming protocol message
   */
  async process(msg) {
    // Validate
    const validation = validateMessage(msg);
    if (!validation.valid) {
      return createError(msg.id, msg.command, 'INVALID_MESSAGE', validation.errors.join('; '));
    }

    // Check command exists
    const cmdDef = schema.getCommand(msg.command);
    if (!cmdDef) {
      return createError(msg.id, msg.command, 'UNKNOWN_COMMAND', `Command not found: ${msg.command}`);
    }

    // Run middleware
    let context = { message: msg, command: cmdDef, metadata: {} };
    for (const mw of this._middleware) {
      try {
        const result = await mw(context);
        if (result === false) {
          return createError(msg.id, msg.command, 'MIDDLEWARE_REJECTED', 'Request rejected by middleware');
        }
        if (result && typeof result === 'object') context = { ...context, ...result };
      } catch (err) {
        return createError(msg.id, msg.command, 'MIDDLEWARE_ERROR', err.message);
      }
    }

    // Check capability if agent
    if (msg.agentId && cmdDef.capabilities.length > 0) {
      for (const cap of cmdDef.capabilities) {
        if (!negotiator.check(msg.agentId, cap)) {
          return createError(msg.id, msg.command, 'CAPABILITY_DENIED',
            `Agent ${msg.agentId} lacks capability: ${cap}`);
        }
      }
      // Use capabilities
      for (const cap of cmdDef.capabilities) {
        negotiator.use(msg.agentId, cap);
      }
    }

    // Execute handler
    const handler = this._handlers.get(msg.command);
    if (!handler) {
      return createError(msg.id, msg.command, 'NO_HANDLER', `No handler for: ${msg.command}`);
    }

    try {
      const timeoutMs = msg.payload?.timeout || cmdDef.timeout;
      const result = await _withTimeout(handler(msg.payload, context), timeoutMs);
      const response = createResponse(msg.id, msg.command, result, {
        agentId: msg.agentId,
        traceId: msg.traceId,
      });

      // Emit event
      _emit(this._eventListeners, 'command:complete', {
        command: msg.command,
        agentId: msg.agentId,
        traceId: msg.traceId,
        duration: Date.now() - msg.timestamp,
      });

      return response;
    } catch (err) {
      _emit(this._eventListeners, 'command:error', {
        command: msg.command,
        agentId: msg.agentId,
        traceId: msg.traceId,
        error: err.message,
      });
      return createError(msg.id, msg.command, 'EXECUTION_ERROR', err.message, {
        traceId: msg.traceId,
      });
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function _withTimeout(promise, ms) {
  if (!ms || ms <= 0) return promise;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Command timed out after ${ms}ms`)), ms);
    promise.then(result => { clearTimeout(timer); resolve(result); })
      .catch(err => { clearTimeout(timer); reject(err); });
  });
}

function _emit(listeners, event, data) {
  const fns = listeners.get(event);
  if (!fns) return;
  for (const fn of fns) {
    try { fn(data); } catch (_) { /* ignore listener errors */ }
  }
}

// ─── Cleanup interval ──────────────────────────────────────────────────────

const _cleanupInterval = setInterval(() => negotiator.cleanup(), 300_000);
if (_cleanupInterval.unref) _cleanupInterval.unref();

module.exports = {
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
  schema,
  negotiator,
  createMessage,
  createRequest,
  createResponse,
  createError,
  createEvent,
  validateMessage,
  ProtocolHandler,
  CapabilityNegotiator: require('./capabilities').CapabilityNegotiator,
};
