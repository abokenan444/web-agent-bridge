/**
 * WAB Agent Mesh SDK
 *
 * Provides a high-level client for interacting with the Private Agent Mesh:
 *   - Join the mesh and communicate with other agents
 *   - Share and query collective knowledge
 *   - Run symphony orchestrations (Researcher → Analyst → Negotiator → Guardian)
 *   - Learn from user decisions via local reinforcement learning
 *
 * Usage:
 *   const { WABAgentMesh } = require('web-agent-bridge-sdk/agent-mesh');
 *   const mesh = new WABAgentMesh('https://your-wab-server.com');
 *
 *   const agent = await mesh.join('researcher', 'PriceBot');
 *   await mesh.shareKnowledge('price', 'amazon.com', 'iphone-15', { price: 999, currency: 'USD' });
 *   const result = await mesh.symphony('Find the best deal on iPhone 15', 'purchase', { products: [...] });
 */

class WABAgentMesh {
  /**
   * @param {string} serverUrl — WAB server base URL
   * @param {object} [options]
   * @param {string} [options.siteId] — Site identifier
   * @param {number} [options.heartbeatInterval=30000] — Heartbeat interval in ms
   */
  constructor(serverUrl, options = {}) {
    this.serverUrl = serverUrl.replace(/\/$/, '');
    this.siteId = options.siteId || 'default';
    this.heartbeatInterval = options.heartbeatInterval || 30000;
    this.agentId = null;
    this.role = null;
    this._heartbeatTimer = null;
  }

  // ─── Mesh Management ──────────────────────────────────────────────

  /**
   * Join the agent mesh with a role.
   * @param {string} role — Agent role (researcher, negotiator, analyst, guardian, etc.)
   * @param {string} [displayName] — Human-readable name
   * @param {string[]} [capabilities] — List of capabilities
   * @returns {Promise<{id: string, role: string, displayName: string}>}
   */
  async join(role, displayName, capabilities = []) {
    const data = await this._post('/api/mesh/agents', {
      siteId: this.siteId, role, displayName, capabilities
    });
    this.agentId = data.id;
    this.role = role;

    // Start heartbeat
    this._heartbeatTimer = setInterval(() => {
      this._post(`/api/mesh/agents/${this.agentId}/heartbeat`, {}).catch(() => {});
    }, this.heartbeatInterval);
    if (this._heartbeatTimer.unref) this._heartbeatTimer.unref();

    return data;
  }

