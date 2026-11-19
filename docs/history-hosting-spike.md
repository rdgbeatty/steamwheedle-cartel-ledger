# History storage and the GitHub-only approach

Research date: **2026-11-18**. Decision briefing only: no workflow, storage account, deployment or history collector was created. Based on the [measured storage spike](history-storage-spike.md) and inspection of `../react-parse-goonmetrics`.

**Updated constraint:** The subsequent [Releases/browser and billing investigation](github-releases-and-billing-spike.md) supersedes this document's R2 preference for an owner requiring a hard free-tier cutoff. R2 has no documented applicable spending cap; the updated proposal is daily Release archives plus small Pages chart files.

**Newer candidate:** The [Durable Objects Free investigation](durable-objects-storage-spike.md) measures a grouped history database below 1 GB, with modeled writes below the free quota and a provider-side free-plan stop. It is now a strong alternative to the static GitHub serving proposal, pending a live Cloudflare pilot. No hosting decision has been made.

## Finding

**GitHub-only can work for the compressed hourly minimum-price/stock history. It needs durable archives and a different history-serving layout from the EVE latest-snapshot design.** Its constraints become more material than the data-processing cost. My preferred hosted option is **Actions + Pages + R2 object storage**; **local SQLite** is the simplest continuation of the current local tool. Neither choice requires a managed SQL service initially.

## What the EVE repository actually contains

- Its [GitHub-only design](../../react-parse-goonmetrics/docs/discovery/04-github-only-vs-cloudflare.md) proposes Actions collection, Secrets for credentials and generated JSON beside the frontend in the Pages deployment. Market observations are not committed to Git. It originally targeted the latest snapshot, not an hourly time series.
- Its [latest feasibility spike](../../react-parse-goonmetrics/docs/discovery/11-github-only-auth-feasibility.md) proposes bounded, checksummed **Release assets** for durable catalog/history state, with cache as optional acceleration. This is a design and browser feasibility harness; integrated hosted collection/state recovery is explicitly unproven.
- The checked-in [workflow](../../react-parse-goonmetrics/.github/workflows/deploy-pages.yml) remains a manual deployment of the legacy frontend, pointed at the old API. It does not implement that complete replacement pipeline.
- EVE's local history store keeps a 21-day regional daily history and prepared serving summaries. The API can backfill that regional history. Our WoW historical auction observations cannot currently be reconstructed after they are missed or lost.

The useful pattern is **scheduled collector → durable state → small published views**, rather than using Git commits as a database. WoW application-token authentication is simpler than EVE's rotating character grant: Actions can hold the Blizzard client ID/secret and obtain a temporary token, without EVE's Secret-write-back mechanism.

The item count alone is not the blocker. EVE's [storage benchmark](../../react-parse-goonmetrics/docs/discovery/07-storage-performance.md) used 60,000 hub/type quote rows and about 1.26 million retained daily history records. WoW has roughly 64,000 active variant/market observations per hour, but 90 hourly days produces about **138 million records**—roughly 110 times that historical row count, with different fields per row.

## Does it fit GitHub?

The previous measurements cover all three houses and preserve equipment variants:

| Representation, 90 hourly days | Measured projection | Fit as a Pages site? |
| --- | ---: | --- |
| Compact summary, stored as gzip files | 0.55 GB | Yes at today's size, with limited headroom |
| Positional JSON summary, stored as gzip files | 0.65 GB | Yes, less headroom |
| Uncompressed compact summary | 2.35 GB | No |
| Indexed SQLite database | 4.56 GB | No; also unsuitable as a single browser download |
| Compressed full API order books | 8.81 GB | No |

Pages limits the **published site to 1 GB**, has a **100 GB/month soft viewer-bandwidth limit**, and requires deployments to complete within ten minutes. These are separate limits; a small download does not make a large published site fit. Store compressed data files themselves in the deployed site and decode selected files in the browser; merely enabling HTTP compression on a 2.35 GB uncompressed directory does not make that directory smaller. [Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)

The browser must request only the selected item/time partitions, not download all 90 days for every item. For illustration, 256 equally sized history buckets would average about **2.1 MB compressed each**; real equipment distributions and compression fragmentation require measurement. A small manifest selects files and records schema, coverage and source times.

GitHub-only design that could work:

1. One serialized Actions collector reads Blizzard credentials from Secrets and collects/validates the three houses.
2. Write immutable hourly summary chunks; compact completed days into roughly **6.1 MB/day** at the measured size. Keep versioned manifests/dictionaries and checksums.
3. Retain the authoritative chunks in **Release assets**, organized and pruned by date. Cache can accelerate jobs, but a cache miss must recover every retained observation from durable state.
4. Assemble a complete Pages generation with the viewer, latest table and compressed, partitioned history. Publish only after the durable write succeeds; retain the previous good generation on failure.

Release files must be **under 2 GiB**, and a release can contain up to **1,000 assets**. Daily chunks fit easily; 2,160 hourly files would need multiple releases or compaction. Use Release assets as collector checkpoints here; direct browser fetching of Release assets, including redirects/CORS and private access, is an additional path that this spike did not test. [Release quotas](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)

### Why I would not simply reuse the existing layout

