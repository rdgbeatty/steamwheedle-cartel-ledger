# Live US PvP history

GitHub Actions pulls both Forever feeds for houses 110, 113 and 116 at **minute 37 of each UTC hour**. Scheduled Actions can start late. A manual dispatch uses the same collector and concurrency group. Check the last successful source publication and the last attempted pull separately in the viewer. Collection begins with the available upstream publication. Skipped or failed hours leave gaps. [Collector workflow](../../.github/workflows/collect-live.yml)

The runner holds raw responses in memory. For each house it deduplicates the two feeds by auction ID, separates item variants, and saves an anonymous price ladder with units, offer count and exact total buyout at each price. Bid-only auctions contribute to the total listed units and bid-only count. Historical records contain no individual listing IDs, player names, bids or time-left field. The chart uses minimum unit buyout in copper and buyout stock. Each UTC source hour has at most one book per house. A later publication within that hour replaces the earlier one. The oldest contributing source timestamp determines the slot and expiry.

## Storage

The live Worker has a dedicated SQLite Durable Object per UTC source day. A house upload contains 32 item-ID buckets. Chart summaries and depth are compressed separately, encrypted and written together in a single transaction. An expired or failed upload leaves the previous committed observation readable. A history query reads one bucket per house and hour, with up to seven days per request. The browser joins ranges for a 90-day view.

A separate Workers KV namespace holds one random AES-GCM key per source hour. The key expires at the start of that hour plus 90 days. SQLite recovery can retain encrypted blocks beyond live deletion. Keys are kept outside the SQLite recovery store, and reads independently enforce the hourly cutoff. A daily object deletes its contents once its last possible source hour expires. Feed validators in KV expire within 30 days of the oldest contributing source. Recovery procedures must preserve these expiry boundaries. [Retention decision](../../docs/blizzard-api-terms.md#owner-retention-decision-2026-11-19)

## Operating the collector

- Deploy with the pinned Node 24 Wrangler from the repository root using `./cloudflare/node_modules/.bin/wrangler deploy --config cloudflare/live/wrangler.jsonc`. Bind the live expiry-key KV namespace. Use the live Worker URL for the collector.
- Set `MARKET_INGEST_TOKEN` on the live Worker. Store the same value as `LIVE_MARKET_INGEST_TOKEN` in GitHub Actions secrets, alongside `BLIZZARD_CLIENT_ID` and `BLIZZARD_CLIENT_SECRET`. The runner needs no Cloudflare administration token.
- Run **Collect live US PvP market books** manually. The repository variable `LIVE_COLLECTION_ENABLED=true` enables scheduled runs. Set it to `false` to pause future scheduled pulls.
- For the local collector and diagnostics, store `{"origin":"https://gathering-ledger.gathering-ledger.workers.dev","token":"…"}` in the private, ignored file `.wow-local/private/history-service.json`. Local API calls then reserve capacity with the same hosted 600-call rolling-hour limit and share upstream backoff with the runner. A failed reservation stops the upstream call.
- `GET /api/status` reports per-house collection status. `GET /api/history` accepts an item ID, optional variant, and inclusive UTC epoch hours `from` and `to`. `GET /api/book` also accepts a house ID and a single hour. Its selected book contains total listed units, bid-only offer count and the price ladder, in that order. Each price level contains unit ask, quantity, offer count and total buyout.
- Storage depends on actual market activity. The first complete upload compressed to 1,219,209 bytes across the three markets. Repeating that size 2,160 times would use about 2.63 GB before SQLite allocation, encryption and metadata. Staging and live share account quotas.

To remove all live market history, remove the live encryption keys and delete the live book namespace. Rotating an ingestion token only changes write access. Keep the local credentials and Actions secrets out of commits and artifacts.

