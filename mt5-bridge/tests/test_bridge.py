import asyncio
import importlib
import sys
import time
import types
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch


class StubHTTPException(Exception):
    def __init__(self, status_code, detail=None):
        super().__init__(str(detail))
        self.status_code = status_code
        self.detail = detail


class StubFastAPI:
    def __init__(self, **_kwargs):
        self.middleware_calls = []

    def add_middleware(self, *args, **kwargs):
        self.middleware_calls.append((args, kwargs))

    def middleware(self, *_args, **_kwargs):
        return lambda fn: fn

    def get(self, *_args, **_kwargs):
        return lambda fn: fn

    def post(self, *_args, **_kwargs):
        return lambda fn: fn


def install_import_stubs():
    mt5 = types.ModuleType("MetaTrader5")
    for index, name in enumerate(("M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1"), start=1):
        setattr(mt5, f"TIMEFRAME_{name}", index)
    mt5.POSITION_TYPE_BUY = 0
    mt5.ORDER_TYPE_BUY = 0
    mt5.ORDER_TYPE_SELL = 1
    mt5.ORDER_TYPE_BUY_LIMIT = 2
    mt5.ORDER_TYPE_SELL_LIMIT = 3
    mt5.ORDER_TYPE_BUY_STOP = 4
    mt5.ORDER_TYPE_SELL_STOP = 5
    mt5.DEAL_ENTRY_OUT = 1
    mt5.DEAL_ENTRY_INOUT = 2
    mt5.DEAL_ENTRY_OUT_BY = 3
    for method in (
        "symbol_info", "symbols_get", "symbol_select", "symbol_info_tick", "order_calc_margin",
        "order_calc_profit", "last_error", "initialize", "shutdown", "terminal_info", "account_info",
        "history_deals_get", "copy_rates_from_pos", "positions_get", "orders_get", "version",
    ):
        setattr(mt5, method, lambda *_args, **_kwargs: None)
    sys.modules["MetaTrader5"] = mt5

    fastapi = types.ModuleType("fastapi")
    fastapi.FastAPI = StubFastAPI
    fastapi.HTTPException = StubHTTPException
    fastapi.Query = lambda default=None, **_kwargs: default
    fastapi.Request = type("Request", (), {})
    middleware = types.ModuleType("fastapi.middleware")
    cors = types.ModuleType("fastapi.middleware.cors")
    cors.CORSMiddleware = type("CORSMiddleware", (), {})
    responses = types.ModuleType("fastapi.responses")
    responses.JSONResponse = type("JSONResponse", (), {})
    sys.modules["fastapi"] = fastapi
    sys.modules["fastapi.middleware"] = middleware
    sys.modules["fastapi.middleware.cors"] = cors
    sys.modules["fastapi.responses"] = responses


install_import_stubs()
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
bridge = importlib.import_module("bridge")
execution = importlib.import_module("execution")


