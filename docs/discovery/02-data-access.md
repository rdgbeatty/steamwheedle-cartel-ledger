# Data-access findings

Research date: **2026-11-16**. Target: **Forever live, US PvP, Alliance + Horde, with neutral/goblin coverage investigated**.

## Finding and evidence level

Integration authors report successful access to Forever auction data through Battle.net. A documented, stable Forever-specific Blizzard contract was not established in this research. The integration authors' own endpoint tests and SDKs are primary evidence for their observations; a community post on Blizzard's forum is not a Blizzard support commitment.

For the initial three-house comparison, the best next experiment is direct Blizzard collection. AHledger is a useful faction-price/history candidate; player-scan services offer alternatives, but their live coverage and data rights vary. These are candidates, not completed integrations.

## Blizzard feed

The author's [Forever API investigation](https://mhuijskens.com/WoWForever/Api/) describes application-token access using OAuth client credentials at `https://oauth.battle.net/token`. Requests use a regional API host and Forever namespaces. For the owner, start at `https://us.api.blizzard.com` with `dynamic-forever-us`; static item lookups use `static-forever-us`. Public market collection should not require player-profile authorization.

Candidate requests, to validate with an application token:

| Purpose | GET path |
| --- | --- |
| Discover rulesets | `/data/wow/ruleset/index` |
| Inspect ruleset | `/data/wow/ruleset/{rulesetId}` |
| Discover houses | `/data/wow/ruleset/{rulesetId}/auctions/` |
| Alternate reported index | `/data/wow/ruleset/{rulesetId}/auctions/index` |
| Item auctions | `/data/wow/ruleset/{rulesetId}/auctions/{houseId}` |
| Commodity auctions | `/data/wow/ruleset/{rulesetId}/auctions/{houseId}/commodities` |
| Item metadata | `/data/wow/item/{itemId}` |

