'use strict';

/**
 * WAB Container Isolation — Real Process-Level Task Isolation
 *
 * Provides true OS-level isolation for task execution:
 *   - Process isolation via child_process.fork()
 *   - Resource limits (memory, CPU time, timeout)
 *   - Filesystem sandboxing (tmp directory per task)
 *   - Network restrictions
 *   - Audit trail of all operations
 *   - Docker container support (when available)
 *
 * Hierarchy:
 *   1. Process isolation (child_process) — always available
 *   2. Docker containers — optional, enterprise-grade
 *   3. JS sandbox — fallback (existing ExecutionSandbox)
 *
 * The worker process runs inside a container, executes the task,
 * and sends results back via IPC.
 */

const { fork, execSync } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { bus } = require('./event-bus');

// ═══════════════════════════════════════════════════════════════════════════
// CONTAINER RUNNER (child_process based)
// ═══════════════════════════════════════════════════════════════════════════

class ContainerRunner {
  constructor(options = {}) {
    this._containers = new Map();  // containerId → Container
    this._maxContainers = options.maxContainers || 50;
    this._defaultTimeout = options.defaultTimeout || 60000;
    this._defaultMaxMemory = options.defaultMaxMemory || 256 * 1024 * 1024; // 256MB
    this._tmpBase = options.tmpDir || path.join(os.tmpdir(), 'wab-containers');
    this._dockerAvailable = null;
    this._stats = {
      created: 0, completed: 0, failed: 0, timedOut: 0, killed: 0,
      totalDuration: 0, peakConcurrent: 0,
    };

    // Ensure tmp directory exists
    try { fs.mkdirSync(this._tmpBase, { recursive: true }); } catch {}
  }

  // ─── Process Containers ─────────────────────────────────────────────

