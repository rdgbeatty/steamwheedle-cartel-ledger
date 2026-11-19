# Hourly price-history storage sizing

Measured **2026-11-18 12:51 UTC** against this application's saved US PvP snapshot and six authenticated Forever auction feeds. This is a capacity spike; it does not enable collection, create a history database, or change retention decisions. All sizes use decimal units: **1 MB = 1,000,000 bytes; 1 GB = 1,000 MB**.

**Follow-up:** The [Durable Objects sizing experiment](durable-objects-storage-spike.md) replaces individual observation rows with grouped daily BLOBs. Actual 90-day SQLite files measured **0.856 GB compressed / 2.403 GB uncompressed** after rolling expiry. The conventional relational database estimates below remain useful comparisons, rather than minimum storage requirements.

## Result

For minimum ask plus listed quantity, retaining equipment variants, budget approximately **0.5–1 GB of compressed archive payload** or **5–10 GB for a queryable local database** over 90 days at hourly resolution. One complete backup roughly doubles those disk budgets. These planning ranges include headroom over today's measurements, not a guarantee about future market growth.

Current-size full order books would require roughly **9 GB as gzip JSON**, or **6 GB using the tested compact listing encoding**, before database indexes, backups or growth headroom. Anonymous price-level depth is a middle option at about **2.4 GB compressed**. Minimum-price history is enough for price/stock charts; full depth is needed to reconstruct historical multi-listing purchase opportunities.

## Current footprint and scope

The application currently uses JSON files, not a historical database:

| Saved data | On disk now | Gzip equivalent |
| --- | ---: | ---: |
| Item catalog, 17,733 named entries | 3.35 MB | 0.234 MB |
| Latest market snapshot | 43.95 MB | 1.63 MB |
| Combined catalog and snapshot | **47.30 MB** | **1.86 MB** |

The latest saved snapshot was collected at **12:44 UTC** from source publications around **12:25 UTC**. It includes **20,797 distinct item IDs**, because auctioned IDs absent from static search remain tracked, and **63,280 item/variant rows**. Of the possible 189,840 item-variant/market pairs, **64,005 had listings** and 64,001 had buyout asks. Counts include Alliance 110, Horde 113 and neutral 116.

The six live feeds matched that snapshot's **398,912 listings**: 180,146 Alliance, 192,027 Horde and 26,739 neutral. They contained 33 bid-only listings. Their minified JSON totaled **37.73 MB**, gzip **4.08 MB**. The current saved snapshot can be larger uncompressed than those raw feeds because it repeats item metadata, quote field names and empty market summaries; its repetitive contents compress more strongly.

The catalog's 17,733 IDs are therefore not the complete count of historical price series. Variant identities matter for equipment. Collapsing all variants into a base item's lowest price can put prices of different stat combinations on the same line.

## Ninety days, every hour

There are **90 × 24 = 2,160 hourly collection slots**. This table multiplies one measured snapshot by 2,160. It assumes every hour is stored at today's size, without cross-hour deduplication or compression. It includes all three markets; do not multiply these totals by three again.

| History content and format | Per hourly snapshot | 90-day payload |
| --- | ---: | ---: |
| Copies of the current app snapshot, JSON | 43.95 MB | **94.9 GB** |
| Copies of the current app snapshot, gzip | 1.63 MB | **3.51 GB** |
| Min ask + stock, all current variants, compact columns | 1.09 MB | **2.35 GB** |
| Same compact summary, gzip | 0.255 MB | **0.550 GB** |
| Same summary as positional JSON arrays, gzip | 0.301 MB | **0.651 GB** |
| Anonymous price-level depth, compact columns + gzip | 1.09 MB | **2.35 GB** |
| Full listing fields, compact columns + gzip | 2.68 MB | **5.79 GB** |
| All six API books as minified JSON + gzip | 4.08 MB | **8.81 GB** |
| All six API books as minified JSON, uncompressed | 37.73 MB | **81.5 GB** |

Compact summary and listing encodings use dictionaries for item/variant identities, held separately rather than repeated each hour. The summary dictionary is **1.82 MB JSON / 0.344 MB gzip** today, plus the catalog. Small collection headers hold the timestamp, source timestamps and coverage state once per batch. They and dictionary growth add some overhead not represented in the per-snapshot payloads. No backup, SQLite index, filesystem allocation, journal, or future market growth is included in this table.

