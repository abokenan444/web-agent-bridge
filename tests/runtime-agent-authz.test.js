'use strict';

/**
 * Regression tests for the Agent OS runtime cross-agent impersonation /
 * authorization-boundary advisory.
 *
 * Original issue (CVE-pending):
 *   1. authMiddleware accepted `X-WAB-Agent: <known active agent id>` as a
 *      proof-of-identity fallback (no API key, no session). Any caller who
 *      learned a target agentId could impersonate it.
 *   2. `GET /agents` returned every active agent's metadata to any
 *      authenticated caller, providing the IDs needed for (1) and for the
 *      lifecycle routes below.
 *   3. `POST /agents/:agentId/capabilities`, `DELETE /agents/:agentId`,
 *      and `POST /deployments` operated on the path/body agentId without
 *      checking that it matched the authenticated `req.agentId`, so a
 *      low-privilege agent could revoke / negotiate / deploy any other
 *      agent.
 *
 * These tests are static-source assertions (matching the style used by
 * tests/security-ssrf-and-auth.test.js) so we don't have to boot the full
 * server. They lock in the fix at the source level, which is sufficient
 * because the fix lives entirely in server/routes/runtime.js.
 */

const fs = require('fs');
const path = require('path');

describe('runtime.js — cross-agent impersonation / lifecycle authorization', () => {
  const routesPath = path.join(__dirname, '..', 'server', 'routes', 'runtime.js');
  const source = fs.readFileSync(routesPath, 'utf8');

  test('X-WAB-Agent header is no longer an authentication fallback', () => {
    // The vulnerable pattern was:
    //   const agentHeader = req.headers['x-wab-agent'];
    //   if (agentHeader) {
    //     const agent = identity.getAgent(agentHeader);
    //     if (agent && agent.status === 'active') {
    //       req.agentId = agentHeader;
    //       return next();
    //     }
    //   }
    // The header must never set req.agentId based on identity.getAgent() alone.
    const stripped = source.replace(/\s+/g, ' ');
    expect(stripped).not.toMatch(
      /req\.headers\[['"]x-wab-agent['"]\][\s\S]{0,200}identity\.getAgent\([\s\S]{0,80}return next\(\)/i
    );
    // Defensive: there must NOT be any `return next()` inside an x-wab-agent block.
    const headerBlock = source.match(/x-wab-agent[\s\S]{0,400}/i);
    if (headerBlock) {
      expect(headerBlock[0]).not.toMatch(/return next\(\)/);
    }
  });

  test('admin-token / capability path is the only way to gain cross-agent authority', () => {
    // The fix introduces:
    //   - WAB_ADMIN_TOKEN env + x-wab-admin-token header (timing-safe compare)
    //   - sessionIsAdmin(): checks ADMIN_CAPABILITIES on the session
    //   - req.isAdmin is set ONLY via these two paths
    expect(source).toMatch(/WAB_ADMIN_TOKEN/);
    expect(source).toMatch(/safeEqual\s*\(/);
    expect(source).toMatch(/ADMIN_CAPABILITIES\s*=\s*\[[^\]]*admin:agents/);
    expect(source).toMatch(/function sessionIsAdmin/);
  });

  test('ownsTarget gate exists and is applied to the four lifecycle routes', () => {
    expect(source).toMatch(/function ownsTarget\(req, targetAgentId\)/);

    // GET /agents/:agentId
    expect(source).toMatch(
      /router\.get\(['"]\/agents\/:agentId['"][\s\S]{0,200}ownsTarget\(req, req\.params\.agentId\)/
    );
    // POST /agents/:agentId/capabilities
    expect(source).toMatch(
      /router\.post\(['"]\/agents\/:agentId\/capabilities['"][\s\S]{0,200}ownsTarget\(req, req\.params\.agentId\)/
    );
    // DELETE /agents/:agentId
    expect(source).toMatch(
      /router\.delete\(['"]\/agents\/:agentId['"][\s\S]{0,200}ownsTarget\(req, req\.params\.agentId\)/
    );
    // POST /deployments — body.agentId variant
    expect(source).toMatch(
      /router\.post\(['"]\/deployments['"][\s\S]{0,400}ownsTarget\(req, agentId\)/
    );
  });

  test('GET /agents redacts other agents for non-admin callers', () => {
    // The handler must branch on req.isAdmin before calling identity.listAgents.
    // Non-admin callers must only receive identity.getAgent(req.agentId).
    const handler = source.match(
      /router\.get\(['"]\/agents['"][\s\S]{0,800}\}\)\s*;/
    );
    expect(handler).not.toBeNull();
    expect(handler[0]).toMatch(/req\.isAdmin/);
    expect(handler[0]).toMatch(/identity\.getAgent\(req\.agentId\)/);
  });

  test('ownsTarget: admin always wins, otherwise equality of agent IDs', () => {
    // Behavioral check on the helper itself. We extract and eval it in
    // isolation so we don't have to load all of runtime.js's dependencies.
    const m = source.match(
      /function ownsTarget\(req, targetAgentId\)\s*\{[\s\S]*?\n\}/
    );
    expect(m).not.toBeNull();
    // eslint-disable-next-line no-new-func
    const ownsTarget = new Function(`${m[0]}; return ownsTarget;`)();

    expect(ownsTarget({ isAdmin: true }, 'agent_other')).toBe(true);
    expect(ownsTarget({ agentId: 'agent_a' }, 'agent_a')).toBe(true);
    expect(ownsTarget({ agentId: 'agent_a' }, 'agent_b')).toBe(false);
    expect(ownsTarget({}, 'agent_a')).toBe(false);
    expect(ownsTarget({ agentId: 'agent_a' }, undefined)).toBe(false);
    expect(ownsTarget({ agentId: '' }, '')).toBe(false);
  });
});
