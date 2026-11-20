# ADR 06 — Put market tables first

## Owner decision

Prioritize market tables over setup and detail panels. Put **Collect now** next to **Last collection**, group per-house timing there, and keep that panel open when the last collection is over four hours old. Provide a separate data browser without trade analysis and category checkboxes for multi-select. Show the Alliance–Horde and Alliance–neutral imbalances as absolute gaps with direction, and display opportunity scores with up to three significant digits.

## AI decision

Use a separate setup tab and shared table controls. Apply the four-hour rule to source publications too, so a check of unchanged data keeps stale prices visible. Filter and sort the saved snapshot before paginating so users can browse without extra market requests. [Local interface](../README.md#data-browser-and-category-filters)
