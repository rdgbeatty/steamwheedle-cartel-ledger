# ADR 01 — Host hourly history on Cloudflare Workers Free

## Owner decision

Collect real Forever market data hourly and show historical price charts without requiring a bulk archive download. The owner approved Cloudflare Workers Free and Durable Objects to keep usage within provider-enforced limits and avoid overage charges. About 4 GB is the storage sizing target for 90 days. [Free quotas](https://developers.cloudflare.com/durable-objects/platform/pricing/), [retention decision](05-blizzard-api-terms.md#owner-retention-decision-2026-11-19)

## AI decision

Serve selected-item history from the Worker, group compressed books by source day in SQLite, and use expiring Workers KV keys to enforce retention through SQLite recovery. [Live runbook](../cloudflare/live/README.md), [collector decision](08-cloudflare-collector.md), [pilot measurements](../cloudflare/README.md#hosted-pilot-results)
