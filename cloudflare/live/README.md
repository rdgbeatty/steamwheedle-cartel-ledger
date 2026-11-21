# Live US PvP history

A Cloudflare Cron Trigger runs the `MarketCollector` Durable Object at **minute 37 of each UTC hour**. It revalidates both Forever feeds for houses 110, 113 and 116 on each tick using the saved ETag or Last-Modified. An on-demand run can reuse still-fresh feed metadata. A 304 preserves the source time and creates no new history point. Check source publication time separately from the last attempted pull. Skipped or failed hours leave gaps. [Collector decision](../../docs/08-cloudflare-collector.md)

The collector streams raw listings into compact arrays for one house at a time. It deduplicates by auction ID, separates item variants, and saves an anonymous price ladder with units, offer count and exact total buyout at each price. Bid-only auctions contribute to the total listed units and bid-only count. Historical records contain no individual listing IDs, player names, bids or time-left field. The chart uses minimum unit buyout in copper and buyout stock. Each UTC source hour has at most one book per house. A later publication within that hour replaces the earlier one. The oldest contributing source timestamp determines the slot and expiry.

## Storage

The live Worker has a dedicated SQLite Durable Object per UTC source day. A house upload contains 32 item-ID buckets. Chart summaries and depth are compressed separately, encrypted and written together in a single transaction. An expired or failed upload leaves the previous committed observation readable. A history query reads one bucket per house and hour, with up to seven days per request. The Pages price history modal loads one item and variant at a time and joins ranges for a 90-day view.

A separate Workers KV namespace holds one random AES-GCM key per source hour. The key expires at the start of that hour plus 90 days. SQLite recovery can retain encrypted blocks beyond live deletion. Keys are kept outside the SQLite recovery store, and reads independently enforce the hourly cutoff. A daily object deletes its contents once its last possible source hour expires. Feed validators and the separately cached item catalog in KV expire within 30 days of their oldest contributing sources. Recovery procedures must preserve these expiry boundaries. [Retention decision](../../docs/05-blizzard-api-terms.md#owner-retention-decision-2026-11-19)

The collector builds the current snapshot from the same reduced books and the Forever item catalog. It reads the exact committed version of each house and streams one bucket at a time through gzip. It preserves the previous complete snapshot if any house fails and skips publication when both the catalog and all source versions match. The `LATEST` KV binding holds one gzipped snapshot. Its expiry follows the oldest source, including catalog metadata. The Worker serves it at `/api/snapshot` with an ETag and CORS for the Pages origin.

## Operating the collector

- With Node 24, install dependencies using `npm ci --prefix cloudflare` and deploy from the repository root with `./cloudflare/node_modules/.bin/wrangler deploy --config cloudflare/live/wrangler.jsonc --experimental-auto-create`. Preserve the `BookDay` and `LiveControl` namespaces and the existing expiry-key KV binding during deploys. Use the deployed live Worker URL for the collector.
- Set `BLIZZARD_CLIENT_ID`, `BLIZZARD_CLIENT_SECRET` and `MARKET_INGEST_TOKEN` as secrets on the live Worker. The collector uses internal bindings for storage and the shared Blizzard budget.
- Call `POST /api/collector/run` with the ingestion bearer token for an on-demand run. Add `?force=1` for a diagnostic full fetch that still uses the shared budget. Prefer that endpoint for manual collection. The [GitHub workflow](../../.github/workflows/collect-live.yml) remains a manually dispatched recovery path.
- For the local collector and diagnostics, store `{"origin":"https://gathering-ledger.gathering-ledger.workers.dev","token":"…"}` in the private, ignored file `.wow-local/private/history-service.json`. Local API calls then reserve capacity with the same hosted 600-call rolling-hour limit and share upstream backoff with the runner. A failed reservation stops the upstream call.
- `GET /api/status` reports per-house collection status. `GET /api/history` accepts an item ID, optional variant, and inclusive UTC epoch hours `from` and `to`. The Worker allows reads by the Pages origin, and the localhost app proxies the same public endpoint. `GET /api/book` also accepts a house ID and a single hour. Its selected book contains total listed units, bid-only offer count and the price ladder, in that order. Each price level contains unit ask, quantity, offer count and total buyout.
- Storage depends on actual market activity. The first complete upload compressed to 1,219,209 bytes across the three markets. Repeating that size 2,160 times would use about 2.63 GB before SQLite allocation, encryption and metadata.

In a restricted WSL session, use the exact absolute path to the workspace config if Wrangler's temporary bundle directory resolves to a read-only path. Append `--dry-run` to verify the bundle and bindings locally.

## Publishing the Pages frontend

The source repository publishes its own Pages site through GitHub Actions. **Publish market tables to Pages** runs on frontend changes pushed to `main` and can be dispatched manually. It tests the app, builds the static files with `tools/build-pages.mjs` and deploys just that artifact. Market snapshots update in Cloudflare independently of website deployments. [Pages workflow](../../.github/workflows/deploy-pages.yml), [public site](https://rdgbeatty.github.io/steamwheedle-cartel-ledger/)

## Verifying changes

Run `npm test --prefix cloudflare` with Node 24. For a growth replay, run `REPLAY_AUCTIONS=500000 node --test cloudflare/test/collector.test.mjs`. It uses synthetic feeds and temporary local storage to exercise OAuth, both feed types, history writes, gzip publication, conditional revalidation and preservation of the previous snapshot after invalid input. The hosted verification is an authenticated manual run followed by reads of the public status, snapshot and history. Watch for a later attempted pull to verify cron has fired. Cron changes can take up to 15 minutes to propagate. [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
