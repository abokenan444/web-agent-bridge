'use strict';

/**
 * Hosted Runtime Service
 *
 * Cloud execution abstraction for running agents without local infrastructure.
 * Pay-as-you-go model with auto-scaling, resource tracking, and multi-region support.
 */

const crypto = require('crypto');
const { bus } = require('../runtime/event-bus');
const metering = require('./metering');

class HostedRuntime {
  constructor() {
    this._instances = new Map();    // instanceId → RuntimeInstance
    this._executions = new Map();   // executionId → Execution
    this._maxInstances = 1000;
  }

  /**
   * Launch a hosted runtime instance for an agent
   */
  launch(config) {
    if (!config.agentId) throw new Error('agentId required');

    const instanceId = `hrt_${crypto.randomBytes(8).toString('hex')}`;
    const instance = {
      id: instanceId,
      agentId: config.agentId,
      tier: config.tier || 'starter',
      region: config.region || 'auto',
      resources: {
        cpu: config.cpu || '0.5',        // vCPU
        memory: config.memory || '512',  // MB
        timeout: config.timeout || 300000, // 5 min default
      },
      status: 'starting',
      startedAt: Date.now(),
      lastActivity: Date.now(),
      executionCount: 0,
      computeMinutes: 0,
      errors: 0,
    };

    this._instances.set(instanceId, instance);

    // Simulate startup (in real deployment, this would provision container/lambda)
    instance.status = 'running';
    bus.emit('hosted.launched', { instanceId, agentId: config.agentId, region: instance.region });

    return instance;
  }

  /**
   * Execute a task on a hosted instance
   */
  async execute(instanceId, task) {
    const instance = this._instances.get(instanceId);
    if (!instance) throw new Error('Instance not found');
    if (instance.status !== 'running') throw new Error(`Instance not running (status: ${instance.status})`);

    const executionId = `hexe_${crypto.randomBytes(8).toString('hex')}`;
    const execution = {
      id: executionId,
      instanceId,
      agentId: instance.agentId,
      task: {
        type: task.type,
        action: task.action,
        params: task.params || {},
      },
      status: 'running',
      startedAt: Date.now(),
      completedAt: null,
      result: null,
      error: null,
      computeMs: 0,
      resources: {
        cpuUsage: 0,
        memoryUsage: 0,
        networkCalls: 0,
      },
    };

    this._executions.set(executionId, execution);
    instance.executionCount++;
    instance.lastActivity = Date.now();

    // Record metering
    metering.record(instance.agentId, 'executionsPerDay', instance.tier, 1);

    bus.emit('hosted.execution.started', { executionId, instanceId, type: task.type });

    // Return execution handle (actual execution is async in real deployment)
    return execution;
  }

  /**
   * Complete an execution (called by worker after task finishes)
   */
  completeExecution(executionId, result, error = null) {
    const execution = this._executions.get(executionId);
    if (!execution) return null;

    execution.status = error ? 'failed' : 'completed';
    execution.completedAt = Date.now();
    execution.result = result;
    execution.error = error ? { message: error.message || String(error) } : null;
    execution.computeMs = execution.completedAt - execution.startedAt;

    // Update instance stats
    const instance = this._instances.get(execution.instanceId);
    if (instance) {
      const minutes = execution.computeMs / 60000;
      instance.computeMinutes += minutes;
      metering.record(instance.agentId, 'computeMinutesPerDay', instance.tier, minutes);
      if (error) instance.errors++;
    }

    bus.emit('hosted.execution.completed', {
      executionId, instanceId: execution.instanceId,
      status: execution.status, computeMs: execution.computeMs,
    });

    return execution;
  }

  /**
   * Stop a hosted instance
   */
  stop(instanceId) {
    const instance = this._instances.get(instanceId);
    if (!instance) return false;
    instance.status = 'stopped';
    instance.stoppedAt = Date.now();
    bus.emit('hosted.stopped', { instanceId, agentId: instance.agentId });
    return true;
  }

  /**
   * Get instance
   */
  getInstance(instanceId) {
    return this._instances.get(instanceId) || null;
  }

  /**
   * List instances
   */
  listInstances(filters = {}, limit = 50) {
    let instances = Array.from(this._instances.values());
    if (filters.agentId) instances = instances.filter(i => i.agentId === filters.agentId);
    if (filters.status) instances = instances.filter(i => i.status === filters.status);
    if (filters.region) instances = instances.filter(i => i.region === filters.region);
    return instances.slice(0, limit);
  }

  /**
   * Get execution
   */
  getExecution(executionId) {
    return this._executions.get(executionId) || null;
  }

  /**
   * List executions for an instance
   */
  listExecutions(instanceId, limit = 50) {
    return Array.from(this._executions.values())
      .filter(e => e.instanceId === instanceId)
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, limit);
  }

  /**
   * Get compute usage for an agent
   */
  getComputeUsage(agentId) {
    const instances = Array.from(this._instances.values())
      .filter(i => i.agentId === agentId);

    return {
      activeInstances: instances.filter(i => i.status === 'running').length,
      totalExecutions: instances.reduce((sum, i) => sum + i.executionCount, 0),
      totalComputeMinutes: Math.round(instances.reduce((sum, i) => sum + i.computeMinutes, 0) * 100) / 100,
      totalErrors: instances.reduce((sum, i) => sum + i.errors, 0),
    };
  }

  getStats() {
    const instances = Array.from(this._instances.values());
    return {
      totalInstances: instances.length,
      running: instances.filter(i => i.status === 'running').length,
      stopped: instances.filter(i => i.status === 'stopped').length,
      totalExecutions: this._executions.size,
      totalComputeMinutes: Math.round(instances.reduce((sum, i) => sum + i.computeMinutes, 0) * 100) / 100,
    };
  }
}

const hostedRuntime = new HostedRuntime();

module.exports = { HostedRuntime, hostedRuntime };
