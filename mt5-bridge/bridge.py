from __future__ import annotations

import os
import ast
import math
import subprocess
import sys
import threading
import secrets
import json
import socket
import time
import uuid
from pathlib import Path
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlsplit

import MetaTrader5 as mt5
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from execution import ExecutionService
from quotes import quote_metadata
import replay_store
import replay_finance

HOST = "127.0.0.1"
PORT = int(os.getenv("CRT_TERMINAL_MT5_PORT", os.getenv("SMARTFLOW_MT5_PORT", "8765")))
TERMINAL_PATH = os.getenv("MT5_TERMINAL_PATH", "").strip() or None
PREFERRED_SYMBOL = os.getenv("MT5_SYMBOL", "XAUUSD").strip() or "XAUUSD"
PROTOCOL_VERSION = 5
BRIDGE_ID = "CRT_TERMINAL_MT5"
OWNER = os.getenv("CRT_TERMINAL_BRIDGE_OWNER", os.getenv("SMARTFLOW_BRIDGE_OWNER", "manual"))
_identity: tuple[int, str, str] | None = None
_next_initialize = 0.0
_daily_cache: tuple[float, Any] | None = None

DEFAULT_ALLOWED_ORIGINS = (
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.1:5174",
    "http://127.0.0.1:4173",
    "http://localhost:4173",
    # Tauri 2's default Windows app origin. Keep it exact; never use a wildcard.
    "http://tauri.localhost",
)


def _build_allowed_origins(extra_origins: str | None = None) -> list[str]:
    configured = os.getenv("CRT_TERMINAL_ALLOWED_ORIGINS", os.getenv("SMARTFLOW_ALLOWED_ORIGINS", "")) if extra_origins is None else extra_origins
    origins = list(DEFAULT_ALLOWED_ORIGINS)
    for raw_origin in configured.split(","):
        origin = raw_origin.strip()
        if not origin:
            continue
        parsed = urlsplit(origin)
        try:
            parsed.port
        except ValueError as error:
            raise ValueError(f"Invalid CRT_TERMINAL_ALLOWED_ORIGINS entry: {origin!r}") from error
        canonical_origin = f"{parsed.scheme}://{parsed.netloc}"
        if (
            "*" in origin
            or parsed.scheme not in {"http", "https"}
            or not parsed.netloc
            or parsed.username is not None
            or parsed.password is not None
            or parsed.path
            or parsed.query
            or parsed.fragment
            or origin != canonical_origin
        ):
            raise ValueError(
                "CRT_TERMINAL_ALLOWED_ORIGINS must contain exact HTTP(S) origins without paths or wildcards."
            )
        origins.append(origin)
    return list(dict.fromkeys(origins))


ALLOWED_ORIGINS = _build_allowed_origins()

TIMEFRAMES = {
    "M1": mt5.TIMEFRAME_M1,
    "M5": mt5.TIMEFRAME_M5,
    "M15": mt5.TIMEFRAME_M15,
    "M30": mt5.TIMEFRAME_M30,
    "H1": mt5.TIMEFRAME_H1,
    "H4": mt5.TIMEFRAME_H4,
    "D1": mt5.TIMEFRAME_D1,
    "W1": mt5.TIMEFRAME_W1,
}

class _ApiLock:
    """Serialize MT5 IPC without letting queued HTTP calls wait indefinitely."""
    def __init__(self):
        self.lock = threading.RLock()

    def __enter__(self):
        if not self.lock.acquire(timeout=3):
            raise HTTPException(status_code=503, detail={"error": "MT5_API_BUSY", "hint": "MT5 nie odpowiada. Odczyt zostanie ponowiony."})
        return self

    def __exit__(self, *_args):
        self.lock.release()


_lock = _ApiLock()
_resolved_symbol: str | None = None
_closing = threading.Event()
_shutdown_token = secrets.token_urlsafe(32)
_instance = secrets.token_hex(16)
_execution_token = secrets.token_urlsafe(32) if OWNER != "manual" else ""
_server: Any = None

_configured_data_dir = os.getenv("CRT_TERMINAL_DATA_DIR", "").strip()
if _configured_data_dir:
    _replay_data_dir = Path(_configured_data_dir)
elif os.getenv("LOCALAPPDATA"):
    _replay_data_dir = Path(os.environ["LOCALAPPDATA"]) / "CRT Terminal"
else:
    _replay_data_dir = Path.home() / ".local" / "share" / "CRT Terminal"
replay_store.initialize(_replay_data_dir)

_replay_jobs_lock = threading.RLock()
_replay_jobs: dict[str, dict[str, Any]] = {}
_active_replay_job: str | None = None
_replay_runs_lock = threading.RLock()
_replay_runs: dict[str, dict[str, Any]] = {}
_active_replay_run: str | None = None

app = FastAPI(
    title="CRT Terminal MT5 Local Bridge",
    version="0.1.0",
    docs_url=None,
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["X-CRT-Terminal-MT5", "X-CRT-Protocol", "X-CRT-Instance"],
)


@app.middleware("http")
async def local_network_headers(request: Request, call_next):
    response = await call_next(request)
    origin = request.headers.get("origin")
    private_network_preflight = (
        request.method == "OPTIONS"
        and request.headers.get("access-control-request-private-network", "").lower() == "true"
    )
    if origin in ALLOWED_ORIGINS and private_network_preflight:
        response.headers["Access-Control-Allow-Private-Network"] = "true"
    response.headers["X-CRT-Terminal-MT5"] = "demo-manual" if _execution_token else "read-only"
    response.headers["X-CRT-Protocol"] = str(PROTOCOL_VERSION)
    response.headers["X-CRT-Instance"] = _instance
    response.headers["Cache-Control"] = "no-store"
    return response


def _last_error() -> dict[str, Any]:
    code, description = mt5.last_error()
    return {"code": code, "description": description}


def _daily_win_rate(deals: Any, open_position_ids: set[int]) -> float | None:
    exit_entries = {mt5.DEAL_ENTRY_OUT, mt5.DEAL_ENTRY_OUT_BY, mt5.DEAL_ENTRY_INOUT}
    closing_position_ids: set[int] = set()
    daily_net_by_position: dict[int, float] = {}
    for deal in deals or ():
        position_id = int(getattr(deal, "position_id", 0) or 0)
        if position_id <= 0:
            continue
        daily_net_by_position[position_id] = daily_net_by_position.get(position_id, 0.0) + sum(
            float(getattr(deal, field, 0.0) or 0.0) for field in ("profit", "swap", "commission", "fee")
        )
        if getattr(deal, "entry", None) in exit_entries:
            closing_position_ids.add(position_id)

    completed_position_ids = closing_position_ids - open_position_ids
    if not completed_position_ids:
        return None
    winning_positions = sum(daily_net_by_position[position_id] > 0 for position_id in completed_position_ids)
    return round(winning_positions / len(completed_position_ids) * 100, 1)


def _initialize() -> bool:
    if TERMINAL_PATH:
        return bool(mt5.initialize(TERMINAL_PATH, timeout=5000))
    return bool(mt5.initialize(timeout=5000))


def _required(value: Any, error: str) -> Any:
    # Empty collections are valid; None is the MT5 API's error sentinel.
    if value is None:
        raise HTTPException(status_code=503, detail={"error": error, "last_error": _last_error()})
    return value


