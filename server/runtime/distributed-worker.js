'use strict';

/**
 * WAB Distributed Worker — Standalone Worker Process
 *
 * Runs as an independent process/machine that:
 *   1. Registers with the Coordinator (WAB server)
 *   2. Pulls tasks from the queue
 *   3. Executes tasks in containers (process isolation)
 *   4. Reports results back
 *   5. Sends periodic heartbeats
 *
 * Usage:
 *   node distributed-worker.js --coordinator=https://wab.example.com --name=worker-1
 *
 * Or programmatically:
 *   const { DistributedWorker } = require('./distributed-worker');
 *   const worker = new DistributedWorker({ coordinatorUrl: '...', name: '...' });
 *   await worker.start();
 */

const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const os = require('os');
const { bus } = require('./event-bus');

class DistributedWorker {
  constructor(options = {}) {
    this.coordinatorUrl = (options.coordinatorUrl || process.env.WAB_COORDINATOR_URL || 'http://localhost:3000').replace(/\/$/, '');
    this.name = options.name || `worker-${os.hostname()}-${process.pid}`;
    this.region = options.region || process.env.WAB_REGION || 'default';
    this.zone = options.zone || process.env.WAB_ZONE || 'a';
    this.capacity = options.capacity || parseInt(process.env.WAB_WORKER_CAPACITY) || 10;
    this.tags = options.tags || (process.env.WAB_WORKER_TAGS || '').split(',').filter(Boolean);
    this.pollInterval = options.pollInterval || 5000;
    this.heartbeatInterval = options.heartbeatInterval || 30000;
    this.useContainers = options.useContainers !== false;
    this.listenPort = options.listenPort || 0; // 0 = auto

    this.nodeId = null;
    this._running = new Map();     // taskId → { task, startedAt }
    this._handlers = new Map();    // taskType → handler function
    this._started = false;
    this._pollTimer = null;
    this._heartbeatTimer = null;
    this._server = null;
    this._stats = { executed: 0, succeeded: 0, failed: 0 };
    this._containerRunner = null;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────

  /**
   * Start the worker — register, start polling, start heartbeat
   */
  async start() {
    if (this._started) return;

    // Optionally load container runner
    if (this.useContainers) {
      try {
        const { containerRunner } = require('./container');
        this._containerRunner = containerRunner;
      } catch {
        this.useContainers = false;
      }
    }

    // Start push notification server
    await this._startNotificationServer();

    // Register with coordinator
    const endpoint = `http://${this._getLocalIP()}:${this._actualPort}`;
    const reg = await this._post('/api/os/cluster/nodes', {
      name: this.name,
      endpoint,
      region: this.region,
      zone: this.zone,
      capacity: this.capacity,
      tags: this.tags,
      hardware: this._getHardware(),
      version: require('../../package.json').version,
    });

    this.nodeId = reg.nodeId;
    this._started = true;

    // Start polling for tasks
    this._pollTimer = setInterval(() => this._poll(), this.pollInterval);

    // Start heartbeat
    this._heartbeatTimer = setInterval(() => this._heartbeat(), this.heartbeatInterval);

    console.log(`[Worker] ${this.name} registered as ${this.nodeId} at ${endpoint}`);
    console.log(`[Worker] Coordinator: ${this.coordinatorUrl}, Region: ${this.region}, Capacity: ${this.capacity}`);

    bus.emit('worker.started', { nodeId: this.nodeId, name: this.name });
    return { nodeId: this.nodeId, name: this.name };
  }

  /**
   * Stop the worker gracefully — finish running tasks, deregister
   */
  async stop() {
    if (!this._started) return;
    this._started = false;

    if (this._pollTimer) clearInterval(this._pollTimer);
    if (this._heartbeatTimer) clearInterval(this._heartbeatTimer);

    // Wait for running tasks to complete (with timeout)
    if (this._running.size > 0) {
      console.log(`[Worker] Waiting for ${this._running.size} running tasks...`);
      const deadline = Date.now() + 30000;
      while (this._running.size > 0 && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    // Deregister
    if (this.nodeId) {
      try {
        await this._delete(`/api/os/cluster/nodes/${this.nodeId}`);
      } catch {}
    }

    if (this._server) {
      this._server.close();
    }

    console.log(`[Worker] ${this.name} stopped. Executed: ${this._stats.executed}`);
    bus.emit('worker.stopped', { nodeId: this.nodeId, stats: this._stats });
  }

  /**
   * Register a task type handler
   */
  registerHandler(taskType, handler) {
    this._handlers.set(taskType, handler);
  }

  // ─── Task Execution ─────────────────────────────────────────────────

  /**
   * Execute a task
   */
  async _executeTask(task) {
    const taskId = task.taskId;
    this._running.set(taskId, { task, startedAt: Date.now() });
    this._stats.executed++;

    // Report started
    try {
      await this._post(`/api/os/cluster/tasks/${taskId}/started`, {});
    } catch {}

    try {
      let result;
      const handler = this._handlers.get(task.type);

      if (handler) {
        // Use registered handler
        result = await handler(task.params, {
          taskId,
          type: task.type,
          objective: task.objective,
          priority: task.priority,
          timeout: task.timeout,
          nodeId: this.nodeId,
          workerName: this.name,
        });
      } else if (this._containerRunner && typeof task.params === 'object' && task.params._code) {
        // Execute in container isolation
        const containerResult = await this._containerRunner.runInProcess(taskId, task.params._code, {
          params: task.params,
          timeout: task.timeout || 60000,
          maxMemory: task.params._maxMemory || 256 * 1024 * 1024,
        });
        result = containerResult.success ? containerResult.result : { error: containerResult.error };
        if (!containerResult.success) throw new Error(containerResult.error);
      } else {
        // Default: return params as acknowledgment
        result = { received: true, type: task.type, params: task.params };
      }

      // Report completed
      await this._post(`/api/os/cluster/tasks/${taskId}/completed`, { result });
      this._stats.succeeded++;
      bus.emit('worker.task.completed', { taskId, nodeId: this.nodeId });
    } catch (err) {
      // Report failed
      try {
        await this._post(`/api/os/cluster/tasks/${taskId}/failed`, { error: err.message });
      } catch {}
      this._stats.failed++;
      bus.emit('worker.task.failed', { taskId, nodeId: this.nodeId, error: err.message });
    } finally {
      this._running.delete(taskId);
    }
  }

  // ─── Polling ────────────────────────────────────────────────────────

  async _poll() {
    if (!this._started || !this.nodeId) return;

    const available = this.capacity - this._running.size;
    if (available <= 0) return;

    try {
      const response = await this._post(`/api/os/cluster/nodes/${this.nodeId}/pull`, {
        limit: Math.min(available, 5),
      });

      if (response.tasks && response.tasks.length > 0) {
        for (const task of response.tasks) {
          // Execute each task concurrently
          this._executeTask(task).catch(() => {});
        }
      }
    } catch (err) {
      // Coordinator unreachable — will retry on next poll
    }
  }

  // ─── Heartbeat ──────────────────────────────────────────────────────

  async _heartbeat() {
    if (!this._started || !this.nodeId) return;

    try {
      await this._post(`/api/os/cluster/nodes/${this.nodeId}/heartbeat`, {
        capacityUsed: this._running.size,
        capacityTotal: this.capacity,
        hardware: this._getHardware(),
        version: require('../../package.json').version,
      });
    } catch {
      // Will retry next interval
    }
  }

  // ─── Push Notification Server ───────────────────────────────────────

  async _startNotificationServer() {
    return new Promise((resolve) => {
      this._server = http.createServer((req, res) => {
        if (req.method === 'POST' && req.url === '/wab-worker/tasks/notify') {
          let body = '';
          req.on('data', d => { body += d; if (body.length > 1024 * 1024) req.destroy(); });
          req.on('end', () => {
            try {
              const msg = JSON.parse(body);
              if (msg.type === 'task.assigned' && msg.taskId) {
                // Start executing the pushed task
                this._executeTask({
                  taskId: msg.taskId,
                  type: msg.taskType,
                  objective: msg.objective,
                  params: msg.params,
                  priority: msg.priority,
                  timeout: msg.timeout,
                }).catch(() => {});
              }
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end('{"ok":true}');
            } catch {
              res.writeHead(400);
              res.end('{"error":"bad request"}');
            }
          });
        } else if (req.method === 'GET' && req.url === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            nodeId: this.nodeId,
            name: this.name,
            running: this._running.size,
            capacity: this.capacity,
            stats: this._stats,
          }));
        } else {
          res.writeHead(404);
          res.end('{"error":"not found"}');
        }
      });

      this._server.listen(this.listenPort, () => {
        this._actualPort = this._server.address().port;
        resolve();
      });
    });
  }

  // ─── HTTP Helpers ───────────────────────────────────────────────────

  _post(path, data) {
    return this._request('POST', path, data);
  }

  _delete(path) {
    return this._request('DELETE', path);
  }

  _request(method, urlPath, data) {
    return new Promise((resolve, reject) => {
      const url = new URL(urlPath, this.coordinatorUrl);
      const mod = url.protocol === 'https:' ? https : http;
      const payload = data ? JSON.stringify(data) : null;

      const req = mod.request(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          'X-WAB-Worker': this.nodeId || this.name,
        },
        timeout: 10000,
      }, (res) => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve({ raw: body });
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
      if (payload) req.write(payload);
      req.end();
    });
  }

  _getLocalIP() {
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      for (const iface of ifaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) return iface.address;
      }
    }
    return '127.0.0.1';
  }

  _getHardware() {
    return {
      cpus: os.cpus().length,
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
      platform: os.platform(),
      arch: os.arch(),
      uptime: os.uptime(),
      loadAvg: os.loadavg(),
    };
  }
}

module.exports = { DistributedWorker };
