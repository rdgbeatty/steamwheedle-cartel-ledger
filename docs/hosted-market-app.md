# ADR 07 — Publish the public market tables

## Owner decision

Publish the market tables to GitHub Pages using the latest Cloudflare snapshot. Use listed stock as the activity proxy for the public app. Retire hosted staging and preserve live market history. Keep local development available.

## AI decision

Build the Pages UI from the local browser modules and use the neutral-named site repository. The hourly runner publishes one compressed, complete snapshot to Workers KV. The browser loads it directly and uses the existing trade calculations. Keep the synthetic fixture runnable in Wrangler for local tests. [Live runbook](../cloudflare/live/README.md), [local development](../cloudflare/README.md)
