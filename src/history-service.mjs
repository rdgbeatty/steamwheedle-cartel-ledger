import { readJson } from './store.mjs';
import { join } from 'node:path';

export async function historySettings(directory, env = process.env) {
  if (env.MARKET_API_URL || env.MARKET_INGEST_TOKEN)
    return { origin: env.MARKET_API_URL, token: env.MARKET_INGEST_TOKEN };
  return readJson(join(directory, 'private', 'history-service.json'));
}
export function historyService(config) {
  if (
    !config ||
    !/^https:\/\/gathering-ledger\.[a-z0-9-]+\.workers\.dev$|^http:\/\/127\.0\.0\.1:\d+$/.test(
      config.origin
    ) ||
    !config.token ||
    config.token.length < 32
  )
    throw Error('Configure the live collector origin and ingestion secret.');
  return async (action, params = {}, body) => {
    const query = new URLSearchParams(params);
    const response = await fetch(config.origin + '/api/collector/' + action + '?' + query, {
      method: 'POST',
      redirect: 'error',
      headers: { authorization: 'Bearer ' + config.token },
      body,
      signal: AbortSignal.timeout(60_000)
    });
    if (!response.ok) throw Error('History service ' + action + ' returned HTTP ' + response.status);
    return response.json();
  };
}
