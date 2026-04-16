'use strict';

/**
 * WAB Observability - Structured Logger, Distributed Tracer, Metrics Collector
 * 
 * Provides production-grade observability:
 * - Structured logging (JSON)
 * - Distributed tracing (OpenTelemetry-compatible spans)
 * - Metrics (counters, gauges, histograms)
 * - Correlation via traceId/spanId
 */

const crypto = require('crypto');

// ─── Structured Logger ──────────────────────────────────────────────────────

const LogLevel = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, FATAL: 4 };
const LogLevelNames = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];

class Logger {
  constructor(options = {}) {
    this._level = LogLevel[options.level?.toUpperCase()] ?? LogLevel.INFO;
    this._buffer = [];
    this._maxBuffer = options.maxBuffer || 10000;
    this._sinks = [];  // output sinks (console, file, API, etc.)
    this._context = options.context || {};

    // Default: console sink
    if (options.console !== false) {
      this._sinks.push(this._consoleSink.bind(this));
    }
  }

  child(context) {
    const childLogger = new Logger({ level: LogLevelNames[this._level], maxBuffer: 0, console: false });
    childLogger._context = { ...this._context, ...context };
    childLogger._sinks = this._sinks;
    childLogger._buffer = this._buffer;
    childLogger._maxBuffer = this._maxBuffer;
    return childLogger;
  }

  addSink(sink) { this._sinks.push(sink); }

  debug(msg, data) { this._log(LogLevel.DEBUG, msg, data); }
  info(msg, data)  { this._log(LogLevel.INFO, msg, data); }
  warn(msg, data)  { this._log(LogLevel.WARN, msg, data); }
  error(msg, data) { this._log(LogLevel.ERROR, msg, data); }
  fatal(msg, data) { this._log(LogLevel.FATAL, msg, data); }

  _log(level, msg, data) {
    if (level < this._level) return;

    const entry = {
      timestamp: new Date().toISOString(),
      level: LogLevelNames[level],
      message: msg,
      ...this._context,
      ...(data || {}),
    };

    // Buffer
    this._buffer.push(entry);
    if (this._buffer.length > this._maxBuffer) {
      this._buffer.splice(0, this._buffer.length - Math.floor(this._maxBuffer * 0.8));
    }

    // Flush to sinks
    for (const sink of this._sinks) {
      try { sink(entry); } catch (_) { /* sink error, ignore */ }
    }
  }

  _consoleSink(entry) {
    const { timestamp, level, message, ...rest } = entry;
    const meta = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : '';
    const fn = level === 'ERROR' || level === 'FATAL' ? console.error
      : level === 'WARN' ? console.warn : console.log;
    fn(`[${timestamp}] [${level}] ${message}${meta}`);
  }

  query(filter = {}, limit = 100) {
    let results = this._buffer;
    if (filter.level) results = results.filter(e => e.level === filter.level);
    if (filter.traceId) results = results.filter(e => e.traceId === filter.traceId);
    if (filter.agentId) results = results.filter(e => e.agentId === filter.agentId);
    if (filter.since) results = results.filter(e => new Date(e.timestamp).getTime() >= filter.since);
    if (filter.message) {
      const re = new RegExp(filter.message, 'i');
      results = results.filter(e => re.test(e.message));
    }
    return results.slice(-limit);
  }
}

// ─── Distributed Tracer ─────────────────────────────────────────────────────

class Tracer {
  constructor() {
    this._traces = new Map();   // traceId → { spans, metadata }
    this._maxTraces = 5000;
    this._stats = { traces: 0, spans: 0, errors: 0 };
  }

  /**
   * Start a new trace
   */
  startTrace(name, metadata = {}) {
    const traceId = `trace_${crypto.randomBytes(16).toString('hex')}`;
    const rootSpan = this._createSpan(traceId, name, null, metadata);

    this._traces.set(traceId, {
      id: traceId,
      name,
      rootSpanId: rootSpan.id,
      spans: new Map([[rootSpan.id, rootSpan]]),
      metadata,
      startedAt: Date.now(),
      completedAt: null,
      status: 'active',
    });

    this._stats.traces++;
    this._enforceLimit();
    return { traceId, spanId: rootSpan.id, span: rootSpan };
  }

