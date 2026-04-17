'use strict';

/**
 * WAB Container Worker — Runs inside a forked child process
 *
 * This script is the entry point for process-isolated task execution.
 * It reads the task definition from a JSON file, executes it,
 * and sends results back via IPC.
 *
 * Security:
 *   - Runs in a separate process with memory limits (--max-old-space-size)
 *   - Limited filesystem access (only its tmp directory)
 *   - Can disable network via environment
 *   - Timeout enforced by parent
 */

const fs = require('fs');
const path = require('path');

const taskFile = process.argv[2];
if (!taskFile) {
  process.stderr.write('No task file specified\n');
  process.exit(1);
}

let taskData;
try {
  taskData = JSON.parse(fs.readFileSync(taskFile, 'utf8'));
} catch (err) {
  process.stderr.write(`Failed to read task file: ${err.message}\n`);
  process.exit(1);
}

// ─── Sandbox Utilities (available to task code) ──────────────────────

const sandbox = {
  taskId: taskData.taskId,
  containerId: taskData.containerId,
  params: taskData.params || {},

  // Send progress updates
  progress(pct) {
    if (process.send) process.send({ type: 'progress', progress: pct });
  },

  // Send log messages
  log(message) {
    if (process.send) process.send({ type: 'log', message: String(message).slice(0, 1000) });
  },

  // Read a param
  param(key, defaultValue) {
    return taskData.params[key] !== undefined ? taskData.params[key] : defaultValue;
  },

  // Filesystem is restricted to tmpDir
  tmpDir: path.dirname(taskFile),

  readFile(name) {
    const p = path.join(sandbox.tmpDir, path.basename(name));
    return fs.readFileSync(p, 'utf8');
  },

  writeFile(name, content) {
    const p = path.join(sandbox.tmpDir, path.basename(name));
    fs.writeFileSync(p, content);
  },
};

// ─── Execute Task ────────────────────────────────────────────────────

async function execute() {
  try {
    let result;

    if (taskData.code) {
      // Execute provided code string in a restricted scope
      const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
      const fn = new AsyncFunction('sandbox', 'params', taskData.code);
      result = await fn(sandbox, taskData.params);
    } else if (taskData.module) {
      // Execute a module (for trusted internal tasks)
      const mod = require(taskData.module);
      if (typeof mod.execute === 'function') {
        result = await mod.execute(taskData.params, sandbox);
      } else {
        result = { error: 'Module has no execute() function' };
      }
    } else {
      result = { echo: taskData.params, message: 'No code or module specified' };
    }

    // Send result back via IPC
    if (process.send) {
      process.send({ type: 'result', data: result });
    }

    // Give IPC time to flush
    setTimeout(() => process.exit(0), 100);
  } catch (err) {
    process.stderr.write(`Task error: ${err.message}\n${err.stack}\n`);

    if (process.send) {
      process.send({ type: 'result', data: null });
    }

    setTimeout(() => process.exit(1), 100);
  }
}

execute();
