# Required data and collection validation

Research date: **2026-11-16**. This is a collection specification and experiment plan, not an implemented collector or a storage design.

## Information required

| Data | Needed for | Acquisition and interpretation |
| --- | --- | --- |
| Game/environment, region, ruleset and house identifiers | Correct scope and comparisons | Discover provider IDs; reconcile them against actual US PvP houses. Retain native IDs as well as verified labels. Beta, Normal and other editions must never silently fill a missing PvP quote. |
| Base item ID and variant identity | Matching equivalent goods | Preserve bonuses/context/modifiers or equivalent provider variant fields. Base-ID-only feeds are insufficient for precise gear arbitrage; start with fungible materials if necessary. |
| Item name, category, quality, stack limit, binding, vendor value and icon reference | Search, grouping, eligibility and expense inputs | Forever static API where present; permitted player observations for gaps. Keep unknown metadata explicit. Never silently import another edition's stats or binding behavior. |
| Buyout/unit price and quantity | Acquisition and resale comparison | Normalize each response's documented price basis. For a whole-stack buyout divide by quantity for the comparison; for `unit_price` do not divide again. Keep original totals to avoid inventing fractional-copper transactions. |
| Auction/listing ID, bid and coarse time-left, if supplied | Snapshot validation and possible turnover inference | Bid-only entries stay separate. These are not EVE buy orders or a buyer demand book. Transient observation of IDs is useful; durable raw-book retention is not decided here. |
| Total listed units and auction count | Supply and competition | Distinguish units from listings. One seller can have many listings; neither number is a distinct-seller count. |
| Price levels with units, where supplied | Quantity-aware acquisition cost | Sum the actual available levels. A summary minimum plus total stock cannot reconstruct depth. |
| Observation/publication, retrieval and generation times | Freshness and cross-house alignment | Record clocks separately, in UTC, including each document's time. Source time is preferable; retrieval time alone is a weaker fallback. |
| Snapshot identity, completeness and scan boundaries | Reliable comparisons and graphs | Record ETag/hash/version where provided, full versus partial status, and start/end times for a multi-request scan. Missing commodity data cannot masquerade as a complete book. |
| Historical minimum and consistently defined median, quantity, listings and sample count | Graphs and historical resale reference | Acquire a permitted provider series or collect observations going forward. Keep intervals, metric definitions, provenance and missing periods. |
| Sales estimate, method, window and uncertainty, when available | Liquidity and weekly opportunity ranking | Optional for initial price comparisons. Never equate disappearance or net stock depletion with verified market sales. |
| House cut, deposit inputs, transfer steps and costs | Net-profit estimates | Verify Forever behavior in game or from current authoritative evidence. Keep configuration effective-dated when mechanics change. |
| Provider, attribution, licence version and allowed use | A usable collection source | Distinguish permission to read, cache, display, redistribute and build an archive. Keep source lineage if provider layers are combined. |

This table specifies meanings and evidence, not database columns or an API schema.

## First experiment: validate Blizzard's US PvP market identity

1. **Use a registered application.** Obtain a client-credentials token using the owner's application setup. Keep the secret and token in the collector environment. Market reads do not need a player login. Record expiry and errors without recording credentials.
2. **Discover the current routes.** Request the US Forever ruleset index, inspect PvP, then follow the house discovery links. Check the documented candidates in [the source assessment](02-data-access.md), including the reported index/slash difference if the advertised link fails.
3. **Disambiguate houses before labeling them.** Compare the discovered records across ruleset requests and their auction IDs/content. Detect aliases and duplicate books. A house name such as “Alliance Auction House” is not sufficient proof of US PvP identity.
4. **Reconcile with in-game observations.** Compare several item/variant/quantity/price combinations on the owner's US PvP Alliance auction house with one published snapshot. The [ForeverAH author](https://github.com/Kyzhoe/foreverah) describes using a distinctive player-posted listing as an additional matching technique. Horde and neutral need equivalent observations from someone who can access those houses. A failed match can reflect feed delay, so compare against the measured publication window.
5. **Read both documents per verified house.** Inspect item auctions and commodities separately; record their timestamps, counts, fields and missing-field behavior. Check any parent commodity link against the child document to prevent double counting.
6. **Sample enrichment.** Resolve a small set of materials, suffix gear, a Forever-specific item and an item with missing static metadata. Verify unit math and variant identity before broadening collection.

Do not hardcode that all fifteen IDs are distinct markets, that ruleset 1 filters the book correctly, or that a particular sample house ID belongs to PvP. Leave the mapping unresolved until the observed books support it.

## Second experiment: cadence, quality and provider comparison