The listing prototype preserves house, dictionary item/variant key, auction ID, quantity, whole-listing buyout, bid and time-left category. It does not retain every JSON envelope field or original object ordering, so byte-identical API response preservation corresponds to the raw JSON row instead. The anonymous depth prototype groups buyout offers at identical unit asks and preserves quantity, offer count and exact aggregate purchase cost. Its **131,102 price levels** omit listing identities, bids and time-left, and cannot reconstruct original stack sizes.

### What if we really mean only 17,733 base IDs?

Storing a value for every catalog ID in every house every hour produces:

```text
17,733 × 3 houses × 2,160 hours = 114,909,840 observations
8-byte price + 4-byte listed quantity = 12 bytes of numeric values
114,909,840 × 12 = 1.38 GB before keys, flags, indexes or compression
```

Most catalog items are unlisted. Sparse storage needs only **9,418 active base-item/market pairs** from the known catalog in today's snapshot: **110 MB gzip over 90 days** in the prototype. Including all 20,797 IDs, but combining variants, gives 16,463 active pairs and **180 MB gzip**. The corresponding variant-preserving result is **550 MB**. The smaller estimates lose both variant distinctions and, for catalog-only history, the unnamed auction items. They should not be presented as equivalent coverage.

For comparison, dense storage of all 63,280 current variant rows across all houses would be **410 million observations / 4.92 GB of numeric values** before overhead. The sparse variant prototype represents about **138 million observations** over 90 days. A dimension key's nonappearance in a successfully collected market means no listing; absence from a failed market means unknown. Never infer stockouts from failed collection.

## SQLite experiment

A second prototype used Python's bundled **SQLite 3.45.1** and a real temporary database. Schema:

```sql
CREATE TABLE history (
  series INTEGER NOT NULL,
  hour INTEGER NOT NULL,
  price REAL,
  units INTEGER NOT NULL,
  state INTEGER NOT NULL,
  PRIMARY KEY (series, hour)
) WITHOUT ROWID;
CREATE INDEX history_hour ON history(hour, series);
```

