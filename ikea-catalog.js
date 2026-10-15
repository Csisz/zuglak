/*
 * Zuglak Studio 1.5 – curated IKEA Hungary starter catalogue (preserved from 1.4).
 *
 * Product measurements are the assembled product's outside dimensions in cm,
 * checked against the linked public IKEA Hungary product pages on 2026-10-15.
 * Images are intentionally omitted: the editor draws its own top-down artwork.
 */
(function (root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  root.ZUGLAK_IKEA_CATALOG = value;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const categories = Object.freeze({
    sofas: 'Kanapék és fotelek',
    wardrobes: 'Gardróbok',
    beds: 'Ágyak',
    tables: 'Asztalok',
    chairs: 'Székek',
    storage: 'Tárolás'
  });

  const products = [
    {
      name: 'KLIPPAN 2 személyes kanapé',
      productId: '495.642.86',
      category: 'sofas',
      type: 'sofa',
      width: 180,
      depth: 88,
      height: 66,
      productUrl: 'https://www.ikea.com/hu/hu/p/klippan-2sz-kanape-langban-elenk-sarga-s49564286/'
    },
    {
      name: 'KIVIK 3 személyes kanapé',
      productId: '494.405.97',
      category: 'sofas',
      type: 'sofa',
      width: 228,
      depth: 95,
      height: 83,
      productUrl: 'https://www.ikea.com/hu/hu/p/kivik-3-szemelyes-kanape-tibbleby-bezs-szuerke-s49440597/'
    },
    {
      name: 'POÄNG fotel',
      productId: '392.407.87',
      category: 'sofas',
      type: 'armchair',
      width: 68,
      depth: 82,
      height: 100,
      productUrl: 'https://www.ikea.com/hu/hu/p/poaeng-fotel-nyir-furner-knisa-vilagosbezs-s39240787/'
    },
    {
      name: 'BRIMNES 3 ajtós gardrób',
      productId: '404.079.22',
      category: 'wardrobes',
      type: 'wardrobe',
      width: 117,
      depth: 50,
      height: 190,
      productUrl: 'https://www.ikea.com/hu/hu/p/brimnes-3-ajtos-gardrob-feher-40407922/'
    },
    {
      name: 'PAX gardróbváz',
      productId: '502.145.60',
      category: 'wardrobes',
      type: 'wardrobe',
      width: 99.8,
      depth: 58,
      height: 236.4,
      productUrl: 'https://www.ikea.com/hu/hu/p/pax-gardrobvaz-feher-50214560/'
    },
    {
      name: 'MALM magas ágykeret, 160 × 200',
      productId: '099.293.73',
      category: 'beds',
      type: 'bed',
      width: 176,
      depth: 209,
      height: 100,
      productUrl: 'https://www.ikea.com/hu/hu/p/malm-agykeret-magas-feher-s09929373/'
    },
    {
      name: 'LISABO asztal',
      productId: '702.943.39',
      category: 'tables',
      type: 'table',
      width: 140,
      depth: 78,
      height: 74,
      productUrl: 'https://www.ikea.com/hu/hu/p/lisabo-asztal-koris-furner-70294339/'
    },
    {
      name: 'LACK dohányzóasztal',
      productId: '401.042.94',
      category: 'tables',
      type: 'coffee',
      width: 90,
      depth: 55,
      height: 45,
      productUrl: 'https://www.ikea.com/hu/hu/p/lack-dohanyzoasztal-fekete-barna-40104294/'
    },
    {
      name: 'LISABO szék',
      productId: '004.572.35',
      category: 'chairs',
      type: 'chair',
      width: 46,
      depth: 51,
      height: 80,
      productUrl: 'https://www.ikea.com/hu/hu/p/lisabo-szek-koris-00457235/'
    },
    {
      name: 'BILLY könyvespolc',
      productId: '002.638.50',
      category: 'storage',
      type: 'shelf',
      width: 80,
      depth: 28,
      height: 202,
      productUrl: 'https://www.ikea.com/hu/hu/p/billy-koenyvespolc-feher-00263850/'
    },
    {
      name: 'KALLAX polcos elem',
      productId: '802.758.87',
      category: 'storage',
      type: 'shelf',
      width: 76.5,
      depth: 39,
      height: 146.5,
      productUrl: 'https://www.ikea.com/hu/hu/p/kallax-polcos-elem-feher-80275887/'
    }
  ];

  return Object.freeze({
    categories,
    products: Object.freeze(products.map(Object.freeze)),
    verifiedAt: '2026-10-15'
  });
});
