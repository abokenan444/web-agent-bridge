/**
 * WAB WebSocket Client with auto-reconnect and exponential backoff
 * Usage:
 *   const ws = new WABWebSocket(token, siteId);
 *   ws.on('analytic', (data) => console.log(data));
 *   ws.connect();
 */
class WABWebSocket {
  constructor(token, siteId, options = {}) {
    this.token = token;
    this.siteId = siteId;
    this.maxRetries = options.maxRetries || 10;
    this.baseDelay = options.baseDelay || 1000;
    this.maxDelay = options.maxDelay || 30000;
    this._retries = 0;
    this._ws = null;
    this._listeners = {};
    this._closed = false;
  }

  connect() {
    if (this._closed) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this._ws = new WebSocket(`${proto}//${location.host}/ws/analytics`);

    this._ws.onopen = () => {
      this._retries = 0;
      this._ws.send(JSON.stringify({ type: 'auth', token: this.token, siteId: this.siteId }));
      this._emit('connected');
    };

    this._ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        this._emit(msg.type, msg);
      } catch { /* ignore malformed */ }
    };

    this._ws.onclose = () => {
      this._emit('disconnected');
      this._reconnect();
    };

    this._ws.onerror = () => {
      this._ws.close();
    };
  }

  _reconnect() {
    if (this._closed || this._retries >= this.maxRetries) {
      this._emit('max_retries');
      return;
    }
    const delay = Math.min(this.baseDelay * Math.pow(2, this._retries), this.maxDelay);
    const jitter = delay * (0.5 + Math.random() * 0.5);
    this._retries++;
    this._emit('reconnecting', { attempt: this._retries, delay: Math.round(jitter) });
    setTimeout(() => this.connect(), jitter);
  }

  on(event, cb) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(cb);
  }

  _emit(event, data) {
    (this._listeners[event] || []).forEach(cb => { try { cb(data); } catch {} });
  }

  close() {
    this._closed = true;
    if (this._ws) this._ws.close();
  }
}
