# WAB DNS Discovery — Global Adoption Plan

## North Star

Make WAB DNS Discovery a default, one-click capability across domains, DNS providers, and registrars, similar to SSL enable/disable UX.

## Product Definition (What must be true)

1. Any domain owner can enable/disable WAB Discovery from DNS panel in one click.
2. Providers can integrate once and support all customer domains.
3. Verification is machine-readable, fast, and reliable.
4. Default setup is safe: no secrets exposed, no dangerous auto-actions.
5. End users see business value, not only technical proof.

## Protocol Contract (v1 hardening)

1. TXT host: `_wab`
2. TXT value: `v=wab1; endpoint=https://<domain>/.well-known/wab.json`
3. HTTPS required for endpoint
4. DNS + endpoint verification statuses must be explicit
5. Backward-compatible fallback path allowed (`/agent-bridge.json`)

## One-Click Architecture (Provider/Registrar)

### A) Toggle ON

1. Provider writes TXT record at `_wab.<domain>`.
2. Provider optionally scaffolds `/.well-known/wab.json` template.
3. Provider calls verification API until green status.
4. UI shows state badges: DNS verified / Agent-ready / Production.

### B) Toggle OFF

1. Provider removes TXT record.
2. Verification API confirms disabled state.
3. UI reflects disabled state quickly.

## Integration Surface for Providers

### Required

1. Add/remove TXT via provider DNS API.
2. Verify status via WAB public verification endpoint.
3. Show simple status to users in provider UI.

### Recommended

1. Prebuilt wab.json wizard (category/use-case presets).
2. Retry/rollback if propagation fails.
3. Explain failures with exact operator messages.

## New APIs to standardize (Implementation backlog)

1. `GET /api/discovery/provider/manifest`
   - Returns protocol fields, constraints, examples, and UX guidance.
2. `POST /api/discovery/provider/verify-batch`
   - Verify many domains in one request for provider dashboards.
3. `GET /api/discovery/provider/status?domain=...`
   - Minimal machine format for one-click toggles.

## Distribution Plan

### Phase 1 — Developer and SMB channels (0-30 days)

1. Cloudflare one-click script/template.
2. cPanel module and WHM/WHMCS helper.
3. Registrar integration guide with copy-paste recipes.

### Phase 2 — Platform channels (30-90 days)

1. Official integrations with top DNS providers.
2. Registrar pilot with a single medium-sized provider.
3. Public compatibility page and certification badges.

### Phase 3 — Ecosystem standard (90-180 days)

1. Public conformance tests and provider scorecards.
2. “WAB Discovery Ready” partner badge.
3. Release governance process for protocol upgrades.

## Adoption KPI Framework

1. Domains enabled (weekly active verified domains).
2. Verification success rate (<5 min target).
3. False negative rate (<1%).
4. One-click completion rate (toggle->green).
5. Real usage ratio (usage proof executions / verified domains).

## Reliability and Trust Requirements

1. Strong SSRF safeguards for all endpoint fetches.
2. Clear fallback semantics (discover endpoint vs agent-bridge.json).
3. Human-readable and machine-readable error diagnostics.
4. No hard dependency on private app IDs for protocol verification.

## Go-To-Market Message

"Like SSL for AI-readiness: one DNS toggle to make your domain discoverable by AI agents."

## Immediate Execution (next sprint)

1. Ship provider manifest endpoint.
2. Ship batch verify endpoint.
3. Publish provider quick-start docs (Cloudflare/cPanel/registrar).
4. Add public compatibility dashboard section.
5. Add onboarding CTA in DNS UI: "Enable in your provider with one click".
