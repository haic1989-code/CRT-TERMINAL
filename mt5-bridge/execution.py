"""Manual DEMO execution. Durable intent precedes every broker mutation."""
from __future__ import annotations

import hashlib
import json
import math
import os
import secrets
import sqlite3
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any, Callable

import MetaTrader5 as mt5
from fastapi import HTTPException
from quotes import quote_metadata

MAGIC = 20261003
UNRESOLVED = ("INTENT", "SUBMITTING", "ACKNOWLEDGED", "UNKNOWN")
# Only documented definite rejections release the account reservation. Future
# or unrecognized broker return codes remain ambiguous, never eligible for retry.
DEFINITE_REJECTIONS = frozenset((10004, 10006, 10007, 10013, 10014, 10015,
    10016, 10017, 10018, 10019, 10020, 10021, 10022, 10024, 10026, 10027,
    10030, 10032, 10033, 10034, 10035, 10042, 10043, 10044, 10045, 10046))


def deny(code: str, message: str, status: int = 409):
    raise HTTPException(status_code=status, detail={"error": code, "hint": message})


def required(value, label: str):
    if value is None:
        deny(label, "Nie dostałam kompletnych danych z MT5. Wstrzymuję wysyłkę.", 503)
    return value


def number(value: Any) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        deny("INVALID_NUMBER", "Potrzebuję poprawnych liczb w planie.", 400)
    return float(value)


def classify_pending_order(side: str, entry: float, bid: float, ask: float) -> str:
    reference = ask if side == "buy" else bid
    if entry == reference:
        deny("PENDING_AT_QUOTE", "Wejście jest równe aktualnemu Ask/Bid. Przesuń poziom i potwierdź plan ponownie.")
    if side == "buy":
        return "buy_limit" if entry < reference else "buy_stop"
    return "sell_limit" if entry > reference else "sell_stop"


def pending_order_type(kind: str) -> int:
    return {
        "buy_limit": mt5.ORDER_TYPE_BUY_LIMIT,
        "buy_stop": mt5.ORDER_TYPE_BUY_STOP,
        "sell_limit": mt5.ORDER_TYPE_SELL_LIMIT,
        "sell_stop": mt5.ORDER_TYPE_SELL_STOP,
    }[kind]


def backend_exception_message(error: Exception) -> str:
    """Expose a bounded local MT5 diagnostic without returning a traceback."""
    detail = " ".join(str(error).split())[:400]
    label = type(error).__name__
    return f"{label}: {detail}" if detail else label


def backend_http_error_message(detail: Any) -> str:
    """Retain the backend error code when a preflight rejection enters the journal."""
    if isinstance(detail, dict):
        code = str(detail.get("error", "")).strip()
        hint = str(detail.get("hint", "")).strip()
        if code and hint:
            return f"{code}: {hint}"
        if code or hint:
            return code or hint
    return " ".join(str(detail).split())[:400]