`series` refers to a stable item/variant/market dimension; `hour` is an integer UTC hour. The primary key serves one-series chart queries; the second index supports time-wide queries and retention work. A `WITHOUT ROWID` table avoids maintaining both an unrelated rowid and a separate composite primary-key index; it is an option to benchmark, not a universal optimization. [SQLite's explanation](https://sqlite.org/withoutrowid.html)

The benchmark inserted **24 distinct hour keys × 64,005 series = 1,536,120 rows**. It reused today's values to measure row and index storage, not to simulate volatility. No gzip ratio was taken from this repeated test data.

| Database layout | Measured for 24 hours | Bytes/row | Extrapolated 90 days |
| --- | ---: | ---: | ---: |
| Series/hour primary key only | 32.35 MB | 21.1 | **2.91 GB** |
| Also indexed by hour | 50.69 MB | 33.0 | **4.56 GB** |

These are extrapolations from one day, not a measured 90-day database. Larger B-trees, insertion order, additional columns, real value distributions, deletions, new variants and free pages can change the result. **5–10 GB primary storage**, and **10–20 GB with one backup**, is a reasonable initial budget for this simple SQLite approach at today's market size. Temporary import/maintenance space or multiple backup generations needs additional capacity. SQLite also uses rollback-journal or WAL files during operation. [SQLite file format](https://sqlite.org/fileformat.html)

## Compaction choices

1. **Store metadata once.** History rows refer to a stable numeric series ID, not repeated item names, category strings and variant JSON. Keep current metadata separate and subject to its retention policy.
2. **Use numeric fields.** The tested summary has column arrays of series ID (4 bytes), unit price (8-byte IEEE float), listed units (4 bytes) and status (1 byte): 17 bytes/active pair before compression. The present maximum listed quantity, 184,568, fits uint32. The script asserts bounds instead of silently truncating. The double preserves the application's current fractional-copper unit asks; do not round minimum stack prices to whole copper just to save bytes.
3. **Avoid empty rows.** Store market coverage once with each batch so absent values can be interpreted correctly. Distinguish no buyout, bid-only offers and unavailable markets; a zero price cannot represent all three.
4. **Compress batches.** Gzip reduced the tested summary from 1.09 MB to 0.255 MB; Brotli quality 5 reached 0.231 MB, or **0.499 GB over 90 days**. Even gzip positional JSON arrays came close at 0.651 GB. A custom binary format is not essential to reach sub-GB archive payloads. Columnar formats also provide dictionary, run-length and delta encodings, but no Parquet/Zstandard size claim was measured in this spike. [Parquet encoding specification](https://parquet.apache.org/docs/file-format/data-pages/encodings/)
5. **Deduplicate unchanged source observations.** Retain source publication time separately from collection/check time. A successful hourly check with unchanged API data can reference the earlier observation instead of copying it. In-memory or disk byte equality is not proof of a fresh source update. Actual savings require a multi-day change-rate sample; they are not assumed in the table.
6. **Optionally keep only changes within a series.** Runs of unchanged price/stock can be represented by one interval. Graphs must preserve stockouts, failures and stale-source gaps. One snapshot does not establish a defensible compression ratio for this scheme.

## Which information earns its storage cost?

Here, **volume means current buyout units listed**, not completed sales. It is the same stock proxy already used in the application. Neither a series of minimum prices nor successive full order books proves actual completed-sale volume; listings can be canceled, expire or be relisted.

| Stored data | Supports | Loses |
| --- | --- | --- |
| Minimum ask + total buyout stock | Price and supply charts, historical faction/neutral spreads, low-stock flags | Quantity actually available at the minimum, ask distribution, exact historical multi-level purchase costs |
| Also offer count and/or quantity at the minimum | Distinguishes a single cheap offer from a deep minimum; better context for price outliers | The rest of the price ladder |
| Anonymous price levels | Historical depth, cumulative purchase costs and replay of profitable price-level selection | Original listing identity, individual stack sizes after grouping, bids/time-left |
| Full order books | Listing/stack detail and observed listing changes | Still no executed-sales tape; much higher storage and retention complexity |

Offer count is an inexpensive optional integer worth considering with the minimum/stock summary. Quantity at the minimum is another distinct metric; it cannot be recovered from minimum ask and total stock alone. Neither extra field is included in the 550 MB summary figure.

## Recommendation for a future implementation

Start with **hourly variant-aware minimum ask and buyout stock**, source time and coverage state, optionally buyout-offer count. Keep the latest neutral price depth for the current opportunity table. This supplies the requested historical price/stock graphs without making a historical full-order-book archive the default.

For a straightforward local implementation, **5–10 GB for SQLite, plus backup space**, is modest enough that a custom storage engine is unnecessary. A later daily compressed archive or columnar export could reduce the historical payload toward the measured **0.5–1 GB** range while keeping recent data queryable. If full historical depth proves useful, budget several GB more or keep a shorter depth window. Additional copies multiply the retained-data footprint.

The **90-day full-book figures are capacity comparisons only**: project instructions cap raw Blizzard API data and copies at **30 days**; today's raw gzip-book projection for 30 days would be about **2.94 GB**. The recorded longer-retention decision covers processed public auction-price statistics, initially daily minimum/maximum/mean. An implementation must apply that decision to the chosen hourly statistics/stock schema and keep raw data and backups within their TTL. This analysis does not expand that decision or start an archive. [Recorded retention decision](blizzard-api-terms.md#owner-retention-decision-2026-11-16)

## Reproduce

From the repository root:

```sh
node tools/analyze-storage.mjs
node tools/analyze-storage.mjs --live-books
python3 tools/analyze-storage-sqlite.py
```

The first command sizes the current saved snapshot with no network calls. The second additionally measures all six books, using saved application credentials and the shared request budget; this run used **7 requests including OAuth**. It writes no raw responses or price observations. Only aggregate counts, dates and byte sizes go to stdout. `WOW_STORAGE_STATE_DIR` can override the state directory if needed. The third command creates a temporary SQLite database and removes it before exiting. No application dependencies, server routes, database migration, scheduler or retention settings were changed.

All compression projections compress **one real snapshot** before multiplication; they do not compress 2,160 copies of identical data together. Round-trip assertions check the prototype's summary prices/quantities and full-book numeric fields, and SQLite checks a recovered observation. Future architecture work still needs real multi-day change rates, query performance, insertion/compaction strategy and retention/deletion behavior.