def _ensure_connected() -> None:
    global _identity, _next_initialize, _resolved_symbol, _daily_cache
    with _lock:
        if _closing.is_set():
            raise HTTPException(status_code=503, detail={"error": "BRIDGE_SHUTTING_DOWN"})
        terminal = mt5.terminal_info()
        account = mt5.account_info()
        if terminal is None or account is None:
            if time.monotonic() < _next_initialize:
                raise HTTPException(status_code=503, detail={"error": "MT5_RECONNECT_PENDING"})
            _next_initialize = time.monotonic() + 2
            mt5.shutdown()
            _resolved_symbol = None
            _daily_cache = None
            initialized = _initialize()
            _next_initialize = time.monotonic() + 2
            if not initialized:
                raise HTTPException(status_code=503, detail={"error": "MT5_INITIALIZE_FAILED", "last_error": _last_error(), "hint": "Uruchom MetaTrader 5 i zaloguj konto brokerskie."})
            terminal = mt5.terminal_info()
            account = mt5.account_info()
        if terminal is None or account is None:
            raise HTTPException(
                status_code=503,
                detail={
                    "error": "MT5_ACCOUNT_NOT_CONNECTED",
                    "last_error": _last_error(),
                    "hint": "Uruchom MetaTrader 5 i zaloguj konto brokerskie.",
                },
            )

        if not terminal.connected:
            raise HTTPException(
                status_code=503,
                detail={
                    "error": "MT5_BROKER_DISCONNECTED",
                    "last_error": _last_error(),
                    "hint": "MT5 utracił połączenie z brokerem. Oczekiwanie na powrót połączenia.",
                },
            )
        identity = (int(account.login), account.server, os.path.normcase(os.path.abspath(terminal.path)))
        if TERMINAL_PATH and identity[2] != os.path.normcase(os.path.abspath(os.path.dirname(TERMINAL_PATH))):
            raise HTTPException(status_code=409, detail={"error": "MT5_TERMINAL_MISMATCH"})
        if _identity is not None and identity != _identity:
            raise HTTPException(status_code=409, detail={"error": "MT5_ACCOUNT_CHANGED", "hint": "Zmieniono konto lub terminal MT5. Uruchom ponownie CRT Terminal, aby zatwierdzić nową sesję."})
        _identity = identity


def _score_symbol(name: str, preferred: str) -> tuple[int, int, str]:
    upper = name.upper()
    preferred_upper = preferred.upper()

    if upper == preferred_upper:
        return (0, len(name), name)
    if upper == "XAUUSD":
        return (1, len(name), name)
    if upper.startswith("XAUUSD"):
        return (2, len(name), name)
    if "XAUUSD" in upper:
        return (3, len(name), name)
    if "XAU" in upper and "USD" in upper:
        return (4, len(name), name)
    if "GOLD" in upper and "USD" in upper:
        return (5, len(name), name)
    if "GOLD" in upper:
        return (6, len(name), name)
    return (99, len(name), name)


def _resolve_symbol() -> str:
    global _resolved_symbol

    with _lock:
        _ensure_connected()

        if _resolved_symbol:
            info = mt5.symbol_info(_resolved_symbol)
            if info is not None:
                if not mt5.symbol_select(_resolved_symbol, True):
                    raise HTTPException(status_code=503, detail={"error": "SYMBOL_SELECT_FAILED", "symbol": _resolved_symbol, "last_error": _last_error()})
                return _resolved_symbol
        _resolved_symbol = _resolve_requested_symbol(PREFERRED_SYMBOL)
        return _resolved_symbol


def _resolve_requested_symbol(requested: str | None = None) -> str:
    requested = (requested or PREFERRED_SYMBOL).strip() or PREFERRED_SYMBOL
    _ensure_connected()
    key = requested.upper().strip()
    direct = mt5.symbol_info(requested)
    if direct is not None:
        if not mt5.symbol_select(direct.name, True):
            raise HTTPException(status_code=503, detail={"error": "SYMBOL_SELECT_FAILED", "symbol": direct.name, "last_error": _last_error()})
        return direct.name
    aliases = {
        "XAUUSD": ("*XAU*", "*GOLD*"),
        "BTCUSD": ("*BTC*",),
        "DJ30": ("*DJ30*", "*US30*", "*DOW*", "*WS30*", "*DJI*"),
    }
    patterns = aliases.get(key, (f"*{key}*",))
    candidates: list[str] = []
    for pattern in patterns:
        items = _required(mt5.symbols_get(pattern), "SYMBOLS_UNAVAILABLE")
        if items:
            for item in items:
                name = item.name.upper()
                # Accept an exact core with a broker suffix only. GOLD additionally
                # requires matching base/profit currencies from broker metadata.
                valid = name.startswith(key) and (len(name) == len(key) or not name[len(key)].isdigit())
                if key == "XAUUSD":
                    valid = ("XAUUSD" in name or "GOLD" in name) and getattr(item, "currency_base", "").upper() == "XAU" and getattr(item, "currency_profit", "").upper() == "USD"
                if key == "BTCUSD":
                    valid = "BTCUSD" in name and getattr(item, "currency_profit", "").upper() == "USD"
                if key == "DJ30":
                    valid = any(name.startswith(core) for core in ("DJ30", "US30", "DOW", "WS30", "DJI")) and getattr(item, "currency_profit", "").upper() == "USD"
                if len(key) == 6 and key not in aliases:
                    valid = valid and getattr(item, "currency_base", "").upper() == key[:3] and getattr(item, "currency_profit", "").upper() == key[3:]
                if valid:
                    candidates.append(item.name)
    unique_candidates = set(candidates)
    if key == "XAUUSD":
        candidates = sorted(unique_candidates, key=lambda name: _score_symbol(name, key))
    else:
        candidates = sorted(unique_candidates, key=lambda name: (0 if name.upper() == key else 1 if name.upper().startswith(key) else 2, len(name), name))
    if not candidates:
        if key == "XAUUSD":
            raise HTTPException(
                status_code=404,
                detail={
                    "error": "XAUUSD_SYMBOL_NOT_FOUND",
                    "symbol": requested,
                    "hint": "Ustaw zmienną MT5_SYMBOL na nazwę złota używaną przez brokera, np. XAUUSD.a lub GOLD.",
                },
            )
        raise HTTPException(status_code=404, detail={"error": "SYMBOL_NOT_FOUND", "symbol": requested, "hint": "Wyszukaj nazwę instrumentu dostępną u brokera."})
    if len(candidates) != 1:
        raise HTTPException(status_code=409, detail={"error": "SYMBOL_AMBIGUOUS", "symbol": requested, "candidates": candidates, "hint": "Wybierz dokładną nazwę instrumentu brokera."})
    if not mt5.symbol_select(candidates[0], True):
        raise HTTPException(status_code=503, detail={"error": "SYMBOL_SELECT_FAILED", "symbol": candidates[0], "last_error": _last_error()})
    return candidates[0]


def _account_payload() -> dict[str, Any]:
    global _daily_cache
    info = mt5.account_info()
    if info is None:
        raise HTTPException(status_code=503, detail={"error": "ACCOUNT_INFO_UNAVAILABLE", "last_error": _last_error()})

    now = datetime.now(timezone.utc)
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    if _daily_cache is None or time.monotonic() - _daily_cache[0] >= 5:
        deals = _required(mt5.history_deals_get(day_start, now), "DEALS_UNAVAILABLE")
        _daily_cache = (time.monotonic(), deals)
    else:
        deals = _daily_cache[1]
    day_pnl = sum(sum(float(getattr(d, field, 0) or 0) for field in ("profit", "swap", "commission", "fee")) for d in deals)
    positions = _required(mt5.positions_get(), "POSITIONS_UNAVAILABLE")
    open_position_ids = {int(getattr(position, "identifier", 0) or 0) for position in positions}
    _ensure_connected()
    return {
        "login": int(info.login),
        "server": info.server,
        "name": info.name,
        "company": info.company,
        "currency": info.currency,
        "leverage": int(info.leverage),
        "balance": float(info.balance),
        "equity": float(info.equity),
        "profit": float(info.profit),
        "margin": float(info.margin),
        "margin_free": float(info.margin_free),
        "margin_level": float(info.margin_level) if info.margin_level is not None else None,
        "trade_allowed": bool(info.trade_allowed),
        "trade_expert": bool(info.trade_expert),
        "margin_mode": int(info.margin_mode),
        "margin_so_call": float(getattr(info, "margin_so_call", 0) or 0),
        "margin_so_so": float(getattr(info, "margin_so_so", 0) or 0),
        "margin_so_mode": int(getattr(info, "margin_so_mode", 0) or 0),
        "trade_mode": int(info.trade_mode),
        "day_pnl": float(day_pnl + info.profit),
        "daily_win_rate": _daily_win_rate(deals, open_position_ids),
        "observed_at": int(now.timestamp() * 1000),
    }


