# @wab/edge

Drop-in edge function for **Vercel** and **Netlify** that serves
`/.well-known/wab.json` from environment variables — no origin changes,
no static files committed.

## Vercel

Copy `examples/vercel-middleware.js` → `middleware.ts` in your project root.

```bash
npm install @wab/edge
```

Set env vars in the Vercel dashboard:
- `WAB_SITE_NAME`
- `WAB_SITE_URL`
- `WAB_ACTIONS_JSON` (optional JSON array)

## Netlify

Copy `examples/netlify-edge.js` → `netlify/edge-functions/wab.js`. Add to `netlify.toml`:

```toml
[[edge_functions]]
function = "wab"
path = "/.well-known/wab.json"

[[edge_functions]]
function = "wab"
path = "/.well-known/wab-discovery"
```

## API

```js
import { handleRequest, buildWabResponse, buildWabDoc } from '@wab/edge';
```

* `handleRequest(request, cfg)` — returns `Response` for the two well-known paths, `null` otherwise.
* `buildWabResponse(cfg)` — returns the JSON `Response` directly.
* `buildWabDoc(cfg)` — returns the plain object.
