'use strict';

/**
 * Deterministic Replay Engine
 *
 * Records all task inputs/outputs/side-effects for deterministic replay.
 * Enables debugging, testing, and verification of agent workflows.
 *
 * v2 Upgrades:
 *   - SQLite persistence (survives restarts)
 *   - Event sourcing integration (every action is an event)
 *   - Checkpoint persistence
 *   - Recording export/import
 *   - Diff between any two runs
 */

const crypto = require('crypto');
const { bus } = require('../runtime/event-bus');
const { db } = require('../models/db');

// ─── Schema ──────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS replay_recordings (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    input TEXT DEFAULT '{}',
    output TEXT,
    error TEXT,
    checksum TEXT,
    steps_count INTEGER DEFAULT 0,
    side_effects_count INTEGER DEFAULT 0,
    replayable INTEGER DEFAULT 1,
    started_at INTEGER NOT NULL,
    completed_at INTEGER,
    UNIQUE(task_id)
  );

  CREATE TABLE IF NOT EXISTS replay_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recording_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    event_index INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    action TEXT,
    input TEXT,
    output TEXT,
    duration_ms INTEGER DEFAULT 0,
    timestamp INTEGER NOT NULL,
    FOREIGN KEY (recording_id) REFERENCES replay_recordings(id)
  );

  CREATE TABLE IF NOT EXISTS replay_side_effects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recording_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    effect_index INTEGER NOT NULL,
    effect_type TEXT NOT NULL,
    target TEXT,
    data TEXT,
    reversible INTEGER DEFAULT 1,
    timestamp INTEGER NOT NULL,
    FOREIGN KEY (recording_id) REFERENCES replay_recordings(id)
  );

  CREATE TABLE IF NOT EXISTS replay_checkpoints (
    id TEXT PRIMARY KEY,
    recording_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    label TEXT,
    state TEXT DEFAULT '{}',
    step_index INTEGER,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (recording_id) REFERENCES replay_recordings(id)
  );

  CREATE INDEX IF NOT EXISTS idx_replay_events_rec ON replay_events(recording_id);
  CREATE INDEX IF NOT EXISTS idx_replay_events_task ON replay_events(task_id);
  CREATE INDEX IF NOT EXISTS idx_replay_se_rec ON replay_side_effects(recording_id);
  CREATE INDEX IF NOT EXISTS idx_replay_cp_rec ON replay_checkpoints(recording_id);
  CREATE INDEX IF NOT EXISTS idx_replay_rec_task ON replay_recordings(task_id);