class BridgeTests(unittest.TestCase):
    def setUp(self):
        bridge._resolved_symbol = None
        bridge._identity = None
        bridge._next_initialize = 0.0
        bridge._daily_cache = None
        bridge._closing.clear()

    def test_native_weekly_bars_are_available_for_reference_levels(self):
        self.assertEqual(bridge.TIMEFRAMES["W1"], bridge.mt5.TIMEFRAME_W1)

    def test_cors_defaults_to_exact_origins_and_rejects_shared_host_wildcards(self):
        middleware_options = bridge.app.middleware_calls[0][1]
        self.assertNotIn("https://smartflow-x-visual-lab.onrender.com", middleware_options["allow_origins"])
        self.assertIn("http://tauri.localhost", middleware_options["allow_origins"])
        self.assertIn("http://127.0.0.1:5173", middleware_options["allow_origins"])
        self.assertIn("http://127.0.0.1:5174", middleware_options["allow_origins"])
        self.assertNotIn("https://another-project.vercel.app", middleware_options["allow_origins"])
        self.assertNotIn("allow_origin_regex", middleware_options)
        self.assertIn("https://preview.example.test", bridge._build_allowed_origins("https://preview.example.test"))
        self.assertIn("http://tauri.localhost", bridge._build_allowed_origins(""))
        with self.assertRaises(ValueError):
            bridge._build_allowed_origins("https://*.vercel.app")

    def test_private_network_header_is_only_granted_to_an_allowlisted_preflight(self):
        async def invoke(origin):
            response = types.SimpleNamespace(headers={})
            request = types.SimpleNamespace(
                method="OPTIONS",
                headers={
                    "origin": origin,
                    "access-control-request-private-network": "true",
                },
            )

            async def call_next(_request):
                return response

            await bridge.local_network_headers(request, call_next)
            return response.headers

        approved = asyncio.run(invoke("http://127.0.0.1:5173"))
        rejected = asyncio.run(invoke("https://another-project.vercel.app"))
        self.assertEqual(approved.get("Access-Control-Allow-Private-Network"), "true")
        self.assertNotIn("Access-Control-Allow-Private-Network", rejected)

    def test_positions_limits_history_query_to_oldest_open_position(self):
        oldest_open_time = int(time.time()) - 3600
        position = types.SimpleNamespace(
            ticket=7, identifier=71, symbol="XAUUSD.a", type=bridge.mt5.POSITION_TYPE_BUY,
            volume=0.1, price_open=2300.0, sl=2290.0, tp=2320.0, profit=3.0,
            swap=-0.1, time=oldest_open_time,
        )
        deals = [
            types.SimpleNamespace(position_id=71, commission=-0.25),
            types.SimpleNamespace(position_id=99, commission=-9.0),
        ]
        with patch.object(bridge, "_ensure_connected"), \
             patch.object(bridge.mt5, "positions_get", return_value=[position]), \
             patch.object(bridge.mt5, "history_deals_get", return_value=deals) as history:
            payload = bridge.positions()

        history.assert_called_once()
        self.assertEqual(history.call_args.args[0], datetime.fromtimestamp(oldest_open_time, timezone.utc))
        self.assertEqual(payload["values"][0]["commission"], -0.25)

        with patch.object(bridge, "_ensure_connected"), \
             patch.object(bridge.mt5, "positions_get", return_value=[]), \
             patch.object(bridge.mt5, "history_deals_get") as history:
            self.assertEqual(bridge.positions()["values"], [])
        history.assert_not_called()

    def test_requested_index_symbol_resolves_to_available_broker_alias(self):
        candidates = {
            "*DJ30*": [types.SimpleNamespace(name="DJ30.cash", currency_profit="USD")],
            "*US30*": [],
        }
        with patch.object(bridge, "_ensure_connected"), \
             patch.object(bridge.mt5, "symbol_info", return_value=None), \
             patch.object(bridge.mt5, "symbols_get", side_effect=lambda pattern: candidates.get(pattern, [])), \
             patch.object(bridge.mt5, "symbol_select", return_value=True):
            self.assertEqual(bridge._resolve_requested_symbol("DJ30"), "DJ30.cash")

    def test_configured_default_bitcoin_symbol_resolves_to_broker_alias(self):
        with patch.object(bridge, "PREFERRED_SYMBOL", "BTCUSD"), \
             patch.object(bridge, "_ensure_connected"), \
             patch.object(bridge.mt5, "symbol_info", return_value=None), \
             patch.object(bridge.mt5, "symbols_get", side_effect=lambda pattern: [types.SimpleNamespace(name="BTCUSD.pro", currency_profit="USD")] if pattern == "*BTC*" else []), \
             patch.object(bridge.mt5, "symbol_select", return_value=True):
            self.assertEqual(bridge._resolve_requested_symbol("BTCUSD"), "BTCUSD.pro")

    def test_tick_payload_exposes_freshness_and_bid_ask(self):
        tick_msc = int(time.time() * 1000) - 1000
        tick = types.SimpleNamespace(time_msc=tick_msc, time=tick_msc // 1000, bid=2300.1, ask=2300.3, last=2300.2, volume=4, volume_real=0.0, flags=1)
        with patch.object(bridge.mt5, "symbol_info_tick", return_value=tick):
            payload = bridge._tick_payload("XAUUSD.a")
        self.assertEqual(payload["freshness"], "fresh")
        self.assertEqual(payload["bid"], 2300.1)
        self.assertEqual(payload["ask"], 2300.3)
        self.assertLessEqual(payload["quote_age_ms"], 15000)

    def test_daily_win_rate_counts_only_completed_positions_closed_today(self):
        deals = [
            types.SimpleNamespace(position_id=11, entry=bridge.mt5.DEAL_ENTRY_OUT, profit=20, swap=-1, commission=-1, fee=0),
            types.SimpleNamespace(position_id=22, entry=bridge.mt5.DEAL_ENTRY_OUT_BY, profit=-10, swap=0, commission=0, fee=0),
            types.SimpleNamespace(position_id=33, entry=bridge.mt5.DEAL_ENTRY_OUT, profit=100, swap=0, commission=0, fee=0),
            types.SimpleNamespace(position_id=44, entry=0, profit=100, swap=0, commission=0, fee=0),
        ]
        self.assertEqual(bridge._daily_win_rate(deals, {33}), 50.0)

    def test_daily_win_rate_is_unavailable_without_a_completed_close(self):
        deals = [types.SimpleNamespace(position_id=11, entry=bridge.mt5.DEAL_ENTRY_OUT, profit=20)]
        self.assertIsNone(bridge._daily_win_rate(deals, {11}))
        self.assertIsNone(bridge._daily_win_rate([], set()))

    def test_account_payload_exposes_daily_win_rate(self):
        account = types.SimpleNamespace(
            login=1, server="Test", name="Trader", company="Broker", currency="USD", leverage=100,
            balance=1000, equity=1000, profit=0, margin=0, margin_free=1000, margin_level=None,
            trade_allowed=True, trade_expert=True, margin_mode=0, trade_mode=0,
        )
        deals = [types.SimpleNamespace(position_id=11, entry=bridge.mt5.DEAL_ENTRY_OUT, profit=20, swap=0, commission=0)]
        with patch.object(bridge, "_ensure_connected"), \
             patch.object(bridge.mt5, "account_info", return_value=account), \
             patch.object(bridge.mt5, "history_deals_get", return_value=deals), \
             patch.object(bridge.mt5, "positions_get", return_value=[]):
            payload = bridge._account_payload()
        self.assertEqual(payload["daily_win_rate"], 100.0)

    def test_margin_helper_uses_mt5_calculation_and_currency(self):
        with patch.object(bridge, "_ensure_connected"), \
             patch.object(bridge, "_resolve_requested_symbol", return_value="XAUUSD.a"), \
             patch.object(bridge.mt5, "order_calc_margin", return_value=420.5) as calc, \
             patch.object(bridge.mt5, "account_info", return_value=types.SimpleNamespace(currency="USD")), \
             patch.object(bridge, "_account_payload", return_value={"currency": "USD"}):
            result = bridge.calculate("margin", "XAUUSD", "buy", 0.2, 2300)
        calc.assert_called_once_with(bridge.mt5.ORDER_TYPE_BUY, "XAUUSD.a", 0.2, 2300)
        self.assertEqual(result, {"value": 420.5, "currency": "USD", "symbol": "XAUUSD.a"})

    def test_calculation_rejects_invalid_side_without_calling_terminal(self):
        with patch.object(bridge.mt5, "order_calc_margin") as calc:
            with self.assertRaises(StubHTTPException) as error:
                bridge.calculate("margin", "XAUUSD", "hold", 0.2, 2300)
        self.assertEqual(error.exception.status_code, 400)
        self.assertEqual(error.exception.detail["error"], "UNSUPPORTED_ORDER_SIDE")
        calc.assert_not_called()

    def test_profit_calculation_requires_valid_close_price(self):
        with self.assertRaises(StubHTTPException) as error:
            bridge.calculate("profit", "XAUUSD", "buy", 0.2, 2300, None)
        self.assertEqual(error.exception.status_code, 400)
        self.assertEqual(error.exception.detail["error"], "CLOSE_PRICE_REQUIRED")

    def test_shutdown_requires_exact_origin_and_process_token(self):
        controller = types.SimpleNamespace(should_exit=False)
        with patch.object(bridge, "_server", controller):
            for origin, token in [("https://evil.example", bridge._shutdown_token), (None, bridge._shutdown_token), ("http://127.0.0.1:5173", "wrong")]:
                request = types.SimpleNamespace(headers={"origin": origin, "x-crt-terminal-shutdown": token})
                with self.assertRaises(StubHTTPException) as error:
                    bridge.shutdown(request)
                self.assertEqual(error.exception.status_code, 403)
                self.assertFalse(controller.should_exit)
                self.assertFalse(bridge._closing.is_set())

    def test_shutdown_blocks_reconnect_and_requests_server_exit(self):
        request = types.SimpleNamespace(headers={"origin": "http://127.0.0.1:5173", "x-crt-terminal-shutdown": bridge._shutdown_token})
        controller = types.SimpleNamespace(should_exit=False)
        with patch.object(bridge, "_server", controller), patch.object(bridge.mt5, "initialize") as initialize:
            self.assertTrue(bridge.shutdown(request)["accepted"])
            self.assertTrue(controller.should_exit)
            with self.assertRaises(StubHTTPException) as error:
                bridge._ensure_connected()
            self.assertEqual(error.exception.detail["error"], "BRIDGE_SHUTTING_DOWN")
            initialize.assert_not_called()

    def test_runtime_does_not_initialize_mt5_when_it_is_offline(self):
        request = types.SimpleNamespace(headers={"origin": "http://127.0.0.1:5173"})
        with patch.object(bridge.mt5, "initialize") as initialize:
            result = bridge.runtime(request)
        self.assertEqual(result["instance"], bridge._instance)
        self.assertEqual(result["shutdown_token"], bridge._shutdown_token)
        initialize.assert_not_called()

    def test_execution_diagnostic_keeps_mt5_exception_without_a_traceback(self):
        from execution import backend_exception_message, backend_http_error_message

        error = RuntimeError("order_check failed: invalid stops")
        self.assertEqual(backend_exception_message(error), "RuntimeError: order_check failed: invalid stops")
        self.assertEqual(backend_exception_message(RuntimeError("  connection\n lost  ")), "RuntimeError: connection lost")
        self.assertEqual(backend_exception_message(RuntimeError("x" * 500)), f"RuntimeError: {'x' * 400}")
        self.assertEqual(backend_http_error_message({"error": "ORDER_CHECK_REJECTED", "hint": "Broker odrzucił sprawdzenie: 10016 · invalid stops"}),
                         "ORDER_CHECK_REJECTED: Broker odrzucił sprawdzenie: 10016 · invalid stops")


class ExecutionOrderTypeTests(unittest.TestCase):
    def test_pending_kinds_map_to_the_matching_mt5_order_type(self):
        expected = {
            "buy_limit": execution.mt5.ORDER_TYPE_BUY_LIMIT,
            "buy_stop": execution.mt5.ORDER_TYPE_BUY_STOP,
            "sell_limit": execution.mt5.ORDER_TYPE_SELL_LIMIT,
            "sell_stop": execution.mt5.ORDER_TYPE_SELL_STOP,
        }
        for kind, order_type in expected.items():
            with self.subTest(kind=kind):
                self.assertEqual(execution.pending_order_type(kind), order_type)


if __name__ == "__main__":
    unittest.main()
