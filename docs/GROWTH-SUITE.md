# WAB Growth Suite

> **Proprietary — Closed Source**
> The Growth Suite implementation is proprietary and not included in this repository.
> These features run exclusively on the official WAB platform at [webagentbridge.com](https://www.webagentbridge.com).

## Overview

WAB Growth Suite is a collection of 8 integrated modules that extend the Web Agent Bridge ecosystem with security, trust, and intelligence capabilities. All modules are accessible via REST API.

**Base URL:** `https://www.webagentbridge.com/api/growth`

---

## Modules

### 1. WAB Widget
Embeddable widget that adds WAB functionality to any website with a single `<script>` tag. Provides real-time agent bridging, fairness indicators, and user consent management.

### 2. AI Safety Layer
Pre-navigation safety check for AI agents. Scans URLs for threats before allowing agents to visit them, combining URL reputation analysis, threat pattern matching, and fairness scoring.

**Endpoint:** `POST /api/growth/safety/check`

| Parameter | Type   | Description              |
|-----------|--------|--------------------------|
| `url`     | string | URL to check             |
| `action`  | string | Agent action (e.g. `navigate`, `click`) |

**Response:** `{ safe: boolean, warnings: [], blocks: [] }`

### 3. WAB Score
Domain trust and fairness scoring system. Computes a composite score (0-100) based on fairness practices (70%) and security posture (30%). Results are cached for 24 hours.

**Endpoints:**
- `GET /api/growth/score/:domain` — Single domain score
- `POST /api/growth/score/batch` — Batch scoring (up to 50 domains)

**Response:** `{ domain, score, grade, fairness_score, security_score, details }`

**Grades:** A+ (97-100), A (93-96), A- (90-92), B+ (87-89), B (83-86), B- (80-82), C+ (77-79), C (70-76), D (60-69), F (0-59)

**Interactive page:** [webagentbridge.com/score](https://www.webagentbridge.com/score)

### 4. Trust Layer Protocol
Domain verification system based on the `/.well-known/wab.json` manifest standard. Websites publish a WAB manifest declaring their agent policies, fairness commitments, and data practices.

**Endpoints:**
- `GET /api/growth/trust/verify/:domain` — Verify domain manifest
- `POST /api/growth/trust/register` — Register for WAB certification (auth required)
- `GET /api/growth/trust/badge/:domain` — SVG trust badge

**Manifest spec:** Domains serve a JSON file at `/.well-known/wab.json` with fields like `wab_version`, `fairness_pledge`, `agent_policy`, `data_practices`.

### 5. Bounty Network
Crowdsourced threat reporting system with reputation tracking and tiered rewards. Security researchers register, submit threat reports, and earn credits based on accuracy.

**Endpoints:**
- `POST /api/growth/bounty/register` — Register as reporter (auth required)
- `POST /api/growth/bounty/submit` — Submit threat report
- `GET /api/growth/bounty/status/:id` — Report status
- `GET /api/growth/bounty/balance` — Reporter credits and accuracy
- `GET /api/growth/bounty/leaderboard` — Top reporters

**Reward tiers:** Newcomer → Contributor → Trusted → Expert → Elite → Legend

### 6. Data Marketplace
Curated datasets for security research, threat intelligence, and market analysis. Licensed data with preview samples and secure download.

**Endpoints:**
- `GET /api/growth/data/datasets` — Browse available datasets
- `GET /api/growth/data/datasets/:id` — Dataset details and pricing
- `GET /api/growth/data/datasets/:id/sample` — Free sample preview
- `POST /api/growth/data/purchase` — Purchase access (auth required)
- `GET /api/growth/data/download/:purchaseId` — Download purchased data (auth required)

**Available datasets:**
| Dataset | Category | Records |
|---------|----------|---------|
| Real-Time Threat Intelligence Feed | THREAT_INTEL | 2.8M+ |
| Platform Fairness Scores | PLATFORM_FAIR | 500+ |
| Affiliate Network Intelligence | AFFILIATE_INTEL | 200+ |
| Email Phishing Patterns | EMAIL_PHISH | 1.2M+ |
| Price Tracking & Trends | PRICE_DATA | 50M+ |

### 7. Email Protection
Email content scanning that detects phishing attempts by analyzing URLs, sender reputation, and social engineering patterns (urgency language, impersonation, etc.).

**Endpoints:**
- `POST /api/growth/email/scan` — Scan email for threats
- `GET /api/growth/email/stats` — Scan statistics

**Detection capabilities:** Phishing URLs, urgency language, impersonation, suspicious senders, credential harvesting forms, homoglyph domains.

### 8. Affiliate Intelligence
Affiliate network analysis and fraud detection. Evaluates networks for commission shaving, cookie stuffing, payment delays, and other deceptive practices.

**Endpoints:**
- `GET /api/growth/affiliate/networks` — List known networks
- `GET /api/growth/affiliate/analyze/:networkId` — Network risk analysis
- `POST /api/growth/affiliate/detect-fraud` — Custom fraud detection
- `GET /api/growth/affiliate/benchmarks` — Industry benchmarks

**Risk levels:** LOW, MODERATE, HIGH, CRITICAL

---

## URL Threat Scanner

Shared across multiple modules, the WAB Shield scanner detects:

- Phishing domains (homoglyphs, brand impersonation)
- Malware distribution URLs
- Cryptocurrency scam patterns
- Fake login pages
- Data exfiltration attempts
- Suspicious TLDs
- Known threat database matches

**Endpoint:** `POST /api/growth/scan`

**Response:** `{ url, domain, status, risk_score, threats[] }`

---

## Suite Status

`GET /api/growth/status` — Returns health and statistics for all 8 modules.

---

## Authentication

Endpoints marked **(auth required)** require a valid WAB API key passed via the `Authorization` header:

```
Authorization: Bearer YOUR_API_KEY
```

Register for API access at [webagentbridge.com/register](https://www.webagentbridge.com/register).

---

## Rate Limits

All Growth Suite endpoints are subject to rate limiting. Default: 100 requests per 15-minute window per IP.

---

## License

The WAB Growth Suite is proprietary software. All rights reserved.
Source code is not distributed with this repository. Contact [webagentbridge.com](https://www.webagentbridge.com) for licensing inquiries.
