from __future__ import annotations

"""Isolated FX Replay strategy runner. Uses only Python's standard library."""

import importlib.util
import contextlib
import io
import hashlib
import json
import math
import random
import sqlite3
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

API_VERSION = 1


def _positive(value: Any, label: str) -> float:
    if isinstance(value, bool):
        raise ValueError(f"{label} musi być dodatnią liczbą.")
    number = float(value)
    if not math.isfinite(number) or number <= 0:
        raise ValueError(f"{label} musi być dodatnią, skończoną liczbą.")
    return number


def _volume(value: Any, spec: dict[str, Any]) -> float:
    number = _positive(value, "Wolumen")
    minimum = float(spec.get("volume_min") or 0)
    maximum = float(spec.get("volume_max") or 0)
    step = float(spec.get("volume_step") or 0)
    if (minimum > 0 and number < minimum - 1e-9) or (maximum > 0 and number > maximum + 1e-9):
        raise ValueError("Wolumen jest poza zakresem min/max zapisanym dla symbolu.")
    if step > 0 and minimum > 0 and abs((number - minimum) / step - round((number - minimum) / step)) > 1e-7:
        raise ValueError("Wolumen nie pasuje do kroku wolumenu brokera.")
    return number


def _price(value: Any, spec: dict[str, Any], label: str) -> float:
    number = _positive(value, label)
    step = float(spec.get("trade_tick_size") or spec.get("point") or 0)
    if step > 0 and abs(number / step - round(number / step)) > 1e-6:
        raise ValueError(f"{label} nie pasuje do kroku ceny symbolu.")
    return number


