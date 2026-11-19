# Alliance → Neutral strategy and volume filters

Implemented 2026-11-17. Scope: Forever US PvP, Alliance main; another independent trader may buy on neutral and resell to Horde. The owner cannot transfer to a Horde character.

## Prices and fee bases

Let A be the Alliance purchase cost per unit, H the Horde expected sale ask, and N the owner's neutral sale price. The owner supplied a 15% neutral sale fee and a 5% Horde sale fee for this model.

```text
your profit                 = 0.85 × N − A
other trader's profit       = 0.95 × H − N
maximum N at their break-even = 0.95 × H
maximum profit for you      = 0.85 × 0.95 × H − A
```

The two fees apply to different prices. Deducting 20% of the Alliance purchase price does not model this flow. Desired profit is a threshold applied to the computed return, not an amount added to it.

Example: A = 100g, H = 200g. At the maximum neutral price of 190g, the neutral fee is 28.5g and your profit is 61.5g. The Horde trader pays 190g, receives 190g after their 10g Horde fee, and earns zero. At N = 150g instead, your fee is 22.5g and your profit is 27.5g; the other trader earns 40g. These are distinct scenarios. The current neutral minimum is shown as context and in the second calculation; it is not assumed to be the suggested selling price.

The main score uses the maximum owner margin, labeled an **upper bound**, until a neutral listing-price policy is chosen. It is suitable for screening a price gap, not a forecast that a counterparty will accept a zero-profit trade. No trader buffer is imposed. The current-neutral-ask calculation separately shows both traders' possible gains/losses.

## Filters and score

| Control | Initial value |
| --- | --- |
| Direction | Alliance price below Horde price |
| Minimum market volume | 1,000 units |
| Apply volume threshold | Both Alliance and Horde |
| Volume source | Both daily estimates when available; otherwise both current stocks |
| Minimum net margin per unit | 0g, with strictly positive margin required |
| Minimum profit × volume | 1g |
| Price basis | Minimum unit buyout |
| Sort | Profit × volume descending, full precision |

```text
volume = min(Alliance volume, Horde volume)
profit × volume = maximum profit for you / unit × volume
```

Both/either changes only the volume eligibility test; it does not change the multiplier to the larger house or add faction volumes. Thresholds are editable and can be reset. They are local screening choices, not validated trading recommendations. A positive pre-fee gap that becomes negative after both fees is excluded. Unknown prices/volume do not become zeros. The current snapshot has only summary Alliance prices; the calculation does not assume all source units can actually be bought at the minimum. Neutral demand and market share are unknown.

## Daily sales data and fallback

On 2026-11-17, [AHledger's own API documentation](https://ahledger.com/developers) describes `sales.estimatedPerDay` in item history and `salesPerDay` in tooltips/deals. Its public bulk `GET /v1/pricetable/forever.pvp.{alliance|horde}.us` exposes the same estimate as the ninth colon-separated field, scaled by ten. The implemented adapter uses two bulk tables rather than one request per item. Market identity must exactly match Forever/PvP/US/the requested faction. Only tracked base-item estimates reach the local page; variants do not inherit the base item's estimate.

The [provider's glossary](https://ahledger.com/glossary) says it estimates sales by checking listings disappearing between full scans, accounting for expiry, cheaper remaining listings and possible relisting. Cancellations remain ambiguous. It uses seven days, or fourteen on quieter markets, and returns unknown until scan coverage is sufficient. This is estimated market activity, not a completed-sales tape or the owner's expected sales.

Both faction estimates must be available to use daily units. Otherwise the default fallback uses `min(current Alliance buyout stock, current Horde buyout stock)`, explicitly labeled a stock proxy. It is not units/day and cannot demonstrate neutral sell-through. A measured zero never triggers stock substitution. Daily-only mode excludes missing/expired estimates; stock-only mode ignores estimates. The UI displays the basis beside every score rather than labeling all scores as daily profit.

The runner could read the published documentation but could not resolve the API host. The adapter is verified against fixtures based on that contract, with unsupported formats and unavailable live coverage reported rather than invented. Actual US PvP item coverage must be confirmed in the owner's running tool.

## Provider access and retention

[Provider access terms](https://ahledger.com/developers#access-and-licences) permit credited personal/community use and require cache-header compliance. They announce a free-tier change for 2026-12-10; current or future 403/429 responses cause explicit fallback. No account/key is required by the documented anonymous table route. No credentials are forwarded from Blizzard. Requests do not bypass Blizzard limits or replace Blizzard collection.

The adapter honors Cache-Control, Age, Date, Expires and Retry-After. It uses only in-memory caches and removes estimates at their allowed expiry, capped at 30 days from the provider observation. Concurrent reads share requests. Downloads are limited to one per market/minute per server instance, and a rate-limit response imposes a shared cooldown. No estimate archive, snapshot extension, log, export or backup is created. The browser discards expired estimates and recomputes the page using stock, or excludes those rows in daily-only mode.

The longer-retention decision for processed Blizzard price statistics does not grant rights to archive AHledger responses. Provider attribution links appear on the page that displays its estimates. Future historical-data architecture remains a separate task.
