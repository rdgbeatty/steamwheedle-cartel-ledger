# Decision records

- For each large coding task, create a short ADR in `docs/` with the next two-digit index as its filename prefix. Keep it to one or two paragraphs. Link to runbooks, research spikes, measurements or external references for supporting detail.
- Label decisions **Owner decision** or **AI decision**. Attribute owner decisions to explicit requests, confirmations or approvals. Get the owner's approval before changing an owner decision.
- AI decisions are reversible. Revise them without owner approval when the change satisfies the owner decisions and applicable external constraints. Record significant choices and rationale in the ADR. Keep routine details such as the exact minute of an hourly job in code or runbooks. Identify provider requirements as external constraints.

# Git commits and pushes

- Commit verified changes before handing work back. Keep commits focused on the request and preserve unrelated working-tree changes.
- Push verified low-risk changes automatically to the agreed branch. Routine copy edits, visual tweaks, and small tested fixes are examples.
- For higher-risk changes such as production infrastructure, authentication, or data migrations, commit the verified changes and ask the owner before pushing unless they already approved the push.
- If a push fails, notify the owner promptly. Identify the local commits awaiting push, explain the blocker, and ask how to proceed. Keep the pending push visible until it is resolved.

# Hosting and billing constraint

- The owner requires zero-cost hosting across the project. Use services with provider-enforced limits that reject, skip, or pause work before any charges accrue, including under runaway retries, traffic, or storage growth. Keep Cloudflare on Workers Free and verify the billing behavior of each product, including storage, logs, and backups. Treat alerts and application-side caps as supplementary controls.

# Blizzard API constraints

- Apply a **maximum 30-day TTL to raw Blizzard API data** and its copies in caches, logs, exports and backups. The owner additionally authorizes a rolling 90 days of anonymous market-book observations, including price levels, listing quantities and hourly price/stock history. Raw API payloads and player-specific data remain outside this exception. A new fetch does not renew old raw observations.
- Keep a shared request budget at **36,000 calls/hour or any lower Blizzard limit**; respect cache headers and `Retry-After`. Do not evade limits through third parties.
- The owner approves longer retention of processed public auction-price statistics, initially daily per-item/market **minimum, maximum and mean**, and accepts the interpretation risk. Player-specific data is outside this exception. See the [recorded decision](docs/05-blizzard-api-terms.md#owner-retention-decision-2026-11-16).
- Keep API credentials private and the registered app's use accurate.
- The owner permits descriptive use of the game's name for this project, including in public naming. Credit Blizzard as the data source and make clear that the app is independent. Blizzard's API terms separately restrict Blizzard trademarks in application titles and URLs. [Blizzard Developer API Terms of Use](https://www.blizzard.com/en-us/legal/a2989b50-5f16-43b1-abec-2ae17cc09dd6/blizzard-developer-api-terms-of-use)
- Keep API-backed features free; do not sell/distribute datasets outside the authorized app. Protect data, support required deletion, and maintain a privacy policy.
- Blizzard controls community-benefit/unfair-advantage decisions and can revoke access. Its broad app license and indemnity deserve attention before wider distribution.

Terms, caveats and sources: [Blizzard API reference](docs/05-blizzard-api-terms.md).
