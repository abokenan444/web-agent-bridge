/**
 * Demo3 — Safe Mode Agent
 *
 * Shows the difference between a domain that has WAB enabled (full trust,
 * full execute) and one that doesn't (read-only / blocked).
 *
 *   node examples/safe-mode-agent.js wab-site.com untrusted-site.com
 *
 * Or pass --policy=strict|standard|permissive to change the gate.
 */

'use strict';

const { WABSafeMode } = require('../sdk');

const args = process.argv.slice(2);
const flags = {};
const domains = [];
for (const a of args) {
  if (a.startsWith('--')) {
    const [k, v] = a.replace(/^--/, '').split('=');
    flags[k] = v ?? true;
  } else domains.push(a);
}
if (domains.length === 0) {
  console.error('Usage: node examples/safe-mode-agent.js <domain1> [<domain2> ...] [--policy=standard]');
  console.error('       [--api=https://your-wab.example.com]');
  process.exit(2);
}

const safe = new WABSafeMode({
  apiBase: flags.api || process.env.WAB_API_BASE || 'https://webagentbridge.com',
  policy:  flags.policy || 'standard',
});

const COLOR = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', cyan: '\x1b[36m',
};
function color(c, s) { return process.stdout.isTTY ? `${COLOR[c]}${s}${COLOR.reset}` : s; }
function levelColor(l) { return l >= 3 ? 'green' : l === 2 ? 'cyan' : l === 1 ? 'yellow' : 'red'; }

async function checkOne(d) {
  const t0 = Date.now();
  const v = await safe.evaluate(d, { live: !!flags.live });
  const elapsed = Date.now() - t0;

  console.log('');
  console.log(color('bold', `── ${v.domain} ──────────────────────────────`));
  console.log(`Level    : ${color(levelColor(v.level), `L${v.level}`)} (${v.score_label} ${v.score})`);
  console.log(`Verdict  : ${color(v.verdict === 'allow' ? 'green' : v.verdict === 'restrict' ? 'yellow' : 'red', v.verdict.toUpperCase())}`);
  console.log(`Execute  : ${v.allow_execute ? color('green', '✓ allowed') : color('red', '✗ blocked')}`);
  console.log(`Read     : ${v.allow_read    ? color('green', '✓ allowed') : color('red', '✗ blocked')}`);
  console.log(`Reason   : ${v.reason}`);
  if (v.reasons && v.reasons.length) {
    for (const r of v.reasons) {
      const sev = r.severity === 'deny' ? 'red' : r.severity === 'restrict' ? 'yellow' : 'dim';
      console.log(color('dim', '         · ') + color(sev, `[${r.severity}] ${r.code}`) + ' ' + (r.message || ''));
    }
  }
  console.log(color('dim', `         (policy=${v.policy}, ${elapsed}ms)`));

  // Simulate the agent acting under Safe Mode
  try {
    if (v.allow_execute) {
      await safe.guardExecute(v.domain, async () => {
        console.log(color('green', `         → Agent: executing full action on ${v.domain}`));
      });
    } else if (v.allow_read) {
      await safe.guardRead(v.domain, async () => {
        console.log(color('yellow', `         → Agent: read-only mode on ${v.domain}`));
      });
    } else {
      console.log(color('red', `         → Agent: refusing to interact with ${v.domain}`));
    }
  } catch (err) {
    console.log(color('red', `         → ${err.message}`));
  }
}

(async () => {
  console.log(color('bold', `WAB Safe Mode demo — policy=${safe.policy} api=${safe.apiBase}`));
  for (const d of domains) {
    try { await checkOne(d); } catch (e) { console.error(`Error checking ${d}: ${e.message}`); }
  }
  console.log('');

  // Pick the most trusted target if multiple were given
  if (domains.length > 1) {
    const best = await safe.pickBest(domains);
    if (best) {
      console.log(color('bold', `Recommended target: `) + color(levelColor(best.level), best.domain) +
        color('dim', ` (L${best.level}, score ${best.score})`));
    }
  }
})();
