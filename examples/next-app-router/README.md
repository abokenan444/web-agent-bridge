# Next.js App Router + WAB

1. Install the React helpers (from repo root after publish, or `file:` link):

```bash
npm install @web-agent-bridge/react
```

2. Add a client component `components/WabShop.tsx`:

```tsx
'use client';

import { WABProvider, useWAB } from '@web-agent-bridge/react';
import { useEffect } from 'react';

function WabInner() {
  const { ready, discover, execute } = useWAB({
    name: 'My App',
    actions: {
      ping: { description: 'Health check', run: () => ({ ok: true }) },
    },
  });

  useEffect(() => {
    if (!ready) return;
    discover().then(console.log);
  }, [ready, discover]);

  return <p>WAB {ready ? 'ready' : 'loading…'}</p>;
}

export default function WabShop() {
  return (
    <WABProvider scriptSrc="https://webagentbridge.com/script/wab.min.js">
      <WabInner />
    </WABProvider>
  );
}
```

3. Import `WabShop` from any `app/.../page.tsx` (server component can import client components).

Use `next/script` with `strategy="beforeInteractive"` if you prefer loading `wab.min.js` in `layout.tsx` instead of `WABProvider`.
