# ADR 05 — Retain anonymous auction history

## Owner retention decision (2026-11-16)

The owner approved retaining processed public auction-price statistics beyond 30 days, initially daily minimum, maximum and mean per item and market. The 30-day limit still applies to raw Blizzard responses and other API data outside the approved exceptions, including copies. Player-specific data remains outside both exceptions.

## Owner retention decision (2026-11-19)

The owner approved a rolling **90 days of anonymous market books**, including price levels, quantities, offer counts and hourly price and stock history. The owner accepts the interpretation risk for both retention decisions. Blizzard's terms specify a 30-day TTL and give no express auction-history exception. Required deletion applies to all controlled copies, including on termination. [Blizzard Developer API Terms of Use](https://www.blizzard.com/en-us/legal/a2989b50-5f16-43b1-abec-2ae17cc09dd6/blizzard-developer-api-terms-of-use), [Blizzard data-protection FAQ](https://us.forums.blizzard.com/en/blizzard/t/data-protection-notice-and-faq/609/2), [project constraints](../AGENTS.md), [expiry implementation](../cloudflare/live/README.md#storage)
