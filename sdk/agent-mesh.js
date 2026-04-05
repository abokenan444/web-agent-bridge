/**
 * WABAgentMesh — SDK Client for the Private Agent Mesh
 *
 * High-level client for agents to join the mesh, communicate,
 * share knowledge, participate in votes, and learn from decisions.
 * Includes automatic heartbeat, reconnection, and response validation.
 */

class WABAgentMesh {
  /**
   * @param {object} options
   * @param {string} options.serverUrl - WAB server URL
   * @param {string} options.role - Agent role (e.g., 'monitor', 'optimizer')
   * @param {string} [options.displayName] - Human-readable agent name
   * @param {string[]} [options.capabilities] - List of capabilities
   * @param {string} [options.siteId] - Site identifier
   * @param {number} [options.heartbeatInterval=30000] - Heartbeat interval in ms
   */
  constructor(options = {}) {
    this.serverUrl = (options.serverUrl || '').replace(/\/$/, '');
    this.role = options.role || 'agent';
    this.displayName = options.displayName || null;
    this.capabilities = options.capabilities || [];
    this.siteId = options.siteId || null;
    this.heartbeatInterval = options.heartbeatInterval || 30000;

    this.agentId = null;
    this._heartbeatTimer = null;
    this._retryCount = 0;
    this._maxRetries = 5;
    this._listeners = {};
  }

  // ─── Lifecycle ───────────────────────────────────────────────────

  /**
   * Join the mesh. Registers the agent and starts heartbeat.
   * @returns {Promise<object>} Registered agent data
   */
  async join() {
    const res = await this._post('/api/mesh/agents', {
      siteId: this.siteId,
      role: this.role,
      displayName: this.displayName,
      capabilities: this.capabilities,
    });
    const data = await this._json(res);
    this.agentId = data.agent.id;
    this._retryCount = 0;
    this._startHeartbeat();
    this._emit('joined', data.agent);
    return data.agent;
  }

  /**
   * Leave the mesh. Deregisters and stops heartbeat.
   */
  async leave() {
    this._stopHeartbeat();
    if (this.agentId) {
      try {
        await this._delete(`/api/mesh/agents/${this.agentId}`);
      } catch (_) { /* ignore errors during cleanup */ }
      this._emit('left', { agentId: this.agentId });
      this.agentId = null;
    }
  }

  /**
   * Destroy the client — leave mesh and clean up all resources.
   */
  async destroy() {
    await this.leave();
    this._listeners = {};
  }

  // ─── Messaging ─────────────────────────────────────────────────

  /**
   * Publish a message to a channel.
   */
  async publish(type, subject, payload = {}, options = {}) {
    this._requireJoined();
    const res = await this._post('/api/mesh/messages', {
      channelName: options.channel || 'general',
      senderId: this.agentId,
      targetId: options.targetId || null,
      type,
      subject,
      payload,
      priority: options.priority || 0,
      ttl: options.ttl,
    });
    return (await this._json(res)).message;
  }

  /**
   * Get messages for this agent.
   */
  async getMessages(limit = 50) {
    this._requireJoined();
    const res = await this._get(`/api/mesh/messages?agentId=${this.agentId}&limit=${limit}`);
    return (await this._json(res)).messages;
  }

  /**
   * Acknowledge a message.
   */
  async acknowledge(messageId) {
    const res = await this._post(`/api/mesh/messages/${encodeURIComponent(messageId)}/acknowledge`);
    return (await this._json(res));
  }

  /**
   * Get unread count and breakdown by channel.
   */
  async getUnread() {
    this._requireJoined();
    const res = await this._get(`/api/mesh/agents/${this.agentId}/unread`);
    return await this._json(res);
  }

  /**
   * Broadcast an alert to all agents.
   */
  async alert(subject, details, priority = 2) {
    this._requireJoined();
    const res = await this._post('/api/mesh/alert', {
      senderId: this.agentId, subject, details, priority,
    });
    return (await this._json(res)).message;
  }