Use the dynamic namespace for market requests and the static namespace for metadata. Discover links and identities rather than baking example house IDs into the product. The investigation reports **PvP ruleset ID 1**. [API investigation](https://mhuijskens.com/WoWForever/Api/)

The [TypeScript integration author's November 6 update](https://us.forums.blizzard.com/en/blizzard/t/wow-forever-api-what-works-so-far-plus-a-ts-client/60334) reports:

- Fifteen house IDs, **110–121 and 123–125**, with Alliance, Horde and Blackwater labels.
- Identical auction books returned under different valid ruleset IDs. Do not multiply those into independent markets.
- A change in required index-path slash behavior since the previous day.
- Auctions with item modifiers, quantity, buyout, optional bid and coarse time-left; commodities use unit price. Some empty responses omit auctions; some listings have no buyout.
- Missing Forever static metadata for many auctioned items in that particular sample.

These are dated observations that need rechecking, especially market mapping. [SDK release notes](https://github.com/SideQuest-Guild/wow-forever-sdk/releases) independently describe separate house and commodity readers. No authenticated requests were made in this spike.

No executed-sales tape or historical-price endpoint was established. Current listing snapshots can generate a future observed-price series, subject to collection rights. They cannot recover periods nobody recorded.

### Access rules that affect the data

Blizzard's published [Developer API terms](https://www.blizzard.com/en-us/legal/a2989b50-5f16-43b1-abec-2ae17cc09dd6/blizzard-developer-api-terms-of-use) require application registration, protected credentials and source attribution, and specify a **maximum 30-day TTL for API data**. The terms also restrict monetization, resale and automated extraction outside authorized API use, and publish a 36,000-call hourly ceiling subject to change.

Owner decision (2026-11-16): retain processed public auction-price statistics beyond 30 days, initially daily per-item/market minimum, maximum and mean, while expiring raw responses and copies within 30 days. The owner accepts the interpretation risk; see the [retention decision](../blizzard-api-terms.md#owner-retention-decision-2026-11-16). Third-party provider licences still require separate assessment.

See the [API terms reference](../blizzard-api-terms.md) for the official link, operating constraints, liability analysis and the distinction between the contract's broad retention language and Blizzard's historical-data FAQ.

## Third-party candidates

### AHledger: documented faction prices and history

The [developer reference](https://ahledger.com/developers) provides `https://api.ahledger.com` with:

- `/v1/markets` for discovery; market IDs such as `forever.pvp.alliance.us` and `forever.pvp.horde.us`.
- `/v1/pricetable/{market}` for a bulk current table with ETag support.
- `/v1/prices/{market}/{itemId}?range=7d` for item prices/history; documented ranges include 24h, 7d, 30d and 90d.
- `/v1/tooltip/{market}?items=...` for batch summaries; other endpoints expose deals and estimated sales.

Its documented markets omit neutral houses. Announced December 10 access tiers are 30 requests/minute and 7-day history without a key; a free key gives 300/minute and 30-day history. Commercial access adds longer series. The page contradicts itself about 24h bucketing, so validate actual timestamps. [Developer reference](https://ahledger.com/developers)

The [terms](https://ahledger.com/terms), announced November 10 and effective **December 10, 2026**, require attribution and prohibit retaining responses beyond their cache lifetime without an appropriate archive licence. Its listed Data tier starts at **$499/month**, with bulk access by agreement. Live chart queries and building our own archive are different permissions. Free access therefore does not solve independent history collection. [Access and licence schedule](https://ahledger.com/developers#terms)

Public API reads could not be retrieved through the research browser. Payload shape, US PvP freshness and variant handling remain untested.

### Grimlight's Depot: explicit reuse, limited observed live coverage

The [API reference](https://grimlightdepot.com/api/) distinguishes **live market pointers** from the v1 **beta archive**. Start with `/ah/live/api/markets`, then use the ruleset-specific summary and its snapshot hash to obtain the advertised snapshot. Do not use the old unqualified Horde example as a live PvP market.

The reference permits building tools with attribution and truthful scan-age/market labels. Keys are free after sign-in; the legacy API supports JSON/CSV/Lua bulk files, item history and ETags. Scans depend on the maintainer playing; base item IDs collapse suffix variants. Prefer one bulk fetch per changed snapshot and respect its caching guidance. Archive rights for the particular live feed still need checking. [API reference](https://grimlightdepot.com/api/)

A [public live metadata response](https://grimlightdepot.com/ah/live/api/markets) was readable during this spike: **Normal Horde**, 6,061 items, scanned **2026-11-15 01:16:44 UTC**; Alliance and neutral were unavailable in that response. This proves a public metadata surface, not US PvP coverage. Other ruleset pools were not exhaustively probed.

### auctionhouse.fyi: public snapshots, additional features gated

The site's [API overview](https://auctionhouse.fyi/docs/api) describes player scans exported through an addon and desktop app. Its assertion that Blizzard has no Forever auction API conflicts with newer integration evidence; treat it as a description of this provider's collection approach, not proof of Blizzard's absence.

The [market documentation](https://auctionhouse.fyi/docs/api/markets) lists six US faction markets, including both PvP factions, but no neutral house. Public snapshots include seven days of history; item variants remain distinct. Ruleset labeling depends on the contributor's external-client setting, introducing a classification risk.

Candidate reads under `https://auctionhouse.fyi/api/v1` include `/ah/{market}/snapshot` and `/ah/{market}/{item}/candles`. [Endpoint reference](https://auctionhouse.fyi/docs/api/reference) gates finer candles, live views and books by feature. [Limits](https://auctionhouse.fyi/docs/api/errors) are 60/minute anonymously, 120 for free accounts and 600 for contributors/premium. These read permissions do not establish archive or redistribution rights; those remain unresolved. No usable JSON payload was retrieved here.

### Everloot: player observations with an open-data licence

Everloot's [market-price API](https://everloot.app/docs/api/market-prices) discovers reported realm labels at `/api/market/prices`, then accepts `realm` and `house=alliance|horde|neutral`. It publishes a day's item value after three reporters. Omitting `house` selects older unclassified scans that may mix houses; do not use that as a fallback. US PvP mapping and coverage must be checked.

Its [history tool](https://everloot.app/docs/mcp/tools/auction-history) is also exposed as `/api/tools/auction_history?realm=...&itemId=...`. Confirm house separation and variant granularity before using its series. The [limits page](https://everloot.app/docs/api/keys) gives market prices a separate 200/hour anonymous allowance; the tools endpoint shares another 200/hour allowance with MCP.

The [licence page](https://everloot.app/docs/licence) licenses player observations and derived facts under **CC BY-SA 4.0**, with attribution and share-alike requirements; Blizzard material is separate. Its [data policy](https://github.com/Everloot/everloot/blob/main/docs/DATA_POLICY.md) explicitly separates Blizzard auction summaries from the player dataset and excludes those summaries from API/export/open-data paths. This is a promising archive candidate for the player-data layer, with coverage and scope still unverified. The public market JSON could not be retrieved here.

### Other useful reference services

| Service | Evidence / disposition |
| --- | --- |
| [Blackwater Exchange](https://blackwater.exchange/) | Advertises Blizzard-fed faction and neutral markets, roughly hourly scans and 29-day retention. Useful cross-check for the three-house concept. No documented reusable external API or reuse licence was established; do not infer permission from its public UI. |
| [TradeSkillMaster](https://tradeskillmaster.com/news/tsm-4-15-brings-wow-forever-support-plus-new-desktop-app-1180) | Its own release announcement confirms Forever support and a companion app. This does not establish an external Forever API contract, neutral coverage or permission to reuse downloaded data. Public-data/API pages were inaccessible during research. |
| [ForeverAH](https://github.com/Kyzhoe/foreverah) | The author's working collector describes Blizzard access and an in-game listing-matching method to identify the correct house. Useful validation reference; its archive implementation is not evidence of archive permission. |

## Acquisition capabilities at a glance

This is an assessment of the evidence above, not a guarantee of current coverage.

| Source | US PvP Alliance/Horde | Neutral | Historical data | Principal unresolved issue |
| --- | --- | --- | --- | --- |
| Blizzard Forever feed | Candidate, mapping unverified | Blackwater labels reported | Collect observations going forward | Authentication, market identity and cadence; processed-price retention follows the owner's decision |
| AHledger | Both documented | Not in documented markets | Supplied series | Payload validation and restrictive archive licence |
| Grimlight | Target pools unverified | None in inspected pointer | Scan-based history | Observed pointer belongs to Normal Horde |
| auctionhouse.fyi | Both documented | Not documented | Public/gated series | Coverage, contributor classification and reuse rights |
| Everloot player data | Discover and map reported labels | Parameter supported, coverage unknown | Tool available, granularity unverified | Three-reporter coverage, house/variant separation |

## What was and was not verified

Follow-up (2026-11-17): the [Alliance → Neutral strategy spike](../alliance-neutral-strategy.md) documents the AHledger sales/day contract and a guarded adapter with listed-stock fallback. Its published documentation was readable; live API coverage remains unverified because this runner cannot resolve the API host. Original discovery findings below retain their dated context.

- Inspected source code and discovery material in `../react-parse-goonmetrics`; made no changes there.
- Read provider-authored documentation, published terms, integration authors' findings and one public live JSON metadata response.
- Blizzard's developer portal returned a script-only page or was inaccessible to the browser. Its legal terms were available through search indexing even though direct opens returned 403. Forever endpoint support is therefore supported here by integration authors, not a verified official reference.
- The shell had no working external DNS. The research browser could read documentation but could not retrieve several API URLs. Those failures do not establish that the APIs are down or unsupported.
- No Blizzard credentials, accounts, paid subscriptions or provider keys were created or used. No in-game addon was installed, scan uploaded, automated collector run or third-party operator contacted.
- No refresh cadence, response headers, completeness guarantee, actual sale rate or house-to-ruleset mapping was independently measured. The next document specifies those experiments.