  /**
   * Start a child span within a trace
   */
  startSpan(traceId, name, parentSpanId = null, metadata = {}) {
    const trace = this._traces.get(traceId);
    if (!trace) return null;

    const span = this._createSpan(traceId, name, parentSpanId || trace.rootSpanId, metadata);
    trace.spans.set(span.id, span);
    this._stats.spans++;
    return span;
  }

  /**
   * End a span
   */
  endSpan(traceId, spanId, result = {}) {
    const trace = this._traces.get(traceId);
    if (!trace) return;

    const span = trace.spans.get(spanId);
    if (!span) return;

    span.endedAt = Date.now();
    span.duration = span.endedAt - span.startedAt;
    span.status = result.error ? 'error' : 'ok';
    span.result = result;

    if (result.error) this._stats.errors++;

    // Check if all spans are done → complete trace
    let allDone = true;
    for (const [, s] of trace.spans) {
      if (!s.endedAt) { allDone = false; break; }
    }
    if (allDone) {
      trace.completedAt = Date.now();
      trace.status = 'completed';
    }
  }

  /**
   * Add event to a span (point-in-time annotation)
   */
  addEvent(traceId, spanId, name, attributes = {}) {
    const trace = this._traces.get(traceId);
    if (!trace) return;
    const span = trace.spans.get(spanId);
    if (!span) return;
    span.events.push({ name, attributes, timestamp: Date.now() });
  }

  /**
   * Get full trace
   */
  getTrace(traceId) {
    const trace = this._traces.get(traceId);
    if (!trace) return null;

    return {
      id: trace.id,
      name: trace.name,
      metadata: trace.metadata,
      status: trace.status,
      startedAt: trace.startedAt,
      completedAt: trace.completedAt,
      duration: trace.completedAt ? trace.completedAt - trace.startedAt : Date.now() - trace.startedAt,
      spans: Array.from(trace.spans.values()).map(s => ({
        id: s.id,
        name: s.name,
        parentId: s.parentId,
        status: s.status,
        duration: s.duration,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        events: s.events,
        attributes: s.attributes,
        result: s.result,
      })),
    };
  }

  /**
   * List recent traces
   */
  listTraces(limit = 50, filter = {}) {
    const results = [];
    for (const [, trace] of this._traces) {
      if (filter.status && trace.status !== filter.status) continue;
      if (filter.name && !trace.name.includes(filter.name)) continue;
      if (filter.since && trace.startedAt < filter.since) continue;
      results.push({
        id: trace.id,
        name: trace.name,
        status: trace.status,
        spanCount: trace.spans.size,
        startedAt: trace.startedAt,
        duration: trace.completedAt ? trace.completedAt - trace.startedAt : Date.now() - trace.startedAt,
      });
      if (results.length >= limit) break;
    }
    return results;
  }

  getStats() {
    return { ...this._stats, activeTraces: this._traces.size };
  }

  _createSpan(traceId, name, parentId, metadata) {
    return {
      id: `span_${crypto.randomBytes(8).toString('hex')}`,
      traceId,
      name,
      parentId,
      attributes: metadata,
      events: [],
      startedAt: Date.now(),
      endedAt: null,
      duration: null,
      status: 'active',
      result: null,
    };
  }

  _enforceLimit() {
    if (this._traces.size <= this._maxTraces) return;
    // Remove oldest completed traces
    const sorted = Array.from(this._traces.entries())
      .filter(([, t]) => t.status === 'completed')
      .sort((a, b) => a[1].startedAt - b[1].startedAt);
    const toRemove = sorted.slice(0, Math.floor(this._maxTraces * 0.2));
    for (const [id] of toRemove) this._traces.delete(id);
  }

  cleanup(maxAge = 3600_000) {
    const cutoff = Date.now() - maxAge;
    for (const [id, trace] of this._traces) {
      if (trace.status === 'completed' && trace.completedAt < cutoff) {
        this._traces.delete(id);
      }
    }
  }
}

// ─── Metrics Collector ──────────────────────────────────────────────────────

