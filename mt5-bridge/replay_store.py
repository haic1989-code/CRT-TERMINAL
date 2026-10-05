from __future__ import annotations

import hashlib
import json
import math
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


_db_path: Path | None = None
_initialized = False
_db_lock = threading.RLock()


def initialize(data_dir: str | Path) -> Path:
    """Prepare the local SQLite archive and mark abandoned imports incomplete."""
    global _db_path, _initialized
    with _db_lock:
        root = Path(data_dir) / "FXReplay"
        root.mkdir(parents=True, exist_ok=True)
        _db_path = root / "archives.crt-replay"
        with _connection() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS archives (
                    id TEXT PRIMARY KEY,
                    status TEXT NOT NULL,
                    requested_symbol TEXT NOT NULL,
                    symbol TEXT NOT NULL,
                    broker TEXT NOT NULL,
                    server TEXT NOT NULL,
                    from_ms INTEGER NOT NULL,
                    to_ms INTEGER NOT NULL,
                    tick_count INTEGER NOT NULL DEFAULT 0,
                    sha256 TEXT,
                    manifest_json TEXT NOT NULL,
                    error TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS ticks (
                    archive_id TEXT NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
                    sequence INTEGER NOT NULL,
                    time_msc INTEGER NOT NULL,
                    bid REAL NOT NULL,
                    ask REAL NOT NULL,
                    last REAL NOT NULL,
                    volume INTEGER NOT NULL,
                    volume_real REAL NOT NULL,
                    flags INTEGER NOT NULL,
                    PRIMARY KEY (archive_id, sequence)
                );
                CREATE INDEX IF NOT EXISTS idx_ticks_archive_time
                    ON ticks(archive_id, time_msc, sequence);
                CREATE INDEX IF NOT EXISTS idx_archives_status_created
                    ON archives(status, created_at DESC);
                CREATE TABLE IF NOT EXISTS strategies (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    source TEXT NOT NULL,
                    sha256 TEXT NOT NULL,
                    api_version INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS replay_runs (
                    id TEXT PRIMARY KEY,
                    archive_id TEXT NOT NULL REFERENCES archives(id),
                    strategy_id TEXT NOT NULL REFERENCES strategies(id),
                    status TEXT NOT NULL,
                    params_json TEXT NOT NULL,
                    report_json TEXT,
                    error TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_replay_runs_created
                    ON replay_runs(created_at DESC);
                CREATE TABLE IF NOT EXISTS replay_run_events (
                    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                    run_id TEXT NOT NULL REFERENCES replay_runs(id) ON DELETE CASCADE,
                    payload_json TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_replay_events_run_sequence
                    ON replay_run_events(run_id, sequence);
            """)
            db.execute("PRAGMA journal_mode=WAL")
            if not _initialized:
                db.execute(
                    "UPDATE archives SET status='interrupted', error='Aplikacja została zamknięta przed końcem importu.', updated_at=? WHERE status='importing'",
                    (_now(),),
                )
                db.execute(
                    "UPDATE replay_runs SET status='failed', error='Proces FX Replay został przerwany przy zamknięciu aplikacji.', updated_at=? WHERE status IN ('queued','running')",
                    (_now(),),
                )
                _initialized = True
        return _db_path


def database_path() -> Path:
    if _db_path is None:
        raise RuntimeError("Replay archive store is not initialized")
    return _db_path


def _connect() -> sqlite3.Connection:
    if _db_path is None:
        raise RuntimeError("Replay archive store is not initialized")
    db = sqlite3.connect(_db_path, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    db.execute("PRAGMA busy_timeout=10000")
    return db


@contextmanager
def _connection():
    db = _connect()
    try:
        with db:
            yield db
    finally:
        db.close()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def create_archive(
    requested_symbol: str,
    symbol: str,
    broker: str,
    server: str,
    from_ms: int,
    to_ms: int,
    symbol_info: dict[str, Any],
) -> str:
    archive_id = str(uuid.uuid4())
    now = _now()
    manifest = {
        "format_version": 1,
        "source": "MetaTrader5.copy_ticks_range",
        "completeness": "importing",
        "requested_symbol": requested_symbol,
        "symbol": symbol,
        "broker": broker,
        "server": server,
        "timezone": "UTC",
        "from_ms": from_ms,
        "to_ms": to_ms,
        "symbol_info": symbol_info,
    }
    with _db_lock, _connection() as db:
        db.execute(
            "INSERT INTO archives(id,status,requested_symbol,symbol,broker,server,from_ms,to_ms,manifest_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            (archive_id, "importing", requested_symbol, symbol, broker, server, from_ms, to_ms, json.dumps(manifest, ensure_ascii=False, separators=(",", ":")), now, now),
        )
    return archive_id


def append_ticks(archive_id: str, rows: Iterable[Any], expected_from_ms: int, expected_to_ms: int) -> tuple[int, int | None]:
    """Validate and append one fetched range without altering broker tick values."""
    normalized: list[tuple[int, int, float, float, float, int, float, int]] = []
    previous_ms: int | None = None
    for row in rows:
        time_msc = int(row["time_msc"])
        bid = float(row["bid"])
        ask = float(row["ask"])
        last = float(row["last"])
        volume = int(row["volume"])
        volume_real = float(row["volume_real"])
        flags = int(row["flags"])
        if time_msc < expected_from_ms or time_msc > expected_to_ms:
            continue
        if time_msc <= 0 or (previous_ms is not None and time_msc < previous_ms):
            raise ValueError("MT5 zwrócił ticki w nieprawidłowej kolejności czasu.")
        if not all(math.isfinite(value) for value in (bid, ask, last, volume_real)):
            raise ValueError("MT5 zwrócił nieprawidłową cenę lub wolumen ticka.")
        if min(bid, ask, last, volume_real) < 0 or volume < 0 or (bid > 0 and ask > 0 and ask < bid):
            raise ValueError("MT5 zwrócił nieprawidłowe wartości ticka.")
        normalized.append((0, time_msc, bid, ask, last, volume, volume_real, flags))
        previous_ms = time_msc

    if not normalized:
        with _db_lock, _connection() as db:
            latest = db.execute("SELECT MAX(time_msc) FROM ticks WHERE archive_id=?", (archive_id,)).fetchone()[0]
        return 0, int(latest) if latest is not None else None

    with _db_lock, _connection() as db:
        state = db.execute("SELECT tick_count FROM archives WHERE id=? AND status='importing'", (archive_id,)).fetchone()
        if state is None:
            raise ValueError("Archiwum nie jest już w stanie importu.")
        sequence = int(state[0])
        previous = db.execute(
            "SELECT time_msc FROM ticks WHERE archive_id=? ORDER BY sequence DESC LIMIT 1",
            (archive_id,),
        ).fetchone()
        if previous is not None and normalized[0][1] < int(previous[0]):
            raise ValueError("Kolejny zakres MT5 cofnął czas względem wcześniej pobranych ticków.")
        for index, row in enumerate(normalized):
            normalized[index] = (sequence + index, *row[1:])
        db.executemany(
            "INSERT INTO ticks(archive_id,sequence,time_msc,bid,ask,last,volume,volume_real,flags) VALUES(?,?,?,?,?,?,?,?,?)",
            [(archive_id, *row) for row in normalized],
        )
        total = sequence + len(normalized)
        latest_ms = normalized[-1][1]
        db.execute("UPDATE archives SET tick_count=?,updated_at=? WHERE id=?", (total, _now(), archive_id))
    return len(normalized), latest_ms


def finish_archive(archive_id: str) -> dict[str, Any]:
    with _db_lock, _connection() as db:
        archive = db.execute("SELECT * FROM archives WHERE id=? AND status='importing'", (archive_id,)).fetchone()
        if archive is None:
            raise ValueError("Nie znaleziono aktywnego importu.")
        if int(archive["tick_count"]) == 0:
            raise ValueError("MT5 nie zwrócił ticków w wybranym zakresie.")
        digest = hashlib.sha256()
        cursor = db.execute(
            "SELECT time_msc,bid,ask,last,volume,volume_real,flags FROM ticks WHERE archive_id=? ORDER BY sequence",
            (archive_id,),
        )
        for row in cursor:
            digest.update(json.dumps(list(row), separators=(",", ":"), allow_nan=False).encode("ascii"))
            digest.update(b"\n")
        manifest = json.loads(archive["manifest_json"])
        manifest["completeness"] = "all_requested_ranges_returned"
        manifest["tick_count"] = int(archive["tick_count"])
        manifest["sha256"] = digest.hexdigest()
        manifest["completed_at"] = _now()
        db.execute(
            "UPDATE archives SET status='complete',sha256=?,manifest_json=?,updated_at=?,error=NULL WHERE id=?",
            (digest.hexdigest(), json.dumps(manifest, ensure_ascii=False, separators=(",", ":")), _now(), archive_id),
        )
    return get_archive(archive_id) or {}


def set_archive_state(archive_id: str, status: str, error: str | None = None) -> None:
    if status not in {"failed", "cancelled", "interrupted"}:
        raise ValueError("Invalid incomplete archive state")
    with _db_lock, _connection() as db:
        row = db.execute("SELECT manifest_json FROM archives WHERE id=? AND status='importing'", (archive_id,)).fetchone()
        if row is None:
            return
        manifest = json.loads(row[0])
        manifest["completeness"] = status
        db.execute(
            "UPDATE archives SET status=?,error=?,manifest_json=?,updated_at=? WHERE id=? AND status='importing'",
            (status, (error or "")[:1000] or None, json.dumps(manifest, ensure_ascii=False, separators=(",", ":")), _now(), archive_id),
        )


def _archive_payload(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "status": row["status"],
        "requested_symbol": row["requested_symbol"],
        "symbol": row["symbol"],
        "broker": row["broker"],
        "server": row["server"],
        "from_ms": int(row["from_ms"]),
        "to_ms": int(row["to_ms"]),
        "tick_count": int(row["tick_count"]),
        "sha256": row["sha256"],
        "manifest": json.loads(row["manifest_json"]),
        "error": row["error"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def get_archive(archive_id: str) -> dict[str, Any] | None:
    with _db_lock, _connection() as db:
        row = db.execute("SELECT * FROM archives WHERE id=?", (archive_id,)).fetchone()
    return _archive_payload(row) if row else None


def list_archives() -> list[dict[str, Any]]:
    with _db_lock, _connection() as db:
        rows = db.execute("SELECT * FROM archives ORDER BY created_at DESC").fetchall()
    return [_archive_payload(row) for row in rows]


def get_archive_ticks(archive_id: str, offset: int, limit: int) -> dict[str, Any] | None:
    with _db_lock, _connection() as db:
        archive = db.execute("SELECT status,tick_count FROM archives WHERE id=?", (archive_id,)).fetchone()
        if archive is None:
            return None
        if archive["status"] != "complete":
            raise ValueError("Niekompletnego archiwum nie można użyć do replay.")
        rows = db.execute(
            "SELECT sequence,time_msc,bid,ask,last,volume,volume_real,flags FROM ticks WHERE archive_id=? ORDER BY sequence LIMIT ? OFFSET ?",
            (archive_id, limit, offset),
        ).fetchall()
    return {"offset": offset, "limit": limit, "total": int(archive["tick_count"]), "values": [dict(row) for row in rows]}


def save_strategy(name: str, source: str) -> dict[str, Any]:
    strategy_id = str(uuid.uuid4())
    digest = hashlib.sha256(source.encode("utf-8")).hexdigest()
    now = _now()
    with _db_lock, _connection() as db:
        db.execute(
            "INSERT INTO strategies(id,name,source,sha256,api_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
            (strategy_id, name, source, digest, 1, now, now),
        )
    return get_strategy(strategy_id) or {}


def _strategy_payload(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"], "name": row["name"], "sha256": row["sha256"],
        "api_version": int(row["api_version"]), "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def get_strategy(strategy_id: str) -> dict[str, Any] | None:
    with _db_lock, _connection() as db:
        row = db.execute("SELECT * FROM strategies WHERE id=?", (strategy_id,)).fetchone()
    return _strategy_payload(row) if row else None


def get_strategy_source(strategy_id: str) -> str | None:
    with _db_lock, _connection() as db:
        row = db.execute("SELECT source FROM strategies WHERE id=?", (strategy_id,)).fetchone()
    return str(row[0]) if row else None


def list_strategies() -> list[dict[str, Any]]:
    with _db_lock, _connection() as db:
        rows = db.execute("SELECT * FROM strategies ORDER BY created_at DESC").fetchall()
    return [_strategy_payload(row) for row in rows]


def create_run(run_id: str, archive_id: str, strategy_id: str, params: dict[str, Any]) -> None:
    now = _now()
    with _db_lock, _connection() as db:
        db.execute(
            "INSERT INTO replay_runs(id,archive_id,strategy_id,status,params_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
            (run_id, archive_id, strategy_id, "queued", json.dumps(params, ensure_ascii=False, allow_nan=False), now, now),
        )


def update_run(run_id: str, status: str, report: dict[str, Any] | None = None, error: str | None = None) -> None:
    if status not in {"running", "complete", "failed", "cancelled"}:
        raise ValueError("Invalid replay run state")
    with _db_lock, _connection() as db:
        db.execute(
            "UPDATE replay_runs SET status=?,report_json=?,error=?,updated_at=? WHERE id=?",
            (status, json.dumps(report, ensure_ascii=False, allow_nan=False) if report is not None else None, (error or "")[:1000] or None, _now(), run_id),
        )


def get_run(run_id: str) -> dict[str, Any] | None:
    with _db_lock, _connection() as db:
        row = db.execute("SELECT * FROM replay_runs WHERE id=?", (run_id,)).fetchone()
    if row is None:
        return None
    return {
        "id": row["id"], "archive_id": row["archive_id"], "strategy_id": row["strategy_id"],
        "status": row["status"], "params": json.loads(row["params_json"]),
        "report": json.loads(row["report_json"]) if row["report_json"] else None,
        "error": row["error"], "created_at": row["created_at"], "updated_at": row["updated_at"],
    }


def append_run_events(run_id: str, events: Iterable[dict[str, Any]]) -> int:
    payloads = [(run_id, json.dumps(event, ensure_ascii=False, allow_nan=False, separators=(",", ":"))) for event in events]
    if not payloads:
        return 0
    with _db_lock, _connection() as db:
        db.executemany("INSERT INTO replay_run_events(run_id,payload_json) VALUES(?,?)", payloads)
    return len(payloads)


def get_run_events(run_id: str, offset: int, limit: int) -> dict[str, Any] | None:
    with _db_lock, _connection() as db:
        run = db.execute("SELECT id FROM replay_runs WHERE id=?", (run_id,)).fetchone()
        if run is None:
            return None
        total = int(db.execute("SELECT COUNT(*) FROM replay_run_events WHERE run_id=?", (run_id,)).fetchone()[0])
        rows = db.execute(
            "SELECT sequence,payload_json FROM replay_run_events WHERE run_id=? ORDER BY sequence LIMIT ? OFFSET ?",
            (run_id, limit, offset),
        ).fetchall()
    return {"offset": offset, "limit": limit, "total": total, "values": [{"sequence": int(row["sequence"]), **json.loads(row["payload_json"])} for row in rows]}
