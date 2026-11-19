# US PvP house mapping and table metrics

Checked **2026-11-17 UTC**. The tool is now locked to **Forever, US, PvP**.

## House IDs

| Market | Alliance | Horde | Neutral / Blackwater |
| --- | --- | --- | --- |
| PvP — used by this tool | **110** | **113** | **116** |
| Normal — excluded | 111 | 114 | 117 |
| Additional unmapped/empty slot — excluded | 112 | 115 | 118 |

[Hyjal's own US market comparison](https://hyjal.cc/auctions/us/pvp/alliance/item/8153/wildvine) explicitly groups 110/113/116 under PvP and 111/114/117 under PvE. [Forever Mastery's market links and methodology](https://forevermastery.com/en/prices/us-ah125-neutral) corroborate that assignment: its Normal mapping comes from an in-game scan, and PvP is distinguished using the two-ruleset regions. [Saddlebag's upload monitor](https://azerothauctionassassin.com/wow-forever/upload-timers) also labels 110/113/116 PvP.

This is a **community-corroborated mapping**, not a Blizzard-published mapping contract. The [integration author's probe](https://www.reddit.com/r/wowaddons/comments/1xofb73/how_to_access_the_wow_forever_auction_house_api/) reports that every ruleset URL lists the same houses, and that the returned `ruleset.href` can reflect the request instead of the book's identity. It reported 112/115/118 as empty; their intended ruleset is not established here. Do not label them Hardcore by inference. Other RP-family house groups also exist; they are outside this tool's collection scope.

## Neutral #116 confirmed in game

On 2026-11-18 UTC (November 17 Eastern), the owner confirmed **neutral house 116** by matching individual Stranglekelp orders against the in-game neutral auction viewer; the other neutral books differed substantially. The owner accepts this identification despite differences in current minimum prices. Neutral house selection is considered resolved; API freshness is the next investigation. This confirms neutral 116 for the owner's US PvP market, without independently verifying every other faction/ruleset mapping.

The earlier price discrepancy prompted the diagnostic below. Rechecked [Hyjal's Stranglekelp comparison](https://hyjal.cc/auctions/us/pvp/alliance/item/3820/stranglekelp): it labels neutral 116 PvP, 117 PvE, 121 RP-PvE and 125 RP-PvP, corroborating the owner's identification.

Use **Local setup → Verify neutral auction houses**, or `npm run inspect:neutral`, to compare all advertised US neutral houses, including unmapped 118. This diagnostic reads both documents per house independently of the trading lock, retains every anonymous Stranglekelp buyout (grouping only identical offers), identifies item/commodity feed provenance and shows publication/fetch times. No trade selection or saved snapshot is changed. Compare a pattern of unit prices and stack sizes with the game after publication catches up; one price match is weak evidence. The diagnostic does not automatically promote a match to a verified mapping.

## Enforcement

The regional host and namespace remain fixed to US Forever. Shared constants in [the market module](../shared/market.mjs) pin 110, 113 and 116. Discovery requires all three expected faction/ID pairs; a missing pair stops discovery. Neither an edited settings file nor an old UI request can change collection to another house.

Existing settings are projected onto the fixed selection and saved on the next collection/discovery. A compatible cached snapshot is recognized without changing its observation, retrieval, generation or retention times. A snapshot from another region, ruleset or house selection is withheld until a fresh locked collection succeeds. Credentials are preserved.

The owner has successfully run discovery and collection, and confirmed neutral 116 against in-game listings. The saved live snapshot uses 110/113/116. The development runner currently blocks network socket creation; no new authenticated Blizzard probe was performed here. See the [network diagnosis](network-access.md).

## Counts and ranking

The original comparison metrics below describe the initial pilot. Page one now defaults to fee-adjusted profit × volume with directional, activity and minimum-profit filters; see the [current strategy and volume model](alliance-neutral-strategy.md). Both faction/neutral imbalances remain visible. The old Spread × stock metric is no longer page one's ranking column.

Each faction's **Stock / offers** column shows buyout units and buyout listing count. Bid-only auctions are excluded from both; their original counts remain in quote metadata. Older snapshots derive buyout offers as total auctions minus bid-only auctions. Hover for exact counts; clicking the stock header sorts units.

**Imbalance** is `abs(Horde unit price − Alliance unit price)` using the selected minimum/median price basis. It sorts descending by default. A direction label names the higher faction with ↑ and the cheaper faction with ↓. Equal prices show zero; a missing side stays unknown and sorts last in either direction.

**Spread × stock** is:

```text
absolute unit-price gap in copper × cheaper faction's buyout units / 10,000
```

The result is a **gold-equivalent supply proxy**, before fees and transfer costs. Using the cheaper faction's stock relates the metric to the side one could acquire from. It does not multiply by destination stock or combine both sides' quantities. A one-unit listing therefore carries less weight than substantial source inventory at the same gap.

This is not expected profit, traded volume or a quantity-execution estimate: the full source stock is not offered at its lowest price, and no sale is guaranteed. Neutral prices and stock remain visible. A separate **Neutral–Alliance** column compares their absolute unit-price gap, using the selected minimum/median basis and naming the higher/lower side. It can be sorted independently; the weighted product continues to use Alliance and Horde.

Values use **up to three significant figures**, with k/M/B/T suffixes. For example, 1,234 becomes `1.23k`, 12,345 becomes `12.3k`, and 1.234 trillion becomes `1.23T`. The displayed currency is gold equivalent. Sorting retains the full unrounded product; filtering does not rescale scores or change their meaning.

Tests cover both spread directions, ties, absent prices/quantities, min/median changes, one-off versus stocked items, rounded-display ties, trillion-scale formatting, scope enforcement, saved-state compatibility and the actual UI handlers.