def _symbol_payload(symbol: str) -> dict[str, Any]:
    info = mt5.symbol_info(symbol)
    if info is None:
        raise HTTPException(status_code=404, detail={"error": "SYMBOL_INFO_UNAVAILABLE", "symbol": symbol})

    return {
        "symbol": symbol,
        "description": info.description,
        "path": info.path,
        "digits": int(info.digits),
        "point": float(info.point),
        "spread": int(info.spread),
        "trade_tick_size": float(info.trade_tick_size),
        "trade_tick_value": float(info.trade_tick_value),
        "trade_tick_value_profit": float(info.trade_tick_value_profit),
        "trade_tick_value_loss": float(info.trade_tick_value_loss),
        "trade_contract_size": float(info.trade_contract_size),
        "volume_min": float(info.volume_min),
        "volume_max": float(info.volume_max),
        "volume_step": float(info.volume_step),
        "currency_base": info.currency_base,
        "currency_profit": info.currency_profit,
        "currency_margin": info.currency_margin,
        "trade_mode": int(info.trade_mode),
        "trade_calc_mode": int(getattr(info, "trade_calc_mode", -1)),
        "margin_initial": float(getattr(info, "margin_initial", 0) or 0),
        "margin_maintenance": float(getattr(info, "margin_maintenance", 0) or 0),
        "margin_hedged": float(getattr(info, "margin_hedged", 0) or 0),
        # Python symbol_info does not expose SymbolInfoMarginRate. These fields
        # must not be invented as zero; replay captures read-only calibration.
        "margin_hedged_use_leg": getattr(info, "margin_hedged_use_leg", None),
        "volume_limit": float(getattr(info, "volume_limit", 0) or 0),
        "trade_stops_level": int(getattr(info, "trade_stops_level", 0) or 0),
        "trade_freeze_level": int(getattr(info, "trade_freeze_level", 0) or 0),
        "trade_exemode": int(getattr(info, "trade_exemode", -1)),
        "order_mode": int(getattr(info, "order_mode", 0) or 0),
        "filling_mode": int(getattr(info, "filling_mode", 0) or 0),
        "swap_mode": int(getattr(info, "swap_mode", -1)),
        "swap_long": float(getattr(info, "swap_long", 0) or 0),
        "swap_short": float(getattr(info, "swap_short", 0) or 0),
        "swap_rollover3days": int(getattr(info, "swap_rollover3days", -1)),
        "visible": bool(info.visible),
        "chart_mode": int(info.chart_mode),
    }


def _tick_payload(symbol: str) -> dict[str, Any]:
    tick = mt5.symbol_info_tick(symbol)
    if tick is None:
        raise HTTPException(status_code=503, detail={"error": "TICK_UNAVAILABLE", "symbol": symbol, "last_error": _last_error()})

    bid = float(tick.bid)
    ask = float(tick.ask)
    last = float(tick.last)
    mid = (bid + ask) / 2 if bid > 0 and ask > 0 else (last if last > 0 else bid or ask)

    quote = quote_metadata(tick)
    return {
        "symbol": symbol,
        "time": int(tick.time),
        "time_msc": int(tick.time_msc),
        "bid": bid,
        "ask": ask,
        "last": last,
        "mid": float(mid),
        "volume": float(tick.volume),
        "volume_real": float(tick.volume_real),
        "flags": int(tick.flags),
        "observed_at": quote["observed_at"],
        "quote_age_ms": quote["quote_age_ms"],
        "freshness": quote["freshness"],
    }


def _market_session_payload(symbol: str, account: Any | None = None) -> dict[str, Any]:
    """Read the live quote/trade schedule written by the bundled MQL5 helper.

    The MetaTrader5 Python package does not expose SymbolInfoSessionQuote/Trade,
    so absence or stale helper data stays unknown instead of guessing from ticks.
    """
    unknown = {"available": False, "quote_open": None, "trade_open": None, "state": "unknown"}
    terminal = mt5.terminal_info()
    account = account or mt5.account_info()
    if terminal is None or account is None:
        return unknown
    login = account.get("login") if isinstance(account, dict) else getattr(account, "login", None)
    server = account.get("server") if isinstance(account, dict) else getattr(account, "server", None)
    if login is None or server is None:
        return unknown
    common_path = str(getattr(terminal, "commondata_path", "") or "").strip()
    if not common_path:
        return unknown
    try:
        path = Path(common_path) / "Files" / f"CRTMarketSessions_{int(login)}.tsv"
        lines = path.read_text(encoding="utf-8-sig").splitlines()
        if len(lines) < 2 or lines[-1] != "END":
            return unknown
        meta = lines[0].split("\t")
        if len(meta) != 6 or meta[0] != "CRT1" or int(meta[1]) != int(login) or meta[2] != str(server):
            return unknown
        weekday, second_of_day = int(meta[3]), int(meta[4])
        file_updated_at = path.stat().st_mtime
        if weekday not in range(7) or second_of_day not in range(86400) or abs(time.time() - file_updated_at) > 12:
            return unknown
        sessions: dict[tuple[str, int, str], list[tuple[int, int]]] = {}
        complete: set[str] = set()
        for line in lines[1:-1]:
            fields = line.split("\t")
            if len(fields) == 2 and fields[0] == "COMPLETE":
                complete.add(fields[1])
            elif len(fields) == 6 and fields[0] == "SESSION":
                _, session_symbol, day_raw, kind, start_raw, end_raw = fields
                day, start, end = int(day_raw), int(start_raw), int(end_raw)
                if day not in range(7) or kind not in ("Q", "T") or start not in range(86400) or end not in range(86400):
                    return unknown
                sessions.setdefault((session_symbol, day, kind), []).append((start, end))
        if symbol not in complete:
            return unknown
        quote_windows = [window for (name, _, kind), windows in sessions.items() if name == symbol and kind == "Q" for window in windows]
        trade_windows = [window for (name, _, kind), windows in sessions.items() if name == symbol and kind == "T" for window in windows]
        if not quote_windows or not trade_windows:
            return unknown

        def active(kind: str) -> bool:
            previous_day = (weekday - 1) % 7
            for (name, day, session_kind), windows in sessions.items():
                if name != symbol or session_kind != kind or day not in (weekday, previous_day):
                    continue
                for start, end in windows:
                    # MT5 reports a 24-hour session as 00:00–00:00 on
                    # brokers that quote continuously (for example crypto).
                    if start == 0 and end == 0 and day == weekday:
                        return True
                    if start < end and day == weekday and start <= second_of_day < end:
                        return True
                    if start > end and ((day == weekday and second_of_day >= start) or (day == previous_day and second_of_day < end)):
                        return True
            return False

        quote_open = active("Q")
        trade_open = active("T")
        return {
            "available": True,
            "quote_open": quote_open,
            "trade_open": trade_open,
            "state": "open" if quote_open else "closed",
            "broker_weekday": weekday,
            "broker_seconds": second_of_day,
            "observed_at": int(file_updated_at * 1000),
            "source": "MT5_SYMBOL_SESSIONS",
        }
    except (OSError, ValueError, TypeError, OverflowError):
        return unknown


def _authorize_runtime(request: Request) -> None:
    # CORS alone does not authorize a mutation. Exact Origin + per-process token
    # prevent another website from using the bridge to stop the local service.
    if request.headers.get("origin") not in ALLOWED_ORIGINS:
        raise HTTPException(status_code=403, detail={"error": "RUNTIME_ORIGIN_DENIED"})


