from __future__ import annotations

import os
import math
import threading
import secrets
import json
import socket
import time
from pathlib import Path
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlsplit

import MetaTrader5 as mt5
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from execution import ExecutionService

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

    observed_at = int(datetime.now(timezone.utc).timestamp() * 1000)
    age_ms = max(0, observed_at - int(tick.time_msc or tick.time * 1000))
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
        "observed_at": observed_at,
        "quote_age_ms": age_ms,
        "freshness": "fresh" if age_ms <= 15000 else "stale",
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
        listener.close()
        if endpoint_file:
            Path(endpoint_file).unlink(missing_ok=True)
        with _lock:
            mt5.shutdown()
        print("CRT Terminal: MT5 connection closed; bridge stopped.")
