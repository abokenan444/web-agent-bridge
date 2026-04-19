# WAB Trust Protocol Specification v2.5

> An open protocol for platform trust and fairness — like HTTPS for e-commerce transparency.

## Overview

The WAB Trust Protocol allows websites to publish a machine-readable trust manifest at `/.well-known/wab.json`. This manifest declares the site's fairness commitments, agent policies, and data practices.

**Goal:** Create an industry standard so AI agents can verify platform trustworthiness before recommending products or services.

## Manifest Location

```
https://example.com/.well-known/wab.json
```

## Manifest Schema

```json
{
  "wab_certified": false,
  "fairness_score": 85,
  "last_audit": "2026-04-19",
  "transparency_url": "https://example.com/transparency",
  "contact_email": "trust@example.com",
  "dispute_url": "https://example.com/disputes",
  "policies": {
    "hidden_fees": false,
    "fair_reviews": true,
    "data_privacy": true,
    "seller_fairness": true
  },
  "schema_version": "2.5",
  "powered_by": "WAB Trust Layer Protocol | https://www.webagentbridge.com"
}
```

## Field Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `wab_certified` | boolean | Yes | Whether the site has passed official WAB audit |
| `fairness_score` | number (0-100) | Yes | Self-reported or audited fairness score |
| `last_audit` | string (ISO date) | Yes | Date of last fairness audit |
| `transparency_url` | string (HTTPS URL) | Yes | Public transparency report URL |
| `contact_email` | string | Recommended | Contact for trust-related inquiries |
| `dispute_url` | string | Recommended | URL for filing disputes |
| `policies.hidden_fees` | boolean | Yes | `false` = no hidden fees (good) |
| `policies.fair_reviews` | boolean | Yes | `true` = reviews are not manipulated |
| `policies.data_privacy` | boolean | Yes | `true` = user data is protected |
| `policies.seller_fairness` | boolean | Yes | `true` = fair treatment of sellers |
| `schema_version` | string | Yes | Protocol version (current: "2.5") |

## Validation Rules

1. `wab_certified` must be a boolean
2. `fairness_score` must be a number between 0 and 100
3. `last_audit` must be a valid ISO date string
4. `transparency_url` must be a valid HTTPS URL
5. Audit older than 90 days triggers a warning
6. `contact_email` and `dispute_url` are strongly recommended

## Server Configuration

### Nginx

```nginx
location = /.well-known/wab.json {
    alias /var/www/example.com/wab.json;
    add_header Content-Type application/json;
    add_header Access-Control-Allow-Origin *;
    add_header Cache-Control "public, max-age=3600";
}
```

### Express.js

```javascript
const { WABTrustManifest } = require('@aspect/wab-trust-protocol');

const manifest = WABTrustManifest.generate({
  domain: 'example.com',
  fairnessScore: 85,
  contactEmail: 'trust@example.com',
  policies: ['no-hidden-fees', 'fair-reviews', 'data-privacy', 'seller-fairness'],
});

app.use(WABTrustManifest.expressMiddleware(manifest));
```

### Apache

```apache
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteRule ^\.well-known/wab\.json$ /wab.json [L]
</IfModule>

<Files "wab.json">
  Header set Content-Type "application/json"
  Header set Access-Control-Allow-Origin "*"
  Header set Cache-Control "public, max-age=3600"
</Files>
```

## Verification

Domains can be verified at:
```
https://www.webagentbridge.com/api/growth/trust/verify/{domain}
```

The verification process:
1. Fetches `/.well-known/wab.json` from the domain
2. Validates the manifest schema
3. Cross-checks with WAB's proprietary verification engine
4. Returns certification status

## Trust Badge

Verified domains can embed a trust badge:
```
https://www.webagentbridge.com/api/growth/trust/badge/{domain}
```

## License

The WAB Trust Protocol Specification is open source (MIT License).
The verification engine and certification process are proprietary.

---

*Powered by [WAB — Web Agent Bridge](https://www.webagentbridge.com)*
