# Auction freshness, cooldown and request budget

Implemented and live-tested 2026-11-18 UTC. Scope remains Forever US PvP houses 110, 113 and owner-confirmed neutral 116.

## What the authenticated probe established

- All six item/commodity GET endpoints returned HTTP 200 and Last-Modified.
- Those responses advertised `Cache-Control: public, max-age=86400`, with no ETag, Expires or rate-budget headers in this sample.
- The neutral item endpoint returned **304 Not Modified with zero response-body bytes** when sent its Last-Modified value as If-Modified-Since.
- HEAD returned HTTP 404 on all six paths. It is not a usable freshness probe, despite GET working.
- Source publication times advanced by about an hour relative to the earlier saved snapshot. That is observed cadence, not a promised schedule. No next-publication timestamp was established.

Cache freshness is permission to reuse a response; it does not promise that the auction publisher will wait that long before replacing it. In particular, the observed 24-hour max-age should not be treated as the next auction update time. Collection explicitly revalidates using a conditional GET and `Cache-Control: max-age=0`. It does not repeatedly download a full book just to learn whether the displayed version is still current.

A request is necessary to discover an upstream change. A 304 saves bandwidth and parsing; it still consumes a request. There is no push subscription or free HEAD probe established here.

## Collection behavior

1. The server reserves the next collection slot before launching upstream work. Collection, discovery and the web neutral-house diagnostic share this gate. Duplicate clicks, another tab, repeated setup and server restart cannot clear its persisted timer. A file lock serializes reservations across local server processes.
2. Each house's item and commodity document is validated against the version used by the saved snapshot. If ETags become available they take precedence; otherwise Last-Modified is sent as If-Modified-Since. A newer raw response cached by a diagnostic must not replace the displayed snapshot's validator.
3. Both unchanged documents allow the house's complete quote aggregates to be reused, including neutral price depth. Raw books are not required after restart to validate an unchanged snapshot.
4. If only one document changed and the other raw body is unavailable, that missing document is fetched in full. This is required to deduplicate cross-book auction IDs and recompute weighted medians correctly.
5. A changed item catalog, changed catalog warnings/coverage, incompatible snapshot, failed prior house or missing neutral depth requires full bodies. Adding items never reuses a summary that omitted those items.
6. If all six documents are unchanged and the catalog is compatible, the snapshot file is left byte-for-byte intact. The UI says **No newer auction data** and records the check separately. Price/source ages and the original retention deadline are preserved.

The minimum delay after updated data is **five minutes**. A completed unchanged check increases the next delay to **ten minutes**, then **fifteen minutes**, capped there until new data resets it. Failures and cancellations retain a five-minute delay rather than enabling a rapid retry loop. A longer upstream Retry-After or exhausted request budget takes precedence.

The button shows a countdown and reenables when eligible; that countdown makes no upstream requests. Status polls stay local. **Last API check** and request usage are inside the existing collection details. The application remains manually refreshed; no background auction polling was added.

## Shared request budget

The default local ceiling is **600 outbound Blizzard requests per rolling hour**, leaving substantial headroom below the 36,000 maximum. The budget implementation rejects configured limits above 36,000. Every HTTP attempt is reserved before it is sent, including OAuth, metadata/catalog requests, retries, conditional GETs and diagnostic requests. Cache hits and localhost status requests do not consume slots. API Retry-After is shared across endpoints and persisted.

The server and `npm run inspect:neutral` use the same `.wow-local/request-budget.json`. Atomic file replacement plus an exclusive lock prevents concurrent instances from overspending it. Restarts and credential changes do not reset it. The file contains only local request timestamps and a retry deadline, never credentials, URLs or API bodies. Local budget-write failures stop before networking with a state-permission error rather than a misleading DNS error.

Six auction requests every five minutes is **72 auction requests/hour**, before authentication, catalog work, retries or partial-book recovery; adaptive backoff reduces that further. More tracked items affect filtering and catalog discovery, not the number of full-house endpoints. The budget covers this checkout's local clients; unrelated applications or other machines using the same registered credentials are not visible to it.

## Live acceptance check

An isolated local server used the saved credentials and shared local request budget, with temporary copies of the public catalog/settings/snapshot. The owner's saved price snapshot and selection were not replaced. Temporary copies were deleted afterwards.

- First live collection succeeded for 54 rows with **seven outbound requests**: one OAuth and six auction documents.
- An immediate repeat returned local HTTP 429 with **zero additional outbound requests**.
- Advancing only the test gate's clock to the next eligible slot allowed a second live check. It used six requests, reported unchanged data, preserved identical snapshot bytes and selected a ten-minute cooldown.

Unit/integration tests additionally cover persisted cooldowns and budgets, concurrent reservations, rolling-hour expiry, Retry-After, restart validators, mixed 200/304 responses, new catalog items, unchanged source retention and the UI countdown. The clock advance exercised eligibility without waiting or bypassing the provider's network limits; conditional requests still went to Blizzard and were counted.

This validates the refresh protocol, not real-time parity with the in-game auction viewer. Blizzard can continue publishing older sampled market data.
