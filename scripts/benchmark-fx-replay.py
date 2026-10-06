"""Read-only source benchmark; all generated archives stay in temporary storage.

Example: python scripts/benchmark-fx-replay.py --database <archive DB>
         --archive <ID> --baseline <old replay_store.py> --output <report.json>
--native additionally measures a read-only request to the already running MT5.
"""
import argparse
import importlib.util
import json
import sqlite3
import statistics
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "mt5-bridge"))
import replay_store
import replay_ticks


def benchmark(args):
    database = Path(args.database).resolve()
    with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True) as db:
        db.row_factory = sqlite3.Row
        archive = db.execute("SELECT * FROM archives WHERE id=? AND status='complete'", (args.archive,)).fetchone()
        if archive is None:
            raise ValueError("Choose a complete archive")
        manifest = json.loads(archive["manifest_json"])
        if manifest.get("tick_storage") == replay_ticks.FORMAT:
            values = list(replay_ticks.iter_ticks(replay_ticks.tick_path(database, args.archive), archive["tick_count"], limit=args.count))
        else:
            values = [dict(row) for row in db.execute("SELECT time_msc,bid,ask,last,volume,volume_real,flags FROM ticks WHERE archive_id=? ORDER BY sequence LIMIT ?", (args.archive, args.count))]
        rows = np.array([tuple(row[field] for field in replay_ticks.FIELDS) for row in values], dtype=[(name, "<i8" if name in {"time_msc", "volume", "flags"} else "<f8") for name in replay_ticks.FIELDS])
        if not len(rows):
            raise ValueError("Archive is empty")
        timings = {}
        if manifest.get("tick_storage") != replay_ticks.FORMAT:
            for offset in (0, max(0, archive["tick_count"]-10_000)):
                for mode in ("offset", "keyset"):
                    durations = []
                    for _ in range(3):
                        sql = "SELECT time_msc,bid,ask FROM ticks WHERE archive_id=? " + ("ORDER BY sequence LIMIT 10000 OFFSET ?" if mode == "offset" else "AND sequence>=? ORDER BY sequence LIMIT 10000")
                        started = time.perf_counter()
                        db.execute(sql, (args.archive, offset)).fetchall()
                        durations.append(time.perf_counter()-started)
                    timings[f"{mode}_{offset}_ms"] = statistics.median(durations)*1000
    variants = {"binary": replay_store}
    if args.baseline:
        spec = importlib.util.spec_from_file_location("benchmark_old_store", Path(args.baseline).resolve())
        old = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(old)
        variants["baseline"] = old
    results = {"ticks": len(rows), "page_timings": timings, "writes": {}}
    hashes = set()
    with tempfile.TemporaryDirectory(prefix="crt-replay-benchmark-") as directory:
        for variant, store in variants.items():
            seconds, sizes = [], []
            for attempt in range(3):
                destination = Path(directory) / f"{variant}-{attempt}"
                store.initialize(destination)
                aid = store.create_archive(archive["symbol"], archive["symbol"], "benchmark", "benchmark", int(rows["time_msc"][0]), int(rows["time_msc"][-1]), {})
                started = time.perf_counter()
                store.append_ticks(aid, rows, int(rows["time_msc"][0]), int(rows["time_msc"][-1]))
                completed = store.finish_archive(aid)
                seconds.append(time.perf_counter()-started)
                hashes.add(completed["sha256"])
                sizes.append(sum(path.stat().st_size for path in destination.rglob("*") if path.is_file()))
            elapsed = statistics.median(seconds)
            results["writes"][variant] = {"median_seconds": elapsed, "ticks_per_second": len(rows)/elapsed, "bytes": statistics.median(sizes), "all_seconds": seconds}
    results["canonical_hash_equal"] = len(hashes) == 1
    if args.native:
        import MetaTrader5 as mt5
        if not mt5.initialize():
            raise ValueError("Cannot attach to running MT5 for read-only benchmark")
        try:
            started = time.perf_counter()
            ticks = mt5.copy_ticks_range(archive["symbol"], datetime.fromtimestamp(int(rows["time_msc"][0])//1000, timezone.utc), datetime.fromtimestamp(int(rows["time_msc"][-1])//1000+1, timezone.utc), mt5.COPY_TICKS_ALL)
            results["native_cached_read"] = {"seconds": time.perf_counter()-started, "ticks": len(ticks) if ticks is not None else None}
        finally:
            mt5.shutdown()
    return results


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", required=True)
    parser.add_argument("--archive", required=True)
    parser.add_argument("--count", type=int, default=200_000)
    parser.add_argument("--baseline")
    parser.add_argument("--native", action="store_true")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    if args.count < 1 or args.count > 2_000_000:
        parser.error("count must be 1..2000000")
    report = benchmark(args)
    Path(args.output).write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
