# Live US PvP history

GitHub Actions schedules the two Forever feeds for each of houses 110, 113 and 116 at **minute 37 of each UTC hour**. Scheduled Actions can start late or be dropped. A manual dispatch uses the same collector and concurrency group. Check the last successful source publication and the last attempted pull separately. Skipped or failed hours leave gaps. [Collector workflow](../../.github/workflows/collect-live.yml)

The runner holds raw responses in memory. For each house it deduplicates the two feeds by auction ID, separates item variants, and saves an anonymous price ladder with units, offer count and exact total buyout at each price. Bid-only auctions contribute to the total listed units and bid-only count. Historical records contain no individual listing IDs, player names, bids or time-left field. The chart uses minimum unit buyout in copper and buyout stock. Each UTC source hour has at most one book per house. A later publication within that hour replaces the earlier one. The oldest contributing source timestamp determines the slot and expiry.

## Storage

The live Worker has a dedicated SQLite Durable Object per UTC source day. A house upload contains 32 item-ID buckets. Chart summaries and depth are compressed separately, encrypted and written together in a single transaction. An expired or failed upload leaves the previous committed observation readable. A history query reads one bucket per house and hour, with up to seven days per request. The browser joins ranges for a 90-day view.

A separate Workers KV namespace holds one random AES-GCM key per source hour. The key expires at the start of that hour plus 90 days. SQLite recovery can retain encrypted blocks beyond live deletion. Keys are kept outside the SQLite recovery store, and reads independently enforce the hourly cutoff. A daily object deletes its contents once its last possible source hour expires. Feed validators in KV expire within 30 days of the oldest contributing source. Recovery procedures must preserve these expiry boundaries. [Retention decision](../../docs/blizzard-api-terms.md#owner-retention-decision-2026-11-19)

The collector builds the current snapshot from the same reduced books and the Forever item catalog. It preserves the previous complete snapshot if any house fails and reuses unchanged summaries when the source checks match. The `LATEST` KV binding holds one gzipped snapshot. Its expiry follows the oldest source, including catalog metadata. The Worker serves it at `/api/snapshot` with an ETag and CORS for the Pages origin.

## Operating the collector

- With Node 24, install dependencies using `npm ci --prefix cloudflare` and deploy from the repository root with `./cloudflare/node_modules/.bin/wrangler deploy --config cloudflare/live/wrangler.jsonc --experimental-auto-create`. Preserve the `BookDay` and `LiveControl` namespaces and the existing expiry-key KV binding during deploys. Use the deployed live Worker URL for the collector.
- Set `MARKET_INGEST_TOKEN` on the live Worker. Store the same value as `LIVE_MARKET_INGEST_TOKEN` in GitHub Actions secrets, alongside `BLIZZARD_CLIENT_ID` and `BLIZZARD_CLIENT_SECRET`. The runner needs no Cloudflare administration token.
- Run **Collect live US PvP market books** manually. The repository variable `LIVE_COLLECTION_ENABLED=true` enables scheduled runs. Set it to `false` to pause future scheduled pulls.
- For the local collector and diagnostics, store `{"origin":"https://gathering-ledger.gathering-ledger.workers.dev","token":"…"}` in the private, ignored file `.wow-local/private/history-service.json`. Local API calls then reserve capacity with the same hosted 600-call rolling-hour limit and share upstream backoff with the runner. A failed reservation stops the upstream call.
- `GET /api/status` reports per-house collection status. `GET /api/history` accepts an item ID, optional variant, and inclusive UTC epoch hours `from` and `to`. `GET /api/book` also accepts a house ID and a single hour. Its selected book contains total listed units, bid-only offer count and the price ladder, in that order. Each price level contains unit ask, quantity, offer count and total buyout.
- Storage depends on actual market activity. The first complete upload compressed to 1,219,209 bytes across the three markets. Repeating that size 2,160 times would use about 2.63 GB before SQLite allocation, encryption and metadata.

In a restricted WSL session, use the exact absolute path to the workspace config if Wrangler's temporary bundle directory resolves to a read-only path. Append `--dry-run` to verify the bundle and bindings locally.

## Publishing the Pages frontend

On the first deployment, enable Pages for the public site repository `rdgbeatty/gathering-ledger` from the root of its `main` branch. To publish UI updates, check out that repository separately and run `node tools/build-pages.mjs /path/to/gathering-ledger` from the source repository. Review, commit and push only the generated HTML, JavaScript and CSS. Market snapshots update in Cloudflare independently of this build. Test the Pages URL and the snapshot response with a browser after publication.

## Schedule reliability

GitHub displays the time a run was created. Compare scheduled run records with each house's last check and source time to distinguish delays from unchanged data. GitHub Actions accepts a minimum five-minute interval and may drop runs under load. A Cloudflare Cron Trigger on Workers Free could dispatch the existing Node workflow through GitHub's API using a repository-scoped Actions credential. Moving auction processing into Cloudflare would need separate CPU and memory testing against Free limits. [GitHub schedules](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule), [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)

