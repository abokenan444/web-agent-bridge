/**
 * WABCommander — SDK Client for the Commander Agent System
 *
 * Provides a high-level API for launching missions, managing edge nodes,
 * running local AI inference, and orchestrating distributed tasks.
 * Works in both browser and Node.js environments.
 */

class WABCommander {
  /**
   * @param {object} options
   * @param {string} options.serverUrl - WAB server URL
   * @param {string} [options.siteId='default'] - Site identifier
   */
  constructor(options = {}) {
    this.serverUrl = (options.serverUrl || '').replace(/\/$/, '');
    this.siteId = options.siteId || 'default';
    this._base = `${this.serverUrl}/api/commander`;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // MISSIONS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /** Launch a mission (create + execute in one call). */
  async launchMission(goal, options = {}) {
    return this._post('/missions/launch', {
      siteId: this.siteId, goal,
      title: options.title, strategy: options.strategy,
      priority: options.priority, context: options.context,
    });
  }

  /** Create a mission plan without executing it. */
  async createMission(goal, options = {}) {
    return this._post('/missions', {
      siteId: this.siteId, goal,
      title: options.title, strategy: options.strategy,
      priority: options.priority, context: options.context,
    });
  }

  /** Execute an existing mission by ID. */
  async executeMission(missionId) {
    return this._post(`/missions/${missionId}/execute`);
  }

  /** Get a mission by ID. */
  async getMission(missionId) {
    return this._get(`/missions/${missionId}`);
  }

  /** Get mission tasks. */
  async getMissionTasks(missionId) {
    return this._get(`/missions/${missionId}/tasks`);
  }

  /** List missions. */
  async listMissions(options = {}) {
    const params = new URLSearchParams({ siteId: this.siteId });
    if (options.active) params.set('active', 'true');
    if (options.limit) params.set('limit', String(options.limit));
    return this._get(`/missions?${params}`);
  }

  /** Get available decomposition strategies. */
  async getStrategies() {
    return this._get('/strategies');
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // AGENTS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /** Register a commander agent. */
  async registerAgent(agentType, options = {}) {
    return this._post('/agents', {
      siteId: this.siteId, agentType,
      displayName: options.displayName,
      capabilities: options.capabilities,
      modelInfo: options.modelInfo,
      hardware: options.hardware,
    });
  }

  /** List commander agents. */
  async listAgents(capability) {
    const params = new URLSearchParams({ siteId: this.siteId });
    if (capability) params.set('capability', capability);
    return this._get(`/agents?${params}`);
  }

  /** Send agent heartbeat. */
  async agentHeartbeat(agentId) {
    return this._post(`/agents/${agentId}/heartbeat`);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // EDGE COMPUTING
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /** Register this device as an edge node. */
  async registerEdgeNode(hostname, hardware = {}, capabilities = []) {
    return this._post('/edge/nodes', {
      siteId: this.siteId, hostname, hardware, capabilities,
    });
  }

  /** List edge nodes. */
  async listEdgeNodes(availableOnly = false) {
    const params = new URLSearchParams({ siteId: this.siteId });
    if (availableOnly) params.set('available', 'true');
    return this._get(`/edge/nodes?${params}`);
  }

  /** Send node heartbeat. */
  async nodeHeartbeat(nodeId, currentLoad = 0) {
    return this._post(`/edge/nodes/${nodeId}/heartbeat`, { currentLoad });
  }

  /** Remove an edge node. */
  async removeEdgeNode(nodeId) {
    return this._delete(`/edge/nodes/${nodeId}`);
  }

  /** Submit a task to the edge computing queue. */
  async submitEdgeTask(taskType, payload, options = {}) {
    return this._post('/edge/tasks', {
      taskType, payload,
      priority: options.priority,
      missionId: options.missionId,
      encrypt: options.encrypt,
      encryptionKey: options.encryptionKey,
    });
  }

  /** Distribute queued tasks to available nodes. */
  async distributeEdgeTasks() {
    return this._post('/edge/distribute', { siteId: this.siteId });
  }

  /** Complete a task (called by executing node). */
  async completeEdgeTask(taskId, result, success = true) {
    return this._post(`/edge/tasks/${taskId}/complete`, { result, success });
  }

  /** Get tasks for a specific node. */
  async getNodeTasks(nodeId) {
    return this._get(`/edge/tasks?nodeId=${nodeId}`);
  }

  /** List edge swarms. */
  async listSwarms(capability) {
    const params = new URLSearchParams({ siteId: this.siteId });
    if (capability) params.set('capability', capability);
    return this._get(`/edge/swarms?${params}`);
  }

  /** Get edge computing stats. */
  async getEdgeStats() {
    return this._get(`/edge/stats?siteId=${this.siteId}`);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // LOCAL AI
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /** Discover local AI models (Ollama, llama.cpp, etc.). */
  async discoverModels(customEndpoints = []) {
    return this._post('/local-ai/discover', {
      siteId: this.siteId, customEndpoints,
    });
  }

  /** Register a local model manually. */
  async registerModel(provider, modelName, endpoint, capabilities, contextWindow) {
    return this._post('/local-ai/models', {
      siteId: this.siteId, provider, modelName, endpoint, capabilities, contextWindow,
    });
  }

  /** Run local AI inference. */
  async infer(prompt, options = {}) {
    return this._post('/local-ai/infer', {
      siteId: this.siteId, prompt,
      capability: options.capability,
      modelId: options.modelId,
      systemPrompt: options.systemPrompt,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
    });
  }

  /** List local models. */
  async listModels(availableOnly = false) {
    const params = new URLSearchParams({ siteId: this.siteId });
    if (availableOnly) params.set('available', 'true');
    return this._get(`/local-ai/models?${params}`);
  }

  /** Update model status. */
  async updateModelStatus(modelId, status) {
    return this._patch(`/local-ai/models/${modelId}`, { status });
  }

  /** Get local AI stats. */
  async getLocalAIStats() {
    return this._get(`/local-ai/stats?siteId=${this.siteId}`);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // UNIFIED STATS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /** Get unified stats across commander, edge, and local AI. */
  async getStats() {
    return this._get(`/stats?siteId=${this.siteId}`);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // HTTP helpers
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  async _get(path) {
    const res = await fetch(`${this._base}${path}`);
    if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
    return res.json();
  }

  async _post(path, body = {}) {
    const res = await fetch(`${this._base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
    return res.json();
  }

  async _patch(path, body = {}) {
    const res = await fetch(`${this._base}${path}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`PATCH ${path} failed: ${res.status}`);
    return res.json();
  }

  async _delete(path) {
    const res = await fetch(`${this._base}${path}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`DELETE ${path} failed: ${res.status}`);
    return res.json();
  }
}

// Universal export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = WABCommander;
} else if (typeof window !== 'undefined') {
  window.WABCommander = WABCommander;
}
