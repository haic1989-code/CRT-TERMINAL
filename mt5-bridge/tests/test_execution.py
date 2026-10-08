"""Regression checks use a mocked MT5 module only; no broker requests are sent."""
import copy
import json
import os
import sqlite3
import tempfile
import threading
import time
import types
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
from unittest.mock import Mock, patch

from test_bridge import bridge, execution, StubHTTPException
from quotes import quote_metadata, MAX_QUOTE_AGE_MS


class ExecutionPipelineTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        directory = self.stack.enter_context(tempfile.TemporaryDirectory())
        self.stack.enter_context(patch.dict(os.environ, {"LOCALAPPDATA": directory}))
        constants = {
            "ACCOUNT_TRADE_MODE_DEMO": 0, "TRADE_ACTION_DEAL": 1, "TRADE_ACTION_PENDING": 5,
            "ORDER_TYPE_BUY": 0, "ORDER_TYPE_SELL": 1, "ORDER_TYPE_BUY_LIMIT": 2,
            "ORDER_TYPE_SELL_LIMIT": 3, "ORDER_TYPE_BUY_STOP": 4, "ORDER_TYPE_SELL_STOP": 5,
            "ORDER_TYPE_BUY_STOP_LIMIT": 6, "ORDER_TYPE_SELL_STOP_LIMIT": 7,
            "ORDER_FILLING_RETURN": 2, "ORDER_FILLING_FOK": 0, "ORDER_FILLING_IOC": 1,
            "ORDER_TIME_GTC": 0, "SYMBOL_TRADE_MODE_FULL": 4,
            "SYMBOL_TRADE_MODE_LONGONLY": 1, "SYMBOL_TRADE_MODE_SHORTONLY": 2,
            "SYMBOL_TRADE_EXECUTION_INSTANT": 1, "SYMBOL_TRADE_EXECUTION_REQUEST": 0,
            "SYMBOL_TRADE_EXECUTION_EXCHANGE": 3, "TRADE_RETCODE_PLACED": 10008,
            "TRADE_RETCODE_DONE": 10009, "TRADE_RETCODE_DONE_PARTIAL": 10010,
            "DEAL_TYPE_BUY": 0, "DEAL_TYPE_SELL": 1, "DEAL_ENTRY_IN": 0, "DEAL_ENTRY_INOUT": 2,
        }
        for name, value in constants.items():
            self.stack.enter_context(patch.object(execution.mt5, name, value, create=True))
        self.account = types.SimpleNamespace(login=1, server="Demo", trade_mode=0,
            trade_allowed=True, trade_expert=True, equity=10000., profit=0., margin=0.,
            margin_free=10000., margin_level=None, currency="USD")
        self.terminal = types.SimpleNamespace(path="MT5", trade_allowed=True, tradeapi_disabled=False)
        self.info = types.SimpleNamespace(name="XAUUSD.a", volume_min=.01, volume_max=100.,
            volume_step=.01, trade_tick_size=.01, point=.01, digits=2, trade_mode=4,
            trade_stops_level=10, trade_exemode=1, filling_mode=1)
        self.tick = types.SimpleNamespace(bid=99.5, ask=100.5, time=int(time.time()),
            time_msc=int(time.time() * 1000))
        values = {"account_info": self.account, "terminal_info": self.terminal,
            "symbol_info": self.info, "symbol_select": True, "symbol_info_tick": self.tick,
            "positions_get": [], "orders_get": [], "history_deals_get": [], "history_orders_get": [],
            "order_calc_profit": -1., "order_calc_margin": 1.,
            "order_check": types.SimpleNamespace(retcode=0, comment="OK"),
            "order_send": types.SimpleNamespace(retcode=10008, order=7, deal=0, volume=.01, price=100., comment="placed")}
        self.methods = {}
        for name, value in values.items():
            mock = Mock(return_value=value)
            self.stack.enter_context(patch.object(execution.mt5, name, mock, create=True))
            self.methods[name] = mock
        self.session = Mock(return_value=True)
        self.service = execution.ExecutionService(Mock(), self.session)

    def plan(self, side="buy", entry=100., preview="pending"):
        return {"clientRequestId": str(uuid.uuid4()), "accountLogin": 1, "accountServer": "Demo",
            "symbol": "XAUUSD.a", "side": side, "kind": preview, "volume": .01,
            "entry": entry, "sl": entry - 1 if side == "buy" else entry + 1,
            "tp": entry + 2 if side == "buy" else entry - 2, "deviationPoints": 20}

    def send_body(self, record):
        return {key: record[key] for key in ("clientRequestId", "confirmationToken")}

    def assert_denied(self, code, call):
        with self.assertRaises(StubHTTPException) as error:
            call()
        self.assertEqual(error.exception.detail["error"], code)
        self.methods["order_send"].assert_not_called()

    def test_all_four_types_are_classified_from_current_mt5_tick_and_sent_once(self):
        for side, entry, kind, order_type in (
            ("buy", 100., "buy_limit", 2), ("buy", 101., "buy_stop", 4),
            ("sell", 100., "sell_limit", 3), ("sell", 99., "sell_stop", 5),
        ):
            with self.subTest(kind=kind):
                # A definite mocked rejection releases the account for the next case.
                self.methods["order_send"].return_value.retcode = 10015
                prepared = self.service.prepare(self.plan(side, entry))
                self.assertEqual(prepared["kind"], kind)
                self.assertEqual(prepared["request"]["type"], order_type)
                self.methods["order_check"].reset_mock()
                self.methods["symbol_info_tick"].reset_mock()
                self.methods["order_send"].reset_mock()
                checked = []
                self.methods["order_check"].side_effect = lambda req: checked.append(copy.deepcopy(req)) or types.SimpleNamespace(retcode=0)
                result = self.service.execute(self.send_body(prepared))
                self.assertEqual(result["kind"], kind)
                self.methods["symbol_info_tick"].assert_called_once_with("XAUUSD.a")
                self.methods["order_check"].assert_called_once()
                self.methods["order_send"].assert_called_once()
                self.assertEqual(checked[0], self.methods["order_send"].call_args.args[0])
                self.assertEqual(result["request"], checked[0])

    def test_backend_overrides_frontend_preview_and_reclassifies_before_send(self):
        prepared = self.service.prepare(self.plan(preview="buy_stop"))
        self.assertEqual(prepared["kind"], "buy_limit")
        self.tick.bid, self.tick.ask = 98.5, 99.5
        result = self.service.execute(self.send_body(prepared))
        self.assertEqual(result["kind"], "buy_stop")
        self.assertEqual(result["request"]["type"], 4)
        self.assertEqual(self.methods["order_check"].call_args.args[0], self.methods["order_send"].call_args.args[0])

    def test_equal_reference_including_tick_grid_rounding_fails_closed(self):
        for side, entry in (("buy", 100.5), ("sell", 99.5), ("buy", 100.501)):
            with self.subTest(side=side, entry=entry):
                self.assert_denied("PENDING_AT_QUOTE", lambda: self.service.prepare(self.plan(side, entry)))

    def test_small_positive_clock_skew_is_accepted_without_changing_past_age_limit(self):
        self.tick.time_msc = int(time.time() * 1000) + 2500
        prepared = self.service.prepare(self.plan())
        self.service.execute(self.send_body(prepared))
        self.methods["order_send"].assert_called_once()
        self.assertEqual(MAX_QUOTE_AGE_MS, 15000)

    def test_old_missing_or_invalid_tick_never_reaches_order_check_or_send(self):
        cases = [
            ("STALE_QUOTE", types.SimpleNamespace(bid=99.5, ask=100.5, time_msc=int(time.time()*1000)-60000)),
            ("QUOTE_UNAVAILABLE", None),
            ("QUOTE_INVALID", types.SimpleNamespace(bid=0, ask=100.5, time_msc=int(time.time()*1000))),
            ("QUOTE_INVALID", types.SimpleNamespace(bid=101, ask=100, time_msc=int(time.time()*1000))),
            ("QUOTE_INVALID", types.SimpleNamespace(bid=float("nan"), ask=100, time_msc=int(time.time()*1000))),
            ("QUOTE_INVALID", types.SimpleNamespace(bid=99, ask=float("inf"), time_msc=int(time.time()*1000))),
            ("QUOTE_UNAVAILABLE", types.SimpleNamespace(bid=99, ask=100, time_msc=0, time=0)),
        ]
        for code, tick in cases:
            with self.subTest(code=code, tick=tick):
                self.methods["symbol_info_tick"].return_value = tick
                self.assert_denied(code, lambda: self.service.prepare(self.plan()))
        self.methods["order_check"].assert_not_called()

    def test_tick_becoming_old_before_send_rejects_the_durable_intent(self):
        prepared = self.service.prepare(self.plan())
        self.tick.time_msc -= 60000
        result = self.service.execute(self.send_body(prepared))
        self.assertEqual(result["state"], "REJECTED")
        self.assertIn("STALE_QUOTE", result["message"])
        self.methods["order_send"].assert_not_called()
        self.assertEqual(self.service.read(prepared["clientRequestId"])["state"], "REJECTED")

    def test_duplicate_prepare_uses_journal_even_when_tick_is_now_unavailable(self):
        body = self.plan()
        prepared = self.service.prepare(body)
        self.methods["symbol_info_tick"].return_value = None
        self.assertEqual(self.service.prepare(body), prepared)
        self.assert_denied("REQUEST_CONFLICT", lambda: self.service.prepare({**body, "volume": .02}))

    def test_replay_same_id_and_bridge_restart_cannot_resend(self):
        prepared = self.service.prepare(self.plan())
        body = self.send_body(prepared)
        self.service.execute(body)
        self.service.execute(body)
        restarted = execution.ExecutionService(Mock(), self.session)
        restarted.execute(body)
        self.methods["order_send"].assert_called_once()

    def test_concurrent_double_click_claims_intent_before_broker_validation(self):
        prepared = self.service.prepare(self.plan())
        entered, release = threading.Event(), threading.Event()
        def checking(_request):
            entered.set()
            if not release.wait(5):
                raise RuntimeError("test did not release preflight")
            return types.SimpleNamespace(retcode=0)
        self.methods["order_check"].side_effect = checking
        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(self.service.execute, self.send_body(prepared))
            try:
                self.assertTrue(entered.wait(5))
                duplicate = self.service.execute(self.send_body(prepared))
                self.assertEqual(duplicate["state"], "INTENT")
                self.methods["order_send"].assert_not_called()
            finally:
                release.set()
            first.result(timeout=5)
        self.methods["order_send"].assert_called_once()

    def test_uncertain_result_and_send_exception_require_reconciliation_without_resend(self):
        for error in (False, True):
            with self.subTest(exception=error), tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"LOCALAPPDATA": directory}):
                self.methods["order_send"].reset_mock()
                self.methods["order_send"].return_value = None
                self.methods["order_send"].side_effect = RuntimeError("transport interrupted") if error else None
                prepared = self.service.prepare(self.plan())
                body = self.send_body(prepared)
                result = self.service.execute(body)
                self.assertEqual(result["state"], "UNKNOWN")
                self.assertEqual(self.service.execute(body)["state"], "UNKNOWN")
                self.assertEqual(self.service.read(result["clientRequestId"])["state"], "UNKNOWN")
                self.assertFalse(self.service.status()["enabled"])
                self.assert_denied_after_send("UNRESOLVED_REQUEST", lambda: self.service.prepare(self.plan()))
                self.methods["order_send"].assert_called_once()

    def assert_denied_after_send(self, code, call):
        with self.assertRaises(StubHTTPException) as error:
            call()
        self.assertEqual(error.exception.detail["error"], code)

    def test_submitting_request_is_durable_and_identical_before_the_send_call(self):
        prepared = self.service.prepare(self.plan())
        def sending(request):
            with self.service.journal() as db:
                stored = self.service.load(db, prepared["clientRequestId"])
            self.assertEqual(stored["state"], "SUBMITTING")
            self.assertEqual(stored["request"], request)
            self.assertEqual(self.methods["order_check"].call_args.args[0], request)
            return None
        self.methods["order_send"].side_effect = sending
        self.service.execute(self.send_body(prepared))
        self.methods["order_send"].assert_called_once()

    def test_demo_only_permissions_symbol_session_volume_grid_and_stops_remain_required(self):
        for target, field, value, code in (
            (self.account, "trade_mode", 2, "DEMO_ONLY"),
            (self.account, "trade_allowed", False, "TRADING_DISABLED"),
            (self.account, "trade_expert", False, "TRADING_DISABLED"),
            (self.terminal, "tradeapi_disabled", True, "TRADING_DISABLED"),
            (self.info, "name", "XAUUSD", "SYMBOL_MISMATCH"),
            (self.info, "volume_min", .02, "INVALID_VOLUME"),
            (self.info, "volume_max", .001, "INVALID_VOLUME"),
            (self.info, "volume_step", .02, "INVALID_VOLUME"),
            (self.info, "trade_tick_size", 0., "SYMBOL_GRID_UNAVAILABLE"),
            (self.info, "point", 0., "SYMBOL_GRID_UNAVAILABLE"),
            (self.info, "trade_mode", 0, "SYMBOL_TRADING_DISABLED"),
            (self.info, "trade_stops_level", 1000, "PENDING_PRICE_INVALID"),
        ):
            with self.subTest(field=field), patch.object(target, field, value):
                self.assert_denied(code, lambda: self.service.prepare(self.plan()))
        for session, code in ((False, "MARKET_CLOSED"), (None, "MARKET_SESSION_UNKNOWN")):
            self.session.return_value = session
            self.assert_denied(code, lambda: self.service.prepare(self.plan()))
        self.session.return_value = True
        self.assert_denied("INVALID_STOPS", lambda: self.service.prepare({**self.plan(), "sl": 101.}))
        self.methods["order_check"].return_value.retcode = 10016
        self.assert_denied("ORDER_CHECK_REJECTED", lambda: self.service.prepare(self.plan()))

    def test_invalid_confirmation_expiry_and_journal_failure_cannot_send(self):
        prepared = self.service.prepare(self.plan())
        self.assert_denied("CONFIRMATION_INVALID", lambda: self.service.execute({**self.send_body(prepared), "confirmationToken": "wrong"}))
        with self.service.journal() as db:
            stored = self.service.load(db, prepared["clientRequestId"])
            stored["expiresAt"] = 1
            self.service.save(db, stored)
        self.assertEqual(self.service.execute(self.send_body(prepared))["state"], "REJECTED")
        with patch.object(execution.sqlite3, "connect", side_effect=sqlite3.DatabaseError("unavailable")):
            self.assert_denied("JOURNAL_UNAVAILABLE", lambda: self.service.prepare(self.plan()))
        self.methods["order_send"].assert_not_called()

    def test_bridge_auth_rejects_wrong_origin_owner_instance_and_token(self):
        with patch.object(bridge, "_execution_token", "secret"), patch.object(bridge, "_instance", "owner-instance"):
            bridge._closing.clear()
            good = {"origin": "http://tauri.localhost", "x-crt-instance": "owner-instance", "x-crt-execution": "secret"}
            for overrides in ({"origin": "https://evil.example"}, {"x-crt-instance": "other"}, {"x-crt-execution": "wrong"}):
                request = types.SimpleNamespace(headers={**good, **overrides})
                with self.assertRaises(StubHTTPException):
                    bridge.execution_prepare(request, self.plan())
            with patch.object(bridge, "_execution_token", ""):
                with self.assertRaises(StubHTTPException):
                    bridge.execution_execute(types.SimpleNamespace(headers=good), {})
            bridge._authorize_execution(types.SimpleNamespace(headers=good))
        self.methods["order_send"].assert_not_called()


class QuotePolicyTests(unittest.TestCase):
    def test_display_and_execution_share_exact_age_boundaries_and_second_fallback(self):
        now = 100000.
        for timestamp, fresh in ((now+2500, True), (now, True), (now-15000, True), (now-15001, False)):
            state = quote_metadata(types.SimpleNamespace(time_msc=timestamp, bid=99., ask=100.), now)
            self.assertEqual(state["freshness"] == "fresh", fresh)
        state = quote_metadata(types.SimpleNamespace(time_msc=0, time=99, bid=99., ask=100.), now)
        self.assertEqual(state["quote_age_ms"], 1000)
        self.assertEqual(quote_metadata(None, now)["error"], "QUOTE_UNAVAILABLE")
