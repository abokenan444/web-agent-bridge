'use strict';

/**
 * Deterministic Replay Engine
 *
 * Records all task inputs/outputs/side-effects for deterministic replay.
 * Enables debugging, testing, and verification of agent workflows.
 */

const crypto = require('crypto');
const { bus } = require('../runtime/event-bus');

class ReplayEngine {
  constructor() {
    this._recordings = new Map();  // taskId → Recording
    this._maxRecordings = 5000;
    this._recordingEnabled = true;
  }

  /**
   * Start recording a task execution
   */
  startRecording(taskId, input) {
    if (!this._recordingEnabled) return null;

    const recording = {
      id: `rec_${crypto.randomBytes(8).toString('hex')}`,
      taskId,
      input: this._deepClone(input),
      steps: [],
      sideEffects: [],
      startedAt: Date.now(),
      completedAt: null,
      output: null,
      error: null,
      checksum: null,
      replayable: true,
    };

    this._recordings.set(taskId, recording);
    this._evict();
    return recording.id;
  }

  /**
   * Record a step in the execution
   */
  recordStep(taskId, step) {
    const rec = this._recordings.get(taskId);
    if (!rec) return;

    rec.steps.push({
      index: rec.steps.length,
      type: step.type,
      action: step.action,
      input: this._deepClone(step.input),
      output: this._deepClone(step.output),
      duration: step.duration || 0,
      timestamp: Date.now(),
    });
  }

  /**
   * Record a side effect (network call, DOM mutation, storage write, etc.)
   */
  recordSideEffect(taskId, effect) {
    const rec = this._recordings.get(taskId);
    if (!rec) return;

    rec.sideEffects.push({
      index: rec.sideEffects.length,
      type: effect.type,    // 'network', 'dom', 'storage', 'event'
      target: effect.target,
      data: this._deepClone(effect.data),
      timestamp: Date.now(),
      reversible: effect.reversible !== false,
    });
  }

  /**
   * Complete a recording
   */
  completeRecording(taskId, output, error = null) {
    const rec = this._recordings.get(taskId);
    if (!rec) return null;

    rec.completedAt = Date.now();
    rec.output = this._deepClone(output);
    rec.error = error ? { message: error.message, code: error.code } : null;
    rec.checksum = this._computeChecksum(rec);

    bus.emit('replay.recording.complete', { taskId, recordingId: rec.id, steps: rec.steps.length });
    return rec;
  }

  /**
   * Replay a recorded task
   * Returns the replay plan (steps to execute) with recorded outputs for verification
   */
  async replay(taskId, options = {}) {
    const rec = this._recordings.get(taskId);
    if (!rec) throw new Error(`No recording found for task ${taskId}`);
    if (!rec.completedAt) throw new Error('Recording not yet complete');

    const replayResult = {
      recordingId: rec.id,
      taskId,
      originalInput: rec.input,
      originalOutput: rec.output,
      steps: [],
      match: true,
      verificationMode: options.verify !== false,
      replayedAt: Date.now(),
    };

    // In verification mode, run each step and compare outputs
    if (options.executor && options.verify !== false) {
      for (const step of rec.steps) {
        try {
          const replayOutput = await options.executor(step);
          const outputMatch = this._deepEqual(step.output, replayOutput);

          replayResult.steps.push({
            index: step.index,
            action: step.action,
            originalOutput: step.output,
            replayOutput,
            match: outputMatch,
          });

          if (!outputMatch) {
            replayResult.match = false;
            if (!options.continueOnMismatch) break;
          }
        } catch (err) {
          replayResult.steps.push({
            index: step.index,
            action: step.action,
            error: err.message,
            match: false,
          });
          replayResult.match = false;
          if (!options.continueOnMismatch) break;
        }
      }
    } else {
      // Dry-run mode: just return the recorded steps
      replayResult.steps = rec.steps.map(s => ({
        index: s.index,
        action: s.action,
        input: s.input,
        output: s.output,
        duration: s.duration,
      }));
    }

    bus.emit('replay.completed', { taskId, match: replayResult.match });
    return replayResult;
  }

  /**
   * Get recording
   */
  getRecording(taskId) {
    return this._recordings.get(taskId) || null;
  }

  /**
   * List recordings
   */
  listRecordings(limit = 50) {
    const all = Array.from(this._recordings.values());
    return all.slice(-limit).reverse().map(r => ({
      id: r.id,
      taskId: r.taskId,
      steps: r.steps.length,
      sideEffects: r.sideEffects.length,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      hasError: !!r.error,
      checksum: r.checksum,
    }));
  }

  /**
   * Compare two recordings
   */
  diff(taskId1, taskId2) {
    const r1 = this._recordings.get(taskId1);
    const r2 = this._recordings.get(taskId2);
    if (!r1 || !r2) return null;

    const diffs = [];
    const maxSteps = Math.max(r1.steps.length, r2.steps.length);

    for (let i = 0; i < maxSteps; i++) {
      const s1 = r1.steps[i];
      const s2 = r2.steps[i];

      if (!s1 || !s2) {
        diffs.push({ index: i, type: 'missing', in: s1 ? 'recording2' : 'recording1' });
      } else if (!this._deepEqual(s1.output, s2.output)) {
        diffs.push({ index: i, type: 'output_mismatch', action: s1.action, output1: s1.output, output2: s2.output });
      }
    }

    return {
      match: diffs.length === 0,
      inputMatch: this._deepEqual(r1.input, r2.input),
      outputMatch: this._deepEqual(r1.output, r2.output),
      diffs,
    };
  }

  /**
   * Enable/disable recording
   */
  setEnabled(enabled) {
    this._recordingEnabled = enabled;
  }

  getStats() {
    return {
      totalRecordings: this._recordings.size,
      enabled: this._recordingEnabled,
      maxRecordings: this._maxRecordings,
    };
  }

  // ── Internal ──

  _computeChecksum(rec) {
    const data = JSON.stringify({
      input: rec.input,
      steps: rec.steps.map(s => ({ action: s.action, output: s.output })),
      output: rec.output,
    });
    return crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
  }

  _deepClone(obj) {
    if (obj === undefined || obj === null) return obj;
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch {
      return obj;
    }
  }

  _deepEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  _evict() {
    if (this._recordings.size <= this._maxRecordings) return;
    const keys = Array.from(this._recordings.keys());
    const toRemove = keys.slice(0, keys.length - this._maxRecordings);
    for (const k of toRemove) this._recordings.delete(k);
  }
}

const replayEngine = new ReplayEngine();

module.exports = { ReplayEngine, replayEngine };
