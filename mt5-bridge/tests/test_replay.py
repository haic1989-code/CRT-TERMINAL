import contextlib
import hashlib
import io
import json
import sqlite3
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import replay_store as store
import replay_ticks
from replay_worker import ReplayContext, run

try:
    import numpy as np
except ImportError:
    np = None

SPEC = {"point": 0.01, "trade_tick_size": 0.01, "trade_tick_value": 2,
        "volume_min": 0.01, "volume_max": 100, "volume_step": 0.01, "digits": 2}


class ReplayEngineTests(unittest.TestCase):
    def context(self, **params):
        result = ReplayContext("test", "XAUUSD", SPEC, {"account_currency": "USD", **params})
        result._event = lambda *_args, **_kwargs: None
        return result

    def test_ema_matches_mt5_first_price_seed(self):
        ctx = self.context()
        ctx.ema(3)
        for close in (10, 20, 30, 40):
            ctx.current_bar = {"open": close, "close": close, "high": close, "low": close}
            ctx._close_bar()
        self.assertAlmostEqual(ctx.ema(3), 31.25)

    def test_atr_matches_mt5_rolling_true_range_not_wilder(self):
        ctx = self.context()
        ctx.atr(2)
        for high, low, close in ((11, 9, 10), (15, 10, 14), (19, 13, 18), (25, 17, 24)):
            ctx.current_bar = {"open": close, "close": close, "high": high, "low": low}
            ctx._close_bar()
        self.assertAlmostEqual(ctx.atr(2), 7)  # last two TR values: 6 and 8

    def test_legacy_indicator_model_is_explicit(self):
        ctx = self.context(indicator_model="legacy_v2")
        ctx.ema(3)
        for close in (10, 20, 30, 40):
            ctx.current_bar = {"open": close, "close": close, "high": close, "low": close}
            ctx._close_bar()
        self.assertAlmostEqual(ctx.ema(3), 30)

    def test_points_are_not_money(self):
        ctx = self.context()
        ctx.bid, ctx.ask = 100, 100.1
        identifier = ctx.buy(1)
        ctx.bid = 100.2
        ctx.close(identifier)
        self.assertAlmostEqual(ctx.net_points_volume, 10)
        self.assertAlmostEqual(ctx.realized_pnl_account_currency, 20)

    def test_buy_limit_gap_below_sl_does_not_abort_fill(self):
        ctx = self.context()
        ctx.bid, ctx.ask = 89, 90
        ctx._open("buy", 1, 90, 95, 110, "buy_limit")
        ctx._close(ctx.positions[0], 1, ctx.bid, "stop_loss")
        self.assertEqual(len(ctx.positions), 0)

    def test_sell_limit_gap_above_sl_does_not_abort_fill(self):
        ctx = self.context()
        ctx.bid, ctx.ask = 120, 121
        ctx._open("sell", 1, 120, 115, 90, "sell_limit")
        ctx._close(ctx.positions[0], 1, ctx.ask, "stop_loss")
        self.assertEqual(len(ctx.positions), 0)

    def test_missing_exit_quote_does_not_hide_loss(self):
        ctx = self.context()
        ctx.bid, ctx.ask = 100, 100.1
        ctx.buy(1)
        ctx.bid = 0
        self.assertIsNone(ctx.equity_estimate)

    def test_total_bars_not_limited_by_window_size(self):
        ctx = self.context()
        for i in range(10_003):
            ctx._update_bar((i + 1) * 60_000, 100)
        ctx._finalize_bars()
        self.assertEqual(ctx.bar_count, 10_003)
        self.assertEqual(len(ctx.bars), 10_000)


