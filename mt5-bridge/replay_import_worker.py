"""Read-only MT5 history importer, isolated from the live/execution bridge."""
from __future__ import annotations

import csv
import json
import math
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# -I protects against external PYTHONPATH, but the trusted bundled siblings
# must be available. This worker never imports the execution service.
sys.path.insert(0, str(Path(__file__).resolve().parent))
import replay_store
import numpy as np


def emit(**values):
    print(json.dumps(values, ensure_ascii=False, allow_nan=False), flush=True)


def csv_blocks(path: Path, offset_minutes: int):
    with path.open("rb") as stream:
        prefix = stream.read(4)
    encoding = "utf-16" if prefix.startswith((b"\xff\xfe", b"\xfe\xff")) else "utf-8-sig"
    dtype = [(name, "<i8" if name in {"time_msc", "volume", "flags"} else "<f8") for name in ("time_msc", "bid", "ask", "last", "volume", "volume_real", "flags")]
    with path.open(encoding=encoding, newline="") as stream:
        header = stream.readline()
        delimiter = "\t" if "\t" in header else ";" if ";" in header else ","
        stream.seek(0)
        reader = csv.DictReader(stream, delimiter=delimiter)
        names = {name.strip().strip("<>").lower(): name for name in reader.fieldnames or []}
        if len(names) != len(reader.fieldnames or []):
            raise ValueError("Nagłówek eksportu zawiera powtórzone nazwy kolumn.")
        if not {"date", "time", "bid", "ask"} <= names.keys():
            raise ValueError("Wymagam eksportu TICKÓW MT5: DATE, TIME, BID, ASK. Plik świec OHLC nie zawiera rzeczywistych ticków.")
        previous = {"bid": None, "ask": None, "last": 0.0, "volume": 0.0}
        date_cache = {}
        batch = []
        previous_ms = 0
        for line, row in enumerate(reader, 2):
            try:
                if None in row or any(value is None for value in row.values()):
                    raise ValueError("Nieprawidłowa liczba kolumn")
                values = {key: row[name].strip() for key, name in names.items()}
                date = values["date"]
                if date not in date_cache:
                    date_cache[date] = int(datetime.strptime(date, "%Y.%m.%d").replace(tzinfo=timezone.utc).timestamp()) * 1000 - offset_minutes * 60_000
                parts = values["time"].split(":")
                if len(parts) != 3:
                    raise ValueError("Czas musi zawierać HH:MM:SS.mmm")
                second_parts = parts[2].split(".")
                millis = second_parts[1] if len(second_parts) == 2 else ""
                if len(second_parts) > 2 or len(millis) > 3:
                    raise ValueError("Nieprawidłowa dokładność czasu")
                hour, minute, second = int(parts[0]), int(parts[1]), int(second_parts[0])
                if not (0 <= hour < 24 and 0 <= minute < 60 and 0 <= second < 60):
                    raise ValueError("Czas poza zakresem")
                timestamp = date_cache[date] + (hour * 3600 + minute * 60 + second) * 1000 + int(millis.ljust(3, "0") or "0")
                if timestamp <= 0 or timestamp < previous_ms:
                    raise ValueError("Ticki nie są uporządkowane chronologicznie")
                flags = 0
                for name, bit in (("bid", 2), ("ask", 4), ("last", 8), ("volume", 16)):
                    if values.get(name, "") != "":
                        number = float(values[name])
                        if not math.isfinite(number) or number < 0:
                            raise ValueError("Nieprawidłowa cena lub wolumen")
                        if previous[name] != number:
                            flags |= bit
                        previous[name] = number
                if previous["bid"] is None or previous["ask"] is None:
                    raise ValueError("Pierwszy tick musi określać Bid i Ask; nie mogę odtworzyć brakującej ceny")
                if values.get("flags", ""):
                    flags = int(values["flags"])
                volume_real = float(values.get("volume_real") or previous["volume"])
                batch.append((timestamp, previous["bid"], previous["ask"], previous["last"], int(previous["volume"]), volume_real, flags))
                previous_ms = timestamp
            except (ValueError, TypeError, OverflowError) as error:
                raise ValueError(f"Wiersz {line}: {error}") from error
            if len(batch) == 100_000:
                yield np.array(batch, dtype=dtype)
                batch.clear()
        if batch:
            yield np.array(batch, dtype=dtype)


