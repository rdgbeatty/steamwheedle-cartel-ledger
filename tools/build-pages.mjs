import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const [directory, ...extra] = process.argv.slice(2);
if (!directory || extra.length) throw Error('Usage: node tools/build-pages.mjs <artifact-directory>');

const output = resolve(directory);
const source = new URL('../', import.meta.url);
const marketOrigin = 'https://gathering-ledger.gathering-ledger.workers.dev';
const pagesAssets = {
  public: ['app.mjs', 'category-filter.mjs', 'collection.mjs', 'format.mjs', 'styles.css'],
  shared: ['items.mjs', 'market.mjs', 'resale.mjs', 'trade.mjs']
};

for (const [folder, names] of Object.entries(pagesAssets)) {
  await mkdir(join(output, folder), { recursive: true });
  for (const name of names) await copyFile(new URL(folder + '/' + name, source), join(output, folder, name));
}

const html = await readFile(new URL('public/index.html', source), 'utf8');
const pages = html
  .replace('<html lang="en">', '<html lang="en" data-market-source="' + marketOrigin + '">')
  .replace('/styles.css', './public/styles.css')
  .replace('/app.mjs', './public/app.mjs')
  .replace(/^[ \t]*<button id="setup-tab"[^\n]*\n/m, '')
  .replace(/^[ \t]*<!-- local setup -->[\s\S]*?<!-- end local setup -->\r?\n/m, '')
  .replace('AWAITING SETUP', 'CONNECTING')
  .replace('Connecting to the local collector…', 'Loading the latest market snapshot…')
  .replace('Collect now <span aria-hidden="true">↻</span>', 'Refresh')
  .replace('</footer>', '<a href="' + marketOrigin + '/privacy">Privacy</a></footer>');
if (pages.includes('id="credentials-form"') || pages.includes('id="setup-tab"'))
  throw Error('Local setup leaked into the Pages artifact.');
await writeFile(join(output, 'index.html'), pages);
await writeFile(join(output, '.nojekyll'), '');
