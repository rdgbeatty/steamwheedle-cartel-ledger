"""Local Durable Objects layout spike. No cloud deployment or API requests.

Creates temporary SQLite files, measures 90 days of independently encoded hourly
frames, exercises hourly updates and rolling expiry, then deletes every database.
The one real snapshot supplies all hours: this measures layout, not actual history.
There is deliberately no compression across repeated hours.
"""
import datetime
import hashlib
import json
import math
import os
import pathlib
import sqlite3
import struct
import sys
import tempfile
import time
import zlib

SHARDS = 64
DAY_HEADER = 8 + 25 * 4
PAIR_BYTES = 17
state = pathlib.Path(os.environ.get("WOW_STORAGE_STATE_DIR", ".wow-local"))
with (state / "snapshot.json").open() as source:
    snapshot = json.load(source)
retained = datetime.datetime.fromisoformat(snapshot.get("retainedAt", snapshot["generatedAt"]).replace("Z", "+00:00"))
now = datetime.datetime.now(datetime.timezone.utc)
if not -60 <= (now - retained).total_seconds() < 30 * 86400:
    raise ValueError("A current saved snapshot within the raw-data TTL is required.")


def frame(records):
    count = len(records)
    result = bytearray(8 + count * PAIR_BYTES)
    struct.pack_into("<4sI", result, 0, b"HRS1", count)
    for index, (series, price, quantity, status) in enumerate(records):
        if not 0 <= series < 2**32 or not isinstance(quantity, int) or not 0 <= quantity < 2**32:
            raise ValueError("Series ID or quantity does not fit uint32.")
        if price is not None and (not math.isfinite(price) or price <= 0):
            raise ValueError("Invalid minimum ask.")
        struct.pack_into("<I", result, 8 + index * 4, series)
        struct.pack_into("<d", result, 8 + count * 4 + index * 8, math.nan if price is None else price)
        struct.pack_into("<I", result, 8 + count * 12 + index * 4, quantity)
        result[8 + count * 16 + index] = status
    return bytes(result)


def frame_lookup(encoded, series):
    magic, count = struct.unpack_from("<4sI", encoded)
    assert magic == b"HRS1" and len(encoded) == 8 + count * PAIR_BYTES
    low, high = 0, count
    while low < high:
        mid = (low + high) // 2
        key = struct.unpack_from("<I", encoded, 8 + mid * 4)[0]
        if key < series:
            low = mid + 1
        else:
            high = mid
    if low == count or struct.unpack_from("<I", encoded, 8 + low * 4)[0] != series:
        return None
    price = struct.unpack_from("<d", encoded, 8 + count * 4 + low * 8)[0]
    return (series, None if math.isnan(price) else price,
            struct.unpack_from("<I", encoded, 8 + count * 12 + low * 4)[0], encoded[8 + count * 16 + low])


def daily_blob(hour_bytes, hours, codec):
    assert 0 <= hours <= 24
    # Offsets make every member independently readable; no re-compression of
    # identical hours together and no implicit timestamp/price forward filling.
    offsets = [index * len(hour_bytes) if index <= hours else hours * len(hour_bytes) for index in range(25)]
    return struct.pack("<4sBBH25I", b"DAY1", hours, codec, 0, *offsets) + hour_bytes * hours


def daily_lookup(blob, hour, series):
    magic, hours, codec, _ = struct.unpack_from("<4sBBH", blob)
    assert magic == b"DAY1" and hour < hours
    start, end = struct.unpack_from("<II", blob, 8 + hour * 4)
    encoded = blob[DAY_HEADER + start:DAY_HEADER + end]
    return frame_lookup(zlib.decompress(encoded) if codec == 1 else encoded, series)


# Preserve fractional-copper asks and distinct no-ask/known-zero states even
# though today's real minimums happen to be integers.
edges = [(0, 1 / 3, 184568, 3), (1, None, 0, 2), (2, 12345.67, 2**32 - 1, 3)]
for record in edges:
    assert frame_lookup(frame(edges), record[0]) == record

buckets = [[] for _ in range(SHARDS)]
dimensions = [[] for _ in range(SHARDS)]
for index, row in enumerate(snapshot["rows"]):
    identity = f"{row['id']}:{row['variant']}".encode()
    bucket = int.from_bytes(hashlib.sha256(identity).digest()[:4], "little") % SHARDS
    dimensions[bucket].append([index, row["id"], row["variant"]])
    for market, faction in enumerate(["alliance", "horde", "neutral"]):
        quote = row["quotes"][faction]
        if quote and quote["auctions"]:
            buckets[bucket].append((index * 3 + market, quote["minBuyout"], quote["buyoutUnits"], 2 if quote["minBuyout"] is None else 3))

raw = [frame(bucket) for bucket in buckets]
compressed = [zlib.compress(value, 6) for value in raw]
for records, encoded in zip(buckets, raw):
    for record in records:
        assert frame_lookup(encoded, record[0]) == record