`);

// ─── Prepared Statements ─────────────────────────────────────────────

const stmts = {
  insertRec: db.prepare(`
    INSERT OR REPLACE INTO replay_recordings (id, task_id, input, started_at)
    VALUES (@id, @task_id, @input, @started_at)
  `),
  completeRec: db.prepare(`
    UPDATE replay_recordings SET output=@output, error=@error, checksum=@checksum,
    steps_count=@steps_count, side_effects_count=@side_effects_count, completed_at=@completed_at
    WHERE id=@id
  `),
  getRec: db.prepare(`SELECT * FROM replay_recordings WHERE task_id=?`),
  getRecById: db.prepare(`SELECT * FROM replay_recordings WHERE id=?`),
  listRecs: db.prepare(`SELECT * FROM replay_recordings ORDER BY started_at DESC LIMIT ?`),
  deleteRec: db.prepare(`DELETE FROM replay_recordings WHERE id=?`),
  countRecs: db.prepare(`SELECT COUNT(*) as count FROM replay_recordings`),

  insertEvent: db.prepare(`
    INSERT INTO replay_events (recording_id, task_id, event_index, event_type, action, input, output, duration_ms, timestamp)
    VALUES (@recording_id, @task_id, @event_index, @event_type, @action, @input, @output, @duration_ms, @timestamp)
  `),
  getEvents: db.prepare(`SELECT * FROM replay_events WHERE recording_id=? ORDER BY event_index ASC`),
  countEvents: db.prepare(`SELECT COUNT(*) as count FROM replay_events WHERE recording_id=?`),

  insertSideEffect: db.prepare(`
    INSERT INTO replay_side_effects (recording_id, task_id, effect_index, effect_type, target, data, reversible, timestamp)
    VALUES (@recording_id, @task_id, @effect_index, @effect_type, @target, @data, @reversible, @timestamp)
  `),
  getSideEffects: db.prepare(`SELECT * FROM replay_side_effects WHERE recording_id=? ORDER BY effect_index ASC`),

  insertCheckpoint: db.prepare(`
    INSERT INTO replay_checkpoints (id, recording_id, task_id, label, state, step_index, created_at)
    VALUES (@id, @recording_id, @task_id, @label, @state, @step_index, @created_at)
  `),
  getCheckpoints: db.prepare(`SELECT * FROM replay_checkpoints WHERE recording_id=? ORDER BY created_at ASC`),

  deleteEvents: db.prepare(`DELETE FROM replay_events WHERE recording_id=?`),
  deleteSideEffects: db.prepare(`DELETE FROM replay_side_effects WHERE recording_id=?`),
  deleteCheckpoints: db.prepare(`DELETE FROM replay_checkpoints WHERE recording_id=?`),

  purgeOld: db.prepare(`DELETE FROM replay_recordings WHERE completed_at < ?`),
};

class ReplayEngine {
  constructor() {
    this._recordings = new Map();  // taskId → Recording (hot cache)
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
      checkpoints: [],
      startedAt: Date.now(),
      completedAt: null,
      output: null,
      error: null,
      checksum: null,
      replayable: true,
    };

    this._recordings.set(taskId, recording);
    this._evict();

    // Persist to DB
    try {
      stmts.insertRec.run({
        id: recording.id,
        task_id: taskId,
        input: JSON.stringify(recording.input),
        started_at: recording.startedAt,
      });
    } catch {}

    bus.emit('replay.recording.started', { taskId, recordingId: recording.id });
    return recording.id;
  }

  /**
   * Record a step in the execution (event sourced)
   */
  recordStep(taskId, step) {
    const rec = this._recordings.get(taskId);
    if (!rec) return;

    const idx = rec.steps.length;
    const entry = {
      index: idx,
      type: step.type,
      action: step.action,
      input: this._deepClone(step.input),
      output: this._deepClone(step.output),
      duration: step.duration || 0,
      timestamp: Date.now(),
    };

    rec.steps.push(entry);

    // Persist event
    try {
      stmts.insertEvent.run({
        recording_id: rec.id,
        task_id: taskId,
        event_index: idx,
        event_type: step.type || 'step',
        action: step.action || '',
        input: JSON.stringify(step.input),
        output: JSON.stringify(step.output),
        duration_ms: step.duration || 0,
        timestamp: entry.timestamp,
      });
    } catch {}

    // Emit for real-time observability
    bus.emit('replay.step', { taskId, index: idx, action: step.action });
  }

  /**
   * Record a side effect (network call, DOM mutation, storage write, etc.)
   */
  recordSideEffect(taskId, effect) {
    const rec = this._recordings.get(taskId);
    if (!rec) return;

    const idx = rec.sideEffects.length;
    const entry = {
      index: idx,
      type: effect.type,
      target: effect.target,
      data: this._deepClone(effect.data),
      timestamp: Date.now(),
      reversible: effect.reversible !== false,
    };

    rec.sideEffects.push(entry);

    // Persist
    try {
      stmts.insertSideEffect.run({
        recording_id: rec.id,
        task_id: taskId,
        effect_index: idx,
        effect_type: effect.type || 'unknown',
        target: effect.target || '',
        data: JSON.stringify(effect.data),
        reversible: effect.reversible !== false ? 1 : 0,
        timestamp: entry.timestamp,
      });
    } catch {}
  }

  /**
   * Save a checkpoint during recording (for partial replay)
   */
  saveCheckpoint(taskId, label, state) {
    const rec = this._recordings.get(taskId);
    if (!rec) return null;

    const cp = {
      id: `rcp_${crypto.randomBytes(8).toString('hex')}`,
      label: label || `step-${rec.steps.length}`,
      state: this._deepClone(state),
      stepIndex: rec.steps.length,
      createdAt: Date.now(),
    };

    rec.checkpoints.push(cp);

    // Persist
    try {
      stmts.insertCheckpoint.run({
        id: cp.id,
        recording_id: rec.id,
        task_id: taskId,
        label: cp.label,
        state: JSON.stringify(cp.state),
        step_index: cp.stepIndex,
        created_at: cp.createdAt,
      });
    } catch {}

    return cp.id;
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

    // Persist completion
    try {
      stmts.completeRec.run({
        id: rec.id,
        output: JSON.stringify(rec.output),
        error: rec.error ? JSON.stringify(rec.error) : null,
        checksum: rec.checksum,
        steps_count: rec.steps.length,
        side_effects_count: rec.sideEffects.length,
        completed_at: rec.completedAt,
      });
    } catch {}

    bus.emit('replay.recording.complete', { taskId, recordingId: rec.id, steps: rec.steps.length });
    return rec;
  }

  /**
   * Replay a recorded task
   */
  async replay(taskId, options = {}) {
    let rec = this._recordings.get(taskId);

    // Load from DB if not in cache
    if (!rec) {
      rec = this._loadFromDB(taskId);
      if (!rec) throw new Error(`No recording found for task ${taskId}`);
    }

    if (!rec.completedAt) throw new Error('Recording not yet complete');

    const replayResult = {
      recordingId: rec.id,
      taskId,
      originalInput: rec.input,
      originalOutput: rec.output,
      steps: [],
      match: true,
      verificationMode: options.verify !== false,
      fromCheckpoint: null,
      replayedAt: Date.now(),
    };

    // Start from a checkpoint if specified
    let startIndex = 0;
    if (options.fromCheckpoint) {
      const cp = rec.checkpoints.find(c => c.id === options.fromCheckpoint || c.label === options.fromCheckpoint);
      if (cp) {
        startIndex = cp.stepIndex;
        replayResult.fromCheckpoint = cp.label;
      }
    }

    const stepsToReplay = rec.steps.slice(startIndex);

    if (options.executor && options.verify !== false) {
      for (const step of stepsToReplay) {
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
      replayResult.steps = stepsToReplay.map(s => ({
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
   * Export a full recording (for sharing/debugging)
   */
  exportRecording(taskId) {
    let rec = this._recordings.get(taskId);
    if (!rec) rec = this._loadFromDB(taskId);
    if (!rec) return null;

    return {
      id: rec.id,
      taskId: rec.taskId,
      input: rec.input,
      output: rec.output,
      error: rec.error,
      checksum: rec.checksum,
      steps: rec.steps,
      sideEffects: rec.sideEffects,
      checkpoints: rec.checkpoints,
      startedAt: rec.startedAt,
      completedAt: rec.completedAt,
    };
  }

  /**
   * Import a recording
   */
  importRecording(data) {
    const recording = {
      id: data.id || `rec_${crypto.randomBytes(8).toString('hex')}`,
      taskId: data.taskId,
      input: data.input || {},
      steps: data.steps || [],
      sideEffects: data.sideEffects || [],
      checkpoints: data.checkpoints || [],
      startedAt: data.startedAt || Date.now(),
      completedAt: data.completedAt,
      output: data.output,
      error: data.error,
      checksum: data.checksum,
      replayable: true,
    };

    this._recordings.set(data.taskId, recording);

    // Persist
    try {
      stmts.insertRec.run({
        id: recording.id,
        task_id: recording.taskId,
        input: JSON.stringify(recording.input),
        started_at: recording.startedAt,
      });

      for (const step of recording.steps) {
        stmts.insertEvent.run({
          recording_id: recording.id,
          task_id: recording.taskId,
          event_index: step.index,
          event_type: step.type || 'step',
          action: step.action || '',
          input: JSON.stringify(step.input),
          output: JSON.stringify(step.output),
          duration_ms: step.duration || 0,
          timestamp: step.timestamp || Date.now(),
        });
      }

      if (recording.completedAt) {
        stmts.completeRec.run({
          id: recording.id,
          output: JSON.stringify(recording.output),
          error: recording.error ? JSON.stringify(recording.error) : null,
          checksum: recording.checksum || this._computeChecksum(recording),
          steps_count: recording.steps.length,
          side_effects_count: recording.sideEffects.length,
          completed_at: recording.completedAt,
        });
      }
    } catch {}

    return recording.id;
  }

  /**
   * Get recording
   */
  getRecording(taskId) {
    let rec = this._recordings.get(taskId);
    if (!rec) rec = this._loadFromDB(taskId);
    return rec || null;
  }

  /**
   * List recordings
   */
  listRecordings(limit = 50) {
    const rows = stmts.listRecs.all(limit);
    return rows.map(r => ({
      id: r.id,
      taskId: r.task_id,
      steps: r.steps_count,
      sideEffects: r.side_effects_count,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      hasError: !!r.error,
      checksum: r.checksum,
    }));
  }

  /**
   * Delete a recording and all its events
   */
  deleteRecording(taskId) {
    const rec = this._recordings.get(taskId);
    const recId = rec ? rec.id : null;
    this._recordings.delete(taskId);

    if (recId) {
      stmts.deleteEvents.run(recId);
      stmts.deleteSideEffects.run(recId);
      stmts.deleteCheckpoints.run(recId);
      stmts.deleteRec.run(recId);
    } else {
      const dbRec = stmts.getRec.get(taskId);
      if (dbRec) {
        stmts.deleteEvents.run(dbRec.id);
        stmts.deleteSideEffects.run(dbRec.id);
        stmts.deleteCheckpoints.run(dbRec.id);
        stmts.deleteRec.run(dbRec.id);
      }
    }
  }

  /**
   * Compare two recordings
   */
  diff(taskId1, taskId2) {
    let r1 = this._recordings.get(taskId1) || this._loadFromDB(taskId1);
    let r2 = this._recordings.get(taskId2) || this._loadFromDB(taskId2);
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
   * Purge old recordings
   */
  purgeOld(maxAgeMs = 7 * 24 * 3600_000) {
    const cutoff = Date.now() - maxAgeMs;
    stmts.purgeOld.run(cutoff);
  }

  setEnabled(enabled) {
    this._recordingEnabled = enabled;
  }

  getStats() {
    const dbCount = stmts.countRecs.get();
    return {
      totalRecordings: dbCount ? dbCount.count : this._recordings.size,
      cachedRecordings: this._recordings.size,
      enabled: this._recordingEnabled,
      persistent: true,
    };
  }

  // ── Internal ──

  /**
   * Load a recording from DB (including all events/side-effects/checkpoints)
   */
  _loadFromDB(taskId) {
    const row = stmts.getRec.get(taskId);
    if (!row) return null;

    const events = stmts.getEvents.all(row.id);
    const sideEffects = stmts.getSideEffects.all(row.id);
    const checkpoints = stmts.getCheckpoints.all(row.id);

    const recording = {
      id: row.id,
      taskId: row.task_id,
      input: _safeParse(row.input, {}),
      output: _safeParse(row.output, null),
      error: _safeParse(row.error, null),
      checksum: row.checksum,
      replayable: !!row.replayable,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      steps: events.map(e => ({
        index: e.event_index,
        type: e.event_type,
        action: e.action,
        input: _safeParse(e.input, null),
        output: _safeParse(e.output, null),
        duration: e.duration_ms,
        timestamp: e.timestamp,
      })),
      sideEffects: sideEffects.map(s => ({
        index: s.effect_index,
        type: s.effect_type,
        target: s.target,
        data: _safeParse(s.data, null),
        reversible: !!s.reversible,
        timestamp: s.timestamp,
      })),
      checkpoints: checkpoints.map(c => ({
        id: c.id,
        label: c.label,
        state: _safeParse(c.state, {}),
        stepIndex: c.step_index,
        createdAt: c.created_at,
      })),
    };

    // Cache it
    this._recordings.set(taskId, recording);
    return recording;
  }

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

function _safeParse(str, fallback) {
  if (str == null) return fallback;
  if (typeof str === 'object') return str;
  try { return JSON.parse(str); } catch { return fallback; }
}

const replayEngine = new ReplayEngine();

module.exports = { ReplayEngine, replayEngine };
