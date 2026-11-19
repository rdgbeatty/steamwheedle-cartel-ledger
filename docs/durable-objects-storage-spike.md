# Durable Objects Free: capacity and browser delivery

Researched and measured **2026-11-18**. This is a storage spike, not a deployment or provider decision. No Cloudflare account, plan, credentials or application behavior was changed. Sizes are decimal: **1 GB = 1,000,000,000 bytes**.

The [deployment proposal](cloudflare-deployment-proposal.md) follows up with the Worker/Object CPU distinction, pipeline steps, credentials and live-pilot targets. It also keeps current depth/catalog data out of the initial cloud pilot until recoverable copies satisfy the project's retention policy.

## Recommendation

**SQLite-backed Durable Objects on Workers Free are a strong candidate.** The tested 90-day hourly minimum-ask/stock history occupies **0.856 GB compressed**, including SQLite allocation, a variant dictionary and reserved collection metadata. The same grouped layout occupies **2.403 GB without compression**. Both fit the owner's 4 GB target, preserving current equipment variants, unnamed items and all three US PvP markets.

The important change is storing many observations inside each database row. A conventional row per item/variant/market/hour exceeds the free daily write allowance even when its storage fits. This proposal gives up direct SQL queries over individual price points; the history endpoint decodes the requested series from grouped blocks.

I would test this before pursuing the earlier GitHub-only serving proposal. Durable Objects can serve individual item charts through an API, avoiding a complete historical-site rebuild on each update. This does not remove collector scheduling or recovery requirements.

## Free limits and billing protection

Cloudflare documents these **Workers Free** allowances for SQLite-backed Durable Objects:

| Resource | Free allowance |
| --- | ---: |
| Stored data, account total | 5 GB |
| SQL rows written | 100,000/day |
| SQL rows read | 5 million/day |
| Durable Object requests | 100,000/day |
| Active duration | 13,000 GB-seconds/day |

Exceeding a free quota makes further operations of that type fail; daily allowances reset at midnight UTC. This is the provider-side stop the owner wanted. **Workers Paid is different:** its first 5 GB-month is included, then additional storage is charged. Keep Workers on Free for this proposal. [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)

The 5 GB is shared across the account's Durable Objects, not available separately to each object. The limits table lists 10 GB/object generally, while its storage-full FAQ explicitly says **1 GB/object on Free**. Design conservatively for the latter. Our largest compressed object is only **14.6 MB**. The documented maximum SQL row/BLOB is 8 MB; our largest compressed daily row is **156 KB**. [Storage limits and FAQ](https://developers.cloudflare.com/durable-objects/platform/limits/)