Observe several successive publication cycles, then a longer representative period if needed. Record source timestamps, ETags, HTTP cache instructions, body changes, response sizes and collection duration. Begin with conservative polling around the approximately hourly cadence reported by integrators; measure before promising an update interval. Conditional requests and 304 responses must preserve the original observation time.

Once the houses are verified, one item document plus one commodity document for each of three houses is **six book requests per collection cycle**, plus discovery, token and metadata work. This is a request-count hypothesis, not a payload-size or performance result. If the actual feed has additional independent partitions, revise the count after discovery.

Use a small common sample to compare candidate providers against the same Blizzard/in-game observation window. Check both US PvP factions and neutral, not just whether a provider knows Linen Cloth. Measure age, catalog completeness, variant preservation and the exact definition of median/history values. Source agreement is useful, but providers reading the same feed are not independent confirmations.

For each provider, explicitly test stockouts, no-buyout items, a partial/missing document, cached responses and unscanned markets. An error or incomplete scan is unknown coverage, not an empty auction house. Respect cache headers and `Retry-After`; repeated polling cannot make the upstream source update faster.

## Historical prices and liquidity

The graph needs a series with stable **market + item/variant + price definition**. Never splice provider medians into a single unlabeled line. Distinguish an observed snapshot series from a provider's hourly or daily aggregates. A gap is a gap; do not invent trades or observed prices between samples.

For a Blizzard-derived series, the [owner's retention decision](../blizzard-api-terms.md#owner-retention-decision-2026-11-16) permits longer storage of processed public price statistics, initially daily minimum, maximum and mean per item/market; raw API responses and copies still expire within 30 days. The owner accepts the interpretation risk. For AHledger, reading its hosted series and retaining a local archive have different rights; see [the licence assessment](02-data-access.md).

Snapshots alone cannot prove sales: listings may be purchased, canceled, expire, be repriced or vanish during a failed/partial scan. New listings may sell entirely between observations. Even a provider's “sold” field needs a method description and validation before it supports weekly-profit ranking. Label any disappearance-based result as an estimate; do not call it a measured lower bound without proving the classification.

Personal sales could later be measured from an opt-in addon ledger or auction-mail observations, but those describe the participant's transactions, not the whole market. Personal accounting is outside the initial scope.

## Fallback if the API mapping or coverage fails

Evaluate a provider with demonstrated US PvP house coverage and suitable reuse rights. If none covers the three-house requirement, validate a small, player-started in-game scan before committing to an addon project:

```text
Player opens the intended auction house and starts a scan
  → addon reads the supported Forever auction interface
  → export includes actual listings, variants, market and completeness
  → saved scan is transferred manually or by a companion
  → collection validates the file and its observation time
```

For a SavedVariables route, expect persistence at logout or UI reload; a companion reads saved data, not arbitrary live addon memory. [Everloot's author](https://github.com/Everloot/everloot/blob/main/README.md) documents that workflow. Addons do not themselves provide general outbound HTTP; [Grimlight's reference](https://grimlightdepot.com/api/) uses a separate companion for web transfers.

Prove the current Forever auction-reading functions, throttling, full-scan support and metadata in a manual sample. Incomplete search results stay partial. Avoid broad client-file extraction or website scraping as a default substitute for an authorized market source. The current [Blizzard addon policy](https://us.forums.blizzard.com/en/wow/t/ui-add-on-development-policy/24534) and supported API behavior govern an eventual addon; a third party's implementation is not blanket approval of every collection technique.

## Acceptance criteria before implementation

- A sample identifies the **actual US PvP Alliance and Horde books**, with neutral either verified or explicitly unavailable.
- Market labels remain correct despite duplicate ruleset URLs or provider-specific realm labels.
- A fungible item and variant gear sample reconcile unit prices, quantities and identities against the game.
- Item and commodity coverage, source ages and full/partial status are measurable.
- A graph sample demonstrates timestamps, metric definitions and honest gaps, with documented source permissions and the applicable retention basis, including the owner's decision for Blizzard-derived processed public price statistics.
- Fee and transfer assumptions are verified for a feasible route. A readable opposite-faction feed is not mistaken for permission or ability to execute that route.
- Demand remains unknown or explicitly estimated unless actual evidence supports a stronger claim.

## Decisions left for follow-up

The owner has settled the starting market and cross-faction data requirement. Remaining product inputs are desired graph horizon, acceptable price delay, the practical cross-faction transfer arrangement, whether neutral comparison becomes essential, and whether the software stays personal/free or becomes a monetized service. These affect source selection; they do not prevent completing this discovery spike.

Current result: the requirements and collection options are documented. Authenticated market samples, in-game reconciliation, cadence measurements and source-specific permission clarifications remain future validation work. No database or hosting design has been selected.