def _stop_replay_workers() -> None:
    with _replay_jobs_lock:
        for job in _replay_jobs.values():
            if job.get("cancel"):
                job["cancel"].set()
            process = job.get("process")
            if process and process.poll() is None:
                process.terminate()
    with _replay_runs_lock:
        active_runs = list(_replay_runs.values())
        for run in active_runs:
            run["cancel"].set()
            process = run.get("process")
            if process and process.poll() is None:
                process.terminate()


@app.get("/v1/runtime")
def runtime(request: Request):
    _authorize_runtime(request)
    return {"bridge": BRIDGE_ID, "protocol_version": PROTOCOL_VERSION, "owner": OWNER, "instance": _instance, "closing": _closing.is_set(), "shutdown_token": _shutdown_token}


@app.post("/v1/shutdown")
def shutdown(request: Request):
    _authorize_runtime(request)
    shutdown_token = request.headers.get("x-crt-terminal-shutdown", request.headers.get("x-smartflow-shutdown", ""))
    if not secrets.compare_digest(shutdown_token, _shutdown_token):
        raise HTTPException(status_code=403, detail={"error": "SHUTDOWN_TOKEN_INVALID"})
    if _server is None:
        raise HTTPException(status_code=503, detail={"error": "SHUTDOWN_CONTROLLER_UNAVAILABLE"})
    _closing.set()
    _stop_replay_workers()
    _server.should_exit = True
    return {"accepted": True, "instance": _instance}


@app.get("/v1/health")
def health():
    with _lock:
        _ensure_connected()
        terminal = mt5.terminal_info()
        version = mt5.version()
        # Transport readiness is independent of a default instrument. The UI
        # must remain usable to select an exact broker symbol when aliases are
        # ambiguous or XAUUSD is unavailable on the connected account.
        symbol = PREFERRED_SYMBOL
        return {
            "ok": True,
            "read_only": not bool(_execution_token),
            "execution_mode": "DEMO_ONLY" if _execution_token else "DISABLED",
            "bridge": BRIDGE_ID,
            "protocol_version": PROTOCOL_VERSION,
            "instance": _instance,
            "owner": OWNER,
            "terminal": {
                "name": terminal.name if terminal else None,
                "company": terminal.company if terminal else None,
                "path": terminal.path if terminal else None,
                "connected": bool(terminal.connected) if terminal else False,
                "build": int(version[0]) if version else None,
                "version": ".".join(str(part) for part in version) if version else None,
            },
            "symbol": symbol,
            "account": _account_payload(),
        }


@app.get("/v1/account")
def account():
    with _lock:
        _ensure_connected()
        return _account_payload()


@app.get("/v1/symbol")
def symbol(requested: str = Query(default="")):
    with _lock:
        resolved = _resolve_requested_symbol(requested or None)
        return _symbol_payload(resolved)


@app.get("/v1/tick")
def tick(requested: str = Query(default="")):
    with _lock:
        resolved = _resolve_requested_symbol(requested or None)
        return _tick_payload(resolved)


@app.get("/v1/bars")
def bars(
    timeframe: str = Query(default="M15"),
    count: int = Query(default=5000, ge=100, le=100000),
    requested: str = Query(default="", alias="symbol"),
):
    tf = timeframe.upper()
    mt5_timeframe = TIMEFRAMES.get(tf)
    if mt5_timeframe is None:
        raise HTTPException(status_code=400, detail={"error": "UNSUPPORTED_TIMEFRAME", "timeframe": timeframe})

    with _lock:
        symbol = _resolve_requested_symbol(requested or None)
        rates = mt5.copy_rates_from_pos(symbol, mt5_timeframe, 0, count)
        if rates is None:
            raise HTTPException(
                status_code=503,
                detail={
                    "error": "BARS_UNAVAILABLE",
                    "symbol": symbol,
                    "timeframe": tf,
                    "last_error": _last_error(),
                },
            )

        values = [
            {
                "time": int(row["time"]),
                "open": float(row["open"]),
                "high": float(row["high"]),
                "low": float(row["low"]),
                "close": float(row["close"]),
                "tick_volume": int(row["tick_volume"]),
                "spread": int(row["spread"]),
                "real_volume": int(row["real_volume"]),
            }
            for row in rates
        ]
        values.sort(key=lambda row: row["time"])
        account_payload = _account_payload()

        return {
            "source": "MT5",
            "symbol": symbol,
            "timeframe": tf,
            "requested_bars": count,
            "loaded_bars": len(values),
            "values": values,
            "tick": _tick_payload(symbol),
            "account": account_payload,
            "market_session": _market_session_payload(symbol, account_payload),
            "symbol_info": _symbol_payload(symbol),
        }


@app.get("/v1/snapshot")
def snapshot(requested: str = Query(default="", alias="symbol")):
    with _lock:
        symbol = _resolve_requested_symbol(requested or None)
        return {
            "source": "MT5",
            "symbol": symbol,
            "tick": _tick_payload(symbol),
            "account": _account_payload(),
            "symbol_info": _symbol_payload(symbol),
        }


@app.get("/v1/positions")
def positions():
    with _lock:
        _ensure_connected()
        values = _required(mt5.positions_get(), "POSITIONS_UNAVAILABLE")
        open_position_ids = {int(getattr(position, "identifier", 0) or 0) for position in values}
        open_times = [
            int(getattr(position, "time", 0) or 0)
            for position in values
            if int(getattr(position, "time", 0) or 0) > 0
        ]
        if open_times:
            deals = _required(mt5.history_deals_get(
                datetime.fromtimestamp(min(open_times), timezone.utc),
                datetime.now(timezone.utc),
            ), "POSITION_DEALS_UNAVAILABLE")
        else:
            deals = ()
        commissions: dict[int, float] = {}
        for deal in deals:
            position_id = int(getattr(deal, "position_id", 0) or 0)
            if position_id not in open_position_ids:
                continue
            commissions[position_id] = commissions.get(position_id, 0.0) + float(getattr(deal, "commission", 0.0) or 0.0)
        _ensure_connected()
        return {"observed_at": int(datetime.now(timezone.utc).timestamp() * 1000), "values": [{
            "ticket": int(p.ticket), "symbol": p.symbol,
            "type": "buy" if int(p.type) == mt5.POSITION_TYPE_BUY else "sell",
            "volume": float(p.volume), "price_open": float(p.price_open), "sl": float(p.sl), "tp": float(p.tp),
            "profit": float(p.profit), "swap": float(p.swap), "commission": commissions.get(int(p.identifier), 0.0), "time": int(p.time),
        } for p in values]}


@app.get("/v1/orders")
def orders():
    with _lock:
        _ensure_connected()
        values = _required(mt5.orders_get(), "ORDERS_UNAVAILABLE")
        _ensure_connected()
        return {"observed_at": int(datetime.now(timezone.utc).timestamp() * 1000), "values": [{
            "ticket": int(o.ticket), "symbol": o.symbol, "type": str(o.type), "volume_initial": float(o.volume_initial),
            "price_open": float(o.price_open), "sl": float(o.sl), "tp": float(o.tp), "price_current": float(o.price_current), "time_setup": int(o.time_setup),
        } for o in values]}


@app.get("/v1/search-symbols")
def search_symbols(q: str = Query(default="", max_length=32), limit: int = Query(default=100, ge=1, le=250)):
    with _lock:
        _ensure_connected()
        needle = q.strip().upper()
        values = _required(mt5.symbols_get(), "SYMBOLS_UNAVAILABLE")
        matches = [s for s in values if not needle or needle in s.name.upper() or needle in s.description.upper()]
        matches.sort(key=lambda s: (not s.visible, 0 if s.name.upper() == needle else 1, s.name))
        return {"values": [{"symbol": s.name, "description": s.description, "path": s.path, "digits": int(s.digits), "visible": bool(s.visible), "trade_mode": int(s.trade_mode)} for s in matches[:limit]]}


