# @wab/dns-verify

> Reference verifier for the **WAB DNS Discovery Protocol** (§4.6 of the [WAB spec](../../docs/SPEC.md)).

Resolves `_wab` / `_wab-trust` / `_wab-policy` TXT records over **DNS-over-HTTPS** (DoH)
and validates them against the ABNF grammar and error-handling matrix in the spec.
Suitable for **CI pipelines** (machine-readable `--json`, exit codes) and
**local debugging** (colored human output, DNSSEC posture, multi-resolver fallback).

**Zero dependencies.** Requires Node 18+ for global `fetch`.

## Install

```bash
npm i -g @wab/dns-verify
# or, one-shot:
npx -y @wab/dns-verify example.com
```

## Usage

```bash
wab-dns example.com                            # verify _wab only
wab-dns example.com --trust --policy           # also _wab-trust and _wab-policy
wab-dns example.com --strict                   # fail when DNSSEC AD=0
wab-dns example.com --json                     # machine-readable
wab-dns example.com --resolver https://dns.quad9.net/dns-query
```

Exit codes:

| Code | Meaning                                           |
|------|---------------------------------------------------|
| 0    | All required checks passed.                       |
| 1    | Verification failed (record missing, malformed). |
| 2    | Usage / argument error.                           |
| 3    | All DoH resolvers unreachable.                    |

## Programmatic API

```js
const { verify } = require('@wab/dns-verify');

const result = await verify('example.com', { trust: true, policy: true, strict: false });
if (!result.ok) process.exit(1);
console.log(result.records);
console.log(result.dnssec); // "verified" | "unverified" | "n/a"
```

Returns:

```ts
{
  ok: boolean;
  domain: string;
  dnssec: 'verified' | 'unverified' | 'n/a';
  records: Array<{
    ok: boolean;
    fqdn: string;
    type: '_wab' | '_wab-trust' | '_wab-policy';
    present: boolean;
    ad: boolean;          // DNSSEC AD flag from the resolver
    raw: string[];        // raw TXT strings
    parsed?: object;      // parsed fields per spec §4.6.2 / §4.6.3
    error?: string;
    code?: string;        // e.g. "NXDOMAIN", "INVALID_FORMAT", "INSECURE_ENDPOINT"
  }>;
  summary: { checked: number; passed: number; failed: number; warnings: string[] };
}
```

## License

MIT — part of [Web Agent Bridge](https://github.com/abokenan444/web-agent-bridge).
