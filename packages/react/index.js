'use strict';

const React = require('react');

function resolveInstance(explicitInstanceRef) {
  if (explicitInstanceRef && explicitInstanceRef.current) return explicitInstanceRef.current;
  if (typeof window !== 'undefined' && window.WAB && window.WAB._instance) return window.WAB._instance;
  return null;
}

/**
 * Register WAB actions inside React. Requires `wab.min.js` on the page (use WABProvider or a <Script> tag).
 * @param {import('./index').WABInitConfig | null} config
 */
function useWAB(config) {
  const cfgJson = React.useMemo(() => JSON.stringify(config || {}), [config]);
  const wabRef = React.useRef(null);
  const [ready, setReady] = React.useState(false);
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const W = window.WAB;
    if (!W || typeof W.init !== 'function') {
      setError(new Error('window.WAB is missing — load wab.min.js before useWAB'));
      setReady(false);
      return undefined;
    }
    try {
      const parsed = JSON.parse(cfgJson);
      wabRef.current = W.init(parsed);
      setReady(true);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
      setReady(false);
    }
    return function cleanup() {
      wabRef.current = null;
      setReady(false);
    };
  }, [cfgJson]);

  const discover = React.useCallback(function discover() {
    if (!wabRef.current) return Promise.reject(new Error('WAB not ready'));
    return wabRef.current.discover();
  }, []);

  const execute = React.useCallback(function execute(name, params) {
    if (!wabRef.current) return Promise.reject(new Error('WAB not ready'));
    return wabRef.current.execute(name, params || {});
  }, []);

  return { ready, error, discover, execute, instance: wabRef };
}

/**
 * Execute a single WAB action with loading/error/result state.
 * @param {string} actionName
 * @param {{ instance?: React.MutableRefObject<any> | null }} [options]
 */
function useWABAction(actionName, options) {
  const opts = options || {};
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [result, setResult] = React.useState(null);

  const run = React.useCallback(function run(params) {
    var instance = resolveInstance(opts.instance || null);
    if (!instance || typeof instance.execute !== 'function') {
      var notReadyError = new Error('WAB not ready');
      setError(notReadyError);
      return Promise.reject(notReadyError);
    }

    setLoading(true);
    setError(null);
    return instance.execute(actionName, params || {})
      .then(function (res) {
        setResult(res);
        return res;
      })
      .catch(function (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
        throw err;
      })
      .finally(function () {
        setLoading(false);
      });
  }, [actionName, opts.instance]);

  return { run: run, loading: loading, error: error, result: result };
}

/**
 * Execute many WAB actions with a single hook.
 * @param {string[]} actionNames
 * @param {{ instance?: React.MutableRefObject<any> | null }} [options]
 */
function useWABActions(actionNames, options) {
  const opts = options || {};
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [results, setResults] = React.useState({});

  const executeOne = React.useCallback(function executeOne(name, params) {
    var instance = resolveInstance(opts.instance || null);
    if (!instance || typeof instance.execute !== 'function') {
      var notReadyError = new Error('WAB not ready');
      setError(notReadyError);
      return Promise.reject(notReadyError);
    }
    setLoading(true);
    setError(null);
    return instance.execute(name, params || {})
      .then(function (res) {
        setResults(function (prev) {
          var next = Object.assign({}, prev);
          next[name] = res;
          return next;
        });
        return res;
      })
      .catch(function (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
        throw err;
      })
      .finally(function () {
        setLoading(false);
      });
  }, [opts.instance]);

  const executeMany = React.useCallback(function executeMany(payloadMap) {
    var names = Array.isArray(actionNames) ? actionNames : [];
    var ops = names.map(function (name) {
      return executeOne(name, payloadMap && payloadMap[name] ? payloadMap[name] : {});
    });
    return Promise.allSettled(ops);
  }, [actionNames, executeOne]);

  return { executeOne: executeOne, executeMany: executeMany, loading: loading, error: error, results: results };
}

/**
 * Loads wab.min.js once, then renders children (for App Router: mark parent as 'use client').
 * @param {{ scriptSrc?: string, children: React.ReactNode }} props
 */
function WABProvider(props) {
  var scriptSrc = props.scriptSrc || 'https://webagentbridge.com/script/wab.min.js';
  var children = props.children;
  var _a = React.useState(function () {
    return typeof window !== 'undefined' && !!window.WAB;
  });
  var loaded = _a[0];
  var setLoaded = _a[1];
  var _b = React.useState(null);
  var loadErr = _b[0];
  var setLoadErr = _b[1];

  React.useEffect(function () {
    if (typeof window === 'undefined') return undefined;
    if (window.WAB) {
      setLoaded(true);
      return undefined;
    }
    var existing = document.querySelector('script[data-wab-client]');
    if (existing) {
      var done = function () {
        setLoaded(!!window.WAB);
      };
      existing.addEventListener('load', done);
      if (window.WAB) done();
      return function () {
        existing.removeEventListener('load', done);
      };
    }
    var s = document.createElement('script');
    s.src = scriptSrc;
    s.async = true;
    s.setAttribute('data-wab-client', '1');
    s.onload = function () {
      setLoaded(true);
      setLoadErr(null);
    };
    s.onerror = function () {
      setLoadErr(new Error('Failed to load WAB script: ' + scriptSrc));
    };
    document.head.appendChild(s);
    return undefined;
  }, [scriptSrc]);

  if (loadErr) {
    return React.createElement(
      'div',
      { role: 'alert', style: { color: 'crimson', padding: 8 } },
      loadErr.message
    );
  }
  if (!loaded) {
    return props.fallback
      ? props.fallback
      : React.createElement('span', { style: { display: 'none' }, 'aria-hidden': 'true' });
  }
  return React.createElement(React.Fragment, null, children);
}

module.exports = {
  useWAB: useWAB,
  useWABAction: useWABAction,
  useWABActions: useWABActions,
  WABProvider: WABProvider
};
