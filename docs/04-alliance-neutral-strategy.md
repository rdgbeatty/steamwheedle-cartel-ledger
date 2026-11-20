# ADR 04 — Screen Alliance trades using both neutral routes

## Owner decision

Give each trading direction its own page. For **Neutral → Alliance**, show both minimum asks and listed stocks, add a low-volume filter, and sum profitable neutral offers at the Alliance minimum ask after its 5% sale fee. Show the price-level math on demand. For **Alliance → Neutral**, use an independent trader's Horde resale price, account for the 15% neutral and 5% Horde fees, and screen with editable price, activity and profit × volume filters. The owner proposed 1,000 units/day as a starting activity threshold, with a proxy when sales data is unavailable.

## AI decision

Use the independent trader's break-even price to calculate the owner's upper-bound margin and multiply by the smaller faction volume. Use AHledger estimates when available for both factions and fall back to both listed stocks. The default screen checks both faction markets and a 1g profit × volume minimum. The Neutral → Alliance stock filter is off by default and checks Alliance stock when enabled, so a single cheap neutral listing can qualify. [Neutral → Alliance calculation](../README.md#neutral--alliance), [Alliance → Neutral calculation](../README.md#alliance--neutral-opportunities), [AHledger methodology](https://ahledger.com/glossary)