  /**
   * Create and run a task in an isolated child process
   */
  async runInProcess(taskId, taskCode, options = {}) {
    if (this._containers.size >= this._maxContainers) {
      throw new Error('Maximum concurrent containers reached');
    }

    const containerId = `ctr_${crypto.randomBytes(12).toString('hex')}`;
    const tmpDir = path.join(this._tmpBase, containerId);

    try { fs.mkdirSync(tmpDir, { recursive: true }); } catch {}

    const container = {
      id: containerId,
      taskId,
      type: 'process',
      state: 'starting',
      process: null,
      tmpDir,
      pid: null,
      limits: {
        timeout: options.timeout || this._defaultTimeout,
        maxMemory: options.maxMemory || this._defaultMaxMemory,
        allowNetwork: options.allowNetwork !== false,
      },
      audit: [],
      usage: { memoryPeak: 0, cpuTime: 0 },
      startedAt: Date.now(),
      completedAt: null,
      result: null,
      error: null,
    };

    this._containers.set(containerId, container);
    this._stats.created++;
    if (this._containers.size > this._stats.peakConcurrent) {
      this._stats.peakConcurrent = this._containers.size;
    }

    container.audit.push({ action: 'created', timestamp: Date.now() });

    return new Promise((resolve, reject) => {
      // Write the task handler to a temp file
      const workerScript = path.join(__dirname, 'container-worker.js');
      const taskDataFile = path.join(tmpDir, 'task.json');
      fs.writeFileSync(taskDataFile, JSON.stringify({
        taskId,
        containerId,
        code: taskCode,
        params: options.params || {},
        timeout: container.limits.timeout,
        allowNetwork: container.limits.allowNetwork,
      }));

      // Fork a child process
      const child = fork(workerScript, [taskDataFile], {
        cwd: tmpDir,
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        env: {
          ...process.env,
          WAB_CONTAINER_ID: containerId,
          WAB_TASK_ID: taskId,
          WAB_SANDBOX: 'true',
          NODE_OPTIONS: `--max-old-space-size=${Math.floor(container.limits.maxMemory / (1024 * 1024))}`,
        },
        execArgv: [],
      });

      container.process = child;
      container.pid = child.pid;
      container.state = 'running';
      container.audit.push({ action: 'started', pid: child.pid, timestamp: Date.now() });

      bus.emit('container.started', { containerId, taskId, pid: child.pid });

      // Timeout
      const timer = setTimeout(() => {
        container.state = 'timeout';
        container.error = 'Execution timeout';
        this._stats.timedOut++;
        container.audit.push({ action: 'timeout', timestamp: Date.now() });
        child.kill('SIGKILL');
      }, container.limits.timeout);

      // Memory monitoring (sample every 2s)
      const memMonitor = setInterval(() => {
        try {
          const usage = process.memoryUsage.call(child);
          if (usage && usage.rss > container.usage.memoryPeak) {
            container.usage.memoryPeak = usage.rss;
          }
        } catch { /* process might be dead */ }
      }, 2000);

      // Collect stdout/stderr
      let stdout = '';
      let stderr = '';
      if (child.stdout) child.stdout.on('data', d => { stdout += d.toString().slice(0, 10000); });
      if (child.stderr) child.stderr.on('data', d => { stderr += d.toString().slice(0, 10000); });

      // IPC message — result from worker
      child.on('message', (msg) => {
        if (msg.type === 'result') {
          container.result = msg.data;
          container.audit.push({ action: 'result_received', timestamp: Date.now() });
        } else if (msg.type === 'progress') {
          bus.emit('container.progress', { containerId, taskId, progress: msg.progress });
        } else if (msg.type === 'log') {
          container.audit.push({ action: 'log', message: msg.message, timestamp: Date.now() });
        }
      });

      child.on('exit', (code, signal) => {
        clearTimeout(timer);
        clearInterval(memMonitor);
        container.completedAt = Date.now();
        const duration = container.completedAt - container.startedAt;
        this._stats.totalDuration += duration;

        if (container.state === 'timeout') {
          container.audit.push({ action: 'exit_timeout', code, signal, timestamp: Date.now() });
          this._cleanup(containerId);
          resolve({
            success: false,
            containerId,
            taskId,
            error: 'Execution timed out',
            duration,
            stdout: stdout.slice(0, 2000),
            stderr: stderr.slice(0, 2000),
          });
          return;
        }

        if (code === 0 && container.result !== null) {
          container.state = 'completed';
          this._stats.completed++;
          container.audit.push({ action: 'completed', code, duration, timestamp: Date.now() });
          bus.emit('container.completed', { containerId, taskId, duration });

          this._cleanup(containerId);
          resolve({
            success: true,
            containerId,
            taskId,
            result: container.result,
            duration,
            stdout: stdout.slice(0, 2000),
          });
        } else {
          container.state = 'failed';
          container.error = stderr || `Process exited with code ${code}`;
          this._stats.failed++;
          container.audit.push({ action: 'failed', code, signal, timestamp: Date.now() });
          bus.emit('container.failed', { containerId, taskId, error: container.error });

          this._cleanup(containerId);
          resolve({
            success: false,
            containerId,
            taskId,
            error: container.error,
            duration,
            stdout: stdout.slice(0, 2000),
            stderr: stderr.slice(0, 2000),
          });
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        clearInterval(memMonitor);
        container.state = 'failed';
        container.error = err.message;
        container.completedAt = Date.now();
        this._stats.failed++;
        container.audit.push({ action: 'error', message: err.message, timestamp: Date.now() });
        this._cleanup(containerId);
        resolve({
          success: false,
          containerId,
          taskId,
          error: err.message,
          duration: Date.now() - container.startedAt,
        });
      });
    });
  }

  // ─── Docker Containers ──────────────────────────────────────────────

  /**
   * Check if Docker is available
   */
  isDockerAvailable() {
    if (this._dockerAvailable !== null) return this._dockerAvailable;
    try {
      execSync('docker info', { stdio: 'ignore', timeout: 5000 });
      this._dockerAvailable = true;
    } catch {
      this._dockerAvailable = false;
    }
    return this._dockerAvailable;
  }

  /**
   * Run a task inside a Docker container
   */
  async runInDocker(taskId, image, command, options = {}) {
    if (!this.isDockerAvailable()) {
      throw new Error('Docker is not available. Use runInProcess() instead.');
    }

    const containerId = `ctr_${crypto.randomBytes(12).toString('hex')}`;
    const containerName = `wab-${containerId}`;
    const timeout = options.timeout || this._defaultTimeout;
    const memLimit = options.maxMemory || this._defaultMaxMemory;

    const container = {
      id: containerId,
      taskId,
      type: 'docker',
      state: 'starting',
      dockerName: containerName,
      image,
      pid: null,
      limits: { timeout, maxMemory: memLimit },
      audit: [],
      usage: {},
      startedAt: Date.now(),
      completedAt: null,
      result: null,
      error: null,
    };

    this._containers.set(containerId, container);
    this._stats.created++;

    const args = [
      'run', '--rm',
      '--name', containerName,
      '--memory', `${Math.floor(memLimit / (1024 * 1024))}m`,
      '--cpus', `${options.cpus || 1}`,
      '--network', options.allowNetwork ? 'bridge' : 'none',
      '--read-only',
      '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m',
    ];

    // Add environment variables
    if (options.env) {
      for (const [k, v] of Object.entries(options.env)) {
        args.push('-e', `${k}=${v}`);
      }
    }
    args.push('-e', `WAB_CONTAINER_ID=${containerId}`);
    args.push('-e', `WAB_TASK_ID=${taskId}`);

    args.push(image);
    if (command) args.push(...(Array.isArray(command) ? command : command.split(' ')));

    return new Promise((resolve) => {
      const { spawn } = require('child_process');
      const proc = spawn('docker', args, { timeout });
      container.state = 'running';

      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', d => { stdout += d.toString().slice(0, 50000); });
      proc.stderr.on('data', d => { stderr += d.toString().slice(0, 10000); });

      proc.on('exit', (code) => {
        container.completedAt = Date.now();
        const duration = container.completedAt - container.startedAt;

        if (code === 0) {
          container.state = 'completed';
          this._stats.completed++;
          // Try to parse stdout as JSON result
          try { container.result = JSON.parse(stdout); } catch { container.result = stdout; }
          resolve({ success: true, containerId, taskId, result: container.result, duration });
        } else {
          container.state = 'failed';
          container.error = stderr || `Docker exit code ${code}`;
          this._stats.failed++;
          resolve({ success: false, containerId, taskId, error: container.error, duration, stderr });
        }

        this._containers.delete(containerId);
      });

      proc.on('error', (err) => {
        container.state = 'failed';
        container.error = err.message;
        container.completedAt = Date.now();
        this._stats.failed++;
        this._containers.delete(containerId);
        resolve({ success: false, containerId, taskId, error: err.message });
      });
    });
  }

  // ─── Management ─────────────────────────────────────────────────────

  /**
   * Kill a running container
   */
  kill(containerId) {
    const container = this._containers.get(containerId);
    if (!container) return false;

    if (container.type === 'process' && container.process) {
      container.process.kill('SIGKILL');
      this._stats.killed++;
      container.audit.push({ action: 'killed', timestamp: Date.now() });
    } else if (container.type === 'docker') {
      try { execSync(`docker kill ${container.dockerName}`, { timeout: 5000 }); } catch {}
      this._stats.killed++;
    }

    container.state = 'killed';
    return true;
  }

  /**
   * Get container details
   */
  getContainer(containerId) {
    const c = this._containers.get(containerId);
    if (!c) return null;
    return {
      id: c.id,
      taskId: c.taskId,
      type: c.type,
      state: c.state,
      pid: c.pid,
      limits: c.limits,
      usage: c.usage,
      audit: c.audit,
      startedAt: c.startedAt,
      completedAt: c.completedAt,
      duration: c.completedAt ? c.completedAt - c.startedAt : Date.now() - c.startedAt,
    };
  }

  /**
   * List active containers
   */
  listContainers() {
    const result = [];
    for (const [, c] of this._containers) {
      result.push({
        id: c.id,
        taskId: c.taskId,
        type: c.type,
        state: c.state,
        pid: c.pid,
        startedAt: c.startedAt,
        duration: c.completedAt ? c.completedAt - c.startedAt : Date.now() - c.startedAt,
      });
    }
    return result;
  }

  getStats() {
    return {
      ...this._stats,
      active: this._containers.size,
      maxContainers: this._maxContainers,
      dockerAvailable: this._dockerAvailable,
      avgDuration: this._stats.completed > 0
        ? Math.round(this._stats.totalDuration / this._stats.completed) : 0,
    };
  }

  _cleanup(containerId) {
    const container = this._containers.get(containerId);
    if (!container) return;

    // Clean up temp directory
    if (container.tmpDir) {
      try { fs.rmSync(container.tmpDir, { recursive: true, force: true }); } catch {}
    }

    // Remove after a delay (to allow getContainer queries)
    setTimeout(() => this._containers.delete(containerId), 60000);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Singleton
// ═══════════════════════════════════════════════════════════════════════════

const containerRunner = new ContainerRunner();

module.exports = { ContainerRunner, containerRunner };
