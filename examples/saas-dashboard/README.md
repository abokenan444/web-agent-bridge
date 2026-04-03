# SaaS Dashboard Example (Notion-style)

A practical setup for internal dashboards where agents read KPIs and trigger safe workflows.

## Embed

```html
<script src="https://webagentbridge.com/script/wab.min.js"></script>
<script>
window.WAB.init({
  name: 'Acme SaaS Dashboard',
  actions: {
    getKpiCards: {
      description: 'Return KPI card values from dashboard widgets',
      run: function () {
        var cards = Array.from(document.querySelectorAll('[data-kpi-card]')).map(function (card) {
          return {
            key: card.getAttribute('data-kpi-card'),
            label: (card.querySelector('[data-kpi-label]') || {}).textContent || null,
            value: (card.querySelector('[data-kpi-value]') || {}).textContent || null
          };
        });
        return { success: true, cards: cards };
      }
    },
    openCustomerById: {
      description: 'Open customer panel using data-customer-id selector',
      params: [{ name: 'customerId', type: 'string', required: true }],
      run: function (params) {
        var id = String(params.customerId || '').trim();
        if (!id) return { success: false, error: 'customerId is required' };
        var row = document.querySelector('[data-customer-id="' + CSS.escape(id) + '"]');
        if (!row) return { success: false, error: 'Customer not found' };
        row.click();
        return { success: true, customerId: id };
      }
    },
    triggerInvoiceReminder: {
      description: 'Trigger existing invoice reminder button from dashboard row',
      params: [{ name: 'invoiceId', type: 'string', required: true }],
      run: function (params) {
        var id = String(params.invoiceId || '').trim();
        if (!id) return { success: false, error: 'invoiceId is required' };
        var btn = document.querySelector('[data-invoice-id="' + CSS.escape(id) + '"] [data-action="send-reminder"]');
        if (!btn) return { success: false, error: 'Reminder action not found for invoice' };
        btn.click();
        return { success: true, invoiceId: id };
      }
    }
  }
});
</script>
```

The selectors use data attributes so actions stay stable across UI redesigns.
