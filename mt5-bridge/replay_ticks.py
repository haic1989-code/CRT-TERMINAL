"""Immutable, seekable real-tick files. No MT5 or third-party dependency on reads."""
from __future__ import annotations

import hashlib
import os
import struct
import uuid
from pathlib import Path

FORMAT = "crt-ticks-le-v1"
RECORD = struct.Struct("<qdddqdq")
FIELDS = ("time_msc", "bid", "ask", "last", "volume", "volume_real", "flags")


def tick_path(database: Path, archive_id: str, partial: bool = False) -> Path:
    # Never trust a filename supplied by a manifest or HTTP client.
    if str(uuid.UUID(archive_id)) != archive_id:
        raise ValueError("Nieprawidłowy identyfikator archiwum.")
    return database.parent / "ticks" / (archive_id + (".part" if partial else ".crt-ticks"))


def validate_file(path: Path, count: int) -> None:
    if not path.is_file() or path.stat().st_size != count * RECORD.size:
        raise ValueError("Plik ticków jest niekompletny albo uszkodzony.")


def iter_ticks(path: Path, count: int, offset: int = 0, limit: int | None = None, expected_sha256: str | None = None):
    validate_file(path, count)
    offset = max(0, int(offset))
    remaining = max(0, count - offset)
    if limit is not None:
        remaining = min(remaining, max(0, limit))
    if expected_sha256 and (offset or limit is not None):
        raise ValueError("Weryfikacja SHA-256 wymaga całego archiwum.")
    digest = hashlib.sha256() if expected_sha256 else None
    with path.open("rb", buffering=1024 * 1024) as stream:
        stream.seek(offset * RECORD.size)
        sequence = offset
        while remaining:
            size = min(remaining, 8192)
            block = stream.read(size * RECORD.size)
            if len(block) != size * RECORD.size:
                raise ValueError("Odczyt pliku ticków został przerwany.")
            if digest is not None:
                digest.update(block)
            for values in RECORD.iter_unpack(block):
                yield {"sequence": sequence, **dict(zip(FIELDS, values))}
                sequence += 1
            remaining -= size
    if digest is not None and digest.hexdigest() != expected_sha256:
        raise ValueError("Suma SHA-256 ticków nie zgadza się z manifestem.")


class TickWriter:
    def __init__(self, database: Path, archive_id: str):
        self.partial = tick_path(database, archive_id, True)
        self.final = tick_path(database, archive_id)
        self.partial.parent.mkdir(parents=True, exist_ok=True)
        self.stream = self.partial.open("xb", buffering=1024 * 1024)
        self.digest = hashlib.sha256()
        self.count = 0
        self.last_ms = None

    def append(self, rows, from_ms: int, to_ms: int):
        # MT5 already returns a structured NumPy array. Validate whole columns
        # and copy to the canonical packed layout, rather than boxing each tick.
        import numpy as np
        dtype = np.dtype([(name, "<i8" if name in {"time_msc", "volume", "flags"} else "<f8") for name in FIELDS])
        if not isinstance(rows, np.ndarray):
            rows = np.array([tuple(row[name] for name in FIELDS) for row in rows], dtype=dtype)
        selected = rows[(rows["time_msc"] >= from_ms) & (rows["time_msc"] <= to_ms)]
        if not len(selected):
            return 0, self.last_ms
        times = selected["time_msc"]
        if times[0] <= 0 or np.any(times[1:] < times[:-1]) or (self.last_ms is not None and times[0] < self.last_ms):
            raise ValueError("MT5 zwrócił ticki w nieprawidłowej kolejności czasu.")
        for name in ("bid", "ask", "last", "volume_real"):
            values = selected[name]
            if np.any(~np.isfinite(values)) or np.any(values < 0):
                raise ValueError("Nieprawidłowa cena lub wolumen ticka.")
        if np.any(selected["volume"] < 0) or np.any(selected["volume"] > np.iinfo(np.int64).max):
            raise ValueError("Nieprawidłowy wolumen ticka.")
        if np.any(selected["flags"] < 0) or np.any(selected["flags"] > np.iinfo(np.uint32).max):
            raise ValueError("Nieprawidłowe flagi ticka.")
        if np.any((selected["bid"] > 0) & (selected["ask"] > 0) & (selected["ask"] < selected["bid"])):
            raise ValueError("Cena Ask ticka jest niższa niż Bid.")
        packed = np.empty(len(selected), dtype=dtype)
        for name in FIELDS:
            packed[name] = selected[name]
        block = memoryview(packed).cast("B")
        written = self.stream.write(block)
        if written != len(block):
            raise OSError("Niepełny zapis pliku ticków.")
        self.digest.update(block)
        self.stream.flush()
        self.count += len(selected)
        self.last_ms = int(times[-1])
        return len(selected), self.last_ms

    def finish(self):
        self.stream.flush()
        os.fsync(self.stream.fileno())
        self.stream.close()
        validate_file(self.partial, self.count)
        os.replace(self.partial, self.final)
        return self.digest.hexdigest()

    def close(self):
        self.stream.close()
