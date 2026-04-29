# WAB Caching Resolver — Design Document

**Status:** Research / Pre-implementation  
**Tracking issue:** TBD  
**Proposed package name:** `@wab/dns-cache`  
**Author:** Web Agent Bridge contributors  
**Date:** 2026-04

---

## 1. Motivation

The WAB DNS Discovery Protocol ([SPEC §4.6](SPEC.md#46-dns-discovery-protocol-ddp))
asks every agent to resolve `_wab.{site}` over DoH before each interaction.
In an agent-mesh deployment this can produce thousands of identical queries per
minute against the same DoH provider — a cost driver, a privacy leak (the resolver
sees every lookup), and a single point of failure.

A **sidecar caching resolver** sits between the agent process and the public DoH
endpoint, serves repeat lookups from local memory, and respects the TTL declared
by the authoritative zone. It is a strict drop-in: the agent talks to
`http://127.0.0.1:5353/dns-query` instead of `https://cloudflare-dns.com/dns-query`,
nothing else changes.

---

## 2. Non-functional requirements

| Requirement                                  | Target                                                            |
|----------------------------------------------|-------------------------------------------------------------------|
| Cache hit latency (P99)                      | < 10 ms (in-process) / < 30 ms (HTTP loopback)                    |
| Cache miss latency overhead                  | < 5 ms over a direct DoH call                                     |
| Memory ceiling                               | 50 MB default, configurable                                       |
| Max entries                                  | 50,000 default, LRU eviction beyond that                          |
| Crash safety                                 | Cache is RAM-only; no disk persistence in v1                      |
| Concurrency                                  | Safe for ≥ 1,000 in-flight queries                                |
| Failure mode when upstream DoH is down       | Serve stale-while-error up to `stale_max` seconds                 |
| Privacy                                      | No logging of question names by default                           |

---

## 3. Caching algorithm

### 3.1 TTL handling

- **Effective TTL** = `min(max(min_ttl, record.ttl), max_ttl)`
- `min_ttl` defaults to **30 s** (avoid cache thrash when origin sets ttl=0)
- `max_ttl` defaults to **86 400 s** (matches SPEC §4.6.5 cap)
- Entries past `effective_ttl` are evicted lazily on read **and** by a background
  sweeper running every `sweep_interval` (default 60 s)

### 3.2 Stale-while-revalidate

When an entry is between `effective_ttl` and `effective_ttl + grace`
(default `grace = 30 s`):

1. Return the stale answer **immediately** to the caller.
2. Asynchronously refresh the entry from upstream (single in-flight per key).
3. Replace the entry on success; leave it stale on failure (until `stale_max`).

This eliminates the latency tail when many agents converge on a popular domain at
the moment its TTL expires.

### 3.3 Negative caching

`NXDOMAIN` and `SERVFAIL` are cached too — but with **shorter** TTLs:

| Status      | Cache for           | Reason                                                |
|-------------|---------------------|-------------------------------------------------------|
| `NoError`   | `effective_ttl`     | Standard.                                             |
| `NXDOMAIN`  | `min(record_ttl, 60)` | Site might be opting in soon — don't pin failure.   |
| `SERVFAIL`  | **5 s only**        | Resolver-side fault, safe to retry quickly.           |
| Other 4xx   | Not cached          | Probably a query bug.                                 |

### 3.4 Cache key

`{name}|{type}|{do_bit}|{class}` — note `do_bit` is part of the key because the
DNSSEC `AD` flag depends on it; we mustn't return a non-DNSSEC-validated answer
to a query that asked for one.

### 3.5 Active invalidation

Two mechanisms:

1. **TTL expiry** (passive, primary).
2. **Push invalidation** via local control endpoint:
   - `POST /admin/invalidate` with `{ name, type }` to evict a single key.
   - `POST /admin/flush` to clear everything (auth-token gated).

A future v2 may add **DNSSEC-key-rollover detection** — when the upstream answer's
`AD` flag flips from true → false (or vice versa), invalidate aggressively because
the zone's trust posture changed.

---

## 4. Data structures

```js
// In-memory entry. ~ 200-400 bytes per record before payload.
{
  key: 'example.com|TXT|do=1|IN',
  status: 0,                   // DNS rcode
  ad: true,                    // DNSSEC AD flag
  answer: [...],               // raw DoH JSON Answer array
  fetched_at: 1719234567890,   // ms epoch
  expires_at: 1719238167890,   // ms epoch (effective TTL)
  stale_until: 1719238197890,  // ms epoch (expires_at + grace)
  hit_count: 0,
  last_hit_at: 0
}
```

Two indexes:

| Structure  | Purpose                                            |
|------------|----------------------------------------------------|
| `Map`      | O(1) lookup by key.                                |
| `MinHeap`  | Fast access to the next-to-expire entry (sweeper). |

LRU eviction uses a doubly-linked list threaded through the Map values.

---

## 5. API surface (proposed)

### 5.1 Programmatic

```js
const cache = require('@wab/dns-cache').create({
  upstream: ['https://cloudflare-dns.com/dns-query', 'https://dns.google/resolve'],
  max_entries: 50000,
  min_ttl: 30,
  max_ttl: 86400,
  grace: 30,
  stale_max: 300
});

const answer = await cache.query('_wab.example.com', 'TXT', { do: true });
console.log(cache.stats());     // { hits, misses, evictions, in_flight, ... }
cache.invalidate('_wab.example.com', 'TXT');
```

### 5.2 HTTP sidecar

Drop-in DoH endpoint at `http://127.0.0.1:5353/dns-query` speaking
`application/dns-json`. Minimal config:

```bash
npx -y @wab/dns-cache --port 5353 \
  --upstream https://cloudflare-dns.com/dns-query \
  --upstream https://dns.google/resolve \
  --max-entries 50000
```

Then point any DoH client (including [`@wab/dns-verify`](../packages/dns-verify))
at the sidecar:

```bash
wab-dns example.com --resolver http://127.0.0.1:5353/dns-query
```

### 5.3 Observability

`GET /admin/stats` returns Prometheus-style metrics:

```
wab_dns_cache_hits_total 12345
wab_dns_cache_misses_total 678
wab_dns_cache_evictions_total 12
wab_dns_cache_size 4321
wab_dns_cache_inflight 0
wab_dns_cache_stale_served_total 9
```

---

## 6. Open questions

1. **Should we share the cache between processes?** A `unix-socket` IPC mode
   (Linux/macOS only) would let a multi-worker agent farm share a single cache.
   v1 keeps it per-process for simplicity.
2. **Should we ship a tiny in-process middleware for [`@wab/dns-verify`](../packages/dns-verify)?**
   Probably yes — opt-in via `verify(domain, { cache: true })`. v1 can just expose
   it as a swappable `fetch`.
3. **Encrypted cache at rest?** Not needed in v1 (RAM-only) but mentioned for
   future disk-persisted variant.
4. **CAP positioning.** We deliberately favour **availability** over consistency
   (stale-while-error). Sites that need strict freshness should set very short
   TTLs and not rely on the sidecar — documented loudly.

---

## 7. Implementation plan

| Phase | Deliverable                                                           |
|-------|------------------------------------------------------------------------|
| 0     | Design doc reviewed (this file).                                       |
| 1     | `packages/dns-cache/src/cache.js` — pure in-memory store + tests.      |
| 2     | `packages/dns-cache/src/upstream.js` — DoH client with stale-while-rev.|
| 3     | `packages/dns-cache/bin/wab-dns-cache.js` — HTTP sidecar.              |
| 4     | Wire optional `cache: true` flag into `@wab/dns-verify`.               |
| 5     | Prometheus metrics + admin endpoints.                                  |
| 6     | Multi-process shared mode (unix socket).                               |

Phases 1–4 are open-source (this repo). Phase 5–6 may live in
`@wab/dns-cache-pro` if they grow significantly — TBD when we get there.
