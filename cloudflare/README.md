# Local Cloudflare history tests

The local Wrangler configuration uses simulated SQLite-backed Durable Objects and a generated price and stock fixture. The fixture covers 21,334 item IDs with three variants each. The staging uploader now accepts only HTTP loopback.

## Run locally

Use Node 24. Install dependencies and run the publication and restart test.

```sh
cd cloudflare
npm ci
npm test
npm run dry-run
```

Start the local chart Worker.

```sh
npm run dev -- --var MARKET_INGEST_TOKEN:localhost-synthetic-capacity-test-only
```

In another terminal in `cloudflare/`, seed one day and open the development URL printed by Wrangler. Use `--days 90` for a capacity run.

```sh
MARKET_INGEST_TOKEN=localhost-synthetic-capacity-test-only npm run pilot -- --days 1
```

The uploader reuses committed days and checks the results against independently generated expected prices and stock. The report includes SQLite sizes, row reads and client round-trip times. The production Worker and GitHub Pages have separate deployment steps. [Live runbook](live/README.md)

## Hosted pilot results

On November 19, 2026, the staging Worker served the 24-hour smoke test and the full 90-day synthetic window. All 16 sampled item and variant charts matched the fixture for **2,160 hours** across all three houses. With four concurrent chart requests, median client round-trip time was **374 ms** and the slowest request was **578 ms**. Each chart read **91 daily rows** from one shard.

The 64 hosted history shard databases reported **1,203,355,648 bytes** combined, with a largest shard of **19,927,040 bytes**. Cloudflare reported **3.21 ms** p99 front Worker CPU and zero Worker runtime errors over **6,160 requests** in the available deployment and seed metrics. Account-level Durable Object storage, SQL-write and memory samples were unavailable in Analytics during the pilot. Steady-state sizing also needs an hourly ingest and expiry run. [Cloudflare Worker analytics](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/), [Durable Object analytics](https://developers.cloudflare.com/durable-objects/observability/metrics-and-analytics/)
