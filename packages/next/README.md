# @wab/next

Zero-config Next.js plugin for [Web Agent Bridge](https://www.webagentbridge.com).

## Install

```bash
npm install @wab/next
```

## next.config.js

```js
const { withWAB } = require('@wab/next');

module.exports = withWAB({
  // your existing Next.js config
}, {
  siteName: 'Acme',
  siteUrl: 'https://acme.com',
  actions: [
    { name: 'home', description: 'Open homepage', url: 'https://acme.com' },
    { name: 'browseSitemap', description: 'URL inventory', url: 'https://acme.com/sitemap.xml' }
  ]
});
```

This adds:
- A rewrite from `/.well-known/wab.json` → `/api/wab/discovery`
- Cache + CORS headers on `/.well-known/wab.json`

## App Router — `app/api/wab/discovery/route.js`

```js
import { createDiscoveryRoute } from '@wab/next/route';
export const GET = createDiscoveryRoute();
```

## Pages Router — `pages/api/wab/discovery.js`

```js
const { createPagesHandler } = require('@wab/next/pages');
module.exports = createPagesHandler();
```

The plugin propagates your `withWAB` config via Next.js env vars,
so the route handlers don't need explicit args.

## DNS step

Add a TXT record at `_wab.<your-host>`:

```
v=wab1; well-known=https://<your-host>/.well-known/wab.json
```

Verify at: https://www.webagentbridge.com/check?host=<your-host>
