# WoW: Forever auction-house trader

The live US PvP history chart covers Alliance 110, Horde 113 and Neutral 116. Select an item name in the local tables to open its chart, including its equipment variant. GitHub Actions schedules collection hourly. Each house has up to one observation per source hour. The chart shows minimum unit buyout and listed buyout quantity, with gaps where observations are missing. The archive retains anonymous price levels for up to 90 days. [Live viewer](https://gathering-ledger.gathering-ledger.workers.dev/), [collector operations](cloudflare/live/README.md)

The local collector, trading tables and data browser cover **all Forever items** in those three US PvP houses. The local app runs on **Node 18.18+** without installing dependencies. [Market mapping](docs/us-pvp-markets.md)

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

Each table renders **100 rows per page**. Filters and sorting apply to the complete dataset before pagination, and changing them returns to page one. Browsing, searching, checking categories and changing pages use the saved snapshot and make no Blizzard requests. [Local interface decision](docs/local-market-interface.md)

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

Click **Collect now** if an older snapshot has only summaries. The Neutral → Alliance page needs complete neutral price levels and an Alliance ask. Its local snapshot retains anonymous aggregates for at most 30 days.

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

The local server reads AHledger's public Forever tables anonymously when page one opens with live prices. The table's ninth field encodes estimated units sold per day × 10. Estimates derive from scans over seven days, or fourteen on quieter houses. Cancellations can resemble sales. Missing estimates, stale cache entries and unavailable or unsupported responses trigger the configured fallback. Estimates apply only to base items. [AHledger API](https://ahledger.com/developers), [estimate methodology](https://ahledger.com/glossary)

Sales estimates remain separate from the saved Blizzard snapshot. Both the server and UI discard them at the provider's HTTP cache expiry, accounting for Age/Date; no-store/no-cache responses are not retained, and Retry-After blocks early retries. A server instance coalesces concurrent readers and limits each market to at most one download/minute. The UI does not poll this provider automatically; **Refresh sales estimates**, inside Metrics & data notes, retries using the provider cache and cooldown. Expiry returns rows to stock fallback (or excludes them in daily-only mode). The third party sees the server's network request; Blizzard credentials and player data are never sent. Personal/community use is documented as permitted with attribution; data archives and paid uses have separate terms. This tool stores none of these responses on disk.

Both imbalance columns show the absolute price gap and which house is higher. Profit scores use three significant figures in gold and sort at full precision. Deposits, relisting, price changes and neutral sell-through are outside this score. [Trade screening decision](docs/alliance-neutral-strategy.md)

The catalog queries **Forever's static item search across all classes**. Live exploration found that an unfiltered search returns 1,000 results with `resultCountCapped: true` despite `pageCount: 1`. Collection therefore traverses ascending item-ID ranges (`orderby=id`, `id=[lastId+1,]`, 1,000 results/request), rather than treating the first page as complete. Repeated or unordered IDs, malformed responses and range failures abort catalog publication. No per-item metadata request or Retail/Classic fallback is used. Names ending in **Ore** receive the Ores filter label, but naming/category rules never exclude items. Bars, stones, other trade goods and all other classes are included.

Blizzard's auction endpoints return whole house documents, so a collection downloads both items and commodities for the fixed houses, then retains summaries for **every auctioned item**, including IDs absent from static search, plus anonymous neutral price levels. It does not request each item price individually; all-item coverage and depth add no auction requests. The integration author's [current Forever notes](https://blizzard.pinta.land/forever/auctions/) document the separate books and ruleset/house ambiguity. The owner has since confirmed a successful live discovery/collection; the [mapping note](docs/us-pvp-markets.md) records the evidence behind the locked IDs.

## Local operation

**Collect now** checks for newer API data with a server-enforced cooldown: five minutes after updated data, ten after the first unchanged check and fifteen after subsequent unchanged checks. New data resets the delay to five minutes. The button counts down; reloads, multiple tabs and backend restarts do not reset the persisted gate. Discovery, repeated setup and the web neutral-house check share it. Upstream Retry-After or an exhausted budget can impose a longer wait.

Auction checks send the saved ETag or Last-Modified as a conditional GET, including after restart. When all six documents are unchanged, the price snapshot is left intact and **Last API check** reports **No newer auction data** separately from the source/collection ages. A fresh item catalog or missing price depth requires full responses, and a partially changed house may need one extra body fetch. HEAD is unsupported on the tested auction paths; the advertised 24-hour max-age does not establish the publisher's next update time. See the [live protocol findings](docs/collection-freshness.md).

The local server and diagnostic CLI share a **600-request rolling hourly limit**. When enrolled with the hosted service, they also reserve each request against the same 600-call ceiling as GitHub Actions. Collection details include local request usage. `.wow-local/request-budget.json` and `collection-state.json` persist local request counts, retry deadlines and the collection gate. [Budget rationale](docs/collection-freshness.md), [shared budget setup](cloudflare/live/README.md#operating-the-collector)

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
| `private/history-service.json` | Optional live collector origin and ingestion secret for sharing the hosted Blizzard request budget. |
| `settings.json` | Discovered houses and the fixed US PvP selection. Older saved selections are migrated. |
| `catalog.json` | Full Forever item catalog, refreshed after one day, on scope upgrade, or when requested. Original data age still enforces the 30-day retention limit. |
| `snapshot.json` | Latest all-item market summaries and anonymous neutral price levels (unit price, quantity, offer count and purchase cost). Auction/player identities, raw books and OAuth tokens are not saved. |

The client secret is never returned by the server. Access tokens stay in memory and renew as necessary. **Forget saved credentials** removes the disk copy. Optional `BLIZZARD_CLIENT_ID` and `BLIZZARD_CLIENT_SECRET` environment variables replace local credentials; set both together. `.env.example` documents them, but this tool does not automatically load `.env` files.

A failed full collection preserves the last successful snapshot. A partial collection explicitly marks the failed houses unavailable rather than mixing old and new quotes. Conditional requests preserve the original source age. No background collection runs: click **Collect now** when needed, with cached responses reused according to upstream headers. Cancel stops an active job.

The localhost app keeps the latest live snapshot. It expires the snapshot on read after 30 days from its oldest known source or retrieval time.

## Hosted market app

The public site loads the current US PvP snapshot from Cloudflare. It offers both trading tables and the data browser, with listed stock as the activity proxy. GitHub Actions publishes the latest complete snapshot and the hourly history independently of website deployments. Wrangler's local emulator supports synthetic tests. [Pages app](https://rdgbeatty.github.io/gathering-ledger/), [public app decision](docs/hosted-market-app.md), [live runbook](cloudflare/live/README.md), [local fixture](cloudflare/README.md)

## To do

- Estimate market activity from our own hourly stock and order-book history. Validate what stock changes can tell us about sales.
- Investigate Cloudflare backups and rehearse a restore of market books and their expiring keys while preserving the retention policy.

## Validation and limitations

```sh
npm test
npm run check
```

Tests cover the collector, request limits, catalog and variant handling, both trading models and the local UI. HTTP integration tests invoke the request listener in memory. UI tests use a DOM harness and AHledger tests use AHL1 fixtures.

An authenticated November 17 probe found **17,733 catalog items in 18 range requests** and **3,062 auctioned IDs missing from the catalog**. An isolated live check verified that the immediate cooldown costs zero upstream requests and that an unchanged six-document check preserves the snapshot. [Collection decision](docs/collection-freshness.md)