class ReplayContext:
    def __init__(self, run_id: str, symbol: str, spec: dict[str, Any], params: dict[str, Any]):
        self.run_id = run_id
        self.symbol = symbol
        self.spec = spec
        self.params = params
        self.now_ms = 0
        self.bid = 0.0
        self.ask = 0.0
        self.last = 0.0
        self.tick: dict[str, Any] = {}
        self.positions: list[dict[str, Any]] = []
        self.pending: list[dict[str, Any]] = []
        self.event_count = 0
        self.closed_volume = 0.0
        self.closed_positions = 0
        self.winning_exits = 0
        self.losing_exits = 0
        self.breakeven_exits = 0
        self.net_points_volume = 0.0
        self.points_volume_sum = 0.0
        self.points_volume_count = 0.0
        self._next_id = 1

    def _id(self) -> str:
        value = str(self._next_id)
        self._next_id += 1
        return value

    def _event(self, kind: str, **values: Any) -> None:
        self.event_count += 1
        print(json.dumps({"event": {"kind": kind, "time_msc": self.now_ms, **values}}, ensure_ascii=False, allow_nan=False, separators=(",", ":")), file=sys.__stdout__, flush=True)

    def _open(self, side: str, volume: float, price: float, sl: float | None, tp: float | None, order_type: str = "market") -> str:
        sl = _price(sl, self.spec, "Stop Loss") if sl is not None else None
        tp = _price(tp, self.spec, "Take Profit") if tp is not None else None
        if side == "buy" and ((sl is not None and sl >= price) or (tp is not None and tp <= price)):
            raise ValueError("BUY wymaga SL poniżej i TP powyżej ceny wejścia.")
        if side == "sell" and ((sl is not None and sl <= price) or (tp is not None and tp >= price)):
            raise ValueError("SELL wymaga SL powyżej i TP poniżej ceny wejścia.")
        position_id = self._id()
        position = {
            "id": position_id, "side": side, "volume": volume, "entry_price": price,
            "entry_time_msc": self.now_ms, "sl": sl, "tp": tp,
        }
        self.positions.append(position)
        self._event("entry", position_id=position_id, side=side, volume=volume, price=price, order_type=order_type)
        return position_id

    def buy(self, volume: float, sl: float | None = None, tp: float | None = None) -> str:
        if self.ask <= 0:
            raise ValueError("Brak ceny Ask dla symulowanego BUY.")
        return self._open("buy", _volume(volume, self.spec), self.ask, sl, tp)

    def sell(self, volume: float, sl: float | None = None, tp: float | None = None) -> str:
        if self.bid <= 0:
            raise ValueError("Brak ceny Bid dla symulowanego SELL.")
        return self._open("sell", _volume(volume, self.spec), self.bid, sl, tp)

    def _limit(self, side: str, volume: float, price: float, sl: float | None, tp: float | None) -> str:
        limit_price = _price(price, self.spec, "Cena zlecenia limit")
        sl = _price(sl, self.spec, "Stop Loss") if sl is not None else None
        tp = _price(tp, self.spec, "Take Profit") if tp is not None else None
        if side == "buy" and ((sl is not None and sl >= limit_price) or (tp is not None and tp <= limit_price)):
            raise ValueError("BUY LIMIT wymaga SL poniżej i TP powyżej ceny limit.")
        if side == "sell" and ((sl is not None and sl <= limit_price) or (tp is not None and tp >= limit_price)):
            raise ValueError("SELL LIMIT wymaga SL powyżej i TP poniżej ceny limit.")
        if side == "buy" and self.ask > 0 and limit_price >= self.ask:
            raise ValueError("BUY LIMIT musi być poniżej aktualnego Ask.")
        if side == "sell" and self.bid > 0 and limit_price <= self.bid:
            raise ValueError("SELL LIMIT musi być powyżej aktualnego Bid.")
        order_id = self._id()
        normalized_volume = _volume(volume, self.spec)
        self.pending.append({"id": order_id, "side": side, "volume": normalized_volume, "price": limit_price, "sl": sl, "tp": tp, "created_at_msc": self.now_ms})
        self._event("pending", order_id=order_id, side=side, volume=volume, price=limit_price, order_type=f"{side}_limit")
        return order_id

    def buy_limit(self, volume: float, price: float, sl: float | None = None, tp: float | None = None) -> str:
        return self._limit("buy", volume, price, sl, tp)

    def sell_limit(self, volume: float, price: float, sl: float | None = None, tp: float | None = None) -> str:
        return self._limit("sell", volume, price, sl, tp)

    def close(self, position_id: str, volume: float | None = None) -> None:
        position = next((item for item in self.positions if item["id"] == str(position_id)), None)
        if position is None:
            raise ValueError("Nie ma otwartej pozycji o podanym ID.")
        close_volume = position["volume"] if volume is None else _volume(volume, self.spec)
        if close_volume > position["volume"] + 1e-12:
            raise ValueError("Wolumen zamknięcia przekracza pozycję.")
        remainder = position["volume"] - close_volume
        min_volume = float(self.spec.get("volume_min") or 0)
        if remainder > 1e-12 and min_volume > 0 and remainder < min_volume - 1e-9:
            raise ValueError("Częściowe zamknięcie pozostawiłoby pozycję poniżej minimalnego wolumenu symbolu.")
        if position["side"] == "buy":
            price = self.bid
        else:
            price = self.ask
        if price <= 0:
            raise ValueError("Brak ceny zamykającej pozycji.")
        self._close(position, close_volume, price, "strategy")

    def _close(self, position: dict[str, Any], volume: float, price: float, reason: str) -> None:
        direction = 1 if position["side"] == "buy" else -1
        price_change = (price - position["entry_price"]) * direction
        point = float(self.spec.get("point") or 0)
        points = price_change / point if point > 0 else None
        self.closed_volume += volume
        self.closed_positions += 1
        if points is not None:
            self.points_volume_sum += points * volume
            self.points_volume_count += volume
            result = points * volume
            self.net_points_volume += result
            if result > 0:
                self.winning_exits += 1
            elif result < 0:
                self.losing_exits += 1
            else:
                self.breakeven_exits += 1
        self._event(
            "exit", position_id=position["id"], side=position["side"], volume=volume,
            price=price, entry_price=position["entry_price"], price_change=price_change,
            points=points, reason=reason,
        )
        position["volume"] -= volume
        if position["volume"] <= 1e-12:
            self.positions.remove(position)


def _load_strategy(path: Path):
    spec = importlib.util.spec_from_file_location("crt_replay_user_strategy", path)
    if spec is None or spec.loader is None:
        raise ValueError("Nie można załadować pliku strategii Python.")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    for callback in ("on_start", "on_tick", "on_stop"):
        if not callable(getattr(module, callback, None)):
            raise ValueError(f"Strategia musi definiować funkcję {callback}(context{', tick' if callback == 'on_tick' else ''}).")
    return module


