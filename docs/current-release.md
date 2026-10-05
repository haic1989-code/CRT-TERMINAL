# CRT Terminal 0.1.34

- FX Replay strategy API v2 provides tick-built, closed Bid OHLC candles and SMA/EMA/ATR indicators without exposing an unfinished candle as closed.
- The simulator adds broker-step price rounding, risk-based volume sizing, position SL/TP modification, pending-order cancellation, and end-of-archive position settlement.
- Replay reports record effective parameters and explicitly label money P&L as an estimate; financial figures remain unavailable when account currency or tick-value metadata is missing.
- Existing API v1 strategy source can be loaded into the editor and saved as a new v2 strategy without changing the old record.
- Strategy simulations remain local and never send trading requests to MT5.
- Windows installer and updater availability depends on the signed GitHub Actions release workflow completing successfully.
