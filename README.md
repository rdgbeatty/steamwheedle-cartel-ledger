# WoW: Forever auction-house trader

The live US PvP history chart covers Alliance 110, Horde 113 and Neutral 116. Select an item name in the local tables to open its chart, including its equipment variant. GitHub Actions runs the collector hourly at minute 37 UTC. Each distinct publication contributes its minimum unit buyout and listed buyout quantity. Price gaps show missing publications. The archive also records anonymous price levels and retains up to 90 days of source history. [Live viewer](https://gathering-ledger.gathering-ledger.workers.dev/), [collector operations](cloudflare/live/README.md)


Small local collector, trading tables and data browser for **all Forever items**, locked to **US PvP**: Alliance **110**, Horde **113**, neutral **116**. Requires **Node 18.18+**; no dependency installation is needed. See [mapping evidence and metric definitions](docs/us-pvp-markets.md).

```sh
npm start
```

Open **http://localhost:4174**. The EVE tool can keep using port 4173. An alternate port is available with `npm start -- --port=4175`.

## First live collection

1. Open the **Local setup** tab. Follow the link to the [Blizzard developer portal](https://develop.battle.net/access/clients), sign in there and create an application, for example **Local Gathering Ledger**. If registration asks for a redirect URL, enter `http://localhost:4174/oauth/callback` (adjust for a different port). This collector uses the **OAuth client-credentials grant**; that redirect is a registration placeholder, not a character-login callback.
2. Copy the application's **client ID and client secret** into the localhost form and click **Save & collect**. A Battle.net password or player authorization is unnecessary. Do not paste credentials into a chat.
3. The tool authenticates, checks that Forever's US index still advertises the fixed PvP houses, loads the full item catalog and collects 110/113/116. Check the progress message for any API error.
4. **US PvP · locked**, inside Local setup, shows the fixed feeds. The mapping is corroborated by community services rather than inferred from the ruleset URL alone. **Check feeds** repeats discovery; **Collect now**, beside Last collection on any data page, refreshes the same three houses. Alternate houses cannot be selected through either the page or collection API.

After updating an already running tool, stop it with **Ctrl+C**, run `npm start` again and reload the page. Saved credentials remain usable. Compatible cached prices display immediately; cached data from a different market requires a new collection. **Collect now once to upgrade an older ores/herbs snapshot to all items.** Its limited catalog is detected and replaced automatically, without requiring the catalog-refresh checkbox or resetting the collection cooldown.

**Preview sample** demonstrates the table without credentials or network access. Its invented prices are clearly labeled, never saved as live data and never replace a live snapshot.

Configured users open directly to the **Neutral → Alliance** table. A compact **Last collection** strip on all three data pages holds the collection time and adjacent **Collect now** button. Expand it for per-house timestamps, collection progress and catalog/house counts. Fresh details start collapsed; details stay open while collection runs or when the last collection or any known source prices are **more than four hours old**. The age rule updates while the page stays open and prevents collapsing stale details. A cached refresh cannot hide old source prices. Metric explanations and data notices fold below the table; credentials, feed checks and sample preview live on the separate Local setup tab.

## Data browser and category filters

**Data browser**, the third data tab, shows item names/IDs and categories, then prices, buyout stock and offer counts for **Alliance, Horde and neutral**. It applies no trade analysis, fees, profit thresholds or volume gates. Choose minimum or quantity-weighted median buyout, search by name, ID or category, and click column headings to sort. Unavailable markets, bid-only listings and confirmed stockouts are distinguished.

**Only listed items** is checked initially and includes bid-only listings. Uncheck it to browse every catalog item, including items absent from the current auction books. Equipment variants remain separate; hover the item name for the API's variant details. Items absent from static search remain visible by ID in **Unknown** instead of being silently discarded. They cannot be assigned a reliable name/category from auction data alone.

All three tables have independent **category checkboxes**, with **All** and **None** shortcuts, inside an expandable Categories area. Select any combination; matching categories are combined with OR. Categories come from the full snapshot, not just profitable or currently searched rows, so filtering does not hide filter choices. Trade-goods subcategories such as cloth, leather, herbs and ores remain selectable alongside weapons, armor, consumables and other classes. New categories join an All selection automatically; explicit selections are preserved across snapshot updates.

Each table renders **100 rows per page**. Filters and sorting apply to the complete dataset before pagination, and changing them returns to page one. Browsing, searching, checking categories and changing pages use the saved snapshot and make no Blizzard requests.

## Neutral → Alliance

This page lists only neutral buyout opportunities with positive expected profit when every purchased unit sells at the **current Alliance minimum unit ask**, less a **5% Alliance sale fee**. Its target always uses the minimum, independently of the comparison page's minimum/median setting.

Columns show item/category, Alliance and neutral minimum unit asks, both houses' buyout stock/offer counts, and **Expected profit**, ranked highest first. Stock includes all buyout listings, including unprofitable neutral ones; it measures supply rather than actual sales. Profit displays in gold with three significant figures and k/M/B/T suffixes. Sorting uses the full value.

**Filter low volume** is an optional checkbox above the table, initially off. When enabled it requires at least **1,000 Alliance buyout units**, with an editable minimum. It checks the destination market's stock as a supply proxy, not actual units sold/day. It does not require a minimum neutral stock: one cheap neutral listing can still be a valid purchase. The filter hides opportunities without changing their expected-profit math, and does not issue API requests. Unknown Alliance stock is excluded while the filter is on.

For each neutral price level, the calculation is:

```text
gross revenue = Alliance minimum unit ask × level quantity
sale fee = gross revenue × 5%
level profit = gross revenue − sale fee − neutral purchase cost
expected profit = sum of strictly positive level profits
```

The click-open **ⓘ** beside each profit shows a table of profitable price levels, unit/offer counts, exact purchase costs, Alliance gross proceeds, the negative 5% deduction and profit, plus totals. Equal-price offers are grouped; whole-stack buyouts retain their original total purchase costs. Duplicate auction IDs across item/commodity books are counted once, bid-only listings are excluded, and item variants remain separate. Break-even and loss-making levels do not contribute. The model applies exactly 5% proportionally; individual fee rounding, deposits, relisting costs and future price changes are excluded.

**Collect now once after this update** to obtain neutral price depth. Older snapshots contain summaries only, so they remain usable on the comparison page but cannot produce resale profit estimates. Failed houses, absent Alliance asks and incomplete depth do not generate opportunities. Neutral price-level aggregates contain no auction or player identities and remain subject to the latest snapshot's 30-day expiry; they are not a historical archive.

## Alliance → Neutral opportunities

The owner can move goods between Alliance and neutral, but cannot transfer them to a Horde character. Horde prices are a reference for an independent trader's onward resale. This page uses editable **filters**, without imposing a trader buffer or adding a desired margin to estimated profit.

Defaults require Alliance's price below Horde's, **1,000 units on both faction markets**, positive profit after both fees and at least **1g of profit × volume**. The visible **Filter low volume** checkbox starts enabled; unchecking it removes the volume minimum but keeps the profit filters and volume multiplier. Expand **Trade filters** to change minimum units, both/either-market matching, minimum profit per unit and minimum profit × volume, or restore defaults. Minimum buyout is the initial price basis; the optional median basis updates all page-one comparisons and calculations.

**Profit × volume**, ranked largest first and shown beside the item, is:

```text
maximum neutral price = Horde ask × 0.95  (other trader breaks even)
maximum profit for you / unit = maximum neutral price × 0.85 − Alliance cost
profit × volume = maximum profit / unit × min(Alliance volume, Horde volume)
```

This is a **ceiling on your opportunity**, not your realized profit or an assumption that another trader will accept zero earnings. Both cuts use their actual sale-price bases. Your own profit at a chosen neutral price N is `0.85 × N − Alliance cost`; the other trader's is `0.95 × Horde ask − N`. Click **ⓘ** to see the fee calculation, the multiplier and both traders' margins at the current neutral minimum, which may be negative. Missing neutral prices do not prevent a faction opportunity score; they leave the current-neutral-price scenario unknown.

The volume source defaults to **estimated daily sales when both faction estimates exist; otherwise both sides use current listed buyout stock**. The table always shows faction stock, with daily estimates underneath when available; each score identifies its daily or stock basis. A known zero estimate remains zero. Daily-only mode excludes missing coverage, and stock-only mode never uses estimates. The smaller faction volume supplies the score in both/either filter modes. Neither faction volume measures neutral demand, a player's market share or how many units should be purchased. Full Alliance stock is not all offered at its minimum price.

The local server reads [AHledger's documented public Forever tables](https://ahledger.com/developers) anonymously when page one is first opened with live prices; no provider credentials are required. The table's ninth field encodes estimated units sold/day × 10. Estimates derive from scans over seven days, or fourteen on quieter houses, and cannot reliably distinguish all cancellations from sales; see the [provider's methodology](https://ahledger.com/glossary). Live coverage and the published payload contract could not be authenticated by this runner because outbound DNS is unavailable; unsupported payloads, unavailable services, stale cache entries and absent item estimates fall back explicitly. Base-item estimates are never applied to item variants.

Sales estimates remain separate from the saved Blizzard snapshot. Both the server and UI discard them at the provider's HTTP cache expiry, accounting for Age/Date; no-store/no-cache responses are not retained, and Retry-After blocks early retries. A server instance coalesces concurrent readers and limits each market to at most one download/minute. The UI does not poll this provider automatically; **Refresh sales estimates**, inside Metrics & data notes, retries using the provider cache and cooldown. Expiry returns rows to stock fallback (or excludes them in daily-only mode). The third party sees the server's network request; Blizzard credentials and player data are never sent. Personal/community use is documented as permitted with attribution; data archives and paid uses have separate terms. This tool stores none of these responses on disk.

Minimum/median unit prices, buyout stock/offer counts, and the Horde–Alliance and Neutral–Alliance imbalances remain available. Profit scores use three significant figures in gold; sorting retains full values. Deposits, relisting, price changes and neutral sell-through are outside this score. See the [worked model](docs/alliance-neutral-strategy.md).

The catalog queries **Forever's static item search across all classes**. Live exploration found that an unfiltered search returns 1,000 results with `resultCountCapped: true` despite `pageCount: 1`. Collection therefore traverses ascending item-ID ranges (`orderby=id`, `id=[lastId+1,]`, 1,000 results/request), rather than treating the first page as complete. Repeated or unordered IDs, malformed responses and range failures abort catalog publication. No per-item metadata request or Retail/Classic fallback is used. Names ending in **Ore** receive the Ores filter label, but naming/category rules never exclude items. Bars, stones, other trade goods and all other classes are included.

Blizzard's auction endpoints return whole house documents, so a collection downloads both items and commodities for the fixed houses, then retains summaries for **every auctioned item**, including IDs absent from static search, plus anonymous neutral price levels. It does not request each item price individually; all-item coverage and depth add no auction requests. The integration author's [current Forever notes](https://blizzard.pinta.land/forever/auctions/) document the separate books and ruleset/house ambiguity. The owner has since confirmed a successful live discovery/collection; the [mapping note](docs/us-pvp-markets.md) records the evidence behind the locked IDs.

## Local operation

**Collect now** checks for newer API data with a server-enforced cooldown: five minutes after updated data, ten after the first unchanged check and fifteen after subsequent unchanged checks. New data resets the delay to five minutes. The button counts down; reloads, multiple tabs and backend restarts do not reset the persisted gate. Discovery, repeated setup and the web neutral-house check share it. Upstream Retry-After or an exhausted budget can impose a longer wait.

Auction checks send the saved ETag or Last-Modified as a conditional GET, including after restart. When all six documents are unchanged, the price snapshot is left intact and **Last API check** reports **No newer auction data** separately from the source/collection ages. A fresh item catalog or missing price depth requires full responses, and a partially changed house may need one extra body fetch. HEAD is unsupported on the tested auction paths; the advertised 24-hour max-age does not establish the publisher's next update time. See the [live protocol findings](docs/collection-freshness.md).

The local server and diagnostic CLI share a conservative **600-request rolling hourly budget**, well below 36,000. It counts OAuth, catalog requests, retries and conditional checks; request usage appears inside collection details. `.wow-local/request-budget.json` and `collection-state.json` persist usage/retry deadlines and the collection gate, with no secrets or API bodies. Other programs or machines using the same credentials are outside this local counter. Six auction checks every five minutes is 72 requests/hour before those other costs; adding tracked items does not multiply the whole-house endpoint count.

**Why 600?** This is an application safety cap, not a separate Blizzard quota or a claim that 600 is the optimal value. The normal five-minute schedule needs at most about 72 auction requests/hour; unchanged-data backoff uses fewer. A catalog refresh currently adds 18 requests once/day, with occasional OAuth, discovery, retries and neutral-house diagnostics. 600 gives roughly eight times the ordinary auction traffic in headroom while using only 1.67% of the stated 36,000 maximum. It stops accidental loops early and leaves capacity for other clients. It limits the rolling total, not instantaneous request spacing, and an upstream lower limit or Retry-After takes precedence.

### Missing item names

**Item #ID** means that auction data exists for the ID but the Forever static catalog did not supply a name. Live probes confirmed this is an upstream coverage gap: `/data/wow/item/2072`, `/647`, `/287039`, `/1604`, `/942` and `/13057` returned 404 in `static-forever-us`, while `/data/wow/item/2770` resolved to Copper Ore. Exact item search for #2072 returned no results, and a narrow ID range also omitted missing equipment IDs. Retrying every unknown ID would spend thousands of requests without a demonstrated source of names.

The [Forever API integration author's original report](https://us.forums.blizzard.com/en/blizzard/t/wow-forever-api-what-works-so-far-plus-a-ts-client/60334) independently documents missing metadata for auctioned items, including older equipment. The saved all-item validation had 3,062 unnamed IDs; equipment variants multiply their number of table rows. This is unrelated to the local 600-request cap. The app now labels these rows **Name unavailable in Forever API**, with an explanatory tooltip while preserving prices, profit and variant identity. Category checkboxes allow excluding Unknown if desired. Full names would require Blizzard to fill the gap or a separately verified and permitted Forever-specific metadata source; no other edition is used as a substitute.

To verify the neutral house against the game, open **Local setup → Verify neutral auction houses → Load Stranglekelp in all neutral houses**. It discovers every US Forever neutral/Blackwater house (currently 116, 117, 118, 121 and 125), then reads both item and commodity documents for each. This inspection can challenge the assumed PvP IDs: it does not require the expected trio to be present, change settings, or replace the trading snapshot. It uses the same application client, cache headers and cancellation path as collection.

Each house shows every Stranglekelp (#3820) buyout, sorted by unit ask, with stack size, exact whole-stack cost, number of identical offers and source feed(s). Only identical price/stack/cost offers are grouped; no asks are omitted or truncated. Bid-only listings are counted separately. Minimum and weighted median prices, total units/offers, source publication time and fetch/cache information are explicit. Set **Highlight unit ask (copper)** to a price visible in game, then compare several prices and stack sizes. Missing/failed feeds are marked incomplete, not empty. Ruleset labels remain community evidence until compared with the game; the ruleset URL alone is not confirmation.

The same check can run without restarting the web server:

```sh
npm run inspect:neutral
```

It reuses saved local credentials (or the documented environment variables) and prints the complete comparison as Markdown; it never prints credentials. Diagnostic books are not written to disk. The web report is held in memory only, expires within 30 days of its oldest source observation, and disappears on restart. Any manually saved terminal output must follow its printed source-data expiry. API publication may lag game listings; fresh retrieval does not renew older source data. A cache-age correction accounts for upstream HTTP Age/Date instead of granting an aged response a new full max-age, and honors no-cache/no-store. It does not bypass upstream caching or prove which house matches the game.

The server binds to **127.0.0.1** and serves an explicit list of assets. Its ignored `.wow-local/` directory contains:

| File | Purpose |
| --- | --- |
| `private/credentials.json` | Saved application ID and secret. Written with mode 0600; unencrypted at rest, with effective permissions determined by the filesystem/Windows ACLs. |
| `settings.json` | Discovered houses and the fixed US PvP selection. Older saved selections are migrated. |
| `catalog.json` | Full Forever item catalog, refreshed after one day, on scope upgrade, or when requested. Original data age still enforces the 30-day retention limit. |
| `snapshot.json` | Latest all-item market summaries and anonymous neutral price levels (unit price, quantity, offer count and purchase cost). Auction/player identities, raw books and OAuth tokens are not saved. |

The client secret is never returned by the server. Access tokens stay in memory and renew as necessary. **Forget saved credentials** removes the disk copy. Optional `BLIZZARD_CLIENT_ID` and `BLIZZARD_CLIENT_SECRET` environment variables replace local credentials; set both together. `.env.example` documents them, but this tool does not automatically load `.env` files.

A failed full collection preserves the last successful snapshot. A partial collection explicitly marks the failed houses unavailable rather than mixing old and new quotes. Conditional requests preserve the original source age. No background collection runs: click **Collect now** when needed, with cached responses reused according to upstream headers. Cancel stops an active job.

The localhost market app keeps the latest live snapshot. Snapshots older than 30 days, measured from the oldest known source/retrieval time, are removed when read. The separate **Cloudflare staging pilot** implements history ingestion and a per-item chart using synthetic data. It includes a local runtime test, a resumable 90-day fixture and manual deployment workflows. [Staging setup and verification](cloudflare/README.md)

The [hourly history storage spike](docs/history-storage-spike.md) measures the current data and compares 90-day summary history, SQLite, anonymous price depth and full order books. It includes reproducible sizing scripts; no archive or scheduled collection is enabled.

The [history hosting spike](docs/history-hosting-spike.md) compares the EVE repository's GitHub-only design with GitHub plus R2, local SQLite and hosted SQL.

The [Releases, browser delivery and billing follow-up](docs/github-releases-and-billing-spike.md) evaluates daily archives, small favorite-item downloads, live CORS headers, and provider-enforced cost controls. Under the owner's hard-overage requirement it favors Releases plus Pages over R2; this remains a proposal.

The [Durable Objects Free spike](docs/durable-objects-storage-spike.md) measured **0.856 GB compressed** and **2.403 GB uncompressed** in a local SQLite sizing experiment for 90 hourly days. It also examines free-plan write limits and browser delivery.

The [Cloudflare deployment proposal](docs/cloudflare-deployment-proposal.md) explains Worker and Durable Object CPU limits, production rollout criteria and the retention decision for live data. The staging workflows run on manual dispatch.

## Validation and limitations

```sh
npm test
npm run check
```

Tests exercise OAuth requests and renewal, retry/cache behavior, capped-search ID traversal, all-item catalog migration and missing metadata, price normalization, variants, failure states, secret handling, US PvP scope enforcement, compact metrics, both imbalance pairs, resale price depth and exact stack costs, both routes' fee models, filter boundaries, daily estimates versus stock fallback, provider cache expiry and Retry-After, base-item scope, summary-only snapshot compatibility, click-open math, the four-hour expansion rule, tab navigation, HTTP route security, independent checkbox filters and pagination after sorting. HTTP integration tests invoke the real request listener through an in-memory transport, and UI tests use a DOM harness. Provider fixtures follow the published AHL1 contract; these checks do not claim a real-browser or live provider run by the development agent.

The resumed development runner now has network access. Authenticated Blizzard header and conditional-request probes succeeded, and an isolated local HTTP test verified live collection, zero-request cooldown rejection and an unchanged six-document check without rewriting the snapshot. The owner's normal saved snapshot was preserved. API errors appear in the local page without echoing credentials; future changes to Forever's undocumented API may need adjustment.

An additional authenticated **all-item** probe on 2026-11-17 (US Eastern) found **17,733 static items in 18 range requests** across 23 categories. The six auction feeds contained 236,889 Alliance, 263,474 Horde and 33,549 neutral listings, reduced to 54,842 listed item variants. Another 14,332 catalog bases had no listings, for 69,174 browser rows with Only listed items off. The auctions included 3,062 distinct item IDs absent from static search; all were retained as Unknown. A second six-request conditional check reported unchanged books and reproduced the same rows. Counts describe that snapshot, not permanent catalog/market totals. OAuth added one request per validation client; all probes used the shared 600/hour budget. No raw books or validation price snapshot were saved.

## Discovery spike

Discovery spike, researched **2026-11-16**. Throughout this project, **WoW** means **World of Warcraft: Forever**. Other WoW editions are outside scope.

The initial trading context is **US, PvP, Alliance**. Collection must also cover **US PvP Horde**, with **neutral/goblin prices** investigated for cross-faction opportunities. Region and ruleset are explicit filters. Historical price graphs are a confirmed requirement.

Read the spike in this order:

1. [Requirements inferred from the EVE project, and confirmed WoW requirements](docs/discovery/01-requirements.md)
2. [Available APIs, source permissions, coverage and research evidence](docs/discovery/02-data-access.md)
3. [Required data, collection experiments and acceptance criteria](docs/discovery/03-collection-plan.md)

The recommendation is to **validate Blizzard's Forever feed first**, especially the mapping between API house IDs and the player's actual markets. Published community integrations demonstrate access, but this spike did not authenticate against Blizzard. Third-party APIs offer useful alternatives and history, with material differences in coverage and reuse rights; see the source assessment before choosing one.

Subsequent implementation: the owner has collected live data and the tool now uses the [corroborated US PvP mapping](docs/us-pvp-markets.md). The discovery documents retain their original research context.

The discovery documents define the broader information and collection work. The local pilot above implements all-item browsing and the two trading tables; production storage, hosting and historical-data architecture remain deferred.
