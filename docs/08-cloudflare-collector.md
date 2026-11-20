# ADR 08 — Run hourly collection on Cloudflare

## Owner decision

Move the hourly Forever market collector to Cloudflare because scheduled GitHub Actions have been unreliable. Keep the project on services with provider-enforced free limits and preserve live history. Retire the old redirect repository. [Billing constraint](../AGENTS.md#hosting-and-billing-constraint), [hourly history decision](01-history-architecture.md)

## AI decision

Use a Cron Trigger to invoke a SQLite Durable Object that streams one house at a time, reuses committed history buckets, and replaces the public snapshot only when all markets are available. Keep the GitHub workflow for manual recovery. Validate with a 500,000-auction replay in the local Workers runtime and a live collection before enabling the schedule. [Runbook](../cloudflare/live/README.md)
