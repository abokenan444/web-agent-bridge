'use strict';

var vue = require('vue');

/**
 * Resolve either an explicit WAB instance ref or fallback to window.WAB._instance.
 * @param {import('vue').Ref<any> | null} instanceRef
 * @returns {any|null}
 */
function resolveInstance(instanceRef) {
  if (instanceRef && instanceRef.value) return instanceRef.value;
  if (typeof window !== 'undefined' && window.WAB && window.WAB._instance) return window.WAB._instance;
  return null;
}

/**
 * Composable: initialise WAB and expose discover/execute helpers.
 *
 * @param {object|null} config  — WAB.init config (reactive or plain)
 * @returns {{ ready: import('vue').Ref<boolean>, error: import('vue').Ref<Error|null>, discover: () => Promise, execute: (name:string, params?:object) => Promise, instance: import('vue').Ref }}
 */
function useWAB(config) {
  var instance = vue.ref(null);
  var ready = vue.ref(false);
  var error = vue.ref(null);

  vue.onMounted(function () {
    if (typeof window === 'undefined') return;
    var W = window.WAB;
    if (!W || typeof W.init !== 'function') {
      error.value = new Error('window.WAB is missing — load wab.min.js before useWAB');
      ready.value = false;
      return;
    }
    try {
      var cfg = vue.isRef(config) ? config.value : (config || {});
      instance.value = W.init(cfg);
      ready.value = true;
      error.value = null;
    } catch (e) {
      error.value = e instanceof Error ? e : new Error(String(e));
      ready.value = false;
    }
  });

  vue.onUnmounted(function () {
    instance.value = null;
    ready.value = false;
  });

  function discover() {
    if (!instance.value) return Promise.reject(new Error('WAB not ready'));
    return instance.value.discover();
  }

  function execute(name, params) {
    if (!instance.value) return Promise.reject(new Error('WAB not ready'));
    return instance.value.execute(name, params || {});
  }

  return { ready: ready, error: error, discover: discover, execute: execute, instance: instance };
}

/**
 * Composable: execute a single WAB action with loading/error/result state.
 *
 * @param {string} actionName
 * @param {{ instance?: import('vue').Ref }} [options]
 */
function useWABAction(actionName, options) {
  var opts = options || {};
  var loading = vue.ref(false);
  var error = vue.ref(null);
  var result = vue.ref(null);

  function run(params) {
    var inst = resolveInstance(opts.instance || null);
    if (!inst || typeof inst.execute !== 'function') {
      var notReady = new Error('WAB not ready');
      error.value = notReady;
      return Promise.reject(notReady);
    }

    loading.value = true;
    error.value = null;
    return inst.execute(actionName, params || {})
      .then(function (res) {
        result.value = res;
        return res;
      })
      .catch(function (err) {
        error.value = err instanceof Error ? err : new Error(String(err));
        throw err;
      })
      .finally(function () {
        loading.value = false;
      });
  }

  return { run: run, loading: loading, error: error, result: result };
}

/**
 * Composable: execute many WAB actions.
 *
 * @param {string[]} actionNames
 * @param {{ instance?: import('vue').Ref }} [options]
 */
function useWABActions(actionNames, options) {
  var opts = options || {};
  var loading = vue.ref(false);
  var error = vue.ref(null);
  var results = vue.ref({});

  function executeOne(name, params) {
    var inst = resolveInstance(opts.instance || null);
    if (!inst || typeof inst.execute !== 'function') {
      var notReady = new Error('WAB not ready');
      error.value = notReady;
      return Promise.reject(notReady);
    }
    loading.value = true;
    error.value = null;
    return inst.execute(name, params || {})
      .then(function (res) {
        var next = Object.assign({}, results.value);
        next[name] = res;
        results.value = next;
        return res;
      })
      .catch(function (err) {
        error.value = err instanceof Error ? err : new Error(String(err));
        throw err;
      })
      .finally(function () {
        loading.value = false;
      });
  }

  function executeMany(payloadMap) {
    var names = Array.isArray(actionNames) ? actionNames : [];
    var ops = names.map(function (name) {
      return executeOne(name, payloadMap && payloadMap[name] ? payloadMap[name] : {});
    });
    return Promise.allSettled(ops);
  }

  return { executeOne: executeOne, executeMany: executeMany, loading: loading, error: error, results: results };
}

module.exports = {
  useWAB: useWAB,
  useWABAction: useWABAction,
  useWABActions: useWABActions
};
