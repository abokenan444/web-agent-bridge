const {
  extractProductsFromHtml,
  suggestWabActionsFromProducts,
  extractJsonLdBlocks
} = require('../sdk/schema-discovery');

describe('schema-discovery', () => {
  test('extracts Product from ld+json', () => {
    const html = `
      <html><body>
      <script type="application/ld+json">
      {"@context":"https://schema.org","@type":"Product","name":"Test Lamp","offers":{"@type":"Offer","price":"29.99","priceCurrency":"USD"}}
      </script>
      </body></html>
    `;
    const products = extractProductsFromHtml(html);
    expect(products.length).toBe(1);
    expect(products[0].name).toBe('Test Lamp');
    expect(products[0].offers).toBeDefined();
  });

  test('suggestWabActionsFromProducts', () => {
    const hints = suggestWabActionsFromProducts([{ type: 'Product', name: 'X', offers: {} }]);
    expect(hints.some((h) => h.name === 'getProductFromSchema')).toBe(true);
    expect(hints.some((h) => h.name === 'getOfferPrice')).toBe(true);
  });

  test('extractJsonLdBlocks finds scripts', () => {
    const html = '<script type="application/ld+json">{"a":1}</script>';
    const blocks = extractJsonLdBlocks(html);
    expect(blocks.length).toBe(1);
    expect(JSON.parse(blocks[0]).a).toBe(1);
  });
});
