# ADR 03 — Revalidate market books and bound collection

## Owner decision

Keep Blizzard API usage well below the provider's 36,000-call hourly limit. Add a cooldown to **Collect now** and check whether the API has published newer data before replacing prices.

## AI decision

Use conditional GETs, an adaptive cooldown and a **600-request rolling hourly cap** shared by scheduled and enrolled local collectors. Six feeds at five-minute intervals use 72 requests/hour before catalog refresh, diagnostics and retries. A live probe confirmed Last-Modified and a bodyless 304, while HEAD returned 404. Track the check time separately so revalidation preserves the publication age. [Local operation](../README.md#local-operation), [shared budget](../cloudflare/live/README.md#operating-the-collector)