  /**
   * Share a tactic with the mesh.
   */
  async shareTactic(name, tactic) {
    this._requireJoined();
    const res = await this._post('/api/mesh/tactic', {
      senderId: this.agentId, name, tactic,
    });
    return (await this._json(res)).message;
  }

  /**
   * Request help from other agents.
   */
  async requestHelp(problem, context = {}) {
    this._requireJoined();
    const res = await this._post('/api/mesh/help', {
      senderId: this.agentId, problem, context,
    });
    return (await this._json(res)).message;
  }

  // ─── Knowledge ─────────────────────────────────────────────────

  /**
   * Share knowledge with the mesh.
   */
  async shareKnowledge(type, key, value, options = {}) {
    this._requireJoined();
    const res = await this._post('/api/mesh/knowledge', {
      agentId: this.agentId,
      type,
      domain: options.domain,
      key,
      value,
      confidence: options.confidence,
      source: options.source,
    });
    return (await this._json(res)).knowledge;
  }

  /**
   * Query knowledge by domain and/or type.
   */
  async queryKnowledge(params = {}) {
    const qs = new URLSearchParams();
    if (params.domain) qs.set('domain', params.domain);
    if (params.type) qs.set('type', params.type);
    if (params.agentId) qs.set('agentId', params.agentId);
    if (params.limit) qs.set('limit', params.limit);
    const res = await this._get(`/api/mesh/knowledge?${qs.toString()}`);
    return (await this._json(res)).knowledge;
  }

  /**
   * Search knowledge by keyword.
   */
  async searchKnowledge(query, limit = 20) {
    const res = await this._get(`/api/mesh/knowledge/search/${encodeURIComponent(query)}?limit=${limit}`);
    return (await this._json(res)).knowledge;
  }

  /**
   * Get knowledge domains with counts.
   */
  async getKnowledgeDomains() {
    const res = await this._get('/api/mesh/knowledge-domains');
    return (await this._json(res)).domains;
  }

  /**
   * Verify a knowledge entry.
   */
  async verifyKnowledge(knowledgeId, confidence) {
    this._requireJoined();
    const res = await this._post(`/api/mesh/knowledge/${encodeURIComponent(knowledgeId)}/verify`, {
      verifierId: this.agentId, confidence,
    });
    return await this._json(res);
  }

  // ─── Voting ────────────────────────────────────────────────────

  /**
   * Create a vote for other agents to participate in.
   */
  async createVote(subject, options, deadlineSeconds = 60) {
    this._requireJoined();
    const res = await this._post('/api/mesh/votes', {
      senderId: this.agentId, subject, options, deadlineSeconds,
    });
    return (await this._json(res)).vote;
  }

  /**
   * Cast a vote on an existing vote message.
   */
  async castVote(voteMessageId, choice, weight = 1, reason = '') {
    this._requireJoined();
    const res = await this._post(`/api/mesh/votes/${encodeURIComponent(voteMessageId)}/cast`, {
      voterId: this.agentId, choice, weight, reason,
    });
    return (await this._json(res)).result;
  }

  /**
   * Get the tally for a vote.
   */
  async tallyVote(voteMessageId) {
    const res = await this._get(`/api/mesh/votes/${encodeURIComponent(voteMessageId)}/tally`);
    return (await this._json(res)).tally;
  }

  // ─── Learning Integration ─────────────────────────────────────

  /**
   * Record a decision for learning.
   */
  async recordDecision(domain, action, context = {}, features = {}) {
    const res = await this._post('/api/mesh/learning/decisions', {
      siteId: this.siteId || 'default',
      agentId: this.agentId || this.role,
      domain, action, context, features,
    });
    return await this._json(res);
  }

  /**
   * Provide feedback on a decision.
   */
  async feedback(decisionId, outcome, reward) {
    const res = await this._post('/api/mesh/learning/feedback', {
      decisionId, outcome, reward,
    });
    return await this._json(res);
  }

  /**
   * Get a recommendation for the best action.
   */
  async recommend(domain, actions, context = {}) {
    const res = await this._post('/api/mesh/learning/recommend', {
      siteId: this.siteId || 'default',
      agentId: this.agentId || this.role,
      domain, actions, context,
    });
    return await this._json(res);
  }

