"""Temporary SQLite sizing benchmark; leaves the application's data unchanged.

Run from the project root: python3 tools/analyze-storage-sqlite.py
Uses only Python's standard library; the temporary database is deleted on exit.
"""
import datetime
import json
import os
import pathlib
import sqlite3
import tempfile

state = pathlib.Path(os.environ.get("WOW_STORAGE_STATE_DIR", ".wow-local"))
with (state / "snapshot.json").open() as source:
    snapshot = json.load(source)
retained = datetime.datetime.fromisoformat(snapshot.get("retainedAt", snapshot["generatedAt"]).replace("Z", "+00:00"))
now = datetime.datetime.now(datetime.timezone.utc)
if not -60 <= (now - retained).total_seconds() < 30 * 86400:
    raise ValueError("A saved snapshot within the 30-day retention period is required.")

records = []
for index, row in enumerate(snapshot["rows"]):
    for market, faction in enumerate(["alliance", "horde", "neutral"]):
        quote = row["quotes"][faction]
        if quote and quote["auctions"]:
            records.append((index * 3 + market, quote["minBuyout"], quote["buyoutUnits"], 2 if quote["minBuyout"] is None else 3))

with tempfile.TemporaryDirectory(prefix="wow-storage-sqlite-") as directory:
    path = pathlib.Path(directory) / "hourly.sqlite"
    db = sqlite3.connect(path)
    db.execute("CREATE TABLE history(series INTEGER NOT NULL, hour INTEGER NOT NULL, price REAL, units INTEGER NOT NULL, state INTEGER NOT NULL, PRIMARY KEY(series,hour)) WITHOUT ROWID")
    # Same values, distinct hour keys. Measures page/index cost, not volatility
    # or compression of a real time series. Do not gzip this repeated test data.
    start = int(datetime.datetime.fromisoformat(snapshot["generatedAt"].replace("Z", "+00:00")).timestamp() // 3600)
    db.executemany("INSERT INTO history VALUES(?,?,?,?,?)", (
        (series, start + hour, price, units, status)
        for series, price, units, status in records for hour in range(24)
    ))
    db.commit()
    primary_size = path.stat().st_size
    db.execute("CREATE INDEX history_hour ON history(hour,series)")
    db.commit()
    indexed_size = path.stat().st_size
    count = db.execute("SELECT count(*) FROM history").fetchone()[0]
    if records:
        first = db.execute("SELECT series,hour,price,units,state FROM history ORDER BY series,hour LIMIT 1").fetchone()
        assert first == (records[0][0], start, records[0][1], records[0][2], records[0][3])
    db.close()
    print(json.dumps({
        "sqliteVersion": sqlite3.sqlite_version, "snapshotAt": snapshot["generatedAt"],
        "hours": 24, "recordsPerHour": len(records), "rows": count,
        "primaryKeyOnlyBytes": primary_size, "withTimeIndexBytes": indexed_size,
        "primaryKeyBytesPerRow": primary_size / count if count else 0,
        "timeIndexBytesPerRow": indexed_size / count if count else 0,
        "projected90Days": {"primaryKeyOnlyBytes": primary_size * 90, "withTimeIndexBytes": indexed_size * 90},
    }, indent=2))
