# Cloudflare history staging

This package publishes and graphs **synthetic** hourly minimum unit asks and listed stock for Alliance 110, Horde 113 and Neutral 116. The fixture covers 21,334 item IDs with three variants each. Item 3820's base variant has observations in all three houses. The staging site is public and uploading requires a secret.

## Run locally

Use Node 24. From the repository root, install the staging dependencies and test publication across a Worker restart.

```sh
cd cloudflare
npm ci
npm test
npm run dry-run
```

To try the chart, start the local Worker with a disposable loopback-only value.

```sh
npm run dev -- --var MARKET_INGEST_TOKEN:localhost-synthetic-capacity-test-only
```

In a second terminal in `cloudflare/`, seed one day and open the development URL printed by Wrangler. These commands assume its default port 8787.

```sh
MARKET_INGEST_TOKEN=localhost-synthetic-capacity-test-only npm run pilot -- --days 1
```

Use `--days 90` for the full capacity run. The uploader reuses committed UTC days, publishes outstanding hours and verifies the chart against independently generated expected values for each returned hour and each house. The report includes the number of sampled hours, SQL rows read in the history shard, client round-trip time including JSON decoding, and the sum and maximum of the 64 shard database sizes. Cloudflare account storage, CPU and peak isolate memory require separate hosted measurements.

In the November 19 local Wrangler run, the 64 shard databases used **1,202,061,312 bytes** combined. The largest shard used **19,902,464 bytes**. After restarting the runtime, a three-house chart for item 3820 verified **2,160 hours** across 91 UTC dates and took **140 ms** in one loopback request. The seed used one batch per UTC date. Regular hourly uploads create temporary additional versions until cleanup, so the measured size is a baseline for the seeded history.

## Hosted pilot results

On November 19, 2026, the staging Worker served the 24-hour smoke test and the full 90-day synthetic window. All 16 sampled item and variant charts matched the fixture for **2,160 hours** across all three houses. With four concurrent chart requests, median client round-trip time was **374 ms** and the slowest request was **578 ms**. Each chart read **91 daily rows** from one shard.

The 64 hosted history shard databases reported **1,203,355,648 bytes** combined, with a largest shard of **19,927,040 bytes**. Cloudflare reported **3.21 ms** p99 front Worker CPU and zero Worker runtime errors over **6,160 requests** in the available deployment and seed metrics. Account-level Durable Object storage, SQL-write and memory samples were unavailable in Analytics during the pilot. Steady-state sizing also needs an hourly ingest and expiry run. [Cloudflare Worker analytics](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/), [Durable Object analytics](https://developers.cloudflare.com/durable-objects/observability/metrics-and-analytics/)

## Authorize the first staging deploy

In your own terminal with Node 24, run these inside `cloudflare/`. Complete the Cloudflare authorization page in your browser. Keep the Workers account on **Free** and choose a `workers.dev` subdomain under Workers & Pages if the account asks for one.

```sh
npx wrangler login
npx wrangler whoami
```

If your shell uses Node 18, you can run both commands below directly from the **repository root**. The first installs the staging dependencies on a fresh checkout. Once they are installed, use the second command for each browser login. Each command works in a fresh shell at the root.

```sh
npm exec --yes --package=node@24 -- npm ci --prefix cloudflare --include=dev
npm exec --yes --package=node@24 -- ./cloudflare/node_modules/.bin/wrangler login
```

Wrangler stores the login in your user profile. If it lists multiple accounts, set `CLOUDFLARE_ACCOUNT_ID` to the intended account ID in the deploying shell. A staging deploy creates one Worker and two SQLite-backed Durable Object namespaces. [Wrangler authentication](https://developers.cloudflare.com/workers/wrangler/commands/general/#login), [Workers permissions](https://developers.cloudflare.com/workers/authorization/workers/)

When ready to provision staging, run the deploy and use the printed `https://gathering-ledger-staging.<subdomain>.workers.dev` origin for `MARKET_API_URL`, without a trailing slash. On a newly registered subdomain, wait for `/api/status` to respond over HTTPS before running the uploader. Create a random, dedicated ingestion key of at least 32 characters in your password manager. In Bash, enter it at the hidden prompt below. The same key will authorize repeat uploads.

```bash
npm run deploy:staging
read -rsp 'Staging ingestion key: ' MARKET_INGEST_TOKEN && echo
export MARKET_INGEST_TOKEN
printf '%s' "$MARKET_INGEST_TOKEN" | npx wrangler secret put MARKET_INGEST_TOKEN
read -rp 'Deployed staging origin: ' MARKET_API_URL
export MARKET_API_URL
npm run pilot -- --days 1
```

Open the staging origin to see the chart, then use `npm run pilot -- --days 90` to measure the full window. An interrupted upload can be retried with the same command. A competing batch receives HTTP 409 while the first upload holds its ten-minute lease. The CLI accepts only loopback and this staging Worker's HTTPS hostname and refuses HTTP redirects. Keep the local test key confined to the local emulator. [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)

## Manual GitHub workflows

When the code is on your GitHub repository's default branch, create the environments below and restrict deployments to that branch. Both workflows run on manual dispatch, share a concurrency group and use a read-only repository token. Dispatch **Deploy Cloudflare staging** to update the service. Dispatch **Seed and verify synthetic staging history** to load 1, 7 or 90 days. The seed job calls the application endpoint and prints aggregate measurements.

| GitHub environment | Environment variable | Environment secret |
| --- | --- | --- |
| `staging-deploy` | `CLOUDFLARE_ACCOUNT_ID` | `CLOUDFLARE_API_TOKEN` scoped to deployment of the existing staging Worker |
| `staging-pilot` | `MARKET_API_URL` set to the staging origin | `MARKET_INGEST_TOKEN` matching the Worker secret |

Use the owner's interactive login to create the Worker. For CI, use the documented Worker-scoped Editor access on the existing Worker. Account-wide access and Blizzard credentials are unnecessary for these workflows. Cloudflare Worker secrets are configured separately from GitHub environment secrets. [Cloudflare CI authentication](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/), [Worker access roles](https://developers.cloudflare.com/workers/authorization/workers/)

## Publication and chart reads

1. The uploader declares a UTC interval and the checksums of all 64 batches. The control object issues a generation number and a lease.
2. Each history object verifies its batch, preserves earlier committed hours in that UTC day, writes the new generation and acknowledges the checksum. Retries may repeat any of these uploads.
3. After all 64 acknowledgments, one control-object transaction advances the manifest. The previous chart stays readable throughout an interrupted upload.
4. A chart request pins the committed generations for its window. The selected item's shard reads one row per sampled UTC date, decodes only the requested hours and returns that item's three quotes per hour. Each quote carries the house's source publication hour. Unknown, empty and bid-only states remain distinguishable. Daily alarms remove expired and superseded generations after allowing in-flight readers to finish. Reads enforce the rolling 2,160-hour window independently of alarm timing.

The next live milestone is the owner's approved daily low, high and mean of observed minimum asks. The existing localhost collector remains the source for live trading. [Architecture and acceptance targets](../docs/cloudflare-deployment-proposal.md), [data retention decision](../docs/blizzard-api-terms.md#owner-retention-decision-2026-11-16)
