# ADR 09 — Open item history in the market table

**Owner decision.** Open price history in a modal when an item name is selected. Keep a visible line between observed prices across missing hours and distinguish interpolated segments.

**AI decision.** Share a native dialog between Pages and localhost. Read the exact item and variant from Cloudflare on demand, starting with 24 hours. Draw dashed segments only between observed endpoints, and keep the hour inspector tied to source data. Distinguish an observed hour with zero buyout stock, an unobserved hour, and an unavailable range. [History API](../cloudflare/live/README.md#operating-the-collector)
