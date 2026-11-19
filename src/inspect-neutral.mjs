import { fileURLToPath } from 'node:url';
import { readCredentials } from './store.mjs';
import { BlizzardClient } from './blizzard.mjs';
import { inspectNeutralBooks } from './neutral-books.mjs';
import { splitCopper } from '../public/format.mjs';
import { RequestBudget } from './request-budget.mjs';

function coins(value) {
  if (value === null) return '—';
  const [g, s, c] = splitCopper(value);
  return `${g ? `${g}g ` : ''}${s ? `${s}s ` : ''}${c || !g && !s ? `${c}c` : ''}`.trim();
}

try {
  const credentials = await readCredentials(fileURLToPath(new URL('../.wow-local/', import.meta.url)));
  if (!credentials.clientId || !credentials.clientSecret) throw new Error('Save Blizzard credentials in Local setup first, or set both Blizzard environment variables.');
  const budget = new RequestBudget({ file: fileURLToPath(new URL('../.wow-local/request-budget.json', import.meta.url)) });
  const report = await inspectNeutralBooks(new BlizzardClient(credentials, { budget }), { progress: (message) => process.stderr.write(`${message}\n`) });
  if (report.expiresAt <= Date.now()) throw new Error('Blizzard returned observations beyond the 30-day retention limit.');
  console.log(`# Stranglekelp (#3820) · all US Forever neutral houses\n\nCollected ${report.generatedAt}\nSource-data expiry ${new Date(report.expiresAt).toISOString()}\n\n${report.note}\n`);
  for (const house of report.houses) {
    console.log(`## Neutral #${house.id} · ${house.rulesetLabel} · ${house.status}\n`);
    for (const document of house.documents) console.log(`${document.feed}: source ${document.observedAt ?? 'unknown'} (${document.timeBasis}); fetched ${document.fetchedAt}; cached ${Boolean(document.cached)}`);
    for (const failure of house.failures) console.log(`${failure.feed}: ${failure.error}`);
    if (house.error) console.log(house.error);
    for (const quote of house.quotes) {
      console.log(`\n${quote.variant ? `Variant ${quote.variant}` : 'Base item'} · min ${coins(quote.minBuyout)} · weighted median ${coins(quote.medianBuyout)} · ${quote.buyoutUnits} units / ${quote.buyoutAuctions} buyout offers · ${quote.bidOnlyAuctions} bid-only offers\n`);
      console.log('| Unit ask | Stack size | Stack buyout | Identical offers | Total units | Feed(s) |\n| --- | ---: | --- | ---: | ---: | --- |');
      for (const offer of quote.offers) console.log(`| ${coins(offer.unitPrice)} | ${offer.quantity} | ${coins(offer.totalBuyout)} | ${offer.listingCount} | ${offer.quantity * offer.listingCount} | ${offer.feeds.join(', ')} |`);
    }
    if (!house.quotes.length) console.log(house.status === 'ok' ? '\nStranglekelp is not listed in either document.\n' : '\nCoverage is incomplete; do not interpret this as a stockout.\n');
    console.log('');
  }
  if (report.houses.some((house) => house.status !== 'ok')) process.exitCode = 1;
} catch (error) { console.error(error.message); process.exitCode = 1; }