  /**
   * Leave the mesh.
   */
  async leave() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
    if (this.agentId) {
      await this._patch(`/api/mesh/agents/${this.agentId}/status`, { status: 'offline' });
      this.agentId = null;
    }
  }

  /**
   * Get all active agents in the mesh.
   */
  async getAgents() {
    return this._get('/api/mesh/agents');
  }

  /**
   * Get agents by role.
   */
  async getAgentsByRole(role) {
    return this._get(`/api/mesh/agents/role/${encodeURIComponent(role)}`);
  }

  // ─── Messaging ────────────────────────────────────────────────────

  /**
   * Publish a message to a channel.
   */
  async publish(channel, messageType, subject, payload = {}, options = {}) {
    this._requireAgent();
    return this._post(`/api/mesh/channels/${encodeURIComponent(channel)}/messages`, {
      senderId: this.agentId, messageType, subject, payload,
      priority: options.priority, ttl: options.ttl, targetId: options.targetId
    });
  }

  /**
   * Get unread messages for this agent on a channel.
   */
  async receive(channel, limit = 20) {
    this._requireAgent();
    return this._get(`/api/mesh/agents/${this.agentId}/messages/${encodeURIComponent(channel)}?limit=${limit}`);
  }

  /**
   * Acknowledge a message.
   */
  async acknowledge(messageId) {
    this._requireAgent();
    return this._post(`/api/mesh/agents/${this.agentId}/messages/${messageId}/ack`, {});
  }

  /**
   * Get unread count.
   */
  async getUnreadCount() {
    this._requireAgent();
    return this._get(`/api/mesh/agents/${this.agentId}/unread`);
  }

  /**
   * Broadcast an alert to all mesh agents.
   */
  async alert(subject, details = {}, priority = 2) {
    this._requireAgent();
    return this._post('/api/mesh/alerts', { senderId: this.agentId, subject, details, priority });
  }

  /**
   * Share a tactic with the mesh.
   */
  async shareTactic(domain, tactic, confidence = 1.0) {
    this._requireAgent();
    return this._post('/api/mesh/tactics', {
      senderId: this.agentId, domain, tactic, confidence
    });
  }

  /**
   * Request help from other agents.
   */
  async requestHelp(subject, question, targetRole = null) {
    this._requireAgent();
    return this._post('/api/mesh/help', {
      senderId: this.agentId, subject, question, targetRole
    });
  }

  // ─── Knowledge ────────────────────────────────────────────────────

  /**
   * Share knowledge to the mesh.
   */
  async shareKnowledge(knowledgeType, domain, key, value, confidence = 1.0) {
    this._requireAgent();
    return this._post('/api/mesh/knowledge', {
      agentId: this.agentId, knowledgeType, domain, key, value, confidence
    });
  }

  /**
   * Query knowledge by domain and key.
   */
  async queryKnowledge(domain, key) {
    return this._get(`/api/mesh/knowledge/${encodeURIComponent(domain)}/${encodeURIComponent(key)}`);
  }

  /**
   * Search knowledge by domain.
   */
  async searchKnowledge(domain, limit = 20) {
    return this._get(`/api/mesh/knowledge/${encodeURIComponent(domain)}?limit=${limit}`);
  }

  // ─── Symphony Orchestrator ────────────────────────────────────────

  /**
   * Run a full symphony — coordinate researcher, analyst, negotiator, guardian.
   * @param {string} task — Task description
   * @param {string} taskType — purchase, price_comparison, negotiation, exploration, verification
   * @param {object} [inputData] — Data to pass to symphony phases
   * @param {object} [agentIds] — Map role → agentId for specific agents
   */
  async symphony(task, taskType, inputData = {}, agentIds = {}) {
    return this._post('/api/mesh/symphony/perform', {
      siteId: this.siteId, task, taskType, inputData, agentIds
    });
  }

  /**
   * Compose a symphony step-by-step.
   */
  async symphonyCompose(task, taskType, agentIds = {}) {
    return this._post('/api/mesh/symphony/compose', {
      siteId: this.siteId, task, taskType, agentIds
    });
  }

  /**
   * Execute a single symphony phase.
   */
  async symphonyPhase(compositionId, phase, input = {}) {
    return this._post(`/api/mesh/symphony/${compositionId}/phase`, { phase, input });
  }

  /**
   * Get composition details.
   */
  async getComposition(compositionId) {
    return this._get(`/api/mesh/symphony/${compositionId}`);
  }

  /**
   * Get available symphony templates.
   */
  async getTemplates() {
    return this._get('/api/mesh/symphony/templates/all');
  }

  // ─── Learning Engine ──────────────────────────────────────────────

  /**
   * Record a decision for the learning engine.
   */
  async recordDecision(domain, action, context = {}, features = {}) {
    this._requireAgent();
    return this._post('/api/mesh/learning/decisions', {
      siteId: this.siteId, agentId: this.agentId, domain, action, context, features
    });
  }

  /**
   * Provide feedback on a decision.
   * @param {string} decisionId
   * @param {string} outcome — accepted, rejected, modified
   * @param {number} reward — 0.0 to 1.0
   */
  async feedback(decisionId, outcome, reward) {
    return this._post(`/api/mesh/learning/decisions/${decisionId}/feedback`, { outcome, reward });
  }

  /**
   * Get recommendation based on learned preferences.
   * @param {string} domain
   * @param {string[]} actions — Available actions to choose from
   * @param {object} [context] — Current context
   */
  async recommend(domain, actions, context = {}) {
    this._requireAgent();
    return this._post('/api/mesh/learning/recommend', {
      siteId: this.siteId, agentId: this.agentId, domain, actions, context
    });
  }

  /**
   * Get learned preferences for a domain.
   */
  async getPreferences(domain) {
    this._requireAgent();
    return this._get(`/api/mesh/learning/preferences/${encodeURIComponent(this.siteId)}/${this.agentId}/${encodeURIComponent(domain)}`);
  }

  /**
   * Get learning stats.
   */
  async getLearningStats() {
    this._requireAgent();
    return this._get(`/api/mesh/learning/stats/${encodeURIComponent(this.siteId)}/${this.agentId}`);
  }

  // ─── Stats ────────────────────────────────────────────────────────

  /**
   * Get mesh statistics.
   */
  async getStats() {
    return this._get('/api/mesh/stats');
  }

  /**
   * Get full dashboard data (agents, channels, templates, stats).
   */
  async getDashboard() {
    return this._get('/api/mesh/dashboard');
  }

  // ─── Internal ─────────────────────────────────────────────────────

  _requireAgent() {
    if (!this.agentId) throw new Error('Must call join() first');
  }

  async _get(path) {
    const res = await fetch(`${this.serverUrl}${path}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  }

  async _post(path, body) {
    const res = await fetch(`${this.serverUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  }

  async _patch(path, body) {
    const res = await fetch(`${this.serverUrl}${path}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  }
}

module.exports = { WABAgentMesh };
