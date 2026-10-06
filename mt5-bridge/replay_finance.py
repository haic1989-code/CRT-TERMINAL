from __future__ import annotations

"""OTC contract accounting from an immutable import-time broker profile.

No MT5 dependency and no network/trading calls. Currency conversion and dynamic
broker margin tiers require additional historical data; they are not guessed.
"""

import math
from typing import Any

PROFILE_VERSION = 1
# Numeric values verified against the MetaTrader5 Python SDK.
FOREX, CFD, CFD_LEVERAGE, FOREX_NO_LEVERAGE = 0, 2, 4, 5
CONTRACT_PNL_MODES = {FOREX, CFD, 3, CFD_LEVERAGE, FOREX_NO_LEVERAGE}
MARGIN_MODES = {FOREX, CFD, CFD_LEVERAGE, FOREX_NO_LEVERAGE}
LEVERAGED_MODES = {FOREX, CFD_LEVERAGE}
PRICE_MARGIN_MODES = {CFD, CFD_LEVERAGE}


def number(value: Any) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return 0.0
    value = float(value)
    return value if math.isfinite(value) else 0.0


def contract_pnl_available(spec: dict[str, Any], currency: str) -> bool:
    return (bool(currency) and str(spec.get("currency_profit") or "").upper() == currency.upper()
            and spec.get("trade_calc_mode") in CONTRACT_PNL_MODES
            and number(spec.get("trade_contract_size")) > 0)


def base_margin(spec: dict[str, Any], price: float, leverage: int, *, maintenance: bool = False,
                hedged: bool = False) -> float | None:
    """One lot in the symbol's margin currency, before its broker rate."""
    mode = spec.get("trade_calc_mode")
    if mode not in MARGIN_MODES or leverage <= 0 or price <= 0:
        return None
    initial = number(spec.get("margin_initial"))
    contract = number(spec.get("trade_contract_size"))
    if initial > 0:
        if hedged:
            value = number(spec.get("margin_hedged"))
        else:
            value = (number(spec.get("margin_maintenance")) or initial) if maintenance else initial
    else:
        value = number(spec.get("margin_hedged")) if hedged else contract
        if mode in PRICE_MARGIN_MODES:
            value *= price
    if mode in LEVERAGED_MODES:
        value /= leverage
    return value if math.isfinite(value) and value >= 0 and contract > 0 else None


def capture_profile(sdk: Any, symbol: str, spec: dict[str, Any], account: dict[str, Any],
                    tick: Any, broker: str, server: str) -> dict[str, Any]:
    """Read-only calibration; SDK order_calc_margin never submits an order.

    Separate rates for BUY/SELL and both LIMIT types. Price/volume probes detect
    a rate inconsistent with a static OTC formula at the sampled points only.
    This does not prove the absence of intermediate/historical broker tiers.
    """
    currency = str(account.get("currency") or "").upper()
    leverage = int(account.get("leverage") or 0)
    profile: dict[str, Any] = {
        "version": PROFILE_VERSION, "source": "MT5 symbol_info/account_info/order_calc_margin",
        "captured_at_ms": account.get("captured_at_ms"), "broker": broker, "server": server,
        "account_currency": currency, "account_margin_mode": account.get("margin_mode"),
        "reference_leverage": leverage, "margin_rates": {}, "calibration_samples": [],
        "margin_rate_source": "inferred initial rates; maintenance uses the same rate (estimate)",
        "historical_profile": False,
        "limitations": ["import-time specification, not historical changes", "sampled static rates, not a complete tier schedule",
                         "maintenance rates inferred from initial rates", "swap, stop-out and trade sessions not modeled"],
    }
    errors = []
    if account.get("margin_mode") != 2:
        errors.append("Rachunek MT5 nie używa hedgingu; netting nie jest jeszcze obsługiwany.")
    if not contract_pnl_available(spec, currency):
        errors.append("P/L wymaga obsługiwanego kontraktu i waluty zysku zgodnej z walutą konta.")
    if str(spec.get("currency_margin") or "").upper() != currency or not currency:
        errors.append("Margin wymaga dodatkowej historii przewalutowania; waluta margin różni się od waluty konta.")
    minimum, maximum = number(spec.get("volume_min")), number(spec.get("volume_max"))
    step = number(spec.get("volume_step"))
    if minimum <= 0 or maximum < minimum or step <= 0 or leverage <= 0:
        errors.append("Brakuje prawidłowej specyfikacji wolumenu lub dźwigni.")
    if spec.get("trade_calc_mode") not in MARGIN_MODES:
        errors.append("Nieobsługiwany typ wyliczania margin kontraktu.")
    if spec.get("margin_hedged_use_leg") is None or spec.get("margin_hedged") is None:
        errors.append("Brakuje reguły margin dla pozycji przeciwstawnych.")
    if not errors:
        midpoint = minimum + math.floor((maximum - minimum) / (2 * step)) * step
        volumes = sorted({minimum, midpoint, maximum})
        for side, type_name in (("buy", "BUY"), ("sell", "SELL"), ("buy_limit", "BUY_LIMIT"), ("sell_limit", "SELL_LIMIT")):
            order_type = getattr(sdk, f"ORDER_TYPE_{type_name}", None)
            price = number(getattr(tick, "ask" if side.startswith("buy") else "bid", 0))
            raw = base_margin(spec, price, leverage)
            if raw is None or raw <= 0 or order_type is None:
                errors.append(f"Brak ceny lub wzoru kalibracji {side}.")
                continue
            rate = None
            samples = [(volume, price) for volume in volumes] + [(minimum, price * 1.25)]
            for volume, probe_price in samples:
                try:
                    required = sdk.order_calc_margin(order_type, symbol, volume, probe_price)
                except Exception:
                    required = None
                denominator = base_margin(spec, probe_price, leverage)
                if required is None or isinstance(required, bool) or not math.isfinite(float(required)) or float(required) < 0 or not denominator:
                    errors.append(f"MT5 nie udostępnił kalibracji {side}.")
                    break
                observed_rate = float(required) / (volume * denominator)
                profile["calibration_samples"].append({"order_type": side, "volume": volume, "price": probe_price, "margin": float(required)})
                if rate is None:
                    rate = observed_rate
                elif not math.isclose(float(required), rate * volume * denominator, rel_tol=0.001, abs_tol=0.01):
                    errors.append(f"Kalibracja {side} wskazuje zmienne stawki margin; potrzebny pełny grafik brokera.")
                    break
            else:
                profile["margin_rates"][side] = rate
    profile["errors"] = list(dict.fromkeys(errors))
    profile["supported"] = not errors and len(profile["margin_rates"]) == 4
    return profile


