# Shopify Hydrogen + WAB

This example wires WAB into a Hydrogen storefront client component and exposes practical commerce actions.

## Install

```bash
npm install @web-agent-bridge/react
```

## Component

Create `app/components/WabHydrogenBridge.tsx`:

```tsx
'use client';

import { useEffect } from 'react';
import { WABProvider, useWAB, useWABAction } from '@web-agent-bridge/react';

function BridgeInner() {
  const { ready, discover, instance } = useWAB({
    name: 'Hydrogen Storefront',
    actions: {
      getCartCount: {
        description: 'Return cart item count from cart badge',
        run: () => {
          const badge = document.querySelector('[data-cart-count], .cart-count');
          const value = Number((badge?.textContent || '0').trim()) || 0;
          return { count: value };
        }
      },
      addFirstVisibleProductToCart: {
        description: 'Click the first visible add-to-cart button on the page',
        run: () => {
          const btn = Array.from(document.querySelectorAll('button, a')).find((el) =>
            /add\s*to\s*cart/i.test((el.textContent || '').trim())
          );
          if (!btn) return { success: false, error: 'No add-to-cart button found' };
          (btn as HTMLElement).click();
          return { success: true };
        }
      }
    }
  });

  const { run: runGetCartCount, result: cartCount } = useWABAction<{ count: number }>('getCartCount', {
    instance
  });

  useEffect(() => {
    if (!ready) return;
    discover().then((doc) => console.log('WAB discover:', doc));
    runGetCartCount().catch(() => {});
  }, [ready, discover, runGetCartCount]);

  return (
    <div>
      <p>WAB status: {ready ? 'ready' : 'loading'}</p>
      <p>Cart count: {cartCount?.count ?? 0}</p>
    </div>
  );
}

export default function WabHydrogenBridge() {
  return (
    <WABProvider scriptSrc="https://webagentbridge.com/script/wab.min.js">
      <BridgeInner />
    </WABProvider>
  );
}
```

Import this component inside any Hydrogen page so WAB is available to agents.