def run(request):
    replay_store.attach_database(request["database_path"])
    archive_id = request["archive_id"]
    archive = replay_store.get_archive(archive_id)
    if not archive or archive["status"] != "importing":
        raise ValueError("Nie znaleziono aktywnego importu.")
    from_ms, to_ms = archive["from_ms"], archive["to_ms"]
    if request.get("file_name"):
        inbox = (replay_store.database_path().parent / "inbox").resolve()
        path = (inbox / request["file_name"]).resolve()
        if path.parent != inbox or path.suffix.lower() not in {".csv", ".tsv", ".txt"}:
            raise ValueError("Plik musi znajdować się bezpośrednio w folderze importu.")
        initial_stat = path.stat()
        emit(stage="file_read", progress=0)
        for rows in csv_blocks(path, request["utc_offset_minutes"]):
            started = time.monotonic()
            added, latest = replay_store.append_ticks(archive_id, rows, from_ms, to_ms)
            emit(stage="file_read", added=added, completed_through_ms=min(to_ms, int(rows["time_msc"][-1])), last_chunk_write_ms=round((time.monotonic()-started)*1000), last_tick_ms=latest)
        final_stat = path.stat()
        if (initial_stat.st_size, initial_stat.st_mtime_ns) != (final_stat.st_size, final_stat.st_mtime_ns):
            raise ValueError("Plik zmienił się podczas odczytu. Importuj jego zamknięty eksport.")
    else:
        import MetaTrader5 as mt5
        executable = Path(request["terminal_path"]) / "terminal64.exe"
        if not executable.is_file() or not mt5.initialize(str(executable)):
            raise ValueError(f"Nie mogę podłączyć importera do wskazanego MT5: {mt5.last_error()}")
        try:
            cursor_ms = from_ms
            chunk_ms = 3_600_000
            while cursor_ms <= to_ms:
                terminal, account = mt5.terminal_info(), mt5.account_info()
                if terminal is None or account is None or not terminal.connected or str(account.server) != archive["server"] or str(terminal.company) != archive["broker"]:
                    raise ValueError("Połączenie lub źródło brokera zmieniło się podczas importu.")
                end_ms = min(cursor_ms + chunk_ms - 1, to_ms)
                emit(stage="mt5_fetch", range_from_ms=cursor_ms, range_to_ms=end_ms)
                started = time.monotonic()
                # The Python MT5 API accepts times at second precision. Request
                # the enclosing seconds, then filter exactly in milliseconds.
                rows = mt5.copy_ticks_range(archive["symbol"], datetime.fromtimestamp(cursor_ms // 1000, timezone.utc), datetime.fromtimestamp((end_ms // 1000) + 1, timezone.utc), mt5.COPY_TICKS_ALL)
                fetch_ms = round((time.monotonic()-started)*1000)
                if rows is None:
                    raise ValueError(f"MT5 nie zwrócił historii: {mt5.last_error()}")
                emit(stage="archive_write", last_chunk_fetch_ms=fetch_ms)
                started = time.monotonic()
                added, latest = replay_store.append_ticks(archive_id, rows, cursor_ms, end_ms)
                emit(stage="archive_write", added=added, completed_through_ms=end_ms, last_chunk_fetch_ms=fetch_ms, last_chunk_write_ms=round((time.monotonic()-started)*1000), last_tick_ms=latest)
                chunk_ms = 86_400_000 if not added else max(1_800_000, min(86_400_000, int(chunk_ms * max(0.35, min(8, 500_000 / added)))))
                cursor_ms = end_ms + 1
        finally:
            mt5.shutdown()
    emit(stage="sha256_finalize", progress=99)
    started = time.monotonic()
    archive = replay_store.finish_archive(archive_id)
    emit(complete=True, archive=archive, finalize_ms=round((time.monotonic()-started)*1000))


if __name__ == "__main__":
    try:
        run(json.loads(sys.stdin.readline()))
    except Exception as error:
        emit(error=str(error))
        raise SystemExit(1)
