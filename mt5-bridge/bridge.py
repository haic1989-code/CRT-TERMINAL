from __future__ import annotations

import os
import math
import threading
import secrets
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlsplit

import MetaTrader5 as mt5
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

HOST = "127.0.0.1"
PORT = int(os.getenv("SMARTFLOW_MT5_PORT", "8765"))
TERMINAL_PATH = os.getenv("MT5_TERMINAL_PATH", "").strip() or None
PREFERRED_SYMBOL = os.getenv("MT5_SYMBOL", "XAUUSD").strip() or "XAUUSD"

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
    configured = os.getenv("SMARTFLOW_ALLOWED_ORIGINS", "") if extra_origins is None else extra_origins
    origins = list(DEFAULT_ALLOWED_ORIGINS)
    for raw_origin in configured.split(","):
        origin = raw_origin.strip()
        if not origin:
            continue
        parsed = urlsplit(origin)
        try:
            parsed.port
        except ValueError as error:
            raise ValueError(f"Invalid SMARTFLOW_ALLOWED_ORIGINS entry: {origin!r}") from error
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
                "SMARTFLOW_ALLOWED_ORIGINS must contain exact HTTP(S) origins without paths or wildcards."
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

_lock = threading.RLock()
_resolved_symbol: str | None = None
_closing = threading.Event()
_shutdown_token = secrets.token_urlsafe(32)
_instance = secrets.token_hex(16)
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
    expose_headers=["X-SmartFlow-MT5"],
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
    response.headers["X-SmartFlow-MT5"] = "read-only"
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
        return bool(mt5.initialize(TERMINAL_PATH))
    return bool(mt5.initialize())


def _ensure_connected() -> None:
    with _lock:
        if _closing.is_set():
            raise HTTPException(status_code=503, detail={"error": "BRIDGE_SHUTTING_DOWN"})
        terminal = mt5.terminal_info()
        account = mt5.account_info()
        if terminal is not None and account is not None:
            return

        mt5.shutdown()
        if not _initialize():
            raise HTTPException(
                status_code=503,
                detail={
                    "error": "MT5_INITIALIZE_FAILED",
                    "last_error": _last_error(),
                    "hint": "Uruchom MetaTrader 5 i zaloguj konto brokerskie.",
                },
            )

        if mt5.account_info() is None:
            raise HTTPException(
                status_code=503,
                detail={
                    "error": "MT5_ACCOUNT_NOT_CONNECTED",
                    "last_error": _last_error(),
                    "hint": "Terminal MT5 działa, ale nie ma aktywnego konta.",
                },
            )


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
                mt5.symbol_select(_resolved_symbol, True)
                return _resolved_symbol
        _resolved_symbol = _resolve_requested_symbol(PREFERRED_SYMBOL)
        return _resolved_symbol


def _resolve_requested_symbol(requested: str | None = None) -> str:
    requested = (requested or PREFERRED_SYMBOL).strip() or PREFERRED_SYMBOL
    _ensure_connected()
    key = requested.upper().strip()
    direct = mt5.symbol_info(requested)
    if direct is not None:
        mt5.symbol_select(direct.name, True)
        return direct.name
    aliases = {
        "XAUUSD": ("*XAU*", "*GOLD*"),
        "BTCUSD": ("*BTC*",),
        "DJ30": ("*DJ30*", "*US30*", "*DOW*", "*WS30*", "*DJI*"),
    }
    patterns = aliases.get(key, (f"*{key}*",))
    candidates: list[str] = []
    for pattern in patterns:
        items = mt5.symbols_get(pattern)
        if items:
            candidates.extend(item.name for item in items)
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
    mt5.symbol_select(candidates[0], True)
    return candidates[0]


def _account_payload() -> dict[str, Any]:
    info = mt5.account_info()
    if info is None:
        raise HTTPException(status_code=503, detail={"error": "ACCOUNT_INFO_UNAVAILABLE", "last_error": _last_error()})

    now = datetime.now(timezone.utc)
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    deals = mt5.history_deals_get(day_start, now)
    day_pnl = sum(float(d.profit) + float(d.swap) + float(d.commission) for d in deals) if deals else 0.0
    positions = mt5.positions_get() or ()
    open_position_ids = {int(getattr(position, "identifier", 0) or 0) for position in positions}
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


def _authorize_runtime(request: Request) -> None:
    # CORS alone does not authorize a mutation. Exact Origin + per-process token
    # prevent another website from using the bridge to stop the local service.
    if request.headers.get("origin") not in ALLOWED_ORIGINS:
        raise HTTPException(status_code=403, detail={"error": "RUNTIME_ORIGIN_DENIED"})


@app.get("/v1/runtime")
def runtime(request: Request):
    _authorize_runtime(request)
    return {"instance": _instance, "closing": _closing.is_set(), "shutdown_token": _shutdown_token}


@app.post("/v1/shutdown")
def shutdown(request: Request):
    _authorize_runtime(request)
    if not secrets.compare_digest(request.headers.get("x-smartflow-shutdown", ""), _shutdown_token):
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
        symbol = _resolve_symbol()
        return {
            "ok": True,
            "read_only": True,
            "bridge": "SMARTFLOW_X_MT5",
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

        return {
            "source": "MT5",
            "symbol": symbol,
            "timeframe": tf,
            "requested_bars": count,
            "loaded_bars": len(values),
            "values": values,
            "tick": _tick_payload(symbol),
            "account": _account_payload(),
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
        values = mt5.positions_get() or ()
        open_position_ids = {int(getattr(position, "identifier", 0) or 0) for position in values}
        open_times = [
            int(getattr(position, "time", 0) or 0)
            for position in values
            if int(getattr(position, "time", 0) or 0) > 0
        ]
        if open_times:
            deals = mt5.history_deals_get(
                datetime.fromtimestamp(min(open_times), timezone.utc),
                datetime.now(timezone.utc),
            ) or ()
        else:
            deals = ()
        commissions: dict[int, float] = {}
        for deal in deals:
            position_id = int(getattr(deal, "position_id", 0) or 0)
            if position_id not in open_position_ids:
                continue
            commissions[position_id] = commissions.get(position_id, 0.0) + float(getattr(deal, "commission", 0.0) or 0.0)
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
        values = mt5.orders_get() or ()
        return {"observed_at": int(datetime.now(timezone.utc).timestamp() * 1000), "values": [{
            "ticket": int(o.ticket), "symbol": o.symbol, "type": str(o.type), "volume_initial": float(o.volume_initial),
            "price_open": float(o.price_open), "sl": float(o.sl), "tp": float(o.tp), "price_current": float(o.price_current), "time_setup": int(o.time_setup),
        } for o in values]}


@app.get("/v1/search-symbols")
def search_symbols(q: str = Query(default="", max_length=32), limit: int = Query(default=100, ge=1, le=250)):
    with _lock:
        _ensure_connected()
        needle = q.strip().upper()
        values = mt5.symbols_get() or ()
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
                continue
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
        return {"value": float(result), "currency": _account_payload()["currency"], "symbol": resolved}


if __name__ == "__main__":
    import uvicorn

    print(f"CRT Terminal MT5 Local Bridge -> http://{HOST}:{PORT}")
    print("READ ONLY: no order_send endpoint is exposed.")
    _server = uvicorn.Server(uvicorn.Config(app, host=HOST, port=PORT, log_level="info", timeout_graceful_shutdown=5))
    try:
        _server.run()
    finally:
        _closing.set()
        with _lock:
            mt5.shutdown()
        print("CRT Terminal: MT5 connection closed; bridge stopped.")
