# ADR 07 — Publish the public market tables

## Owner decision

Publish the market tables from the `steamwheedle-cartel-ledger` source repository to its GitHub Pages URL. Use the latest Cloudflare snapshot and listed stock as the activity proxy. Retire hosted staging, preserve live market history, and keep local development available.

## AI decision

Use GitHub Actions in the source repository to publish the shared browser code as a static artifact. The Cloudflare collector publishes one compressed, complete snapshot to Workers KV. The browser loads it directly and uses the existing trade calculations. Keep the synthetic fixture runnable in Wrangler for local tests. [Live runbook](../cloudflare/live/README.md), [local development](../cloudflare/README.md)
