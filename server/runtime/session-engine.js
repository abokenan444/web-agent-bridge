'use strict';

/**
 * Session Engine
 *
 * Manages browser execution sessions with cookies, tokens,
 * and state persistence across navigation.
 */

const crypto = require('crypto');
const { bus } = require('../runtime/event-bus');

class SessionEngine {
  constructor() {
    this._sessions = new Map();   // sessionId → BrowserSession
    this._cookieJars = new Map(); // sessionId → CookieJar
    this._maxSessions = 500;
    this._defaultTTL = 3600_000;  // 1 hour
  }

  /**
   * Create a new browser execution session
   */
  create(config = {}) {
    const sessionId = `sess_${crypto.randomBytes(16).toString('hex')}`;

    const session = {
      id: sessionId,
      agentId: config.agentId || null,
      siteId: config.siteId || null,
      state: 'active',
      viewport: config.viewport || { width: 1920, height: 1080 },
      userAgent: config.userAgent || null,
      proxy: config.proxy || null,
      localStorage: {},
      sessionStorage: {},
      variables: {},    // Arbitrary key-value store for the agent
      history: [],
      createdAt: Date.now(),
      expiresAt: Date.now() + (config.ttl || this._defaultTTL),
      lastActivity: Date.now(),
    };

    this._sessions.set(sessionId, session);
    this._cookieJars.set(sessionId, new CookieJar());
    this._evict();

    bus.emit('session.created', { sessionId, agentId: session.agentId, siteId: session.siteId });
    return session;
  }

  /**
   * Get session
   */
  get(sessionId) {
    const session = this._sessions.get(sessionId);
    if (!session) return null;
    if (session.expiresAt < Date.now()) {
      this.destroy(sessionId);
      return null;
    }
    return session;
  }

  /**
   * Update session last activity
   */
  touch(sessionId) {
    const session = this._sessions.get(sessionId);
    if (session) session.lastActivity = Date.now();
  }

  /**
   * Set cookies for a session
   */
  setCookies(sessionId, cookies) {
    const jar = this._cookieJars.get(sessionId);
    if (!jar) return;
    for (const cookie of cookies) {
      jar.set(cookie);
    }
    this.touch(sessionId);
  }

  /**
   * Get cookies for a session/domain
   */
  getCookies(sessionId, domain = null) {
    const jar = this._cookieJars.get(sessionId);
    if (!jar) return [];
    return jar.getAll(domain);
  }

  /**
   * Set localStorage value
   */
  setStorage(sessionId, key, value, type = 'local') {
    const session = this._sessions.get(sessionId);
    if (!session) return;
    const store = type === 'session' ? session.sessionStorage : session.localStorage;
    store[key] = value;
    this.touch(sessionId);
  }

  /**
   * Get localStorage value
   */
  getStorage(sessionId, key, type = 'local') {
    const session = this._sessions.get(sessionId);
    if (!session) return null;
    const store = type === 'session' ? session.sessionStorage : session.localStorage;
    return store[key] || null;
  }

  /**
   * Set variable in session
   */
  setVariable(sessionId, key, value) {
    const session = this._sessions.get(sessionId);
    if (session) {
      session.variables[key] = value;
      this.touch(sessionId);
    }
  }

  /**
   * Get variable from session
   */
  getVariable(sessionId, key) {
    const session = this._sessions.get(sessionId);
    return session?.variables[key] || null;
  }

  /**
   * Record navigation in session history
   */
  recordNavigation(sessionId, url, title = '') {
    const session = this._sessions.get(sessionId);
    if (!session) return;
    session.history.push({
      url,
      title,
      timestamp: Date.now(),
      index: session.history.length,
    });
    this.touch(sessionId);
  }

  /**
   * Export session state (for transfer/persistence)
   */
  export(sessionId) {
    const session = this._sessions.get(sessionId);
    if (!session) return null;
    return {
      id: session.id,
      agentId: session.agentId,
      siteId: session.siteId,
      viewport: session.viewport,
      userAgent: session.userAgent,
      localStorage: { ...session.localStorage },
      sessionStorage: { ...session.sessionStorage },
      variables: { ...session.variables },
      cookies: this.getCookies(sessionId),
      history: [...session.history],
      createdAt: session.createdAt,
    };
  }

  /**
   * Import session state (restore from exported data)
   */
  import(data) {
    const session = this.create({
      agentId: data.agentId,
      siteId: data.siteId,
      viewport: data.viewport,
      userAgent: data.userAgent,
    });

    session.localStorage = data.localStorage || {};
    session.sessionStorage = data.sessionStorage || {};
    session.variables = data.variables || {};
    session.history = data.history || [];

    if (data.cookies) {
      this.setCookies(session.id, data.cookies);
    }

    return session;
  }

  /**
   * Destroy session
   */
  destroy(sessionId) {
    this._sessions.delete(sessionId);
    this._cookieJars.delete(sessionId);
    bus.emit('session.destroyed', { sessionId });
  }

  /**
   * List sessions
   */
  list(filters = {}, limit = 50) {
    const now = Date.now();
    let sessions = Array.from(this._sessions.values()).filter(s => s.expiresAt >= now);

    if (filters.agentId) sessions = sessions.filter(s => s.agentId === filters.agentId);
    if (filters.siteId) sessions = sessions.filter(s => s.siteId === filters.siteId);
    if (filters.state) sessions = sessions.filter(s => s.state === filters.state);

    return sessions.slice(0, limit).map(s => ({
      id: s.id,
      agentId: s.agentId,
      siteId: s.siteId,
      state: s.state,
      historyLength: s.history.length,
      createdAt: s.createdAt,
      lastActivity: s.lastActivity,
    }));
  }

  getStats() {
    return {
      activeSessions: this._sessions.size,
      maxSessions: this._maxSessions,
    };
  }

  _evict() {
    const now = Date.now();
    for (const [id, session] of this._sessions) {
      if (session.expiresAt < now) this.destroy(id);
    }
    if (this._sessions.size > this._maxSessions) {
      const sorted = Array.from(this._sessions.entries())
        .sort((a, b) => a[1].lastActivity - b[1].lastActivity);
      const toRemove = sorted.slice(0, sorted.length - this._maxSessions);
      for (const [id] of toRemove) this.destroy(id);
    }
  }
}

// ─── Cookie Jar ─────────────────────────────────────────────────────────────

class CookieJar {
  constructor() {
    this._cookies = new Map();  // domain:name → cookie
  }

  set(cookie) {
    const key = `${cookie.domain || '*'}:${cookie.name}`;
    this._cookies.set(key, {
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain || '*',
      path: cookie.path || '/',
      expires: cookie.expires || null,
      httpOnly: cookie.httpOnly || false,
      secure: cookie.secure || false,
      sameSite: cookie.sameSite || 'Lax',
      setAt: Date.now(),
    });
  }

  get(name, domain = '*') {
    return this._cookies.get(`${domain}:${name}`) || null;
  }

  getAll(domain = null) {
    const now = Date.now();
    const result = [];
    for (const cookie of this._cookies.values()) {
      if (cookie.expires && cookie.expires < now) continue;
      if (domain && cookie.domain !== '*' && cookie.domain !== domain) continue;
      result.push({ ...cookie });
    }
    return result;
  }

  delete(name, domain = '*') {
    this._cookies.delete(`${domain}:${name}`);
  }

  clear() {
    this._cookies.clear();
  }
}

const sessionEngine = new SessionEngine();

module.exports = { SessionEngine, CookieJar, sessionEngine };
