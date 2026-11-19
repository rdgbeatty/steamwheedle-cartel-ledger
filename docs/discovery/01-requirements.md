# Trading requirements

Research date: **2026-11-16**. This is a proposed product baseline, with confirmed requirements distinguished from suggestions inferred from the sibling EVE project.

## Confirmed by the owner

- Support **World of Warcraft: Forever exclusively**, including when the project says “WoW.” Do not silently substitute another edition's prices, item properties or market mechanics.
- Identify trading opportunities through market-price comparisons, taking the EVE application as the starting point.
- Default to the owner's **US PvP Alliance** context. Region and ruleset must be filterable.
- Collect **Horde data in the same US PvP economy** as well. Investigate neutral/goblin auction-house data for additional routes.
- Provide **historical price graphs**. The owner explains that the Forever client lacks the history view that kept graphs out of the EVE product's scope.
- This spike covers **what information is needed and how to obtain it**. Defer data-management and architecture decisions.

## What the EVE application tells us

Both the original React application and the newer local backend/viewer were inspected. These are repository observations, not assumptions about the upstream Goonmetrics service.

| Existing behavior and repository evidence | Proposed Forever equivalent |
| --- | --- |
| [Import/export routes](../../../react-parse-goonmetrics/apps/web/src/lib/tradeModes.ts) reverse acquisition and destination markets. | Select source and destination auction houses; compare both directions where movement is feasible. |
| [Calculations](../../../react-parse-goonmetrics/apps/web/src/lib/tradeCalculations.ts) subtract shipping and sale expenses, and calculate unit profit, margin and weekly opportunity. | Calculate net gold profit and return on acquisition cost using Forever's costs and an explicit resale-price assumption. |
| [Trade table](../../../react-parse-goonmetrics/apps/web/src/components/TradeTable.tsx) exposes sortable metrics and adjustable relisting assumptions. | Keep a searchable, sortable opportunity table with visible cost assumptions. |
| [Current backend guide](../../../react-parse-goonmetrics/apps/market-backend/README.md) describes stock, quote age, competition proxies and labeled regional demand estimates. | Show stock, freshness, coverage and the evidence behind liquidity estimates. |
| [EVE discovery](../../../react-parse-goonmetrics/docs/discovery/README.md) separates market quotes from demand and treats unavailable metrics as unknown. | Preserve that distinction; a missing price or unmeasured sales rate must not become zero. |
| The backend retains regional daily history for demand summaries, although a user-facing price chart remains outside the EVE product scope. | A graph needs a defined price series for each Forever item and market, in addition to any demand summary. |

The EVE filler score, ISK-per-m³ shipping model, taxes and regional-volume assumptions are game-specific. Their formulas should not become WoW defaults. Similarly, its hosting preference and refresh tolerance are background context, not newly confirmed WoW requirements.

## Proposed core behavior

| ID | Requirement | Information needed / completion condition |
| --- | --- | --- |
| R1 | Select and identify the market precisely. | Forever live environment, region, ruleset, auction-house identity and its verified player-facing label. Alliance is the default view; Horde collection remains enabled. Neutral availability is explicit. |
| R2 | Compare equivalent goods across houses. | Stable item IDs plus economically relevant variants, normalized unit prices, stock and observation times. Never compare two different suffixes as identical gear. |
| R3 | Rank opportunities after expenses. | Acquisition cost, destination resale assumption, house cut, expected lost deposits/relisting costs and any transfer expense. Sort by unit profit and return; show quantity limits when supported. |
| R4 | Explain liquidity and competition. | Listed units and listing counts; price depth if available. Show a sales-rate estimate only with its method, observation window and uncertainty. Unknown demand does not prevent a price comparison. |
| R5 | Explore item price history. | Per-market observations of the same item/variant, metric definition, UTC timestamps, sample counts and gaps. Keep source changes and beta/live boundaries visible. |
| R6 | Make data quality visible. | Provider, source observation/publication time, retrieval time, age, complete/partial coverage and unavailable-field status. A successful refresh of an unchanged cached response must not make old prices look new. |
| R7 | Support practical investigation. | Search by name or ID; filter region, ruleset, house and item category; sort profit, return, price difference, stock and freshness. Every row should explain its calculation. |

R1–R7 are the proposed interpretation of the owner's workflow, not a claim that each control has already been separately approved.

## Opportunity types and execution constraints

The primary concept is a **price comparison between US PvP Alliance and Horde**, adding neutral-house comparisons if coverage is usable. A favorable spread is a candidate, not proof that the owner can move the item and realize the profit.

Blizzard's [ruleset overview](https://worldofwarcraft.blizzard.com/en-us/news/24302070) says players cannot freely move between rulesets and that the PvP ruleset restricts character creation to one faction. This makes an opposite-faction alt on the same WoW account an unsuitable assumed transfer mechanism. Validate the participant/account arrangement, neutral access, binding and actual transfer costs before marking a route executable. Reading public Horde prices does not require owning a Horde character.

Other regions and rulesets may be useful comparison views; their price differences must not automatically become executable routes. Neutral/goblin trading must also be distinguished from any separate NPC Black Market auction system.

Potential extensions, requiring a later scope decision:

- Buy below an item's usual price and resell in the same house.
- Crafting, disenchanting or vendor opportunities, which require additional recipe, yield, skill and vendor data.
- Watchlists, alerts, personal accounting and an in-game addon.
- Shopping quantities, capital allocation and transfer planning beyond a simple opportunity ranking.

## Calculation semantics

For a proposed quantity `q`:

```text
net proceeds(q) = assumed resale revenue(q) - destination sale cut
estimated profit(q) = net proceeds(q)
                    - actual acquisition cost(q)
                    - transfer expenses(q)
                    - expected forfeited deposits / other costs(q)
return on cost = estimated profit / total acquisition-and-transfer cost
```

Refundable deposits are working capital, with forfeiture counted as an expense when applicable. Model each intermediate sale on a neutral transfer separately so its cut is not lost or counted twice. Fee rates and deposit behavior must be verified on Forever before using defaults.

The lowest advertised price may cover only one unit. Without depth, present a **unit-price comparison**, not a promise that all listed stock can be bought at that price. A historical median can support a resale assumption, but is not a guaranteed sale price. Weekly profit requires both a demand estimate and an explicit achievable market-share assumption; otherwise leave it unavailable.

## Historical graph baseline

The required graph is initially a history of **observed asking prices**. Start with minimum unit buyout and, where available, a consistently defined quantity-weighted median. Stock/listing-count overlays help explain outliers; they are supply measurements.

Suggested controls are a short intraday view and a multi-day view. Exact maximum horizon, refresh target and acceptable quote age remain open. Longer history must be supported by both actual observations and collection rights. A provider accepting `90d` does not establish 90 days of live coverage.

Missing observations remain gaps. No-buyout listings do not produce a zero buyout; an item absent from a verified complete scan can have zero listed quantity and no current price. Partial scans cannot establish market-wide absence. A daily high/low from snapshots describes the observed asking-price range, not an exchange's executed-trade candle.

## Deferred decisions

Database and storage choices, retention mechanics, aggregation layout, hosting, scheduling infrastructure, deployment and a production UI are deferred. Source permission to retain observations is part of this spike because it determines which historical data can be collected at all.