class BrokerMargin:
    """Single-symbol, same-currency hedging portfolio under frozen rates."""

    def __init__(self, spec: dict[str, Any], profile: dict[str, Any], leverage: int, currency: str):
        self.spec, self.profile, self.leverage = spec, profile, leverage
        self.rates = profile.get("margin_rates") or {}
        self.available = (profile.get("version") == PROFILE_VERSION and profile.get("supported") is True
                          and profile.get("account_currency") == currency
                          and str(spec.get("currency_margin") or "").upper() == currency
                          and profile.get("account_margin_mode") == 2
                          and spec.get("trade_calc_mode") in MARGIN_MODES
                          and all(isinstance(self.rates.get(key), (int, float)) and not isinstance(self.rates[key], bool)
                                  and math.isfinite(float(self.rates[key])) and self.rates[key] >= 0
                                  for key in ("buy", "sell", "buy_limit", "sell_limit")))
        self.price_factor = (number(spec.get("margin_initial")) == 0
                             and spec.get("trade_calc_mode") in PRICE_MARGIN_MODES)
        self.initial_coefficient = base_margin(spec, 1.0, leverage)
        self.maintenance_coefficient = base_margin(spec, 1.0, leverage, maintenance=True)
        self.hedged_coefficient = base_margin(spec, 1.0, leverage, maintenance=True, hedged=True)

    def one_lot(self, side: str, price: float, *, maintenance: bool = False, hedged: bool = False) -> float | None:
        if not self.available:
            return None
        if price <= 0:
            return None
        basic = self.hedged_coefficient if hedged else self.maintenance_coefficient if maintenance else self.initial_coefficient
        if basic is not None and self.price_factor:
            basic *= price
        return None if basic is None else basic * self.rates[side]

    def portfolio(self, positions: list[dict[str, Any]], pending: list[dict[str, Any]]) -> float | None:
        if not self.available:
            return None
        if not positions and not pending:
            return 0.0
        if len(positions) == 1 and not pending:
            position = positions[0]
            value = self.one_lot(position["side"], position["entry_price"], maintenance=True)
            return None if value is None else position["volume"] * value
        legs = {}
        for side in ("buy", "sell"):
            items = [p for p in positions if p["side"] == side]
            volume = sum(p["volume"] for p in items)
            price = sum(p["entry_price"] * p["volume"] for p in items) / volume if volume else 0.0
            legs[side] = (volume, price)
        pending_margin = {"buy": 0.0, "sell": 0.0}
        for order in pending:
            value = self.one_lot(f'{order["side"]}_limit', order["price"])
            if value is None:
                return None
            pending_margin[order["side"]] += order["volume"] * value
        buy_volume, buy_price = legs["buy"]
        sell_volume, sell_price = legs["sell"]
        if self.spec.get("margin_hedged_use_leg"):
            return max((buy_volume * (self.one_lot("buy", buy_price, maintenance=True) or 0)) + pending_margin["buy"],
                       (sell_volume * (self.one_lot("sell", sell_price, maintenance=True) or 0)) + pending_margin["sell"])
        covered = min(buy_volume, sell_volume)
        larger = "buy" if buy_volume >= sell_volume else "sell"
        volume, price = legs[larger]
        total = (volume - covered) * (self.one_lot(larger, price, maintenance=True) or 0)
        if covered > 0 and number(self.spec.get("margin_hedged")) > 0:
            price = (buy_price * buy_volume + sell_price * sell_volume) / (buy_volume + sell_volume)
            basic = self.hedged_coefficient
            if basic is None:
                return None
            if self.price_factor:
                basic *= price
            total += covered * basic * (self.rates["buy"] + self.rates["sell"]) / 2
        return total + pending_margin["buy"] + pending_margin["sell"]