def run(database_path: Path, run_id: str, archive_id: str, strategy_path: Path, params: dict[str, Any]) -> dict[str, Any]:
    db = sqlite3.connect(f"{database_path.resolve().as_uri()}?mode=ro", uri=True)
    db.row_factory = sqlite3.Row
    archive = db.execute("SELECT * FROM archives WHERE id=? AND status='complete'", (archive_id,)).fetchone()
    if archive is None:
        raise ValueError("Archiwum nie istnieje albo nie jest kompletne.")
    manifest = json.loads(archive["manifest_json"])
    random.seed(int(archive["sha256"][:16], 16))
    symbol_spec = manifest.get("symbol_info") or {}
    context = ReplayContext(run_id, archive["symbol"], symbol_spec, params)
    module = _load_strategy(strategy_path)
    with contextlib.redirect_stdout(io.StringIO()):
        module.on_start(context)
    cursor = db.execute(
        "SELECT sequence,time_msc,bid,ask,last,volume,volume_real,flags FROM ticks WHERE archive_id=? ORDER BY sequence",
        (archive_id,),
    )
    processed = 0
    try:
        for row in cursor:
            context.now_ms = int(row["time_msc"])
            context.bid = float(row["bid"])
            context.ask = float(row["ask"])
            context.last = float(row["last"])
            context.tick = {"time_msc": context.now_ms, "bid": context.bid, "ask": context.ask, "last": context.last, "volume": int(row["volume"]), "volume_real": float(row["volume_real"]), "flags": int(row["flags"]), "sequence": int(row["sequence"])}

            # Limits fill at the first eligible broker quote, with price improvement.
            for pending in list(context.pending):
                if pending["side"] == "buy" and context.ask > 0 and context.ask <= pending["price"]:
                    context.pending.remove(pending)
                    context._open("buy", pending["volume"], context.ask, pending["sl"], pending["tp"], "buy_limit")
                    context._event("filled", order_id=pending["id"], side="buy", price=context.ask)
                elif pending["side"] == "sell" and context.bid > 0 and context.bid >= pending["price"]:
                    context.pending.remove(pending)
                    context._open("sell", pending["volume"], context.bid, pending["sl"], pending["tp"], "sell_limit")
                    context._event("filled", order_id=pending["id"], side="sell", price=context.bid)

            # SL/TP are checked on executable exit-side quotes, before strategy decisions.
            for position in list(context.positions):
                quote = context.bid if position["side"] == "buy" else context.ask
                if quote <= 0:
                    continue
                stop = position["sl"]
                target = position["tp"]
                reason = None
                if stop is not None and ((position["side"] == "buy" and quote <= stop) or (position["side"] == "sell" and quote >= stop)):
                    reason = "stop_loss"
                elif target is not None and ((position["side"] == "buy" and quote >= target) or (position["side"] == "sell" and quote <= target)):
                    reason = "take_profit"
                if reason:
                    context._close(position, position["volume"], quote, reason)

            with contextlib.redirect_stdout(io.StringIO()):
                module.on_tick(context, context.tick)
            processed += 1
            if processed % 100_000 == 0:
                print(json.dumps({"progress": processed}), flush=True)

        if processed == 0:
            raise ValueError("Archiwum nie zawiera ticków.")
        with contextlib.redirect_stdout(io.StringIO()):
            module.on_stop(context)
    finally:
        db.close()

    return {
        "api_version": API_VERSION,
        "archive_id": archive_id,
        "archive_sha256": archive["sha256"],
        "symbol": archive["symbol"],
        "strategy_sha256": hashlib.sha256(strategy_path.read_bytes()).hexdigest(),
        "params": params,
        "tick_count": processed,
        "event_count": context.event_count,
        "closed_exits": context.closed_positions,
        "winning_exits": context.winning_exits,
        "losing_exits": context.losing_exits,
        "breakeven_exits": context.breakeven_exits,
        "closed_volume": context.closed_volume,
        "net_points_volume": context.net_points_volume,
        "volume_weighted_points": context.points_volume_sum / context.points_volume_count if context.points_volume_count > 0 else None,
        "open_positions": context.positions,
        "pending_orders": context.pending,
        "costs": {"commission": "not modeled", "swap": "not modeled", "slippage": "not modeled"},
        "assumptions": [
            "Symulacja wykorzystuje wyłącznie zapisane ticki Bid/Ask; nie wysyła zleceń do MT5.",
            "BUY otwiera po Ask i zamyka po Bid; SELL otwiera po Bid i zamyka po Ask.",
            "Poślizg, prowizja i swap nie są modelowane.",
            "Wynik punktowy używa punktu brokera z manifestu; wynik pieniężny nie jest wyliczany.",
        ],
    }


if __name__ == "__main__":
    try:
        request = json.loads(sys.stdin.readline())
        report = run(Path(request["database_path"]), request["run_id"], request["archive_id"], Path(request["strategy_path"]), request["params"])
        print(json.dumps({"complete": True, "report": report}, ensure_ascii=False, allow_nan=False), flush=True)
    except Exception as error:
        print(json.dumps({"complete": False, "error": f"{error}\n{traceback.format_exc(limit=4)}"[-4000:]}, ensure_ascii=False), flush=True)
        raise SystemExit(1)
