// The local server and Pages build serve the same browser files.
const files = [
  'public/app.mjs',
  'public/format.mjs',
  'public/collection.mjs',
  'public/category-filter.mjs',
  'public/styles.css',
  'public/market-table.css',
  'shared/market.mjs',
  'shared/resale.mjs',
  'shared/trade.mjs',
  'shared/items.mjs'
];

export const siteAssets = new Map([['/', 'public/index.html'], ...files.map((file) => ['/' + file, file])]);