@app.get("/v1/fx-bars")
def fx_bars(timeframe: str = Query(default="H1")):
    tf = TIMEFRAMES.get(timeframe.upper())
    if tf is None:
        raise HTTPException(status_code=400, detail={"error": "UNSUPPORTED_TIMEFRAME", "timeframe": timeframe})
    pairs = ("EURUSD", "GBPUSD", "AUDUSD", "NZDUSD", "USDJPY", "USDCHF", "USDCAD", "EURGBP", "EURJPY", "GBPJPY", "AUDJPY", "EURCHF", "EURAUD", "GBPAUD")
    out: dict[str, list[dict[str, Any]]] = {}
    with _lock:
        _ensure_connected()
        for pair in pairs:
            try:
                resolved = _resolve_requested_symbol(pair)
                rates = mt5.copy_rates_from_pos(resolved, tf, 0, 300)
                if rates is not None:
                    out[pair] = sorted([{"time": int(r["time"]), "open": float(r["open"]), "high": float(r["high"]), "low": float(r["low"]), "close": float(r["close"]), "tick_volume": int(r["tick_volume"]), "real_volume": int(r["real_volume"])} for r in rates], key=lambda row: row["time"])
            except HTTPException:
                continue
        return {"values": out}


@app.get("/v1/context-bars")
def context_bars(requested: str = Query(default="XAUUSD", alias="symbol")):
    values: dict[str, list[dict[str, Any]]] = {}
    with _lock:
        resolved = _resolve_requested_symbol(requested)
        for name in ("M5", "M15", "M30", "H1", "H4", "D1"):
            rates = mt5.copy_rates_from_pos(resolved, TIMEFRAMES[name], 0, 500)
            if rates is None:
                raise HTTPException(status_code=503, detail={"error": "CONTEXT_BARS_UNAVAILABLE", "timeframe": name, "last_error": _last_error()})
            values[name] = sorted([{"time": int(r["time"]), "open": float(r["open"]), "high": float(r["high"]), "low": float(r["low"]), "close": float(r["close"]), "tick_volume": int(r["tick_volume"]), "real_volume": int(r["real_volume"])} for r in rates], key=lambda row: row["time"])
    return {"symbol": resolved, "values": values}


def _replay_job_payload(job: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": job["id"],
        "archive_id": job["archive_id"],
        "status": job["status"],
        "symbol": job["symbol"],
        "from_ms": job["from_ms"],
        "to_ms": job["to_ms"],
        "completed_through_ms": job["completed_through_ms"],
        "tick_count": job["tick_count"],
        "progress": job["progress"],
        "stage": job.get("stage", "queued"),
        "range_from_ms": job.get("range_from_ms"),
        "range_to_ms": job.get("range_to_ms"),
        "last_chunk_fetch_ms": job.get("last_chunk_fetch_ms"),
        "last_chunk_write_ms": job.get("last_chunk_write_ms"),
        "fetch_total_ms": job.get("fetch_total_ms", 0),
        "write_total_ms": job.get("write_total_ms", 0),
        "finalize_ms": job.get("finalize_ms"),
        "ticks_per_second": round(job["tick_count"] / max(0.1, time.monotonic() - job.get("started_monotonic", time.monotonic())), 1),
        "error": job["error"],
        "archive": replay_store.get_archive(job["archive_id"]),
        "reused": job.get("reused", False),
    }


def _run_replay_import(job_id: str) -> None:
    global _active_replay_job
    with _replay_jobs_lock:
        job = _replay_jobs[job_id]
    archive_id = job["archive_id"]
    process = None
    failure = None
    try:
        request = {key: job.get(key) for key in ("archive_id", "terminal_path", "file_name", "utc_offset_minutes")}
        request["database_path"] = str(replay_store.database_path())
        process = subprocess.Popen(
            [sys.executable, "-X", "utf8", "-I", str(Path(__file__).with_name("replay_import_worker.py"))],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding="utf-8", creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        with _replay_jobs_lock:
            job["process"] = process
            if job["cancel"].is_set() or _closing.is_set():
                process.terminate()
        process.stdin.write(json.dumps(request) + "\n")
        process.stdin.close()
        for line in process.stdout:
            try:
                update = json.loads(line)
            except ValueError:
                failure = line.strip()[-1000:]
                continue
            if update.get("error"):
                failure = update["error"]
            with _replay_jobs_lock:
                for key in ("stage", "range_from_ms", "range_to_ms", "last_chunk_fetch_ms", "last_chunk_write_ms", "last_tick_ms", "completed_through_ms", "finalize_ms"):
                    if key in update:
                        job[key] = update[key]
                if "added" in update:
                    job["tick_count"] += update["added"]
                    job["fetch_total_ms"] += update.get("last_chunk_fetch_ms", 0)
                    job["write_total_ms"] += update.get("last_chunk_write_ms", 0)
                    job["progress"] = max(0, min(99, int((job["completed_through_ms"]-job["from_ms"])*100/max(1,job["to_ms"]-job["from_ms"]))))
                if update.get("stage") == "sha256_finalize":
                    job.update(status="finalizing", progress=99)
                if update.get("complete"):
                    job.update(status="complete", stage="complete", progress=100, error=None)
        exit_code = process.wait(timeout=5)
        archive = replay_store.get_archive(archive_id)
        if archive and archive["status"] == "complete":
            with _replay_jobs_lock:
                job.update(status="complete", stage="complete", progress=100, tick_count=archive["tick_count"], error=None)
        elif job["cancel"].is_set() or _closing.is_set():
            replay_store.set_archive_state(archive_id, "cancelled", "Import anulowany przed końcem zakresu.")
            with _replay_jobs_lock:
                job.update(status="cancelled", error="Import anulowany.")
        else:
            raise ValueError(failure or f"Importer zakończył się bez kompletnego archiwum (kod {exit_code}).")
    except Exception as error:
        cancelled = job["cancel"].is_set() or _closing.is_set()
        replay_store.set_archive_state(archive_id, "cancelled" if cancelled else "failed", str(error))
        with _replay_jobs_lock:
            job.update(status="cancelled" if cancelled else "failed", error="Import anulowany." if cancelled else str(error)[:1000])
    finally:
        if process:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=5)
            for stream in (process.stdin, process.stdout):
                if stream:
                    stream.close()
        with _replay_jobs_lock:
            job.pop("process", None)
            if _active_replay_job == job_id:
                _active_replay_job = None


@app.get("/v1/replay/inbox")
def replay_inbox():
    folder = replay_store.database_path().parent / "inbox"
    folder.mkdir(parents=True, exist_ok=True)
    files = [{"name": path.name, "bytes": path.stat().st_size} for path in folder.iterdir() if path.is_file() and not path.is_symlink() and path.suffix.lower() in {".csv", ".tsv", ".txt"}]
    return {"folder": str(folder), "values": sorted(files, key=lambda item: item["name"])}