  /**
   * Get learning stats.
   */
  async getLearningStats() {
    const res = await this._get(`/api/mesh/learning/stats?siteId=${this.siteId || 'default'}&agentId=${this.agentId || this.role}`);
    return (await this._json(res)).stats;
  }

  // ─── Symphony Integration ─────────────────────────────────────

  /**
   * Execute a symphony composition.
   */
  async compose(template, inputData = {}, schema = null) {
    const res = await this._post('/api/mesh/symphony/compose', {
      siteId: this.siteId || 'default',
      template, inputData, schema,
    });
    return await this._json(res);
  }

  /**
   * Get available symphony templates.
   */
  async getTemplates() {
    const res = await this._get('/api/mesh/symphony/templates');
    return (await this._json(res)).templates;
  }

  // ─── Mesh Info ─────────────────────────────────────────────────

  /**
   * Get all active agents in the mesh.
   */
  async getAgents(role = null) {
    const qs = role ? `?role=${encodeURIComponent(role)}` : '';
    const res = await this._get(`/api/mesh/agents${qs}`);
    return (await this._json(res)).agents;
  }

  /**
   * Get mesh stats.
   */
  async getStats() {
    const res = await this._get('/api/mesh/stats');
    return (await this._json(res)).stats;
  }

  /**
   * Update own agent metadata.
   */
  async updateMeta(metadata) {
    this._requireJoined();
    const res = await this._patch(`/api/mesh/agents/${this.agentId}/meta`, { metadata });
    return await this._json(res);
  }

  /**
   * Set own status.
   */
  async setStatus(status) {
    this._requireJoined();
    const res = await this._put(`/api/mesh/agents/${this.agentId}/status`, { status });
    return await this._json(res);
  }

  // ─── Events ────────────────────────────────────────────────────

  on(event, fn) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(fn);
    return this;
  }

  off(event, fn) {
    if (!this._listeners[event]) return this;
    this._listeners[event] = this._listeners[event].filter((f) => f !== fn);
    return this;
  }

  _emit(event, data) {
    if (this._listeners[event]) {
      for (const fn of this._listeners[event]) {
        try { fn(data); } catch (e) { console.error(`[WABAgentMesh] listener error on ${event}:`, e.message); }
      }
    }
  }

  // ─── Internal ──────────────────────────────────────────────────

  _requireJoined() {
    if (!this.agentId) throw new Error('Agent not joined. Call join() first.');
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this._heartbeatTimer = setInterval(async () => {
      try {
        await this._post(`/api/mesh/agents/${this.agentId}/heartbeat`);
        this._retryCount = 0;
      } catch (e) {
        this._retryCount++;
        this._emit('heartbeat-error', { retryCount: this._retryCount, error: e.message });
        if (this._retryCount >= this._maxRetries) {
          this._stopHeartbeat();
          this._emit('disconnected', { reason: 'heartbeat-failed', retries: this._retryCount });
        }
      }
    }, this.heartbeatInterval);
  }

  _stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  async _post(path, body) {
    const fetch = globalThis.fetch || require('node-fetch');
    return fetch(`${this.serverUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async _get(path) {
    const fetch = globalThis.fetch || require('node-fetch');
    return fetch(`${this.serverUrl}${path}`);
  }

  async _put(path, body) {
    const fetch = globalThis.fetch || require('node-fetch');
    return fetch(`${this.serverUrl}${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async _patch(path, body) {
    const fetch = globalThis.fetch || require('node-fetch');
    return fetch(`${this.serverUrl}${path}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async _delete(path) {
    const fetch = globalThis.fetch || require('node-fetch');
    return fetch(`${this.serverUrl}${path}`, { method: 'DELETE' });
  }

  async _json(res) {
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let msg;
      try { msg = JSON.parse(text).error; } catch (_) { msg = text || res.statusText; }
      throw new Error(`WABAgentMesh HTTP ${res.status}: ${msg}`);
    }
    return res.json();
  }
}

module.exports = { WABAgentMesh };
