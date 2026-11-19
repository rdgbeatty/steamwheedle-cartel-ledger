# Blizzard Developer API terms reference

Reviewed: **2026-11-16**. Terms version supplied by the owner: **October 1, 2019**.

Authoritative text: [Blizzard Developer API Terms of Use](https://www.blizzard.com/en-us/legal/a2989b50-5f16-43b1-abec-2ae17cc09dd6/blizzard-developer-api-terms-of-use).

This document summarizes the owner's supplied text and separates express requirements from interpretations and unresolved questions. It is not a verbatim copy or a determination of enforceability. The legal page was indexed but direct retrieval returned HTTP 403 during review. Continued use accepts future changes, so consult the published terms when making consequential decisions.

## Owner retention decision (2026-11-19)

The owner approved 90 days of anonymous historical market books and accepted the interpretation risk. This covers US PvP price levels, quantities, offer counts and derived hourly price and stock charts. Expiry follows the oldest contributing source. Rechecking the same publication does not extend its lifetime. The collector drops auction and player identifiers before persistence. Raw responses keep the existing 30-day maximum and can be discarded in memory. The earlier daily-statistics decision continues to apply. Other sites' practices informed the owner's decision. Blizzard has not confirmed this interpretation.

## Owner retention decision (2026-11-16)

The owner interprets public auction-house price statistics as outside the player-rights retention restriction and accepts the risk of that interpretation. **Raw API responses and their copies must expire within 30 days; processed public price statistics may be retained longer**, initially daily minimum, maximum and mean per item and market, with dates and necessary item/market identifiers. This exception does not cover player-specific data. It is the project's accepted decision, not confirmation from Blizzard, and supersedes the earlier conservative aggregate-retention default below.

## Project defaults

- **Maximum 30-day TTL for raw API data and other API content outside the owner's processed-price exception.** Include item/house metadata and API content in caches, logs, exports and backups. Refresh current records or expire them. Refreshing today's auction book does not revalidate old raw observations.
- **36,000 API calls per hour**, subject to any other limit Blizzard imposes. Use one shared application budget, account for retries, respect upstream caching and throttling, and do not use other services to obtain additional requests on our behalf.
- Retain processed public auction-price summaries under the owner's decision above; other data keeps the 30-day default.
- Keep source/retrieval times and data lineage sufficient to expire raw observations. Recalculation must not reset raw-data age; longer history can use retained processed price summaries.
- Required deletion applies to all controlled copies. Termination requires removing the integration and deleting Blizzard data; individual deletion/unlink requests require immediate removal of that individual's data.

These are development constraints, not a claim that the current application implements every requirement.

## Other operating requirements

| Area | Practical meaning |
| --- | --- |
| Registration | Use credentials/data only for registered applications and authorized purposes; keep registration information accurate. |
| Credentials | Keep credentials confidential, report compromise immediately, and accept responsibility for activity using them. |
| Money and redistribution | No paid API-backed downloads/features/services, data sales/licensing, advertising targeting with data, or transfer to advertising/data-broker services. The latter expressly includes anonymous, aggregate and derived data. Donation gates and required video ads are prohibited; other funding arrangements are not clearly resolved here. |
| Privacy/security | Publish and follow an appropriate privacy policy consistent with Blizzard's; comply with applicable law; do not collect Blizzard passwords. Protect data and notify Blizzard immediately, within 24 hours, of suspected unauthorized access/disclosure. |
| Attribution/branding | Identify Blizzard as the source without suggesting affiliation or endorsement. No Blizzard trademarks in public application titles or URLs. |
| Conduct | Benefit Blizzard players, avoid harmful/unfair functionality, keep content appropriate to the game's rating, and do not design/market the app for children under 13. |
| Extraction | Use authorized APIs; no unauthorized scraping, data mining, reverse engineering or interference. |
| Availability | No support, accuracy or uptime promise. Blizzard can change terms, introduce fees, or revoke access without notice. |

## Liability allocation: sections 6–8

The indemnity is broader than an agreement to pay only for damage caused by our proven negligence. It covers third-party claims related to our or our users' use of the application, APIs or data, our breach, and other connected actions. It includes litigation expenses and attorneys' fees, without an express monetary cap. Blizzard also broadly disclaims its own liability; there is no matching promise to indemnify us for defective API data or service behavior.

An outside claimant can still pursue whichever parties applicable law permits. This contract instead allocates expenses and losses between us and Blizzard; it does not itself prevent that claimant from suing Blizzard.

Examples, as interpretations rather than settled outcomes:

- A flaw in our app exposes player data and someone sues Blizzard: this is the clearest kind of claim Blizzard could seek to pass through under the indemnity.
- Someone misuses our app and sues Blizzard: the reference to users' conduct makes a pass-through claim possible even without a finding that we personally acted negligently.
- Blizzard independently deploys, modifies or misuses its licensed copy and causes harm: the terms do not clearly say we cover Blizzard's own independent wrongdoing. They also omit an express exclusion for Blizzard-caused losses, so this is not a clean protection for us.

The separate license allowing Blizzard to use/distribute our app does not, by itself, settle the third example. California law adds limits and interpretation rules. The California Supreme Court explains that shifting responsibility for the protected party's own active negligence requires particularly clear language, and that defense obligations can differ from ultimate responsibility for damages. Civil Code section 2778 supplies defense-related default rules unless the agreement indicates otherwise. A covered claim can therefore raise legal-cost obligations before fault is finally determined; the precise application to this API contract is unresolved.

Sources: [California Civil Code section 2778](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?sectionNum=2778.&lawCode=CIV), [Crawford v. Weather Shield, California Supreme Court (2008)](https://scocal.stanford.edu/opinion/crawford-v-weather-shield-33143/). Crawford concerned a different construction contract; its discussion informs the legal framework rather than deciding Blizzard's terms.

## Community benefit: section 2

The community-benefit paragraph supplies no minimum audience, public-release requirement, follower count or definition requiring the developer to operate a community. Benefiting Blizzard players is the stated purpose; the same paragraph restricts use as a CCPA service provider rather than a buyer of Blizzard data.

Our working interpretation is that a free guild/friends tool fits that purpose naturally. A personal tool also has a reasonable argument, but this is not an express exemption or published approval. The separate requirement that data be dynamically available to the public appears in the physical-product restriction; its exact effect on private tools is not clarified here.

Blizzard's data-protection FAQ gives a guild spreadsheet as an example intended use and accommodates clients with no service URL. A 2020 API forum reply discusses a personal-only client-credentials application while warning against exposing credentials when sharing a client. This supports personal/small-audience development as a practical use case; neither source expressly waives the community-benefit clause. Do not confuse distribution of source code with permission to share credentials.

Sources: [Data Protection Notice and FAQ, questions 1 and 8](https://us.forums.blizzard.com/en/blizzard/t/data-protection-notice-and-faq/609/2), [Learning to code, need item database, reply 2](https://us.forums.blizzard.com/en/blizzard/t/learning-to-code-need-item-database/5821/2).

## Unfair advantage: section 2

The contract does not define unfairness or provide objective tests. Blizzard reserves sole discretion over negative impact, game integrity and unfair player advantages. Public availability is not an express exception.

Our interpretation: a passive dashboard analyzing the authorized public auction feed is easier to reconcile with the API's intended use than gameplay automation, exploitation of bugs, circumvention of limits, or privacy-invasive player tracking. Receiving useful market information is not automatically a contractual finding of unfairness. Conversely, making a tool free and public does not guarantee Blizzard will permit its functionality.

Keep this distinction explicit when proposing features: comparing prices and displaying calculated opportunities helps a player make decisions; automatically executing gameplay actions raises separate concerns. This is practical reasoning, not Blizzard approval of this application, any particular trading strategy, or any future automation feature.

## Long-term price history: what is and is not established

**Express text:** the retention clause covers all data obtained through the APIs and sets a maximum 30-day TTL. It contains a WoW character-validation option, not an auction-price-history exception. The monetization section expressly recognizes aggregate/derived data, but does not grant that data an extended retention period.

**Unresolved boundary:** the contract does not clearly specify when newly computed information ceases to be covered data. Deleting raw JSON while retaining its prices, converting currencies, removing names, calculating a daily median or maintaining an old-input moving average is not an express way around the TTL. A plausible argument exists that non-identifying market statistics are distinct from player data; the agreement does not clearly authorize their indefinite retention.

| Stored information | Working treatment |
| --- | --- |
| Raw auction response, compressed copy, filtered item rows | Expire within 30 days; encoding/filtering does not change the information's source. |
| Processed public price statistics, initially daily minimum, maximum and mean per item/market | Retain beyond 30 days under the owner's accepted interpretation and risk decision. |
| Moving average incorporating older observations | May use retained processed price summaries; raw inputs still expire within 30 days. |
| Independently authored code, formulas and UI | Separate from API observations; this clause is not a 30-day expiry of our software. |
| Genuine independently acquired observations | Assess their actual source and applicable permissions separately. Relabeling API-derived observations or obtaining them through another API consumer does not establish independent rights. |

There is relevant nuance in Blizzard's official data-protection guidance:

- FAQ question 6 rejects anonymization as a substitute for the player-data lifespan.
- FAQ question 15 treats some historical guild/leaderboard data as public data that is not deleted when a player invokes erasure. A February 2020 staff reply repeats that position.

That guidance means an absolute statement that Blizzard forbids every kind of historical data would be too broad. It does **not** expressly extend the guild/leaderboard treatment to retained auction prices or grant blanket permission for every aggregate. A November 2026 forum question about keeping Forever aggregates beyond 30 days remained unanswered when checked; it is evidence of an unresolved question, not permission.

Sources: [Official FAQ, questions 6 and 15](https://us.forums.blizzard.com/en/blizzard/t/data-protection-notice-and-faq/609/2), [Historical-data staff response, February 3, 2020](https://us.forums.blizzard.com/en/blizzard/t/data-protection-and-historical-data/2496/12), [Unanswered Forever aggregation question](https://us.forums.blizzard.com/en/blizzard/t/wow-forever-keeping-aggregated-stats-past-30-days/60440).

The owner's decision above governs implementation despite this interpretive uncertainty. The initial long-term archive needs item ID, market ID, date and daily minimum, maximum and mean prices; it does not need auction IDs, account/character identifiers or seller names.

## Other contract terms worth remembering

- Blizzard receives a nonexclusive, perpetual, royalty-free license to use/distribute/display the app and its arranged data, plus rights in app IP for developing and exploiting its own API-based applications. This is not an assignment of the entire app or a source-publication obligation.
- API/data/site feedback is assigned to Blizzard without payment.
- California law and the incorporated dispute policy apply; the pasted terms announce arbitration and a class-action waiver. The separate dispute policy's detailed procedures were not verified.
- We cannot assign the agreement without Blizzard's consent. Multiple obligations survive termination.

Related collection research: [data access](discovery/02-data-access.md), [historical collection plan](discovery/03-collection-plan.md).