@app.post("/v1/replay/imports", status_code=202)
def replay_import_start(request: Request, body: dict[str, Any]):
    global _active_replay_job
    _authorize_runtime(request)
    requested_symbol = body.get("symbol")
    from_ms = body.get("from_ms")
    to_ms = body.get("to_ms")
    if not isinstance(requested_symbol, str) or not requested_symbol.strip() or len(requested_symbol) > 64:
        raise HTTPException(status_code=400, detail={"error": "REPLAY_SYMBOL_REQUIRED"})
    if isinstance(from_ms, bool) or not isinstance(from_ms, int) or isinstance(to_ms, bool) or not isinstance(to_ms, int):
        raise HTTPException(status_code=400, detail={"error": "REPLAY_RANGE_MUST_USE_UTC_MILLISECONDS"})
    now_ms = int(time.time() * 1000)
    if from_ms <= 0 or to_ms <= from_ms or to_ms > now_ms + 60_000:
        raise HTTPException(status_code=400, detail={"error": "REPLAY_RANGE_INVALID", "hint": "Podaj poprawny zakres czasu UTC; data końcowa nie może być w przyszłości."})

    file_name = body.get("file_name")
    offset_minutes = body.get("utc_offset_minutes")
    if file_name is not None:
        folder = (replay_store.database_path().parent / "inbox").resolve()
        if not isinstance(file_name, str) or Path(file_name).name != file_name or (folder / file_name).resolve().parent != folder or Path(file_name).suffix.lower() not in {".csv", ".tsv", ".txt"} or not (folder / file_name).is_file():
            raise HTTPException(status_code=400, detail={"error": "REPLAY_FILE_INVALID"})
        if isinstance(offset_minutes, bool) or not isinstance(offset_minutes, int) or abs(offset_minutes) > 840:
            raise HTTPException(status_code=400, detail={"error": "REPLAY_FILE_TIMEZONE_REQUIRED"})

    job_id = str(uuid.uuid4())
    with _replay_jobs_lock:
        if _active_replay_job:
            active = _replay_jobs.get(_active_replay_job)
            if active and active["status"] in {"starting", "importing", "finalizing"}:
                raise HTTPException(status_code=409, detail={"error": "REPLAY_IMPORT_ALREADY_RUNNING", "job_id": _active_replay_job})
        _active_replay_job = job_id
        _replay_jobs[job_id] = {"id": job_id, "status": "starting"}
    try:
        with _lock:
            _ensure_connected()
            symbol = _resolve_requested_symbol(requested_symbol.strip())
            account = mt5.account_info()
            terminal = mt5.terminal_info()
            symbol_info = _symbol_payload(symbol)
            tick = mt5.symbol_info_tick(symbol)
            if account is None or terminal is None:
                raise HTTPException(status_code=503, detail={"error": "MT5_METADATA_UNAVAILABLE", "last_error": _last_error()})

            account_snapshot = {
                "balance": float(account.balance),
                "equity": float(account.equity),
                "leverage": int(account.leverage),
                "currency": str(account.currency or "").upper(),
                "margin_mode": int(account.margin_mode),
                "margin_so_call": float(getattr(account, "margin_so_call", 0) or 0),
                "margin_so_so": float(getattr(account, "margin_so_so", 0) or 0),
                "margin_so_mode": int(getattr(account, "margin_so_mode", 0) or 0),
                "captured_at_ms": int(time.time() * 1000),
            }
            margin_calibration: dict[str, Any] = {
                "source": "MT5 order_calc_margin at import quote",
                "reference_leverage": int(account.leverage),
                "trade_calc_mode": symbol_info["trade_calc_mode"],
                "bid": float(getattr(tick, "bid", 0) or 0) if tick else 0,
                "ask": float(getattr(tick, "ask", 0) or 0) if tick else 0,
                "buy_per_lot": None,
                "sell_per_lot": None,
            }
            volume_min = float(symbol_info.get("volume_min") or 0)
            if tick and volume_min > 0:
                for side, order_type, quote in (
                    ("buy", getattr(mt5, "ORDER_TYPE_BUY", None), margin_calibration["ask"]),
                    ("sell", getattr(mt5, "ORDER_TYPE_SELL", None), margin_calibration["bid"]),
                ):
                    if order_type is None or quote <= 0:
                        continue
                    try:
                        required_margin = mt5.order_calc_margin(order_type, symbol, volume_min, quote)
                        if required_margin is not None and math.isfinite(float(required_margin)) and float(required_margin) > 0:
                            margin_calibration[f"{side}_per_lot"] = float(required_margin) / volume_min
                    except Exception:
                        pass

            broker_profile = replay_finance.capture_profile(
                mt5, symbol, symbol_info, account_snapshot, tick,
                str(terminal.company), str(account.server),
            )

        # Reuse only the exact data source and requested range, never another
        # broker's similarly named instrument. The original snapshot is preserved.
        reused = next((item for item in replay_store.list_archives() if not file_name and item["status"] == "complete" and item["symbol"] == symbol and item["server"] == str(account.server) and item["broker"] == str(terminal.company) and item["from_ms"] == from_ms and item["to_ms"] == to_ms and item["manifest"].get("source") == "MetaTrader5.copy_ticks_range" and item["manifest"].get("mt5_range_boundary_policy") == "enclosing_seconds_filter_ms_v1" and item["manifest"].get("account_currency") == str(account.currency).upper() and all((item["manifest"].get("symbol_info") or {}).get(key) == symbol_info.get(key) for key in ("digits", "point", "trade_tick_size", "trade_contract_size", "currency_base", "currency_profit", "currency_margin", "trade_calc_mode", "chart_mode"))), None)
        if reused:
            replay_store.get_archive_ticks(reused["id"], 0, 1)  # Validate stored file/count before claiming cache ready.
            replay_store.append_financial_profile(
                reused["id"], symbol_info=symbol_info, account_snapshot=account_snapshot,
                margin_calibration=margin_calibration, broker_profile=broker_profile,
            )
            job = {"id": job_id, "archive_id": reused["id"], "status": "complete", "symbol": symbol, "from_ms": from_ms, "to_ms": to_ms, "completed_through_ms": to_ms, "tick_count": reused["tick_count"], "progress": 100, "stage": "complete", "reused": True, "error": None, "cancel": threading.Event()}
            with _replay_jobs_lock:
                _replay_jobs[job_id] = job
                _active_replay_job = None
            return _replay_job_payload(job)

        archive_id = replay_store.create_archive(
            requested_symbol=requested_symbol.strip(),
            symbol=symbol,
            broker=str(getattr(terminal, "company", "") or ""),
            server=str(getattr(account, "server", "") or ""),
            from_ms=from_ms,
            to_ms=to_ms,
            symbol_info=symbol_info,
            account_currency=str(getattr(account, "currency", "") or ""),
            account_snapshot=account_snapshot,
            margin_calibration=margin_calibration,
            broker_profile=broker_profile,
        )
        if file_name:
            replay_store.annotate_archive(archive_id, source="MT5 tick CSV export supplied by user", source_file=file_name, file_utc_offset_minutes=offset_minutes, csv_flags="exported if present, otherwise derived from field changes", symbol_assignment="user selected; CSV does not identify its broker", completeness="importing")
        job = {
            "id": job_id,
            "archive_id": archive_id,
            "terminal_path": str(terminal.path),
            "file_name": file_name,
            "utc_offset_minutes": offset_minutes,
            "status": "importing",
            "symbol": symbol,
            "from_ms": from_ms,
            "to_ms": to_ms,
            "completed_through_ms": from_ms,
            "tick_count": 0,
            "progress": 0,
            "stage": "queued",
            "started_monotonic": time.monotonic(),
            "fetch_total_ms": 0,
            "write_total_ms": 0,
            "error": None,
            "cancel": threading.Event(),
        }
        with _replay_jobs_lock:
            _replay_jobs[job_id] = job
    except Exception:
        with _replay_jobs_lock:
            _replay_jobs.pop(job_id, None)
            if _active_replay_job == job_id:
                _active_replay_job = None
        raise
    thread = threading.Thread(target=_run_replay_import, args=(job_id,), name=f"crt-replay-{job_id[:8]}", daemon=True)
    thread.start()
    return _replay_job_payload(job)


@app.get("/v1/replay/imports/{job_id}")
def replay_import_status(job_id: str):
    with _replay_jobs_lock:
        job = _replay_jobs.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail={"error": "REPLAY_IMPORT_NOT_FOUND"})
        return _replay_job_payload(job)


@app.post("/v1/replay/imports/{job_id}/cancel")
def replay_import_cancel(request: Request, job_id: str):
    _authorize_runtime(request)
    with _replay_jobs_lock:
        job = _replay_jobs.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail={"error": "REPLAY_IMPORT_NOT_FOUND"})
        if job["status"] == "importing":
            job["cancel"].set()
            process = job.get("process")
            if process and process.poll() is None:
                process.terminate()
        return _replay_job_payload(job)


@app.get("/v1/replay/archives")
def replay_archives():
    return {"values": replay_store.list_archives(), "database": "archives.crt-replay"}


@app.get("/v1/replay/archives/{archive_id}")
def replay_archive(archive_id: str):
    archive = replay_store.get_archive(archive_id)
    if archive is None:
        raise HTTPException(status_code=404, detail={"error": "REPLAY_ARCHIVE_NOT_FOUND"})
    return archive


