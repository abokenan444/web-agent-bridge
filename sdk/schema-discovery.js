/**
 * Server-side / Node: extract schema.org Product nodes from HTML (JSON-LD blocks).
 * No extra dependencies — regex-based script extraction (same semantics as browser WABSchema).
 *
 * @example
 *   const { extractProductsFromHtml, suggestWabActionsFromProducts } = require('./schema-discovery');
 *   const products = extractProductsFromHtml(htmlString);
 *   const hints = suggestWabActionsFromProducts(products);
 */

function extractJsonLdBlocks(html) {
  if (!html || typeof html !== 'string') return [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const blocks = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    blocks.push(m[1].trim());
  }
  return blocks;
}

function flattenGraph(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data['@graph'])) return data['@graph'];
  return [data];
}

/**
 * @param {string} html
 * @returns {Array<{ type: string, name?: string, sku?: string, offers?: unknown }>}
 */
function extractProductsFromHtml(html) {
  const out = [];
  const blocks = extractJsonLdBlocks(html);
  for (const text of blocks) {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      continue;
    }
    const items = flattenGraph(data);
    for (const node of items) {
      if (!node || typeof node !== 'object') continue;
      let types = node['@type'];
      if (typeof types === 'string') types = [types];
      if (!Array.isArray(types)) types = [];
      if (!types.includes('Product')) continue;
      out.push({
        type: 'Product',
        name: node.name,
        sku: node.sku,
        offers: node.offers
      });
    }
  }
  return out;
}

function suggestWabActionsFromProducts(products) {
  const actions = [];
  if (products.length) {
    actions.push({
      name: 'getProductFromSchema',
      description: 'Structured products from schema.org JSON-LD',
      source: 'schema.org'
    });
  }
  if (products.some((p) => p.offers)) {
    actions.push({
      name: 'getOfferPrice',
      description: 'Prices from schema.org Offer',
      source: 'schema.org'
    });
  }
  return actions;
}

module.exports = {
  extractJsonLdBlocks,
  extractProductsFromHtml,
  suggestWabActionsFromProducts
};
