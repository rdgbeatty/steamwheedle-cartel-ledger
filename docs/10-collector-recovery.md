# ADR 10 — Retry hourly market collection on Cloudflare

**Owner decision.** Use a single Cloudflare Cron Trigger for the hourly primary and a recovery check 15 minutes later. Collection returns to the primary schedule in the next hour, including after recovery succeeds. [Collector runbook](../cloudflare/live/README.md)

**AI decision.** Track scheduled attempts in the existing collector Durable Object by UTC hour so recovery can detect a failed or missing primary and limit collection to one recovery attempt. Count an unchanged revalidation as a completed check. Continue using the shared Blizzard request budget and Blizzard source timestamps for history. [Cloudflare scheduled handler](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/)