@app.get("/v1/replay/archives/{archive_id}/ticks")
def replay_archive_ticks(
    archive_id: str,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=10_000, ge=1, le=50_000),
):
    try:
        page = replay_store.get_archive_ticks(archive_id, offset, limit)
    except ValueError as error:
        raise HTTPException(status_code=409, detail={"error": "REPLAY_ARCHIVE_INCOMPLETE", "hint": str(error)}) from error
    if page is None:
        raise HTTPException(status_code=404, detail={"error": "REPLAY_ARCHIVE_NOT_FOUND"})
    return page


def _replay_run_payload(run: dict[str, Any]) -> dict[str, Any]:
    stored = replay_store.get_run(run["id"])
    return {**(stored or {}), "progress_ticks": run.get("progress_ticks", 0), "total_ticks": run.get("total_ticks", 0)}


def _run_replay_strategy(run_id: str) -> None:
    global _active_replay_run
    with _replay_runs_lock:
        run = _replay_runs[run_id]
        run["status"] = "running"
    replay_store.update_run(run_id, "running")
    process: subprocess.Popen[str] | None = None
    try:
        if run["cancel"].is_set():
            replay_store.update_run(run_id, "cancelled", error="Symulacja została anulowana przed startem.")
            with _replay_runs_lock:
                run["status"] = "cancelled"
            return
        strategy_dir = _replay_data_dir / "FXReplay" / "strategies"
        strategy_dir.mkdir(parents=True, exist_ok=True)
        strategy_path = strategy_dir / f"{run['strategy_id']}.py"
        source = replay_store.get_strategy_source(run["strategy_id"])
        if source is None:
            raise ValueError("Nie znaleziono źródła wybranej strategii.")
        strategy_path.write_text(source, encoding="utf-8", newline="\n")
        request_data = {
            "database_path": str(replay_store.database_path()),
            "run_id": run_id,
            "archive_id": run["archive_id"],
            "strategy_path": str(strategy_path),
            "params": run["params"],
        }
        # -I -S keeps the worker independent of site-packages, including the MT5 package.
        safe_env = {key: os.environ[key] for key in ("SYSTEMROOT", "WINDIR", "TEMP", "TMP") if key in os.environ}
        safe_env["PYTHONIOENCODING"] = "utf-8"
        with _replay_runs_lock:
            if run["cancel"].is_set() or _closing.is_set():
                raise RuntimeError("Symulacja została zatrzymana przed uruchomieniem procesu.")
            process = subprocess.Popen(
                [sys.executable, "-X", "utf8", "-I", "-S", str(Path(__file__).with_name("replay_worker.py"))],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, encoding="utf-8", errors="replace", bufsize=1, env=safe_env,
            )
            run["process"] = process
        assert process.stdin is not None and process.stdout is not None
        process.stdin.write(json.dumps(request_data, ensure_ascii=False, allow_nan=False) + "\n")
        process.stdin.close()
        result: dict[str, Any] | None = None
        event_batch: list[dict[str, Any]] = []
        for line in process.stdout:
            with _replay_runs_lock:
                cancelled = run["cancel"].is_set()
            if cancelled:
                process.terminate()
                break
            try:
                message = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(message, dict) and isinstance(message.get("progress"), int):
                with _replay_runs_lock:
                    run["progress_ticks"] = message["progress"]
            elif isinstance(message, dict) and isinstance(message.get("event"), dict):
                event_batch.append(message["event"])
                if len(event_batch) >= 500:
                    replay_store.append_run_events(run_id, event_batch)
                    event_batch.clear()
            elif isinstance(message, dict) and "complete" in message:
                result = message
        if event_batch:
            replay_store.append_run_events(run_id, event_batch)
        exit_code = process.wait(timeout=10)
        with _replay_runs_lock:
            cancelled = run["cancel"].is_set()
        if cancelled:
            replay_store.update_run(run_id, "cancelled", error="Symulacja została anulowana.")
            with _replay_runs_lock:
                run["status"] = "cancelled"
            return
        if exit_code != 0 or not result or not result.get("complete"):
            reason = str((result or {}).get("error") or f"Proces symulacji zakończył się kodem {exit_code}.")
            replay_store.update_run(run_id, "failed", error=reason)
            with _replay_runs_lock:
                run.update(status="failed", error=reason)
            return
        report = result["report"]
        replay_store.update_run(run_id, "complete", report=report)
        with _replay_runs_lock:
            run.update(status="complete", progress_ticks=report["tick_count"])
    except Exception as error:
        reason = str(error)[:1000]
        with _replay_runs_lock:
            cancelled = run["cancel"].is_set()
            run.update(status="cancelled" if cancelled else "failed", error=reason)
        replay_store.update_run(run_id, "cancelled" if cancelled else "failed", error=reason)
    finally:
        if process and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
        with _replay_runs_lock:
            run.pop("process", None)
            if _active_replay_run == run_id:
                _active_replay_run = None


@app.get("/v1/replay/strategies")
def replay_strategies(request: Request):
    _authorize_runtime(request)
    return {"api_version": 2, "values": replay_store.list_strategies()}


@app.get("/v1/replay/strategies/{strategy_id}/source")
def replay_strategy_source(request: Request, strategy_id: str):
    _authorize_runtime(request)
    strategy = replay_store.get_strategy(strategy_id)
    source = replay_store.get_strategy_source(strategy_id)
    if strategy is None or source is None:
        raise HTTPException(status_code=404, detail={"error": "REPLAY_STRATEGY_NOT_FOUND"})
    return {"id": strategy_id, "name": strategy["name"], "api_version": strategy["api_version"], "source": source}


@app.post("/v1/replay/strategies", status_code=201)
def replay_strategy_create(request: Request, body: dict[str, Any]):
    _authorize_runtime(request)
    name = body.get("name")
    source = body.get("source")
    if not isinstance(name, str) or not name.strip() or len(name.strip()) > 80:
        raise HTTPException(status_code=400, detail={"error": "REPLAY_STRATEGY_NAME_INVALID"})
    if not isinstance(source, str) or not source.strip() or len(source.encode("utf-8")) > 256_000:
        raise HTTPException(status_code=400, detail={"error": "REPLAY_STRATEGY_SOURCE_INVALID", "hint": "Skrypt musi zawierać do 256 KB kodu Python."})
    try:
        tree = ast.parse(source)
    except SyntaxError as error:
        raise HTTPException(status_code=400, detail={"error": "REPLAY_STRATEGY_SYNTAX_ERROR", "line": error.lineno, "hint": error.msg}) from error
    functions = {node.name for node in tree.body if isinstance(node, ast.FunctionDef)}
    missing = sorted({"on_start", "on_tick", "on_stop"} - functions)
    if missing:
        raise HTTPException(status_code=400, detail={"error": "REPLAY_STRATEGY_CALLBACKS_MISSING", "callbacks": missing})
    return replay_store.save_strategy(name.strip(), source)


