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
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

API_VERSION = 2
DEFAULT_INITIAL_BALANCE = 10_000.0
DEFAULT_RISK_FRACTION = 0.005
MAX_CLOSED_BARS = 10_000
TIMEFRAMES_MS = {
    "M1": 60_000, "M5": 300_000, "M15": 900_000, "M30": 1_800_000,
    "H1": 3_600_000, "H4": 14_400_000, "D1": 86_400_000,
}


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
        tick_size = float(spec.get("trade_tick_size") or 0)
        value_profit = float(spec.get("trade_tick_value_profit") or spec.get("trade_tick_value") or 0)
        value_loss = float(spec.get("trade_tick_value_loss") or spec.get("trade_tick_value") or 0)
        self.state: dict[str, Any] = {}
        self.timeframe = str(params.get("timeframe", "M1")).upper()
        if self.timeframe not in TIMEFRAMES_MS:
            raise ValueError("timeframe musi być jednym z: M1, M5, M15, M30, H1, H4, D1.")
        self.timeframe_ms = TIMEFRAMES_MS[self.timeframe]
        self.initial_balance = _positive(params.get("initial_balance", DEFAULT_INITIAL_BALANCE), "Kapitał początkowy")
        self.risk_fraction = _positive(params.get("risk_fraction", DEFAULT_RISK_FRACTION), "Ryzyko na transakcję")
        if self.risk_fraction > 1:
            raise ValueError("risk_fraction musi być ułamkiem od 0 do 1, np. 0.005 dla 0,5%.")
        self.commission_per_lot_side = float(params.get("commission_per_lot_side", 0.0))
        self.slippage_points = float(params.get("slippage_points", 0.0))
        if not math.isfinite(self.commission_per_lot_side) or self.commission_per_lot_side < 0:
            raise ValueError("commission_per_lot_side musi być nieujemne.")
        if not math.isfinite(self.slippage_points) or self.slippage_points < 0:
            raise ValueError("slippage_points musi być nieujemne.")
        self.account_currency = str(params.get("account_currency") or "")
        self.money_pnl_available = bool(self.account_currency) and tick_size > 0 and value_profit > 0 and value_loss > 0
        self.now_ms = 0
        self.bid = 0.0
        self.ask = 0.0
        self.last = 0.0
        self.tick: dict[str, Any] = {}
        self.bars: deque[dict[str, Any]] = deque(maxlen=MAX_CLOSED_BARS)
        self.current_bar: dict[str, Any] | None = None
        self._bar_bucket_ms: int | None = None
        self._ema_state: dict[tuple[int, str], dict[str, Any]] = {}
        self._sma_state: dict[tuple[int, str], dict[str, Any]] = {}
        self._atr_state: dict[int, dict[str, Any]] = {}
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
        self.realized_pnl_account_currency = 0.0
        self.commission_paid = 0.0
        self.peak_equity_estimate = self.initial_balance
        self.max_drawdown_estimate = 0.0
        self._next_id = 1

    def _id(self) -> str:
        value = str(self._next_id)
        self._next_id += 1
        return value

    def _event(self, kind: str, **values: Any) -> None:
        self.event_count += 1
        print(json.dumps({"event": {"kind": kind, "time_msc": self.now_ms, "tick_sequence": self.tick.get("sequence"), **values}}, ensure_ascii=False, allow_nan=False, separators=(",", ":")), file=sys.__stdout__, flush=True)

    def _price_pnl(self, side: str, entry: float, exit_price: float, volume: float) -> float | None:
        tick_size = float(self.spec.get("trade_tick_size") or 0)
        value_profit = float(self.spec.get("trade_tick_value_profit") or self.spec.get("trade_tick_value") or 0)
        value_loss = float(self.spec.get("trade_tick_value_loss") or self.spec.get("trade_tick_value") or 0)
        if tick_size <= 0 or value_profit <= 0 or value_loss <= 0:
            return None
        direction = 1 if side == "buy" else -1
        price_delta = (exit_price - entry) * direction
        tick_value = value_profit if price_delta >= 0 else value_loss
        return price_delta / tick_size * tick_value * volume

    def _position_exit_quote(self, position: dict[str, Any]) -> float:
        return self.bid if position["side"] == "buy" else self.ask

    @property
    def unrealized_pnl_account_currency(self) -> float | None:
        total = 0.0
        for position in self.positions:
            price = self._position_exit_quote(position)
            if price <= 0:
                continue
            value = self._price_pnl(position["side"], position["entry_price"], price, position["volume"])
            if value is None:
                return None
            total += value
        return total

    @property
    def equity_estimate(self) -> float | None:
        if not self.money_pnl_available:
            return None
        unrealized = self.unrealized_pnl_account_currency
        if unrealized is None:
            return None
        return self.initial_balance + self.realized_pnl_account_currency + unrealized

    def _mark_equity(self) -> None:
        equity = self.equity_estimate
        if equity is None:
            return
        self.peak_equity_estimate = max(self.peak_equity_estimate, equity)
        self.max_drawdown_estimate = max(self.max_drawdown_estimate, self.peak_equity_estimate - equity)

    def risk_volume(self, stop_distance: float, risk_fraction: float | None = None) -> float:
        """Return a broker-step-aligned volume for a price-distance stop."""
        distance = _positive(stop_distance, "Odległość Stop Loss")
        fraction = self.risk_fraction if risk_fraction is None else _positive(risk_fraction, "Ryzyko na transakcję")
        if fraction > 1:
            raise ValueError("Ryzyko na transakcję musi być ułamkiem od 0 do 1.")
        tick_size = float(self.spec.get("trade_tick_size") or 0)
        tick_value = float(self.spec.get("trade_tick_value_loss") or self.spec.get("trade_tick_value") or 0)
        point = float(self.spec.get("point") or 0)
        if not self.account_currency or tick_size <= 0 or tick_value <= 0 or (self.slippage_points > 0 and point <= 0):
            raise ValueError("Manifest nie zawiera waluty konta oraz wiarygodnej wartości ticka straty; nie wyliczę wolumenu ryzyka.")
        capital = self.equity_estimate
        if capital is None:
            raise ValueError("Nie mogę obliczyć bieżącego kapitału w walucie konta; wolumen ryzyka pozostaje zablokowany.")
        if capital <= 0:
            raise ValueError("Kapitał symulacji jest równy lub niższy od zera; nie otwieram kolejnej pozycji.")
        risk_amount = capital * fraction
        loss_per_lot = ((distance + self.slippage_points * point) / tick_size * tick_value) + 2 * self.commission_per_lot_side
        raw_volume = risk_amount / loss_per_lot
        minimum = float(self.spec.get("volume_min") or 0)
        maximum = float(self.spec.get("volume_max") or 0)
        step = float(self.spec.get("volume_step") or 0)
        if step <= 0 or minimum <= 0:
            raise ValueError("Manifest symbolu nie zawiera poprawnego minimum i kroku wolumenu.")
        steps = max(0, math.floor((raw_volume - minimum + 1e-12) / step))
        volume = minimum + steps * step
        if raw_volume < minimum - 1e-12:
            raise ValueError("Wolumen wyliczony dla zadanego ryzyka byłby mniejszy od minimum brokera; nie podbijam ryzyka automatycznie.")
        if maximum > 0:
            volume = min(volume, maximum)
        return _volume(volume, self.spec)

    def round_price(self, price: float, direction: str = "nearest") -> float:
        value = _positive(price, "Cena")
        tick_size = float(self.spec.get("trade_tick_size") or self.spec.get("point") or 0)
        if tick_size <= 0:
            raise ValueError("Manifest symbolu nie zawiera poprawnego kroku ceny.")
        ratio = value / tick_size
        if direction == "down":
            ticks = math.floor(ratio + 1e-10)
        elif direction == "up":
            ticks = math.ceil(ratio - 1e-10)
        elif direction == "nearest":
            ticks = round(ratio)
        else:
            raise ValueError("direction musi być jednym z: down, up, nearest.")
        digits = int(self.spec.get("digits") or 8)
        return round(ticks * tick_size, max(0, min(digits, 12)))

    def _source_value(self, bar: dict[str, Any], source: str) -> float:
        if source not in {"open", "high", "low", "close"}:
            raise ValueError("Źródło średniej musi być jednym z: open, high, low, close.")
        return float(bar[source])

    def sma(self, period: int, source: str = "close") -> float | None:
        if source not in {"open", "high", "low", "close"}:
            raise ValueError("Źródło średniej musi być jednym z: open, high, low, close.")
        period = int(period)
        if period < 1 or period > MAX_CLOSED_BARS:
            raise ValueError(f"Okres SMA musi mieścić się w zakresie 1–{MAX_CLOSED_BARS} świec.")
        key = (period, source)
        state = self._sma_state.get(key)
        if state is None:
            values = deque((self._source_value(bar, source) for bar in list(self.bars)[-period:]), maxlen=period)
            state = {"values": values, "total": sum(values)}
            self._sma_state[key] = state
        return state["total"] / period if len(state["values"]) == period else None

    def ema(self, period: int, source: str = "close") -> float | None:
        if source not in {"open", "high", "low", "close"}:
            raise ValueError("Źródło średniej musi być jednym z: open, high, low, close.")
        period = int(period)
        if period < 1 or period > MAX_CLOSED_BARS:
            raise ValueError(f"Okres EMA musi mieścić się w zakresie 1–{MAX_CLOSED_BARS} świec.")
        key = (period, source)
        state = self._ema_state.get(key)
        if state is None:
            values = [self._source_value(bar, source) for bar in self.bars]
            state = {"seed": [], "value": None}
            for value in values:
                self._advance_ema(state, value, period)
            self._ema_state[key] = state
        return state["value"]

    @staticmethod
    def _advance_ema(state: dict[str, Any], value: float, period: int) -> None:
        if state["value"] is not None:
            alpha = 2.0 / (period + 1.0)
            state["value"] = alpha * value + (1.0 - alpha) * state["value"]
            return
        state["seed"].append(value)
        if len(state["seed"]) >= period:
            state["value"] = sum(state["seed"][-period:]) / period
            state["seed"] = []

    def atr(self, period: int) -> float | None:
        period = int(period)
        if period < 1 or period > MAX_CLOSED_BARS:
            raise ValueError(f"Okres ATR musi mieścić się w zakresie 1–{MAX_CLOSED_BARS} świec.")
        state = self._atr_state.get(period)
        if state is None:
            state = {"seed": [], "value": None, "previous_close": None}
            for bar in self.bars:
                self._advance_atr(state, bar, period)
            self._atr_state[period] = state
        return state["value"]

    @staticmethod
    def _advance_atr(state: dict[str, Any], bar: dict[str, Any], period: int) -> None:
        previous_close = state["previous_close"]
        high, low, close = float(bar["high"]), float(bar["low"]), float(bar["close"])
        true_range = high - low if previous_close is None else max(high - low, abs(high - previous_close), abs(low - previous_close))
        state["previous_close"] = close
        if state["value"] is not None:
            state["value"] = ((period - 1) * state["value"] + true_range) / period
            return
        state["seed"].append(true_range)
        if len(state["seed"]) >= period:
            state["value"] = sum(state["seed"][-period:]) / period
            state["seed"] = []

    def _close_bar(self) -> None:
        if self.current_bar is None:
            return
        bar = self.current_bar
        self.bars.append(bar)
        for (period, source), state in self._sma_state.items():
            values = state["values"]
            if len(values) == period:
                state["total"] -= values[0]
            values.append(self._source_value(bar, source))
            state["total"] += values[-1]
        for (period, source), state in self._ema_state.items():
            self._advance_ema(state, self._source_value(bar, source), period)
        for period, state in self._atr_state.items():
            self._advance_atr(state, bar, period)
        self.current_bar = None

    def _update_bar(self, time_msc: int, bid: float) -> None:
        if bid <= 0:
            return
        bucket = (time_msc // self.timeframe_ms) * self.timeframe_ms
        if self._bar_bucket_ms is None:
            self._bar_bucket_ms = bucket
            self.current_bar = {"time_msc": bucket, "open": bid, "high": bid, "low": bid, "close": bid, "tick_count": 1}
            return
        if bucket < self._bar_bucket_ms:
            raise ValueError("Tick cofnął czas względem aktualnie budowanej świecy.")
        if bucket > self._bar_bucket_ms:
            self._close_bar()
            self._bar_bucket_ms = bucket
            self.current_bar = {"time_msc": bucket, "open": bid, "high": bid, "low": bid, "close": bid, "tick_count": 1}
            return
        assert self.current_bar is not None
        self.current_bar["high"] = max(self.current_bar["high"], bid)
        self.current_bar["low"] = min(self.current_bar["low"], bid)
        self.current_bar["close"] = bid
        self.current_bar["tick_count"] += 1

    def _finalize_bars(self) -> None:
        self._close_bar()

    def _open(self, side: str, volume: float, price: float, sl: float | None, tp: float | None, order_type: str = "market") -> str:
        sl = _price(sl, self.spec, "Stop Loss") if sl is not None else None
        tp = _price(tp, self.spec, "Take Profit") if tp is not None else None
        if side == "buy" and ((sl is not None and sl >= price) or (tp is not None and tp <= price)):
            raise ValueError("BUY wymaga SL poniżej i TP powyżej ceny wejścia.")
        if side == "sell" and ((sl is not None and sl <= price) or (tp is not None and tp >= price)):
            raise ValueError("SELL wymaga SL powyżej i TP poniżej ceny wejścia.")
        position_id = self._id()
        estimated_risk = None
        if sl is not None:
            gross_stop = self._price_pnl(side, price, sl, volume)
            if gross_stop is not None:
                tick_size = float(self.spec.get("trade_tick_size") or 0)
                tick_loss = float(self.spec.get("trade_tick_value_loss") or self.spec.get("trade_tick_value") or 0)
                point = float(self.spec.get("point") or 0)
                exit_slippage = self.slippage_points * point / tick_size * tick_loss * volume if tick_size > 0 else 0.0
                estimated_risk = abs(gross_stop) + exit_slippage + 2 * self.commission_per_lot_side * volume
        entry_commission = self.commission_per_lot_side * volume
        self.commission_paid += entry_commission
        self.realized_pnl_account_currency -= entry_commission
        position = {
            "id": position_id, "side": side, "volume": volume, "entry_price": price,
            "initial_volume": volume, "entry_time_msc": self.now_ms, "sl": sl, "tp": tp,
            "entry_commission_remaining": entry_commission,
        }
        self.positions.append(position)
        self._event("entry", position_id=position_id, side=side, volume=volume, price=price, sl=sl, tp=tp, estimated_risk_account_currency=abs(estimated_risk) if estimated_risk is not None else None, commission=entry_commission, order_type=order_type)
        self._mark_equity()
        return position_id

    def _market_price(self, side: str, opening: bool) -> float:
        point = float(self.spec.get("point") or 0)
        slip = self.slippage_points * point
        if opening:
            return self.ask + slip if side == "buy" else self.bid - slip
        return self.bid - slip if side == "buy" else self.ask + slip

    def buy(self, volume: float, sl: float | None = None, tp: float | None = None) -> str:
        if self.ask <= 0:
            raise ValueError("Brak ceny Ask dla symulowanego BUY.")
        return self._open("buy", _volume(volume, self.spec), self._market_price("buy", True), sl, tp)

    def sell(self, volume: float, sl: float | None = None, tp: float | None = None) -> str:
        if self.bid <= 0:
            raise ValueError("Brak ceny Bid dla symulowanego SELL.")
        return self._open("sell", _volume(volume, self.spec), self._market_price("sell", True), sl, tp)

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
        price = self._market_price(position["side"], False)
        if price <= 0:
            raise ValueError("Brak ceny zamykającej pozycji.")
        self._close(position, close_volume, price, "strategy")

    def modify_position(self, position_id: str, *, sl: float | None = None, tp: float | None = None, clear_sl: bool = False, clear_tp: bool = False) -> None:
        position = next((item for item in self.positions if item["id"] == str(position_id)), None)
        if position is None:
            raise ValueError("Nie ma otwartej pozycji o podanym ID.")
        if (clear_sl and sl is not None) or (clear_tp and tp is not None):
            raise ValueError("Nie można jednocześnie ustawić i skasować tego samego poziomu.")
        next_sl = None if clear_sl else (_price(sl, self.spec, "Stop Loss") if sl is not None else position["sl"])
        next_tp = None if clear_tp else (_price(tp, self.spec, "Take Profit") if tp is not None else position["tp"])
        market = self._position_exit_quote(position)
        if position["side"] == "buy" and ((next_sl is not None and next_sl >= market) or (next_tp is not None and next_tp <= market)):
            raise ValueError("BUY wymaga SL poniżej bieżącego Bid i TP powyżej bieżącego Bid.")
        if position["side"] == "sell" and ((next_sl is not None and next_sl <= market) or (next_tp is not None and next_tp >= market)):
            raise ValueError("SELL wymaga SL powyżej bieżącego Ask i TP poniżej bieżącego Ask.")
        if next_sl == position["sl"] and next_tp == position["tp"]:
            return
        position["sl"], position["tp"] = next_sl, next_tp
        self._event("modify", position_id=position["id"], sl=next_sl, tp=next_tp)

    def cancel_pending(self, order_id: str) -> None:
        order = next((item for item in self.pending if item["id"] == str(order_id)), None)
        if order is None:
            raise ValueError("Nie ma oczekującego zlecenia o podanym ID.")
        self.pending.remove(order)
        self._event("cancel", order_id=order["id"], side=order["side"], price=order["price"], reason="strategy")

    def _close(self, position: dict[str, Any], volume: float, price: float, reason: str) -> None:
        direction = 1 if position["side"] == "buy" else -1
        price_change = (price - position["entry_price"]) * direction
        point = float(self.spec.get("point") or 0)
        points = price_change / point if point > 0 else None
        self.closed_volume += volume
        self.closed_positions += 1
        gross_pnl = self._price_pnl(position["side"], position["entry_price"], price, volume)
        fraction_closed = volume / position["volume"] if position["volume"] > 0 else 1.0
        entry_commission = float(position.get("entry_commission_remaining", 0.0)) * fraction_closed
        exit_commission = self.commission_per_lot_side * volume
        self.commission_paid += exit_commission
        if gross_pnl is not None:
            self.realized_pnl_account_currency += gross_pnl - exit_commission
        else:
            self.realized_pnl_account_currency -= exit_commission
        net_pnl = gross_pnl - entry_commission - exit_commission if gross_pnl is not None else None
        position["entry_commission_remaining"] = max(0.0, float(position.get("entry_commission_remaining", 0.0)) - entry_commission)
        if points is not None:
            self.points_volume_sum += points * volume
            self.points_volume_count += volume
            result = net_pnl if net_pnl is not None else points * volume
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
            points=points, gross_pnl_account_currency_estimate=gross_pnl,
            net_pnl_account_currency_estimate=net_pnl, commission=entry_commission + exit_commission,
            reason=reason,
        )
        position["volume"] -= volume
        if position["volume"] <= 1e-12:
            self.positions.remove(position)
        self._mark_equity()


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
    run_params = dict(params)
    run_params["account_currency"] = manifest.get("account_currency", "")
    context = ReplayContext(run_id, archive["symbol"], symbol_spec, run_params)
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
            context._update_bar(context.now_ms, context.bid)
            context._mark_equity()

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
                    context._close(position, position["volume"], context._market_price(position["side"], False), reason)

            with contextlib.redirect_stdout(io.StringIO()):
                module.on_tick(context, context.tick)
            processed += 1
            if processed % 100_000 == 0:
                print(json.dumps({"progress": processed}), flush=True)

        if processed == 0:
            raise ValueError("Archiwum nie zawiera ticków.")
        context._finalize_bars()
        with contextlib.redirect_stdout(io.StringIO()):
            module.on_stop(context)
        # A replay must not end with an unpriced position or a silently live limit.
        for position in list(context.positions):
            quote = context._market_price(position["side"], False)
            if quote <= 0:
                raise ValueError("Nie mogę rozliczyć otwartej pozycji na końcu archiwum bez prawidłowego Bid/Ask.")
            context._close(position, position["volume"], quote, "end_of_data")
        for pending in list(context.pending):
            context.pending.remove(pending)
            context._event("cancel", order_id=pending["id"], side=pending["side"], price=pending["price"], reason="end_of_data")
    finally:
        db.close()

    return {
        "api_version": API_VERSION,
        "archive_id": archive_id,
        "archive_sha256": archive["sha256"],
        "symbol": archive["symbol"],
        "strategy_sha256": hashlib.sha256(strategy_path.read_bytes()).hexdigest(),
        "params": {
            **params,
            "timeframe": context.timeframe,
            "initial_balance": context.initial_balance,
            "risk_fraction": context.risk_fraction,
            "commission_per_lot_side": context.commission_per_lot_side,
            "slippage_points": context.slippage_points,
            "account_currency": context.account_currency,
        },
        "timeframe": context.timeframe,
        "tick_count": processed,
        "bar_count": len(context.bars),
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
        "initial_balance": context.initial_balance,
        "account_currency": context.account_currency or None,
        "realized_pnl_account_currency_estimate": context.realized_pnl_account_currency if context.money_pnl_available else None,
        "unrealized_pnl_account_currency_estimate": context.unrealized_pnl_account_currency if context.money_pnl_available else None,
        "equity_account_currency_estimate": context.equity_estimate,
        "max_drawdown_account_currency_estimate": context.max_drawdown_estimate if context.equity_estimate is not None else None,
        "commission_paid": context.commission_paid,
        "costs": {"commission_per_lot_side": context.commission_per_lot_side, "slippage_points": context.slippage_points, "swap": "not modeled"},
        "money_metrics_available": context.money_pnl_available,
        "assumptions": [
            "Symulacja wykorzystuje wyłącznie zapisane ticki Bid/Ask; nie wysyła zleceń do MT5.",
            "BUY otwiera po Ask i zamyka po Bid; SELL otwiera po Bid i zamyka po Ask.",
            "Sygnały świecowe otrzymują wyłącznie świece zamknięte; niepełna świeca jest widoczna jako current_bar, a finalizuje się na końcu danych.",
            "Świece są agregowane z ticków Bid w koszykach wyrównanych do UTC; nie są pobranymi z MT5 świecami serwerowymi, a dla D1 granica dnia może się różnić od brokera.",
            "Otwarta pozycja jest rozliczana po ostatnim dostępnym kursie wykonywalnym; niewypełnione zlecenia oczekujące są anulowane na końcu archiwum.",
            "Spread pochodzi z Bid/Ask archiwum; poślizg i prowizja są parametrami symulacji, a swap nie jest modelowany.",
            "Pieniężny wynik i wolumen ryzyka są szacowane z wartości ticka oraz waluty konta zapisanych przy imporcie; nie odtwarzają historycznych zmian przelicznika walutowego ani zmian specyfikacji symbolu.",
            "Wynik punktowy używa punktu brokera z manifestu.",
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
