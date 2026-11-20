import { fileURLToPath, pathToFileURL } from 'node:url';
import { BlizzardClient } from './blizzard.mjs';
import { readCredentials } from './store.mjs';
import { BudgetError } from './request-budget.mjs';
import { BOOK_HOUSES, collectBook, splitBook } from './history-collector.mjs';
import { historyService, historySettings } from './history-service.mjs';
import { collectCatalog } from './catalog.mjs';
import { FACTIONS } from './market.mjs';
import { publishLatest, readLatestSnapshot, reuseCatalog, reuseHouse, summarizeBook } from './latest-snapshot.mjs';

export function encodeBook(records) {
  return Buffer.concat(
    splitBook(records).flatMap((block) => {
      const length = Buffer.alloc(4);
      length.writeUInt32LE(block.length);
      return [length, block];
    })
  );
}
export async function publishBook(service, book, checked = Date.now()) {
  const { house, source, documents, version, records } = book;
  await service('upload', { house, source, checked, version }, encodeBook(records));
  await service(
    'check',
    { house },
    JSON.stringify({ checked, status: 'changed', prior: { source, documents, version } })
  );
}
export async function runHistory({
  directory = fileURLToPath(new URL('../.wow-local/', import.meta.url)),
  env = process.env
} = {}) {
  const startedAt = Date.now();
  const settings = await historySettings(directory, env);
  const service = historyService(settings);
  const credentials = await readCredentials(directory, env);
  if (!credentials.clientId || !credentials.clientSecret)
    throw Error('Blizzard application credentials are required.');
  const shared = {
    async take() {
      const state = await service('take');
      if (!state.accepted) throw new BudgetError('Shared Blizzard cooldown', state.retryAt);
    },
    defer: (until) => service('defer', { until })
  };
  const client = new BlizzardClient(credentials, { budget: shared });
  const failures = [];
  const houses = {};
  try {
    let snapshotReadError;
    const { enabled: publishSnapshot, snapshot: previous } = await readLatestSnapshot(settings.origin).catch((error) => {
      snapshotReadError = error;
      return { enabled: false, snapshot: null };
    });
    for (const [index, house] of BOOK_HOUSES.entries()) {
      const faction = FACTIONS[index];
      try {
        const prior = await service('prior', { house });
        const cached = reuseHouse(previous, faction, prior);
        if ((!publishSnapshot || cached) && prior?.documents?.every((doc) => doc.freshUntil > Date.now())) {
          await service('check', { house }, JSON.stringify({ checked: Date.now(), status: 'cached' }));
          houses[faction] = cached;
          console.log('House', house, 'within upstream cache lifetime');
          continue;
        }
        const book = await collectBook(client, house, prior, { requireSummary: publishSnapshot && !cached });
        if (book.unchanged) {
          await service(
            'check',
            { house },
            JSON.stringify({
              checked: Date.now(),
              status: 'unchanged',
              prior: { ...prior, documents: book.documents }
            })
          );
          houses[faction] = cached;
          console.log('House', house, 'publication unchanged');
          continue;
        }
        await publishBook(service, book);
        houses[faction] = summarizeBook(book);
        console.log(
          'House',
          house,
          new Date(book.source).toISOString(),
          book.records.length,
          'priced or bid-only series'
        );
      } catch (error) {
        failures.push(house);
        await service('check', { house }, JSON.stringify({ checked: Date.now(), status: 'failed' })).catch(
          () => {}
        );
        console.error('House', house, error.message);
      }
    }
    if (failures.length) throw Error('Collection incomplete for ' + failures.join(', '));
    if (snapshotReadError) throw snapshotReadError;
    if (publishSnapshot) {
      const catalog = reuseCatalog(previous, startedAt) ?? await collectCatalog(client);
      await publishLatest(service, catalog, houses, previous, startedAt);
    }
  } finally {
    client.dispose();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runHistory().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
