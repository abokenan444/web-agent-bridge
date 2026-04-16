'use strict';

/**
 * WAB Runtime - State Manager
 * 
 * Manages agent state, task checkpoints, and long-running task persistence.
 * Provides rollback capabilities and state snapshots.
 */

const crypto = require('crypto');

class StateManager {
  constructor(options = {}) {
    this._states = new Map();        // entityId → current state
    this._checkpoints = new Map();   // entityId → [checkpoint, ...]
    this._maxCheckpoints = options.maxCheckpoints || 50;
    this._ttl = options.ttl || 24 * 3600_000; // 24h default
    this._stats = { saves: 0, restores: 0, checkpoints: 0, rollbacks: 0 };
  }

  /**
   * Save state for an entity (agent or task)
   */
  save(entityId, state) {
    const entry = {
      state: _deepClone(state),
      updatedAt: Date.now(),
      version: (this._states.get(entityId)?.version || 0) + 1,
    };
    this._states.set(entityId, entry);
    this._stats.saves++;
    return entry.version;
  }

  /**
   * Get current state
   */
  get(entityId) {
    const entry = this._states.get(entityId);
    if (!entry) return null;
    if (Date.now() - entry.updatedAt > this._ttl) {
      this._states.delete(entityId);
      return null;
    }
    return _deepClone(entry.state);
  }

  /**
   * Create a checkpoint (point-in-time snapshot for rollback)
   */
  checkpoint(entityId, label = '') {
    const entry = this._states.get(entityId);
    if (!entry) throw new Error(`No state found for entity: ${entityId}`);

    const cp = {
      id: `cp_${crypto.randomBytes(8).toString('hex')}`,
      label,
      state: _deepClone(entry.state),
      version: entry.version,
      createdAt: Date.now(),
    };

    if (!this._checkpoints.has(entityId)) this._checkpoints.set(entityId, []);
    const cps = this._checkpoints.get(entityId);
    cps.push(cp);

    // Limit checkpoints
    if (cps.length > this._maxCheckpoints) {
      cps.splice(0, cps.length - this._maxCheckpoints);
    }

    this._stats.checkpoints++;
    return cp.id;
  }

  /**
   * Rollback to a checkpoint
   */
  rollback(entityId, checkpointId) {
    const cps = this._checkpoints.get(entityId);
    if (!cps) throw new Error(`No checkpoints for entity: ${entityId}`);

    const idx = cps.findIndex(cp => cp.id === checkpointId);
    if (idx === -1) throw new Error(`Checkpoint not found: ${checkpointId}`);

    const cp = cps[idx];
    this._states.set(entityId, {
      state: _deepClone(cp.state),
      updatedAt: Date.now(),
      version: (this._states.get(entityId)?.version || 0) + 1,
    });

    // Remove checkpoints after the restored one
    cps.splice(idx + 1);
    this._stats.rollbacks++;
    return cp;
  }

  /**
   * List checkpoints for an entity
   */
  listCheckpoints(entityId) {
    const cps = this._checkpoints.get(entityId) || [];
    return cps.map(cp => ({
      id: cp.id,
      label: cp.label,
      version: cp.version,
      createdAt: cp.createdAt,
    }));
  }

  /**
   * Delete state and checkpoints for an entity
   */
  delete(entityId) {
    this._states.delete(entityId);
    this._checkpoints.delete(entityId);
  }

  /**
   * Get all active entity IDs
   */
  listEntities() {
    const entities = [];
    const now = Date.now();
    for (const [id, entry] of this._states) {
      if (now - entry.updatedAt > this._ttl) {
        this._states.delete(id);
        continue;
      }
      entities.push({ id, version: entry.version, updatedAt: entry.updatedAt });
    }
    return entities;
  }

  /**
   * Merge partial state update
   */
  merge(entityId, partial) {
    const current = this.get(entityId) || {};
    const merged = { ...current, ...partial };
    return this.save(entityId, merged);
  }

  /**
   * Transition state with validation
   */
  transition(entityId, field, from, to) {
    const state = this.get(entityId);
    if (!state) throw new Error(`No state for: ${entityId}`);
    if (state[field] !== from) {
      throw new Error(`Invalid transition: ${field} is ${state[field]}, expected ${from}`);
    }
    state[field] = to;
    return this.save(entityId, state);
  }

  getStats() {
    return {
      ...this._stats,
      activeEntities: this._states.size,
      totalCheckpoints: Array.from(this._checkpoints.values()).reduce((s, c) => s + c.length, 0),
    };
  }

  /**
   * Cleanup expired states
   */
  cleanup() {
    const now = Date.now();
    let cleaned = 0;
    for (const [id, entry] of this._states) {
      if (now - entry.updatedAt > this._ttl) {
        this._states.delete(id);
        this._checkpoints.delete(id);
        cleaned++;
      }
    }
    return cleaned;
  }
}

function _deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  return JSON.parse(JSON.stringify(obj));
}

module.exports = { StateManager };
