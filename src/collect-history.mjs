import { fileURLToPath, pathToFileURL } from 'node:url';
import { BlizzardClient } from './blizzard.mjs';
import { readCredentials } from './store.mjs';
import { BudgetError } from './request-budget.mjs';
import { BOOK_HOUSES, collectBook, splitBook } from './history-collector.mjs';
import { historyService, historySettings } from './history-service.mjs';

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
  const service = historyService(await historySettings(directory, env));
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
  try {
    for (const house of BOOK_HOUSES) {
      try {
        const prior = await service('prior', { house });
        if (prior?.documents?.every((doc) => doc.freshUntil > Date.now())) {
          await service('check', { house }, JSON.stringify({ checked: Date.now(), status: 'cached' }));
          console.log('House', house, 'within upstream cache lifetime');
          continue;
        }
        const book = await collectBook(client, house, prior);
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
          console.log('House', house, 'publication unchanged');
          continue;
        }
        await publishBook(service, book);
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
  } finally {
    client.dispose();
  }
  if (failures.length) throw Error('Collection incomplete for ' + failures.join(', '));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runHistory().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
