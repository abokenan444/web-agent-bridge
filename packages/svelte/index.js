'use strict';

var svelte_store = require('svelte/store');

/**
 * Resolve either an explicit WAB instance or fall back to window.WAB._instance.
 * @param {any} inst
 * @returns {any|null}
 */
function resolveInstance(inst) {
  if (inst) return inst;
  if (typeof window !== 'undefined' && window.WAB && window.WAB._instance) return window.WAB._instance;
  return null;
}

/**
 * Create a WAB store that initialises the bridge and exposes discover/execute.
 *
 * Usage in a Svelte component:
 *   const wab = createWAB({ siteUrl: 'https://example.com' });
 *   $: ready = $wab.ready;
 *   $wab.execute('addToCart', { id: '123' });
 *
 * @param {object} [config] — Config passed to WAB.init()
 * @returns {import('svelte/store').Readable & { discover: Function, execute: Function, init: Function }}
 */
function createWAB(config) {
  var state = { ready: false, error: null, instance: null };
  var _set;
  var store = svelte_store.readable(state, function (set) {
    _set = set;
    if (typeof window === 'undefined') return;
    var W = window.WAB;
    if (!W || typeof W.init !== 'function') {
      _set({ ready: false, error: new Error('window.WAB is missing — load wab.min.js'), instance: null });
      return;
    }
    try {
      var inst = W.init(config || {});
      _set({ ready: true, error: null, instance: inst });
    } catch (e) {
      _set({ ready: false, error: e instanceof Error ? e : new Error(String(e)), instance: null });
    }
  });

  /** Re-initialise with different config. */
  function init(cfg) {
    if (typeof window === 'undefined') return;
    var W = window.WAB;
    if (!W || typeof W.init !== 'function') return;
    try {
      var inst = W.init(cfg || {});
      if (_set) _set({ ready: true, error: null, instance: inst });
    } catch (e) {
      if (_set) _set({ ready: false, error: e instanceof Error ? e : new Error(String(e)), instance: null });
    }
  }

  return {
    subscribe: store.subscribe,
    init: init,
    discover: function () {
      var inst = resolveInstance(state.instance);
      if (!inst) return Promise.reject(new Error('WAB not ready'));
      return inst.discover();
    },
    execute: function (name, params) {
      var inst = resolveInstance(state.instance);
      if (!inst) return Promise.reject(new Error('WAB not ready'));
      return inst.execute(name, params || {});
    }
  };
}

/**
 * Create an action store for a single WAB action.
 *
 * @param {string} actionName
 * @param {{ instance?: any }} [options]
 * @returns {{ subscribe: Function, run: (params?: object) => Promise }}
 */
function createWABAction(actionName, options) {
  var opts = options || {};
  var _set;
  var _state = { loading: false, error: null, result: null };

  var store = svelte_store.readable(_state, function (set) {
    _set = set;
  });

  function run(params) {
    var inst = resolveInstance(opts.instance || null);
    if (!inst || typeof inst.execute !== 'function') {
      var notReady = new Error('WAB not ready');
      if (_set) _set({ loading: false, error: notReady, result: null });
      return Promise.reject(notReady);
    }

    if (_set) _set({ loading: true, error: null, result: _state.result });
    return inst.execute(actionName, params || {})
      .then(function (res) {
        _state = { loading: false, error: null, result: res };
        if (_set) _set(_state);
        return res;
      })
      .catch(function (err) {
        var e = err instanceof Error ? err : new Error(String(err));
        _state = { loading: false, error: e, result: _state.result };
        if (_set) _set(_state);
        throw err;
      });
  }

  return { subscribe: store.subscribe, run: run };
}

module.exports = {
  createWAB: createWAB,
  createWABAction: createWABAction
};
