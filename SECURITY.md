# Security Policy — Web Agent Bridge (WAB)

> **Open AI↔Web Protocol & Agent Platform**
> Versions covered: `v3.x` (current). Older versions receive critical fixes only.

This document explains how to report vulnerabilities, our threat model, the
defense-in-depth controls already deployed, and the bug bounty program.

---

## 1. Reporting a Vulnerability

**Do not open a public GitHub issue for security reports.**

Send a detailed report to **security@webagentbridge.com** (PGP key on the
website at `/.well-known/security.txt`). Include:

1. Affected component (server, browser, SDK, page URL, etc.).
2. Steps to reproduce, with PoC if possible.
3. Impact assessment (data, integrity, availability).
4. Your contact info for follow-up and bounty payment.

We acknowledge within **48 hours** and aim to triage within **5 business days**.

You may also use [GitHub Private Vulnerability Reporting](https://github.com/abokenan444/web-agent-bridge/security/advisories/new).

---

## 2. Threat Model (high level)

WAB is the bridge between AI agents and websites. The relevant attacker classes are:

| # | Adversary | Capability |
|---|---|---|
| A1 | Malicious agent | Sends crafted commands, tries to exfiltrate, abuses APIs. |
| A2 | Compromised website | Hosts malicious `wab.json` / pages designed to weaponize an agent. |
| A3 | Prompt-injection attacker | Plants instructions in scraped content / vision images / page text. |
| A4 | Network attacker | MitM, DNS spoofing on agent↔server or browser↔server links. |
| A5 | Tenant-to-tenant | Multi-tenant data leakage between sites/agents. |
| A6 | Supply chain | Compromise of dependencies, NPM packages, or CDN-hosted assets. |

---

## 3. Defense-in-Depth (current controls)

### 3.1 SSRF protection
All server-side fetches that take a URL from a request body **must** use
[`server/utils/safe-fetch.js`](server/utils/safe-fetch.js). It enforces:
- HTTP/HTTPS scheme allow-list, port allow-list (80/443 by default),
- DNS resolution + private/loopback/link-local/CGNAT/multicast/test-net CIDR block,
- per-hop re-validation on redirects (manual redirect handling),
- response body size cap (default 5 MB) and content-type allow-list,
- hard timeout via `AbortController`.

The Universal Scraper (`services/universal-scraper.js`) is wired through
`safeFetch`, blocking SSRF into AWS metadata (`169.254.169.254`), internal
RFC1918, IPv6 ULA, and link-local ranges.

### 3.2 Human-in-the-Loop gate for sensitive actions
Sensitive verbs (`purchase`, `transfer`, `delete-account`, `change-password`, …)
are intercepted in [`server/middleware/sensitiveAction.js`](server/middleware/sensitiveAction.js)
on the runtime routes (`/api/os/execute*`, `/api/os/tasks`).
The gate either:
- accepts a **timing-safe HMAC confirmation** (`X-WAB-Confirm` header) tied to
  the actor + action + nonce + timestamp (5-minute window), or
- requires an authenticated *user* token to set `confirmed:true` in the body.

Otherwise the request is rejected with HTTP `412 Precondition Required` and a
challenge that orchestrators can surface to a human.

### 3.3 Content Security Policy
- Strict CSP via Helmet, with `frame-ancestors 'none'`, `object-src 'none'`,
  `base-uri 'self'`, `form-action 'self'`.
- HTTPS-only iframes (`frame-src 'self' https:`).
- `upgrade-insecure-requests` in production.
- CSP violations are reported to `/api/security/csp-report` and the last 500
  reports are queryable at `/api/security/csp-report/recent` (admin only in prod).
- For pages that need stricter protection, set `CSP_ALLOW_UNSAFE_INLINE=false`
  in the environment to drop `'unsafe-inline'` from `script-src`/`style-src`.

### 3.4 API authentication & rate limiting
- JWT for users, agent API keys for agents, with revocation list checked on
  every request (`services/security.isJWTRevoked`).
- `express-rate-limit` is enforced per-route, with stricter limits on
  `/api/license`, `/api/search`, and password endpoints.
- Public endpoints in `routes/runtime.js` are explicitly listed; everything else
  requires a valid session or API key.

### 3.5 Tamper-evident audit log
`services/security.js` provides a chained-hash audit log
(`security_audit_log` table). Every entry carries `prev_hash → chain_hash`
so an admin can verify the full chain.

### 3.6 Sovereign Phone Shield
- AES-256-GCM personal vault with PBKDF2-SHA256 (250 000 iterations).
- Threat-intel feed promotion only after **3 unique reporters**.
- Connection telemetry is capped at 500 entries per batch and the request
  body is rate-limited.

### 3.7 Cross-origin and cookies
- Strict `cors` allow-list driven by `ALLOWED_ORIGINS`.
- `credentials: true` only for same-origin / explicitly listed origins.
- Cookies are `Secure`, `HttpOnly`, `SameSite=Lax` in production.

### 3.8 Secrets
- All secrets are checked at startup (`config/secrets.assertSecretsAtStartup`);
  the server refuses to boot with default/insecure JWT secrets in production.

---

## 4. Known Limitations & Recommendations

These are tracked openly so contributors can pick them up:

1. **mTLS between components** — currently relies on TLS at the edge; full
   mutual-TLS between API gateway and microservices is on the roadmap.
2. **Strict CSP everywhere** — many static HTML pages still rely on
   `'unsafe-inline'`. Migration to per-request nonces is in progress and can be
   forced today via `CSP_ALLOW_UNSAFE_INLINE=false`.
3. **Sandboxing for Vision/Universal scraping** — runs in the main Node process.
   For high-risk deployments, run the Universal Agent in a separate container
   with `seccomp` / `gVisor`, no egress to RFC1918 networks, and no shared
   filesystem.
4. **Reward-hacking in local RL** — the `agent-learning` service should be run
   read-only on production data; a separate offline replay buffer is recommended
   for training.
5. **Fairness algorithm leakage** — the engine is a paid component; deploy with
   restricted file permissions on `services/fairness-engine.js`.
6. **External security audit** — recommended at every major release (next: v4.0).

---

## 5. Bug Bounty Program

We run a **community-funded bounty** with the following ranges. Payments are
made in USD via PayPal/Wise or in equivalent USDC.

| Severity | Range (USD) | Examples |
|---|---|---|
| Critical | $500 – $2 500 | Auth bypass, RCE, full SSRF to internal infra, account takeover at scale, key extraction. |
| High | $200 – $750 | Stored XSS in dashboards, broken access control, persistent prompt-injection escape, IDOR on tenant data. |
| Medium | $50 – $250 | Rate-limit bypass, info disclosure of non-PII data, weak crypto with limited impact. |
| Low | Swag / $25 | Reflected XSS on static pages, missing security headers, verbose error messages. |

**Out of scope:**
- Self-XSS, social engineering, physical attacks.
- Findings on third-party services (Cloudflare, Stripe, etc.).
- Reports generated solely from automated scanners without a working PoC.
- DoS / volumetric attacks.

**Safe Harbor:** good-faith research that follows this policy and does not
violate user privacy or service availability will not be pursued legally.

---

## 6. Cryptography Notes

- JWT: HS256 with rotating server secret.
- Vault: AES-256-GCM, random 16-byte IV, PBKDF2-SHA256 with 250 000 iterations
  and per-record salt.
- Audit log: SHA-256 chained hashing.
- Signed commands: HMAC-SHA256.
- TLS: TLS 1.2+ enforced at the reverse proxy (Nginx config in `deploy/`).

We deliberately avoid bringing in custom crypto. All primitives are from the
Node `crypto` standard library.

---

## 7. Contact

- security@webagentbridge.com
- GitHub: [Private Vulnerability Reporting](https://github.com/abokenan444/web-agent-bridge/security/advisories/new)
- Discord (non-sensitive questions only): https://discord.gg/NnbpJYEF
