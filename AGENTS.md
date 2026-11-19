# Blizzard API constraints

- Apply a **maximum 30-day TTL to raw Blizzard API data** and its copies in caches, logs, exports and backups. The owner additionally authorizes a rolling 90 days of anonymous market-book observations, including price levels, listing quantities and hourly price/stock history. Raw API payloads and player-specific data remain outside this exception. A new fetch does not renew old raw observations.
- Keep a shared request budget at **36,000 calls/hour or any lower Blizzard limit**; respect cache headers and `Retry-After`. Do not evade limits through third parties.
- The owner approves longer retention of processed public auction-price statistics, initially daily per-item/market **minimum, maximum and mean**, and accepts the interpretation risk. Player-specific data is outside this exception. See the [recorded decision](docs/blizzard-api-terms.md#owner-retention-decision-2026-11-16).
- Keep API credentials private and the registered app's use accurate. Credit Blizzard without implying endorsement; avoid Blizzard trademarks in public app titles/URLs.
- Keep API-backed features free; do not sell/distribute datasets outside the authorized app. Protect data, support required deletion, and maintain a privacy policy.
- Blizzard controls community-benefit/unfair-advantage decisions and can revoke access. Its broad app license and indemnity deserve attention before wider distribution.

Terms, caveats and sources: [Blizzard API reference](docs/blizzard-api-terms.md).
