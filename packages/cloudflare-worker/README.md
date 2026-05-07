# @webagentbridge/cloudflare-worker

Zero-config Cloudflare Worker that injects `/.well-known/wab.json` for any
site without you needing to deploy a static file to your origin.

## Quick start

```bash
cd packages/cloudflare-worker
npm install
# Edit wrangler.toml: set WAB_SITE_NAME, WAB_SITE_URL, route or zone
npx wrangler deploy
```

## Behavior

* `GET /.well-known/wab.json` → returns a stub (or KV-stored doc) describing your site.
* `GET /.well-known/wab-discovery` → returns helpful pointers for clients.
* All other paths pass through to `WAB_FALLBACK_ORIGIN` if set, otherwise 404.

## Bringing your own signed wab.json

Bind a KV namespace called `WAB_KV` and put your full signed `wab.json`
under the key `wab.json`. The worker will serve it verbatim (with cache).

## DNS step (optional but recommended)

Add a TXT record at `_wab.<your-host>`:

```
v=wab1; well-known=https://<your-host>/.well-known/wab.json
```

Then verify at: https://www.webagentbridge.com/check?host=<your-host>