class MetricsCollector {
  constructor() {
    this._counters = new Map();     // name → value
    this._gauges = new Map();       // name → value
    this._histograms = new Map();   // name → { values, sum, count, min, max }
    this._timeSeries = new Map();   // name → [{ value, timestamp }]
    this._maxTimeSeries = 1000;
  }

  // Counter (monotonically increasing)
  increment(name, value = 1, labels = {}) {
    const key = this._key(name, labels);
    this._counters.set(key, (this._counters.get(key) || 0) + value);
    this._recordTimeSeries(key, this._counters.get(key));
  }

  getCounter(name, labels = {}) {
    return this._counters.get(this._key(name, labels)) || 0;
  }

  // Gauge (can go up or down)
  gauge(name, value, labels = {}) {
    const key = this._key(name, labels);
    this._gauges.set(key, value);
    this._recordTimeSeries(key, value);
  }

  getGauge(name, labels = {}) {
    return this._gauges.get(this._key(name, labels)) || 0;
  }

  // Histogram (distribution of values)
  observe(name, value, labels = {}) {
    const key = this._key(name, labels);
    let hist = this._histograms.get(key);
    if (!hist) {
      hist = { values: [], sum: 0, count: 0, min: Infinity, max: -Infinity };
      this._histograms.set(key, hist);
    }
    hist.values.push(value);
    hist.sum += value;
    hist.count++;
    if (value < hist.min) hist.min = value;
    if (value > hist.max) hist.max = value;

    // Keep last 10000 values for percentile calculations
    if (hist.values.length > 10000) {
      hist.values = hist.values.slice(-5000);
    }
  }

  getHistogram(name, labels = {}) {
    const key = this._key(name, labels);
    const hist = this._histograms.get(key);
    if (!hist) return null;

    const sorted = [...hist.values].sort((a, b) => a - b);
    return {
      count: hist.count,
      sum: hist.sum,
      avg: hist.sum / hist.count,
      min: hist.min,
      max: hist.max,
      p50: sorted[Math.floor(sorted.length * 0.5)] || 0,
      p90: sorted[Math.floor(sorted.length * 0.9)] || 0,
      p95: sorted[Math.floor(sorted.length * 0.95)] || 0,
      p99: sorted[Math.floor(sorted.length * 0.99)] || 0,
    };
  }

  // Time series for dashboards
  getTimeSeries(name, labels = {}, since) {
    const key = this._key(name, labels);
    const series = this._timeSeries.get(key) || [];
    if (since) return series.filter(p => p.timestamp >= since);
    return series;
  }

  // Snapshot (all metrics)
  snapshot() {
    const result = { counters: {}, gauges: {}, histograms: {} };
    for (const [k, v] of this._counters) result.counters[k] = v;
    for (const [k, v] of this._gauges) result.gauges[k] = v;
    for (const [k] of this._histograms) result.histograms[k] = this.getHistogram(k);
    return result;
  }

  /**
   * Timer helper: returns a function to call when done
   */
  startTimer(name, labels = {}) {
    const start = process.hrtime.bigint();
    return () => {
      const duration = Number(process.hrtime.bigint() - start) / 1e6; // ms
      this.observe(name, duration, labels);
      return duration;
    };
  }

  _key(name, labels) {
    const labelStr = Object.entries(labels).sort().map(([k, v]) => `${k}=${v}`).join(',');
    return labelStr ? `${name}{${labelStr}}` : name;
  }

  _recordTimeSeries(key, value) {
    if (!this._timeSeries.has(key)) this._timeSeries.set(key, []);
    const series = this._timeSeries.get(key);
    series.push({ value, timestamp: Date.now() });
    if (series.length > this._maxTimeSeries) {
      series.splice(0, series.length - Math.floor(this._maxTimeSeries * 0.8));
    }
  }
}

// ─── Singletons ─────────────────────────────────────────────────────────────

const logger = new Logger({ level: process.env.LOG_LEVEL || 'INFO', console: false });
const tracer = new Tracer();
const metrics = new MetricsCollector();

module.exports = { Logger, Tracer, MetricsCollector, logger, tracer, metrics, LogLevel };