- **Cache-only persistence is unsafe for this history.** GitHub evicts caches after seven days without access and also under storage pressure. EVE can rebuild its reference history; we cannot promise a WoW backfill. [Cache policy](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching)
- **Full-bundle churn is substantial.** Restoring and uploading a 0.55 GB archive every hour at steady size is approximately `0.55 × 2 × 720 = 792 GB/month` of pipeline transfers. That is arithmetic, not a measured runner cost. Restoring from Pages itself would account for about 396 GB of downloads, already above its soft viewer-bandwidth allowance; restore from durable checkpoints instead. Incremental Release chunks reduce checkpoint uploads, but Pages publication still assembles a complete site generation. [Custom Pages publication](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- **Schedules are best-effort.** GitHub documents delayed or dropped scheduled jobs and automatic disabling after 60 days of inactivity in public repositories. Use an off-hour minute, show gaps and alert on missed collections. Replacing storage with R2 does not fix this scheduler behavior. [Schedule behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
- **Git commits do not implement expiry.** Removing an old file leaves its previous Git versions. Repeated generated binary commits also accumulate data and complicate cloning. GitHub blocks ordinary Git files above 100 MiB. Keep observations out of repository history. [Large-file guidance](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)
- **Artifacts are delivery/checkpoint tools, not anonymous chart endpoints.** Downloads require GitHub access and artifacts expire. Standard public-repository runner compute is free; artifact storage is a separate consideration, and GitHub's Free-plan table lists 500 MB. A real pilot must verify the account's Pages-artifact retention/accounting rather than infer that every storage operation is free. [Artifact access](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts), [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)

The roughly 1.8× compressed-data headroom is adequate for a prototype, not a comfortable growth plan. Additional summary fields, new item variants, duplicated generations and an inefficient chart export all consume it. Only representative hosted deployment and browser tests can establish timings and usability.

## Options to choose between

| Approach | Storage model | Advantages | Tradeoffs / cost outlook |
| --- | --- | --- | --- |
| **A. Strict GitHub-only** | Actions collector; Release chunks as durable history; Pages viewer and compressed chart files | One provider; no permanent server; current summary window fits | Pages ceiling and repeated full deployments; more archive/manifest machinery; public/static delivery assumptions; $0 target needs artifact/account verification |
| **B. GitHub + R2 — preferred hosted option** | Actions collector; R2 summary chunks and chart partitions; Pages viewer | Independent data writes; ample room; no running database/API needed for precomputed charts; same file format can run locally | Another account/storage credential; production delivery/CORS setup; still Actions scheduling unless collection moves |
| **C. Always-on collector + SQLite** | Current Node tool plus SQLite on an existing PC/NAS or small server; independent backups | Direct indexed chart queries; transactional updates; easiest continuation of local app; no Pages data limit | Machine must stay running; operate backup/expiry and remote access if wanted; hosted machine costs extra; reserve 5–10 GB plus backups |
| **D. Hosted SQL service** | Worker/API plus managed SQL, with object archives as needed | Convenient server-side filtering, access control and future multi-user queries | More components and row-write costs; free SQL plans are not a natural fit for the measured ingest rate |

### B: R2 details and expected cost

The 0.55–1 GB summary archive is far below R2 Standard's current free allowances: **10 GB-month storage, 1 million write-class operations and 10 million read-class operations/month**, with free direct egress. Above allowances, Standard storage is **$0.015/GB-month**; operations are separately priced. This supports an expectation of $0 storage/operations for modest personal use, not a guaranteed whole-service bill. Allow for other account usage, backups, operation counts and any domain/Worker costs. [R2 pricing](https://developers.cloudflare.com/r2/pricing/)

Batch observations into hourly/daily files and chart partitions; do not create one object per price point. For example, 256 partition writes each hour would be about 184,320 writes/month before other work, within the cited allowance; one write per observation would be around 46 million. Exact partitioning can be chosen after a browser prototype.

Publish data using a custom domain or a small read-only Worker, with CORS configured for the viewer. The free `r2.dev` endpoint is explicitly for development and rate-limited, so it is not the production delivery plan. The collector remains a Node job; this proposal does not assume its full-book parsing fits the CPU allowance of a free Worker. [Public R2 delivery](https://developers.cloudflare.com/r2/buckets/public-buckets/), [CORS](https://developers.cloudflare.com/r2/buckets/cors/)

### D: why a free managed database is not an automatic win

The measured workload is approximately **64,005 active observations/hour**, or **1,536,120 inserts/day**, before indexes and retention deletes. Cloudflare D1 Free allows 100,000 row writes/day and 500 MB per database. The unmodified relational approach exceeds both; indexes and deletes add billable work. Paid or blob-batched designs are possible, but the latter is essentially a file archive inside a database. D1 is one concrete example, not a judgment about every managed SQL provider. [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)

## Recommendation and remaining decisions

For an unattended hosted viewer, I favor **B**, retaining GitHub for source/builds/collector and adding R2 solely for data. It keeps the EVE pattern's simplicity while removing the Pages archive-size and whole-site data-update constraints. Choose **A** if avoiding another provider is the priority and summary-only history with best-effort scheduling is acceptable. Choose **C** if the app should remain personal/local and an always-on machine is available. A SQL hosting service is not necessary merely to draw per-item graphs.

Before implementation, decide:

- **Strict GitHub-only versus one storage provider.** This is the main infrastructure tradeoff.
- **Public viewer/data versus private use.** EVE's permission to publish its snapshots does not automatically decide WoW publication. Static public chart files are downloadable; private viewing adds access control or favors local operation.
- **Best-effort hourly collection versus a continuously operated scheduler.** If gaps are unacceptable, evaluate moving the collector to an always-on host or another scheduler; object storage alone does not fill missing observations.

Whichever option is selected, retain source time, explicit missing-market coverage, stable variant IDs, an atomic manifest and an independent recovery copy. Keep the latest order depth for current opportunities, and use hourly processed summaries for charts. The current localhost API frontend needs a static-data adapter for either hosted static option. The existing **30-day raw-data TTL** and [processed-statistics retention decision](blizzard-api-terms.md#owner-retention-decision-2026-11-16) still govern stored objects, artifacts and backups; this spike does not start or broaden an archive.