@app.post("/v1/replay/runs", status_code=202)
def replay_run_start(request: Request, body: dict[str, Any]):
    global _active_replay_run
    _authorize_runtime(request)
    archive_id = body.get("archive_id")
    strategy_id = body.get("strategy_id")
    params = body.get("params", {})
    if not isinstance(archive_id, str) or not isinstance(strategy_id, str) or not isinstance(params, dict):
        raise HTTPException(status_code=400, detail={"error": "REPLAY_RUN_REQUEST_INVALID"})
    try:
        json.dumps(params, allow_nan=False)
    except (ValueError, TypeError) as error:
        raise HTTPException(status_code=400, detail={"error": "REPLAY_PARAMS_INVALID"}) from error
    if len(json.dumps(params, ensure_ascii=False)) > 16_000:
        raise HTTPException(status_code=400, detail={"error": "REPLAY_PARAMS_TOO_LARGE"})
    archive = replay_store.get_archive(archive_id)
    if archive is None or archive["status"] != "complete":
        raise HTTPException(status_code=409, detail={"error": "REPLAY_ARCHIVE_INCOMPLETE"})
    if replay_store.get_strategy(strategy_id) is None:
        raise HTTPException(status_code=404, detail={"error": "REPLAY_STRATEGY_NOT_FOUND"})
    strategy = replay_store.get_strategy(strategy_id)
    if strategy and strategy["api_version"] != 2:
        raise HTTPException(status_code=409, detail={"error": "REPLAY_STRATEGY_API_VERSION_UNSUPPORTED", "required_api_version": 2})
    with _replay_runs_lock:
        if _active_replay_run:
            raise HTTPException(status_code=409, detail={"error": "REPLAY_RUN_ALREADY_ACTIVE", "run_id": _active_replay_run})
        run_id = str(uuid.uuid4())
        replay_store.create_run(run_id, archive_id, strategy_id, params)
        run = {"id": run_id, "archive_id": archive_id, "strategy_id": strategy_id, "params": params, "status": "queued", "progress_ticks": 0, "total_ticks": archive["tick_count"], "cancel": threading.Event()}
        _replay_runs[run_id] = run
        _active_replay_run = run_id
    threading.Thread(target=_run_replay_strategy, args=(run_id,), name=f"crt-replay-run-{run_id[:8]}", daemon=True).start()
    return _replay_run_payload(run)


@app.get("/v1/replay/runs/{run_id}")
def replay_run_status(request: Request, run_id: str):
    _authorize_runtime(request)
    with _replay_runs_lock:
        run = _replay_runs.get(run_id)
    if run is not None:
        return _replay_run_payload(run)
    stored = replay_store.get_run(run_id)
    if stored is None:
        raise HTTPException(status_code=404, detail={"error": "REPLAY_RUN_NOT_FOUND"})
    return {**stored, "progress_ticks": stored["report"]["tick_count"] if stored["report"] else 0, "total_ticks": stored["report"]["tick_count"] if stored["report"] else 0}


@app.post("/v1/replay/runs/{run_id}/cancel")
def replay_run_cancel(request: Request, run_id: str):
    _authorize_runtime(request)
    with _replay_runs_lock:
        run = _replay_runs.get(run_id)
        if run is None:
            raise HTTPException(status_code=404, detail={"error": "REPLAY_RUN_NOT_FOUND"})
        run["cancel"].set()
        process = run.get("process")
    if process and process.poll() is None:
        process.terminate()
    return _replay_run_payload(run)


@app.get("/v1/replay/runs/{run_id}/events")
def replay_run_events(request: Request, run_id: str, offset: int = Query(default=0, ge=0), limit: int = Query(default=500, ge=1, le=5000), tick_from: int | None = Query(default=None, ge=0), tick_to: int | None = Query(default=None, ge=0)):
    _authorize_runtime(request)
    if tick_from is not None and tick_to is not None and tick_to < tick_from:
        raise HTTPException(status_code=400, detail={"error": "REPLAY_EVENT_RANGE_INVALID"})
    page = replay_store.get_run_events(run_id, offset, limit, tick_from, tick_to)
    if page is None:
        raise HTTPException(status_code=404, detail={"error": "REPLAY_RUN_NOT_FOUND"})
    return page


@app.get("/v1/calculate")
def calculate(action: str, symbol: str, side: str, volume: float, price: float, stop: float | None = None):
    normalized_action = action.lower()
    normalized_side = side.lower()
    if normalized_action not in {"margin", "profit"}:
        raise HTTPException(status_code=400, detail={"error": "UNSUPPORTED_CALCULATION"})
    if normalized_side not in {"buy", "sell"}:
        raise HTTPException(status_code=400, detail={"error": "UNSUPPORTED_ORDER_SIDE"})
    if not math.isfinite(volume) or volume <= 0 or not math.isfinite(price) or price <= 0:
        raise HTTPException(status_code=400, detail={"error": "INVALID_CALCULATION_INPUT"})
    if normalized_action == "profit" and (stop is None or not math.isfinite(stop) or stop <= 0):
        raise HTTPException(status_code=400, detail={"error": "CLOSE_PRICE_REQUIRED"})
    with _lock:
        resolved = _resolve_requested_symbol(symbol)
        order_type = mt5.ORDER_TYPE_BUY if normalized_side == "buy" else mt5.ORDER_TYPE_SELL
        if normalized_action == "profit":
            result = mt5.order_calc_profit(order_type, resolved, volume, price, stop)
        else:
            result = mt5.order_calc_margin(order_type, resolved, volume, price)
        if result is None:
            raise HTTPException(status_code=503, detail={"error": "CALCULATION_UNAVAILABLE", "last_error": _last_error()})
        _ensure_connected()
        info = _required(mt5.account_info(), "ACCOUNT_INFO_UNAVAILABLE")
        return {"value": float(result), "currency": info.currency, "symbol": resolved}


def _market_trade_open(symbol: str) -> bool | None:
    session = _market_session_payload(symbol)
    return session["trade_open"] if session["available"] else None


_execution = ExecutionService(_ensure_connected, _market_trade_open)


def _authorize_execution(request: Request):
    if _closing.is_set() or not _execution_token or request.headers.get("origin") != "http://tauri.localhost":
        raise HTTPException(status_code=403, detail={"error": "EXECUTION_DESKTOP_ONLY", "hint": "Wysyłam zlecenia tylko z aplikacji desktop na koncie DEMO."})
    if request.headers.get("x-crt-instance") != _instance or not secrets.compare_digest(request.headers.get("x-crt-execution", ""), _execution_token):
        raise HTTPException(status_code=403, detail={"error": "EXECUTION_TOKEN_INVALID", "hint": "Nie potwierdziłam własnej sesji mostu. Uruchom ponownie terminal."})


@app.get("/v1/execution/status")
def execution_status(request: Request):
    _authorize_execution(request)
    with _lock:
        return _execution.status()


@app.post("/v1/execution/prepare")
def execution_prepare(request: Request, body: dict[str, Any]):
    _authorize_execution(request)
    with _lock:
        return _execution.prepare(body)


@app.post("/v1/execution/execute")
def execution_execute(request: Request, body: dict[str, Any]):
    _authorize_execution(request)
    with _lock:
        return _execution.execute(body)


@app.get("/v1/execution/requests/{request_id}")
def execution_read(request: Request, request_id: str):
    _authorize_execution(request)
    with _lock:
        return _execution.read(request_id)


if __name__ == "__main__":
    import uvicorn

    print(f"CRT Terminal MT5 Local Bridge -> http://{HOST}:{PORT}")
    print("Manual DEMO execution available only to the owning desktop session." if _execution_token else "READ ONLY: execution disabled.")
    # Binding port 0 lets Windows allocate a private endpoint for each desktop
    # session. The inherited endpoint file ties discovery to that exact owner.
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind((HOST, PORT))
    listener.listen(128)
    actual_port = listener.getsockname()[1]
    endpoint_file = os.getenv("CRT_TERMINAL_BRIDGE_ENDPOINT_FILE", os.getenv("SMARTFLOW_BRIDGE_ENDPOINT_FILE"))
    if endpoint_file:
        path = Path(endpoint_file)
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps({"url": f"http://{HOST}:{actual_port}", "instance": _instance, "owner": OWNER, "protocol_version": PROTOCOL_VERSION, "execution_token": _execution_token}), encoding="utf-8")
        temporary.replace(path)
    _server = uvicorn.Server(uvicorn.Config(app, host=HOST, port=actual_port, log_level="info", timeout_graceful_shutdown=5))
    try:
        _server.run(sockets=[listener])
    finally:
        _closing.set()
        _stop_replay_workers()
        listener.close()
        if endpoint_file:
            Path(endpoint_file).unlink(missing_ok=True)
        with _lock:
            mt5.shutdown()
        print("CRT Terminal: MT5 connection closed; bridge stopped.")