dimension_bytes = [zlib.compress(json.dumps(values, separators=(",", ":")).encode(), 6) for values in dimensions]


def measure_layout(directory, name, members, codec):
    stores = []
    for shard, member in enumerate(members):
        path = pathlib.Path(directory) / f"{name}-{shard}.sqlite"
        db = sqlite3.connect(path)
        db.execute("CREATE TABLE days(day INTEGER PRIMARY KEY, payload BLOB NOT NULL)")
        db.execute("CREATE TABLE meta(key TEXT PRIMARY KEY, value BLOB NOT NULL) WITHOUT ROWID")
        db.execute("INSERT INTO meta VALUES('dimensions',?)", (dimension_bytes[shard],))
        # Deliberately reserve metadata per captured hour for publication times,
        # retrieval times, market coverage, checksums and format versions.
        db.execute("INSERT INTO meta VALUES('hour-metadata-reserve',?)", (bytes(90 * 24 * 128),))
        blob = daily_blob(member, 24, codec)
        db.executemany("INSERT INTO days VALUES(?,?)", ((day, blob) for day in range(90)))
        db.commit()
        stores.append((path, db, shard))
    initial_size = sum(path.stat().st_size for path, _, _ in stores)
    print(f"{name}: 90-day databases allocated; checking rolling expiry…", file=sys.stderr, flush=True)
    max_row = max(len(daily_blob(value, 24, codec)) for value in members)
    peak = initial_size
    changes_before = sum(db.total_changes for _, db, _ in stores)
    # Model 14 more days: delete the expired day first, append each hour by
    # rewriting that day's BLOB. Do not VACUUM; measure allocated free pages.
    for day in range(90, 104):
        for path, db, shard in stores:
            db.execute("DELETE FROM days WHERE day < ?", (day - 89,))
            for hour in range(24):
                db.execute("INSERT INTO days(day,payload) VALUES(?,?) ON CONFLICT(day) DO UPDATE SET payload=excluded.payload",
                           (day, daily_blob(members[shard], hour + 1, codec)))
                db.commit()
        peak = max(peak, sum(path.stat().st_size for path, _, _ in stores))
    write_changes = sum(db.total_changes for _, db, _ in stores) - changes_before
    final_size = sum(path.stat().st_size for path, _, _ in stores)
    max_object = max(path.stat().st_size for path, _, _ in stores)
    free_bytes = sum(db.execute("PRAGMA freelist_count").fetchone()[0] * db.execute("PRAGMA page_size").fetchone()[0] for _, db, _ in stores)
    # A favorite's query reads one daily row per day from one shard. Return only
    # that series, not the shard's other market data.
    shard = max(range(SHARDS), key=lambda value: len(buckets[value]))
    db = stores[shard][1]
    series = buckets[shard][0][0]
    started = time.perf_counter()
    found = []
    fetched_rows = list(db.execute("SELECT payload FROM days WHERE day >= ? AND day < ? ORDER BY day", (14, 104)))
    for (blob,) in fetched_rows:
        for hour in range(24):
            found.append(daily_lookup(blob, hour, series))
    assert len(fetched_rows) == 90 and len(found) == 2160 and all(value == buckets[shard][0] for value in found)
    lookup_ms = (time.perf_counter() - started) * 1000
    query_plan = [row[3] for row in db.execute("EXPLAIN QUERY PLAN SELECT payload FROM days WHERE day >= ? AND day < ? ORDER BY day", (14, 104))]
    for _, db, _ in stores:
        assert db.execute("SELECT count(*) FROM days").fetchone()[0] == 90
        db.close()
    return {"initial90DayDatabaseBytes": initial_size, "after14DayRollingBytes": final_size,
            "observedPeakDatabaseBytes": peak, "largestObjectBytes": max_object, "largestRowBytes": max_row,
            "allocatedFreeBytesAfterRolling": free_bytes, "dailySqlRowChangesExcludingIndexes": write_changes / 14,
            "chartDailyRowsRead": len(fetched_rows), "chartHourlyValuesReturned": len(found),
            "localChartLookupMs": lookup_ms, "queryPlan": query_plan}


with tempfile.TemporaryDirectory(prefix="wow-durable-storage-") as directory:
    report = {"measuredAt": now.isoformat(), "snapshotAt": snapshot["generatedAt"], "sqliteVersion": sqlite3.sqlite_version,
              "shards": SHARDS, "days": 90, "observationsPerHour": sum(map(len, buckets)),
              "dailySqlHistoryRows": SHARDS, "ninetyDaySqlHistoryRows": SHARDS * 90,
              "metadataReserveBytes": 90 * 24 * 128 * SHARDS,
              "hourlyUncompressedBytes": sum(map(len, raw)), "hourlyCompressedBytes": sum(map(len, compressed)),
              "dimensionBytes": sum(map(len, dimension_bytes)),
              "uncompressed": measure_layout(directory, "raw", raw, 0),
              "compressed": measure_layout(directory, "compressed", compressed, 1)}
    print(json.dumps(report, indent=2))