@unittest.skipIf(np is None, "NumPy is required for the native MT5 tick layout")
class ReplayArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old_database = store._db_path
        store.initialize(self.temp.name)

    def tearDown(self):
        for writer in store._tick_writers.values():
            writer.close()
        store._tick_writers.clear()
        store._db_path = self.old_database
        self.temp.cleanup()

    def archive(self, start=1000, end=5000):
        return store.create_archive("XAUUSD", "XAUUSD", "test", "test", start, end, SPEC, "USD")

    def rows(self):
        return np.array([(1000, 100, 101, 0, 0, 0, 6), (1000, 101, 102, 0, 0, 0, 6), (2000, 102, 103, 0, 0, 0, 6)],
                        dtype=[(name, "<i8" if name in {"time_msc", "volume", "flags"} else "<f8") for name in replay_ticks.FIELDS])

    def test_canonical_hash_and_same_ms_tick_order(self):
        aid, rows = self.archive(), self.rows()
        store.append_ticks(aid, rows, 1000, 5000)
        result = store.finish_archive(aid)
        expected = hashlib.sha256(b"".join(replay_ticks.RECORD.pack(*tuple(row)) for row in rows)).hexdigest()
        self.assertEqual(result["sha256"], expected)
        values = store.get_archive_ticks(aid, 1, 2)["values"]
        self.assertEqual([tick["bid"] for tick in values], [101, 102])
        self.assertEqual([tick["sequence"] for tick in values], [1, 2])

    def test_bad_block_does_not_append_partial_rows(self):
        aid, rows = self.archive(), self.rows()
        rows["bid"][-1] = float("nan")
        with self.assertRaises(ValueError):
            store.append_ticks(aid, rows, 1000, 5000)
        self.assertEqual(store.get_archive(aid)["tick_count"], 0)
        with self.assertRaises(ValueError):
            store.finish_archive(aid)

    def test_decreasing_time_rejected_across_blocks(self):
        aid, rows = self.archive(), self.rows()
        store.append_ticks(aid, rows[-1:], 1000, 5000)
        with self.assertRaises(ValueError):
            store.append_ticks(aid, rows[:1], 1000, 5000)

    def test_incomplete_archive_cannot_be_replayed(self):
        aid = self.archive()
        store.append_ticks(aid, self.rows(), 1000, 5000)
        store.set_archive_state(aid, "cancelled")
        with self.assertRaises(ValueError):
            store.get_archive_ticks(aid, 0, 2)

    def test_truncated_and_modified_files_fail_verification(self):
        aid = self.archive()
        store.append_ticks(aid, self.rows(), 1000, 5000)
        archive = store.finish_archive(aid)
        path = replay_ticks.tick_path(store.database_path(), aid)
        data = bytearray(path.read_bytes())
        data[10] ^= 1
        path.write_bytes(data)
        with self.assertRaises(ValueError):
            list(replay_ticks.iter_ticks(path, 3, expected_sha256=archive["sha256"]))
        path.write_bytes(data[:-1])
        with self.assertRaises(ValueError):
            store.get_archive_ticks(aid, 0, 1)

    def test_legacy_sqlite_archive_keeps_keyset_paging(self):
        aid = self.archive()
        with store._connection() as db:
            db.executemany("INSERT INTO ticks VALUES(?,?,?,?,?,?,?,?,?)", [(aid, i, *tuple(row)) for i, row in enumerate(self.rows())])
            db.execute("UPDATE archives SET status='complete',tick_count=3,manifest_json='{}' WHERE id=?", (aid,))
        self.assertEqual(store.get_archive_ticks(aid, 2, 10)["values"][0]["bid"], 102)

    def test_isolated_csv_import_and_run_without_mt5(self):
        start = 1_735_689_600_000
        aid = self.archive(start, start+2000)
        inbox = store.database_path().parent / "inbox"
        inbox.mkdir()
        (inbox / "ticks.csv").write_text("<DATE>\t<TIME>\t<BID>\t<ASK>\t<LAST>\t<VOLUME>\t<FLAGS>\n2025.01.01\t02:00:00.999\t100\t101\t\t\t6\n2025.01.01\t02:00:01.001\t102\t103\t\t\t6\n", encoding="utf-8")
        worker = Path(__file__).resolve().parents[1] / "replay_import_worker.py"
        request = {"database_path": str(store.database_path()), "archive_id": aid, "file_name": "ticks.csv", "utc_offset_minutes": 120}
        process = subprocess.run([sys.executable, "-X", "utf8", "-I", str(worker)], input=json.dumps(request)+"\n", capture_output=True, text=True, encoding="utf-8", timeout=20)
        self.assertEqual(process.returncode, 0, process.stdout+process.stderr)
        self.assertEqual(store.get_archive_ticks(aid, 0, 2)["values"][0]["time_msc"], start+999)
        strategy = inbox / "no_op.py"
        strategy.write_text("def on_start(context): pass\ndef on_tick(context,tick): pass\ndef on_stop(context): pass\n")
        with contextlib.redirect_stdout(io.StringIO()):
            report = run(store.database_path(), "test", aid, strategy, {})
        self.assertEqual(report["tick_count"], 2)
        self.assertEqual(report["engine_version"], "3.1")

    def test_csv_bars_and_folder_escape_are_rejected(self):
        from replay_import_worker import csv_blocks
        path = Path(self.temp.name) / "bars.csv"
        path.write_text("<DATE>\t<TIME>\t<OPEN>\t<HIGH>\t<LOW>\t<CLOSE>\n")
        with self.assertRaises(ValueError):
            list(csv_blocks(path, 0))
        with self.assertRaises(ValueError):
            replay_ticks.tick_path(store.database_path(), "../../file")

    def test_native_seconds_enclose_chunk_and_keep_boundary_milliseconds(self):
        from replay_import_worker import run as import_run
        aid = self.archive(1000, 3_601_000)
        terminal = Path(self.temp.name) / "MT5"
        terminal.mkdir()
        (terminal / "terminal64.exe").touch()
        rows = self.rows()
        rows["time_msc"] = [1001, 3_600_999, 3_601_000]
        ranges = []
        def copy(_symbol, start, end, _flags):
            ranges.append((int(start.timestamp()*1000), int(end.timestamp()*1000)))
            # Emulate the SDK's second-resolution request handling.
            return rows[(rows["time_msc"] >= ranges[-1][0]) & (rows["time_msc"] <= ranges[-1][1])]
        stub = types.SimpleNamespace(initialize=lambda *_args: True, shutdown=lambda: None,
            terminal_info=lambda: types.SimpleNamespace(connected=True, company="test"),
            account_info=lambda: types.SimpleNamespace(server="test"), COPY_TICKS_ALL=0, copy_ticks_range=copy)
        with patch.dict(sys.modules, {"MetaTrader5": stub}), contextlib.redirect_stdout(io.StringIO()):
            import_run({"database_path": str(store.database_path()), "archive_id": aid, "terminal_path": str(terminal)})
        self.assertEqual(ranges[0], (1000, 3_601_000))
        self.assertEqual([item["time_msc"] for item in store.get_archive_ticks(aid, 0, 10)["values"]], [1001, 3_600_999, 3_601_000])


if __name__ == "__main__":
    unittest.main()
