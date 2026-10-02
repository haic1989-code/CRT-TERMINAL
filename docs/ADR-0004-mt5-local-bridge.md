# ADR-0004 — MT5 Local Bridge as broker truth

Status: CANDIDATE  
Date: 2026-09-26

## Desktop protocol v2 — 2026-10-02, release 0.1.7

Each desktop launch starts its own bundled bridge on an OS-assigned loopback
port. The native host passes a unique owner and endpoint-file path. Discovery
checks ownership and protocol 2; HTTP responses additionally carry protocol and
instance headers. The application never adopts an existing listener on 8765.
Shutdown targets the discovered instance; native exit only terminates the
bootstrap process tree created by that application. Browser development still
uses the manually started protocol-v2 bridge on 8765.

Initialization uses the official MT5 Python API with a 5000 ms timeout.
Missing IPC information causes a throttled reinitialization; broker disconnect
is reported separately and waits for MT5 to reconnect. The first connected
account (login/server) and terminal directory are pinned for the lifetime of
the bridge. A changed identity is rejected and requires an explicit application
restart. `MT5_TERMINAL_PATH`, when set, must point to the desired terminal EXE.
No passwords are stored or supplied by CRT Terminal.

MT5 errors (`None`) are distinct from successful empty collections. Portfolio
read failures retain the last display snapshot but immediately invalidate its
freshness for Risk Guard. Ambiguous broker aliases and failed `symbol_select`
are errors. All client HTTP calls have a bounded timeout; serialized MT5 calls
have a bounded lock acquisition. Native MT5 calls themselves cannot be safely
cancelled by Python; an IPC call that never returns may require restarting the
application. Diagnostics include a per-session startup status and bridge log
in the application's local data directory.

Chart OHLC is always read from native MT5 bars, never synthesized from mid-price.
Recent bars and all affected indicator points are reconciled every polling
cycle. After an error, the next successful poll requests the initial 5000-bar
history window to fill gaps. Quotes and chart bars remain separate data types.
The live chart polls every second; this is not an every-tick capture service.

Planner profit/loss labels use MT5 `order_calc_profit` with actual allocated
lot sizes and account currency. Calculations are scoped to account, symbol,
side, levels and volume, periodically refreshed and cleared on failure.
These are gross price-based results; commissions and swap are not included.

Acceptance remains pending on real Windows MT5: disconnect/reconnect,
account switch, broker aliases, multiple application windows and installation
upgrade. Build success alone is not acceptance of these scenarios.

## Decision

SmartFlow X uses a local, read-only MetaTrader 5 bridge as the primary source for:

- broker account state,
- broker/server identity,
- XAUUSD symbol resolution,
- symbol metadata,
- bid/ask/last ticks,
- OHLC bars for M5 / M15 / M30 / H1 / H4.

The CRT Terminal browser preview connects directly to the local bridge on `127.0.0.1:8765`.

No market-data request is proxied through Vercel.

## Why

SmartFlow X will ultimately depend on MT5 for broker-specific account, symbol, risk and execution truth. Using MT5 for the chart now removes a temporary third-party data boundary and lets chart/risk/planner work against the same broker domain that later execution will use.

Official MetaTrader 5 Python integration exposes terminal initialization, account info, symbol info, ticks and bar history directly from the locally installed terminal.

## Security boundary

Phase 1 is read-only.

The bridge exposes no order placement endpoint and does not call `order_send`.

Trading/execution will be introduced only after the Risk Gateway milestone and a separate ADR.

## Browser preview

The bridge listens only on loopback (`127.0.0.1`). The Vercel preview performs a browser-to-localhost request, so account data does not transit through the Vercel backend.

The bridge returns CORS and local-network access headers for the private preview workflow.

## Symbol resolution

Default preference is `XAUUSD`, but the bridge searches broker variants such as:

- XAUUSD.a
- XAUUSDm
- GOLD

The user can force the broker symbol with `MT5_SYMBOL`.

## History

The chart requests 5000 bars by default.

The actual amount returned is authoritative from MT5 and is bounded by history available in the terminal, including the terminal's "Max. bars in chart" setting.

## Future desktop runtime

The Windows desktop runtime supervises the bridge as a local companion service, rather than requiring users to manage a separate development process.