class ExecutionService:
    def __init__(self, ensure_connected: Callable[[], None], market_trade_open: Callable[[str], bool | None] | None = None):
        self.ensure_connected = ensure_connected
        self.market_trade_open = market_trade_open

    @contextmanager
    def journal(self):
        # One shared journal per Windows user, not per bridge/session/release.
        root = os.getenv("LOCALAPPDATA")
        if not root:
            deny("JOURNAL_UNAVAILABLE", "Nie mogę bezpiecznie zapisać zlecenia na tym komputerze.", 503)
        connection = None
        try:
            directory = Path(root) / "CRTTerminal" / "execution"
            directory.mkdir(parents=True, exist_ok=True)
            connection = sqlite3.connect(directory / "requests.sqlite3", timeout=3, isolation_level=None)
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA synchronous=FULL")
            connection.execute("PRAGMA journal_mode=WAL")
            if connection.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                raise sqlite3.DatabaseError("Journal integrity failure")
            connection.execute("CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, account_key TEXT NOT NULL, state TEXT NOT NULL, record TEXT NOT NULL)")
            yield connection
        except (sqlite3.Error, OSError):
            deny("JOURNAL_UNAVAILABLE", "Nie mogę potwierdzić trwałego zapisu. Nie wyślę kolejnego zlecenia.", 503)
        finally:
            if connection is not None:
                connection.close()

    def account(self, trading: bool = True):
        self.ensure_connected()
        account = required(mt5.account_info(), "ACCOUNT_UNAVAILABLE")
        terminal = required(mt5.terminal_info(), "TERMINAL_UNAVAILABLE")
        if account.trade_mode != mt5.ACCOUNT_TRADE_MODE_DEMO:
            deny("DEMO_ONLY", "To konto nie jest DEMO. Mogę je obserwować, ale nie wyślę zlecenia.")
        if trading and (not account.trade_allowed or not account.trade_expert or not terminal.trade_allowed or terminal.tradeapi_disabled):
            deny("TRADING_DISABLED", "MT5 nie pozwala teraz na handel z aplikacji. Sprawdź uprawnienia Algo Trading.")
        identity = {"login": int(account.login), "server": account.server, "terminal": os.path.normcase(os.path.abspath(terminal.path))}
        key = json.dumps([identity["login"], identity["server"]], separators=(",", ":"))
        return account, identity, key

    def status(self):
        account, identity, key = self.account(trading=False)
        terminal = required(mt5.terminal_info(), "TERMINAL_UNAVAILABLE")
        permitted = bool(account.trade_allowed and account.trade_expert and terminal.trade_allowed and not terminal.tradeapi_disabled)
        with self.journal() as db:
            unresolved = db.execute("SELECT id,state FROM requests WHERE account_key=? AND state IN (?,?,?,?)", (key, *UNRESOLVED)).fetchall()
        return {"mode": "DEMO_ONLY", "enabled": permitted and not unresolved, "account": identity,
                "reason": "Poprzednia wysyłka wymaga uzgodnienia." if unresolved else "MT5 nie pozwala na handel z aplikacji. Sprawdź Algo Trading." if not permitted else "",
                "unresolved": [{"clientRequestId": row["id"], "state": row["state"]} for row in unresolved]}

    @staticmethod
    def save(db, record):
        db.execute("UPDATE requests SET state=?,record=? WHERE id=?", (record["state"], json.dumps(record, allow_nan=False), record["clientRequestId"]))

    @staticmethod
    def load(db, request_id):
        row = db.execute("SELECT record FROM requests WHERE id=?", (request_id,)).fetchone()
        if row is None:
            deny("REQUEST_NOT_FOUND", "Nie znalazłam tego zlecenia w dzienniku. Niczego nie ponawiam.", 404)
        return json.loads(row[0])

    @staticmethod
    def public(record):
        return {key: record.get(key) for key in ("clientRequestId", "state", "account", "kind", "request", "expiresAt", "confirmationToken", "risk", "result", "message")}

    @staticmethod
    def symbol_context(symbol):
        info = required(mt5.symbol_info(symbol), "SYMBOL_UNAVAILABLE")
        if info.name != symbol:
            deny("SYMBOL_MISMATCH", "Nie będę zastępować symbolu innym instrumentem.")
        if not mt5.symbol_select(symbol, True):
            deny("SYMBOL_SELECT_FAILED", "MT5 nie udostępnił tego symbolu.")
        if number(info.trade_tick_size) <= 0 or number(info.point) <= 0:
            deny("SYMBOL_GRID_UNAVAILABLE", "Nie znam poprawnego kroku ceny tego instrumentu.")
        return info

    @staticmethod
    def snap(value, info):
        value = number(value)
        if value <= 0:
            deny("INVALID_PRICE", "Cena wejścia, SL i TP musi być dodatnia.")
        return round(round(value / info.trade_tick_size) * info.trade_tick_size, info.digits)

    def preflight(self, request, identity, side, *, preparing=False):
        """Read one current tick, classify, validate, then check the exact send request."""
        info = self.symbol_context(request["symbol"])
        tick = mt5.symbol_info_tick(request["symbol"])
        quote = quote_metadata(tick)
        if quote["error"]:
            deny(quote["error"], "Nie mam aktualnego, poprawnego notowania Bid/Ask z MT5.")
        reference = float(tick.ask if side == "buy" else tick.bid)
        if request["action"] == mt5.TRADE_ACTION_PENDING:
            kind = classify_pending_order(side, request["price"], tick.bid, tick.ask)
            request["type"] = pending_order_type(kind)
        else:
            kind = "market"
            if not preparing and abs(reference - request["price"]) > request["deviation"] * info.point + info.trade_tick_size * .01:
                deny("QUOTE_MOVED", "Cena uciekła poza wybrane odchylenie. Przygotuj nowe podsumowanie.")
            request["price"] = self.snap(reference, info)
        risk = self.guard(request, identity, info, tick)
        check = required(mt5.order_check(request), "ORDER_CHECK_UNAVAILABLE")
        if check.retcode != 0:
            deny("ORDER_CHECK_REJECTED", f"Broker odrzucił sprawdzenie: {check.retcode} · {check.comment}")
        if self.account()[1] != identity:
            deny("ACCOUNT_CHANGED", "Konto zmieniło się podczas sprawdzania. Przygotuj nowy plan.")
        return kind, risk

    def guard(self, request, identity, info, tick):
        account, current, _ = self.account()
        if current != identity:
            deny("ACCOUNT_CHANGED", "Konto lub terminal się zmienił. Przygotuj plan w nowej sesji.")
        symbol = request["symbol"]
        if self.market_trade_open is not None:
            session_open = self.market_trade_open(symbol)
            if session_open is None:
                deny("MARKET_SESSION_UNKNOWN", "Nie potwierdziłam godzin sesji symbolu. Uruchom pomocnik CRTMarketSessions w MT5.")
            if session_open is False:
                deny("MARKET_CLOSED", "Sesja handlowa symbolu jest zamknięta według grafiku brokera.")
        volume = request["volume"]
        step = float(info.volume_step)
        if step <= 0 or not (0 < info.volume_min <= volume <= info.volume_max) or abs(Decimal(str(volume)) % Decimal(str(step))) > Decimal("0.00000001"):
            deny("INVALID_VOLUME", "Lot nie pasuje do minimum, maksimum lub kroku brokera.")
        grid = float(info.trade_tick_size)
        if grid <= 0 or info.point <= 0:
            deny("SYMBOL_GRID_UNAVAILABLE", "Nie znam poprawnego kroku ceny tego instrumentu.")
        for field in ("price", "sl", "tp"):
            value = request[field]
            if value <= 0 or not math.isfinite(value) or abs(value / grid - round(value / grid)) > 0.000001:
                deny("INVALID_PRICE", "Cena, SL albo TP nie pasuje do kroku ceny brokera.")
        buying = request["type"] in (mt5.ORDER_TYPE_BUY, mt5.ORDER_TYPE_BUY_LIMIT, mt5.ORDER_TYPE_BUY_STOP, mt5.ORDER_TYPE_BUY_STOP_LIMIT)
        if info.trade_mode not in (mt5.SYMBOL_TRADE_MODE_FULL, mt5.SYMBOL_TRADE_MODE_LONGONLY if buying else mt5.SYMBOL_TRADE_MODE_SHORTONLY):
            deny("SYMBOL_TRADING_DISABLED", "Broker nie pozwala na ten kierunek transakcji.")
        pending = request["action"] == mt5.TRADE_ACTION_PENDING
        reference = float(tick.ask if buying else tick.bid)
        if pending:
            limit = request["type"] in (mt5.ORDER_TYPE_BUY_LIMIT, mt5.ORDER_TYPE_SELL_LIMIT)
            distance = reference - request["price"] if buying == limit else request["price"] - reference
            if distance <= 0 or distance + grid * .01 < info.trade_stops_level * info.point:
                deny("PENDING_PRICE_INVALID", "Cena oczekująca jest zbyt blisko rynku albo po niewłaściwej stronie.")
        entry = request["price"]
        if not (request["sl"] < entry < request["tp"] if buying else request["tp"] < entry < request["sl"]):
            deny("INVALID_STOPS", "Potrzebuję SL i TP po właściwych stronach wejścia.")
        minimum = info.trade_stops_level * info.point
        if min(abs(entry - request["sl"]), abs(entry - request["tp"])) + grid * .01 < minimum:
            deny("STOPS_TOO_CLOSE", "SL lub TP jest bliżej niż pozwala broker.")
        positions = required(mt5.positions_get(), "POSITIONS_UNAVAILABLE")
        orders = required(mt5.orders_get(), "ORDERS_UNAVAILABLE")
        if any(item.symbol == symbol for item in (*positions, *orders)):
            deny("SYMBOL_ALREADY_EXPOSED", "Masz już pozycję lub zlecenie na tym symbolu. W pierwszej wersji nie dokładam kolejnej ekspozycji.")
        equity = float(account.equity)
        if equity <= 0 or not math.isfinite(equity):
            deny("EQUITY_UNAVAILABLE", "Nie mam wiarygodnego kapitału konta.")
        order_type = mt5.ORDER_TYPE_BUY if buying else mt5.ORDER_TYPE_SELL
        loss = max(0.0, -number(required(mt5.order_calc_profit(order_type, symbol, volume, entry, request["sl"]), "RISK_UNAVAILABLE")))
        margin = number(required(mt5.order_calc_margin(order_type, symbol, volume, entry), "MARGIN_UNAVAILABLE"))
        existing_loss = 0.0
        buy_types = (mt5.ORDER_TYPE_BUY, mt5.ORDER_TYPE_BUY_LIMIT, mt5.ORDER_TYPE_BUY_STOP, mt5.ORDER_TYPE_BUY_STOP_LIMIT)
        sell_types = (mt5.ORDER_TYPE_SELL, mt5.ORDER_TYPE_SELL_LIMIT, mt5.ORDER_TYPE_SELL_STOP, mt5.ORDER_TYPE_SELL_STOP_LIMIT)
        for item in (*positions, *orders):
            item_volume = float(getattr(item, "volume", getattr(item, "volume_current", 0)))
            if item_volume <= 0 or item.sl <= 0 or item.price_open <= 0 or item.type not in (*buy_types, *sell_types):
                deny("PORTFOLIO_RISK_UNKNOWN", "Nie mogę policzyć ryzyka istniejącej pozycji lub zlecenia. Wstrzymuję wysyłkę.")
            side = mt5.ORDER_TYPE_BUY if item.type in buy_types else mt5.ORDER_TYPE_SELL
            # Equity is marked to market: existing positions risk the move from
            # the current price to SL, including a possible giveback of profit.
            risk_price = number(getattr(item, "price_current", item.price_open)) if hasattr(item, "volume") else number(item.price_open)
            if risk_price <= 0:
                deny("PORTFOLIO_RISK_UNKNOWN", "Nie mam aktualnej ceny istniejącej pozycji.")
            existing_loss += max(0.0, -number(required(mt5.order_calc_profit(side, item.symbol, item_volume, risk_price, item.sl), "PORTFOLIO_RISK_UNKNOWN")))
        now = datetime.now(timezone.utc)
        deals = required(mt5.history_deals_get(now.replace(hour=0, minute=0, second=0, microsecond=0), now), "HISTORY_UNAVAILABLE")
        trading_deals = [deal for deal in deals if deal.type in (mt5.DEAL_TYPE_BUY, mt5.DEAL_TYPE_SELL)]
        day_pnl = number(account.profit) + sum(sum(number(getattr(deal, field, 0)) for field in ("profit", "swap", "commission", "fee")) for deal in trading_deals)
        values = (loss, margin, existing_loss, day_pnl, account.margin, account.margin_free)
        if not all(math.isfinite(value) for value in values) or margin <= 0 or account.margin < 0:
            deny("RISK_UNAVAILABLE", "Wyliczenia brokera są niekompletne. Nie wyślę zlecenia.")
        if loss / equity * 100 > 2 or (loss + existing_loss) / equity * 100 > 5:
            deny("RISK_LIMIT", "Ten plan przekracza limit 2% na transakcję lub 5% dla portfela.")
        if max(0, -day_pnl) / equity * 100 >= 5:
            deny("DAILY_LOSS_LIMIT", "Osiągnięto dzienny limit straty 5%. Wstrzymuję nowe zlecenia.")
        if margin > account.margin_free or (account.margin + margin) / equity * 100 >= 60:
            deny("MARGIN_LIMIT", "Brakuje wolnego margin albo plan przekracza limit wykorzystania 60%.")
        if account.margin > 0 and (account.margin_level is None or account.margin_level <= 0 or not math.isfinite(account.margin_level)):
            deny("MARGIN_LEVEL_INVALID", "Nie mogę potwierdzić poziomu zabezpieczenia konta.")
        return {"loss": loss, "riskPercent": loss / equity * 100, "margin": margin, "currency": account.currency}

    def prepare(self, body):
        _, identity, key = self.account()
        try:
            request_id = str(uuid.UUID(body["clientRequestId"]))
        except (ValueError, KeyError, TypeError, AttributeError):
            deny("REQUEST_ID_REQUIRED", "Potrzebuję unikalnego identyfikatora zlecenia.", 400)
        if body.get("accountLogin") != identity["login"] or body.get("accountServer") != identity["server"]:
            deny("ACCOUNT_CHANGED", "Podsumowanie dotyczy innego konta. Odśwież dane.")
        # Consult durable idempotency before looking at a newer tick.
        fingerprint = hashlib.sha256(json.dumps(body, sort_keys=True, allow_nan=False).encode()).hexdigest()
        with self.journal() as db:
            existing = db.execute("SELECT record FROM requests WHERE id=?", (request_id,)).fetchone()
            if existing:
                record = json.loads(existing[0])
                if record["fingerprint"] != fingerprint or record["account"] != identity:
                    deny("REQUEST_CONFLICT", "Ten identyfikator był już użyty dla innego planu.")
                return self.public(record)
        symbol = body.get("symbol")
        if not isinstance(symbol, str) or not symbol or len(symbol) > 64:
            deny("INVALID_SYMBOL", "Wybierz dokładny symbol brokera.", 400)
        side, preview = body.get("side"), body.get("kind")
        if side not in ("buy", "sell") or preview not in ("pending", "market", "buy_limit", "buy_stop", "sell_limit", "sell_stop"):
            deny("INVALID_KIND", "Wybierz kierunek planu i zlecenie oczekujące albo rynkowe.", 400)
        pending = preview != "market"
        info = self.symbol_context(symbol)
        buying = side == "buy"
        deviation = body.get("deviationPoints")
        if type(deviation) is not int or not 0 <= deviation <= 100:
            deny("INVALID_DEVIATION", "Odchylenie ceny musi wynosić od 0 do 100 punktów.", 400)
        if pending:
            filling = mt5.ORDER_FILLING_RETURN
        elif info.trade_exemode in (mt5.SYMBOL_TRADE_EXECUTION_INSTANT, mt5.SYMBOL_TRADE_EXECUTION_REQUEST) or info.filling_mode & 1:
            filling = mt5.ORDER_FILLING_FOK
        elif info.filling_mode & 2:
            filling = mt5.ORDER_FILLING_IOC
        elif info.trade_exemode == mt5.SYMBOL_TRADE_EXECUTION_EXCHANGE:
            filling = mt5.ORDER_FILLING_RETURN
        else:
            deny("FILLING_UNAVAILABLE", "Nie znalazłam obsługiwanej polityki wykonania.")
        request = {"action": mt5.TRADE_ACTION_PENDING if pending else mt5.TRADE_ACTION_DEAL,
                   "symbol": symbol, "volume": number(body.get("volume")),
                   "type": mt5.ORDER_TYPE_BUY if buying else mt5.ORDER_TYPE_SELL,
                   "price": self.snap(body.get("entry"), info), "sl": self.snap(body.get("sl"), info),
                   "tp": self.snap(body.get("tp"), info), "deviation": deviation,
                   "magic": MAGIC, "comment": "J:" + uuid.UUID(request_id).hex[:24],
                   "type_time": mt5.ORDER_TIME_GTC, "type_filling": filling}
        kind, risk = self.preflight(request, identity, side, preparing=True)
        record = {"clientRequestId": request_id, "fingerprint": fingerprint, "account": identity,
                  "state": "PREPARED", "side": side, "kind": kind, "request": request, "risk": risk,
                  "expiresAt": int(time.time() * 1000) + 20000, "createdAt": time.time(),
                  "confirmationToken": secrets.token_urlsafe(24),
                  "message": f"MT5: {kind.upper().replace('_', ' ')}. Sprawdziłam plan przed wysyłką."}
        with self.journal() as db:
            db.execute("BEGIN IMMEDIATE")
            # A second bridge can prepare the same ID while this preflight runs.
            existing = db.execute("SELECT record FROM requests WHERE id=?", (request_id,)).fetchone()
            if existing:
                saved = json.loads(existing[0])
                if saved["fingerprint"] != fingerprint or saved["account"] != identity:
                    deny("REQUEST_CONFLICT", "Ten identyfikator był już użyty dla innego planu.")
                db.execute("COMMIT")
                return self.public(saved)
            if db.execute("SELECT id FROM requests WHERE account_key=? AND state IN (?,?,?,?)", (key, *UNRESOLVED)).fetchone():
                deny("UNRESOLVED_REQUEST", "Poprzednia wysyłka nie jest jeszcze uzgodniona. Najpierw sprawdźmy jej wynik.")
            db.execute("INSERT INTO requests VALUES (?,?,?,?)", (request_id, key, record["state"], json.dumps(record, allow_nan=False)))
            db.execute("COMMIT")
        return self.public(record)

    def execute(self, body):
        _, identity, key = self.account()
        try:
            request_id = str(uuid.UUID(body["clientRequestId"]))
        except (ValueError, KeyError, TypeError, AttributeError):
            deny("REQUEST_ID_REQUIRED", "Nie rozpoznałam identyfikatora podsumowania.", 400)
        with self.journal() as db:
            db.execute("BEGIN IMMEDIATE")
            record = self.load(db, request_id)
            if record["account"] != identity:
                deny("ACCOUNT_CHANGED", "To zlecenie należy do innego konta lub terminalu.")
            if not secrets.compare_digest(str(body.get("confirmationToken", "")), record["confirmationToken"]):
                deny("CONFIRMATION_INVALID", "Podsumowanie wysyłki nie zgadza się z zapisanym planem.", 403)
            if record["state"] != "PREPARED":
                db.execute("COMMIT")
                return self.public(record)  # Replay never calls order_send.
            if record.get("kind") == "pending":
                record.update(state="REJECTED", message="Stary typ Oczekujące nie jest już wysyłany. Wybierz konkretny typ Buy/Sell Limit/Stop i sprawdź plan ponownie.")
                self.save(db, record)
                db.execute("COMMIT")
                return self.public(record)
            if time.time() * 1000 > record["expiresAt"]:
                record.update(state="REJECTED", message="Podsumowanie wygasło. Przygotuj nowe, aby sprawdzić aktualną cenę.")
                self.save(db, record)
                db.execute("COMMIT")
                return self.public(record)
            if db.execute("SELECT id FROM requests WHERE account_key=? AND state IN (?,?,?,?)", (key, *UNRESOLVED)).fetchone():
                deny("UNRESOLVED_REQUEST", "Nie wyślę kolejnego zlecenia, dopóki poprzednia wysyłka nie zostanie uzgodniona.")
            record.update(state="INTENT", submittedAt=time.time())
            self.save(db, record)
            db.execute("COMMIT")
        request = record["request"]
        try:
            side = record.get("side") or ("buy" if request["type"] in (mt5.ORDER_TYPE_BUY, mt5.ORDER_TYPE_BUY_LIMIT, mt5.ORDER_TYPE_BUY_STOP) else "sell")
            record["kind"], record["risk"] = self.preflight(request, identity, side)
            # No reclassification or second tick gate after order_check.
            # This exact normalized dictionary is saved and sent once.
        except HTTPException as error:
            record.update(state="REJECTED", message=backend_http_error_message(error.detail))
            with self.journal() as db:
                self.save(db, record)
            return self.public(record)
        except Exception as error:
            # No order_send call has occurred on this path.
            record.update(state="REJECTED", message=f"Kontrola MT5 nie powiodła się ({backend_exception_message(error)}). Nie wysłałam zlecenia.")
            with self.journal() as db:
                self.save(db, record)
            return self.public(record)
        record["state"] = "SUBMITTING"
        with self.journal() as db:
            self.save(db, record)  # FULL synchronous durable barrier before mutation.
        try:
            result = mt5.order_send(request)
            if result is None:
                record.update(state="UNKNOWN", message="Nie dostałam wyniku od brokera. Nie ponawiam wysyłki; sprawdźmy wynik w MT5.")
            else:
                record["result"] = {"retcode": int(result.retcode), "order": int(result.order), "deal": int(result.deal), "volume": float(result.volume), "price": float(result.price), "comment": result.comment}
                accepted = result.retcode in (mt5.TRADE_RETCODE_DONE, mt5.TRADE_RETCODE_DONE_PARTIAL, mt5.TRADE_RETCODE_PLACED)
                uncertain = result.retcode not in DEFINITE_REJECTIONS or result.order > 0 or result.deal > 0
                record["state"] = "ACKNOWLEDGED" if accepted else "UNKNOWN" if uncertain else "REJECTED"
                record["message"] = (f"MT5: {record['kind'].upper().replace('_', ' ')}. Broker przyjął żądanie. Uzgadniam jego wynik." if accepted else "Wynik jest niejednoznaczny. Nie wyślę tego zlecenia ponownie." if uncertain else f"Broker odrzucił zlecenie: {result.retcode} · {result.comment}")
        except Exception as error:
            record.update(state="UNKNOWN", message=f"Wysyłka MT5 zwróciła błąd ({backend_exception_message(error)}). Wynik jest niepewny; sprawdzę dziennik bez ponowienia zlecenia.")
        with self.journal() as db:
            self.save(db, record)
        if record["state"] in UNRESOLVED:
            try:
                return self.read(request_id)
            except HTTPException:
                pass
        return self.public(record)

    def read(self, request_id):
        _, identity, _ = self.account(trading=False)
        with self.journal() as db:
            record = self.load(db, request_id)
        if record["account"] != identity:
            deny("ACCOUNT_CHANGED", "To zlecenie należy do innego konta lub terminalu.")
        if record["state"] not in UNRESOLVED:
            return self.public(record)
        start = datetime.fromtimestamp(record.get("submittedAt", record["createdAt"]) - 60, timezone.utc)
        now = datetime.now(timezone.utc)
        positions = required(mt5.positions_get(), "POSITIONS_UNAVAILABLE")
        orders = required(mt5.orders_get(), "ORDERS_UNAVAILABLE")
        history = required(mt5.history_orders_get(start, now), "HISTORY_UNAVAILABLE")
        deals = required(mt5.history_deals_get(start, now), "HISTORY_UNAVAILABLE")
        request = record["request"]
        result = record.get("result") or {}
        def matching(item):
            tagged = getattr(item, "magic", None) == MAGIC and request["comment"] in getattr(item, "comment", "")
            ticketed = result.get("order", 0) > 0 and (getattr(item, "ticket", None) == result["order"] or getattr(item, "order", None) == result["order"])
            return item.symbol == request["symbol"] and (tagged or ticketed)
        matching_orders = [item for item in (*orders, *history) if matching(item)]
        matching_deals = [item for item in deals if matching(item)]
        matching_positions = [item for item in positions if matching(item)]
        if self.account(trading=False)[1] != identity:
            deny("ACCOUNT_CHANGED", "Konto zmieniło się podczas uzgadniania wyniku.")
        if matching_orders or matching_deals or matching_positions:
            fill = sum(float(item.volume) for item in matching_deals if item.entry in (mt5.DEAL_ENTRY_IN, mt5.DEAL_ENTRY_INOUT))
            result.update(orderTickets=list({int(item.ticket) for item in matching_orders}), dealTickets=[int(item.ticket) for item in matching_deals], filledVolume=fill)
            record.update(state="RECONCILED", result=result,
                          message=f"Uzgodniłam wynik z MT5. Wykonany wolumen: {fill:g} lota." if fill > 0 else "Uzgodniłam zlecenie z MT5. Sprawdź jego bieżący stan w terminalu.")
            with self.journal() as db:
                self.save(db, record)
        else:
            record["message"] = "Nie potwierdziłam jeszcze wyniku w MT5. Nie ponawiam wysyłki i blokuję kolejne zlecenia na tym koncie."
        return self.public(record)
