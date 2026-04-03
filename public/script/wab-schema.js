/**
 * WAB Schema hints — scan JSON-LD (schema.org Product, Offer) to suggest WAB actions.
 * <script src="/script/wab-schema.js"></script>
 *
 *   var products = WABSchema.scanJsonLd();
 *   var suggested = WABSchema.suggestActions(products);
 *   WAB.init(WABSchema.mergeWithManual({ buy: { ... } }, suggested));
 */
(function (global) {
  'use strict';

  function normalizeNode(node) {
    if (!node || typeof node !== 'object') return null;
    var types = node['@type'];
    if (typeof types === 'string') types = [types];
    if (!Array.isArray(types)) types = [];
    return { raw: node, types: types };
  }

  function flattenGraph(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data['@graph'])) return data['@graph'];
    return [data];
  }

  /**
   * @returns {Array<{ type: string, name?: string, sku?: string, offers?: unknown, source: string }>}
   */
  function scanJsonLd() {
    var out = [];
    var scripts = global.document.querySelectorAll('script[type="application/ld+json"]');
    for (var i = 0; i < scripts.length; i++) {
      var text = scripts[i].textContent;
      if (!text || !text.trim()) continue;
      try {
        var data = JSON.parse(text);
        var items = flattenGraph(data);
        for (var j = 0; j < items.length; j++) {
          var n = normalizeNode(items[j]);
          if (!n) continue;
          var isProduct = n.types.indexOf('Product') !== -1;
          if (!isProduct) continue;
          out.push({
            type: 'Product',
            name: n.raw.name,
            sku: n.raw.sku,
            offers: n.raw.offers,
            source: 'schema.org'
          });
        }
      } catch (e) {}
    }
    return out;
  }

  /**
   * @param {ReturnType<typeof scanJsonLd>} products
   */
  function suggestActions(products) {
    var actions = [];
    if (products && products.length) {
      actions.push({
        name: 'getProductFromSchema',
        description: 'Return structured product data detected from schema.org JSON-LD on this page',
        source: 'schema.org',
        auto: true
      });
    }
    var hasOffer = products && products.some(function (p) { return p.offers; });
    if (hasOffer) {
      actions.push({
        name: 'getOfferPrice',
        description: 'Read price/availability from schema.org Offer if present',
        source: 'schema.org',
        auto: true
      });
    }
    return actions;
  }

  /**
   * Merge manual WAB.init actions with schema-derived runners (read-only helpers).
   * @param {Record<string, object>} manual — same shape as WAB.init({ actions })
   * @param {ReturnType<typeof suggestActions>} suggestions
   */
  function mergeWithManual(manual, suggestions) {
    manual = manual || {};
    var products = scanJsonLd();
    var extra = {};
    if (suggestions && suggestions.some(function (s) { return s.name === 'getProductFromSchema'; })) {
      extra.getProductFromSchema = {
        description: 'List products from schema.org JSON-LD embedded in the page',
        run: function () {
          return { products: products, count: products.length };
        }
      };
    }
    if (suggestions && suggestions.some(function (s) { return s.name === 'getOfferPrice'; })) {
      extra.getOfferPrice = {
        description: 'Extract offer price strings from detected Product nodes',
        run: function () {
          var prices = [];
          products.forEach(function (p) {
            var o = p.offers;
            if (!o) return;
            var list = Array.isArray(o) ? o : [o];
            list.forEach(function (off) {
              if (off && typeof off === 'object') {
                prices.push({
                  product: p.name,
                  price: off.price,
                  priceCurrency: off.priceCurrency,
                  availability: off.availability
                });
              }
            });
          });
          return { offers: prices };
        }
      };
    }
    var merged = Object.assign({}, extra, manual);
    return { actions: merged };
  }

  global.WABSchema = {
    scanJsonLd: scanJsonLd,
    suggestActions: suggestActions,
    mergeWithManual: mergeWithManual
  };
})(typeof window !== 'undefined' ? window : globalThis);