Paid-plan spending limits do **not** provide the same protection. They exclude stored-data charges and the Workers subscription; storage can remain billable during a pause, and enforcement has delays. Cloudflare explicitly says these limits do not guarantee a maximum invoice. [Spending-limit behavior](https://developers.cloudflare.com/durable-objects/platform/spend-management/)

These statements cover this storage/compute product, not unrelated paid products in the account. Account plan and other applications' quota usage have not been inspected.

## Measured capacity

Input is the saved **2026-11-18 12:44 UTC** snapshot: 20,797 item IDs, 63,280 item/variant rows and **64,005 active market observations/hour**, across Alliance 110, Horde 113 and neutral 116. Listed stock remains a proxy for supply, not completed sales.

| Layout | 90-day database size | Measurement |
| --- | ---: | --- |
| One row/observation, primary key plus hour index | 4.562 GB | Earlier 24-hour test extrapolated to 90 days |
| One row/observation, primary key only | 2.911 GB | Earlier 24-hour test extrapolated to 90 days |
| Grouped binary blocks, no compression | **2.403 GB** | Actual 90-day files, after 14 additional rolling days |
| Grouped binary blocks, DEFLATE | **0.856 GB** | Actual 90-day files, after 14 additional rolling days |

The grouped benchmark creates 64 temporary SQLite databases, fills 90 days, then performs 14 days of hourly updates and daily expiry. **No VACUUM is used.** Allocation grows initially from 2.377 to 2.403 GB uncompressed, or 0.846 to 0.856 GB compressed, as it establishes reusable free pages. Every database finishes with 90 daily rows. The observed peaks equal those final sizes; this short run demonstrates bounded allocation for the fixture, not a guarantee about future growth.

The files include:

- All 138,250,800 hourly observations implied by today's active series count.
- Series IDs, 8-byte prices, 4-byte stock and explicit status flags; no rounding to whole copper.
- A compressed item/variant dictionary, about 0.508 MB in total.
- **17.7 MB reserved** for source/check times, coverage, checksums and format metadata: 128 bytes/hour/object.
- SQLite page overhead and free pages. The compressed run ends with 8.64 MB allocated but reusable.

This is **one real snapshot replayed into hourly slots**, not 90 days of actual observations. Each hour is compressed independently; repeated hours are never compressed together. Thus the size is not an artificial win from identical consecutive hours. Different future listings, new variant identities, actual metadata and Cloudflare's storage implementation can still change the result. Transient local journals, remote recovery storage and independent backups are not measured.

The smaller blocks compress less efficiently than the earlier whole-market archive: their payload is about **0.823 GB**, versus the previous **0.550 GB** estimate. That is a deliberate tradeoff for smaller server reads. The complete database still leaves about **3.14 GB below the 4 GB target**. Roughly four times the current compressed footprint would be 3.42 GB; that is sensitivity arithmetic, not a forecast. Even today's uncompressed result fits, so the decision does not depend entirely on the compression ratio.

See the [aggregate measurement output](durable-objects-storage-measurement.json) and [previous sizing spike](history-storage-spike.md). No auction listings or player identities are included in the measurement output.

## Proposed layout and request costs

Use one Durable Object class with **64 named instances**, chosen by hashing the item/variant identity. All three markets for a variant go to the same instance. Each has a tiny schema:

```sql
CREATE TABLE days(day INTEGER PRIMARY KEY, payload BLOB NOT NULL);
CREATE TABLE meta(key TEXT PRIMARY KEY, value BLOB NOT NULL) WITHOUT ROWID;
```

Each daily payload contains up to 24 independently compressed hourly frames plus offsets. A frame stores sorted numeric series IDs, minimum asks, buyout units and status. Empty markets need coverage metadata: absence from a successful collection can mean a stockout; absence from a failed collection means unknown. Bid-only listings remain distinct. Failed or unchanged-source checks must not invent fresh prices.

The benchmark rewrites today's row once/hour and deletes the expired daily row before adding new data. That is:

```text
64 objects × 24 hourly row updates = 1,536 history writes/day
64 objects × 1 expired-day delete =    64 history writes/day
                                    -----
                                    1,600 history row changes/day
```

The ordinary relational layout instead inserts **1,536,120 rows/day**, before deletion and indexes. Sending those INSERTs in batches does not reduce their row count. Cloudflare's row-billing definition counts a large BLOB as one row, and includes INSERT, UPDATE and DELETE; it does not count each embedded price as a separate SQL row. [SQL row-count definitions](https://developers.cloudflare.com/d1/platform/pricing/)

Allow additional writes for dictionary changes, collection metadata, publication state and retries. The 1,600 is a locally measured history-table change count, **not a measured Cloudflare bill**. A provisional operating budget below 10,000 writes/day leaves room, but must be validated remotely. Avoid a per-series dictionary-row bootstrap: it can itself exceed a day's quota. The prototype stores the dictionary in grouped metadata.

For one favorite, the endpoint routes to one object and selects **90 daily rows** through the integer primary key, then extracts 2,160 hourly values. All three houses can be extracted together. The local test verified those values against the source, including separate round-trip checks for fractional prices and uint32 quantity bounds. One-series lookup took 33 ms uncompressed and 75 ms compressed in local Python; neither predicts Cloudflare latency.

The visitor receives only the selected chart. A full 90-day three-house chart needs about **78 KB for price/stock numeric values**, before timestamps/status/envelopes and compression. It does not require downloading the object's database. There is server-side read amplification: the compressed test reads/decompresses roughly 14 MB of grouped blocks to return a small chart. Cache completed-day chart responses and impose practical favorite/time-range limits; public traffic can exhaust the free read, request or duration allowance and temporarily stop service.

## Collection and browser integration

Keep the existing Node collector on a local machine or GitHub Actions initially. It fetches Blizzard data, computes summaries, compresses frames and uploads small authenticated batches. A thin Worker routes chart reads and uploads; Durable Objects own persistence and decode selected history. Browsers never receive a write credential. Existing Blizzard budgets and source-cache handling continue to apply; reading history does not call Blizzard.

At 64 uploads/hour this is **1,536 ingest requests/day**, before visitors and retries. Separate requests let the collector retry an individual shard and bound concurrent uploads. Workers Free distinguishes the general 50-subrequest allowance from the 1,000 internal-service allowance. The front Worker has 10 ms of CPU per invocation and shares 128 MB of isolate memory. Node handles parsing and compression of the complete market. [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)

The runtime supports DEFLATE through `CompressionStream`/`DecompressionStream`, matching the prototype's zlib-wrapped encoding. [Compression APIs](https://developers.cloudflare.com/workers/runtime-apis/web-standards/)

Before implementation, require stable append-only series IDs, a versioned binary format, bounded decode sizes, checksums, idempotent hour uploads and explicit publication/coverage state. Snapshot row indexes in this sizing fixture are not production-stable IDs. Each object's SQLite database is private; there is no automatic cross-object transaction. Use a generation manifest so partially uploaded hours do not appear complete. A production SQL cursor must be consumed before awaiting asynchronous decompression. Use `transactionSync` for related synchronous writes, and measure `rowsRead`, `rowsWritten` and `databaseSize` remotely. [SQLite storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)

Let objects become idle between requests. Keeping many objects active with timers or non-hibernating connections would consume the duration allowance despite low SQL traffic. The proposed workload needs neither a persistent connection nor polling inside every object.

An independent daily recovery archive remains useful; GitHub Releases could serve that role without becoming the chart endpoint. GitHub-hosted scheduling retains the best-effort limitations described in the [earlier hosting comparison](history-hosting-spike.md).

## Scope and remaining evidence

This fits **processed minimum-ask/stock summaries**, not a 90-day raw order-book archive. The earlier whole-book estimate remains about 8.8 GB gzip, and raw Blizzard observations and all copies still have a **maximum 30-day TTL**. The owner's recorded longer-retention exception initially covers daily processed min/max/mean statistics. This sizing experiment does not broaden that decision to hourly stock/price observations or player-specific data. Final retention design must follow the [recorded terms and decision](blizzard-api-terms.md#owner-retention-decision-2026-11-16).

No workerd/Wrangler runtime or live Cloudflare deployment was used. Before choosing the provider, a small remote pilot should verify actual stored bytes and row billing, repeated hourly updates, expiry and restart behavior, bounded chart decoding under runtime limits, and quota-error handling. The local evidence is sufficient to move Durable Objects Free ahead of R2 under the owner's billing constraint, but not to call the hosted design proven.

Reproduce with a current local snapshot:

```sh
python3 tools/analyze-durable-storage.py
```

The Python standard-library script makes no network requests. It checks the input's 30-day age limit, creates roughly 3.3 GB of temporary SQLite files, runs the two layouts and removes the files on completion. It takes several minutes and prints aggregate sizes only. The application still stores only its latest snapshot.
