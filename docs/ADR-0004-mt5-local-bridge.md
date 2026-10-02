# ADR-0004 — MT5 Local Bridge as broker truth

Status: CANDIDATE  
Date: 2026-09-26

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
