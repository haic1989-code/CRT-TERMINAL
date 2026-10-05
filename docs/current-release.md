# CRT Terminal 0.1.37

- FX Replay imports real ticks in adaptive MT5 ranges, targeting about 500,000 ticks per response and expanding empty ranges to one day to reduce Python/MT5 round trips.
- Import progress reports MT5 fetch time, SQLite write time, finalization time, and observed ticks per second so slow broker history responses can be separated from local storage time.
- Bulk archive writes use bounded SQLite cache with WAL/NORMAL synchronization, avoid an unused per-tick time index, and update SHA-256 during import instead of rescanning the complete archive afterward.
- Existing FX Replay archives remain usable; these changes affect new imports and do not require re-downloading history already stored locally.
- FX Replay archives the MT5 account balance, deposit currency, leverage, margin mode, symbol margin specification and broker-calculated BUY/SELL margin calibration at import time.
- FX Replay now offers editable starting balance and leverage for real-tick simulations, initialized from the selected archive's MT5 account snapshot.
- Simulated orders that exceed estimated free margin are recorded as `order_rejected`; the backtest continues and reports estimated peak margin, minimum free margin and rejected order count.
- Margin is an estimate calibrated with MT5 `order_calc_margin` at the import quote. Historical conversion rates, changing broker margin rules, stop-out, swaps and broker commission schedules are not reconstructed.
- Signed Windows installer and updater manifest are published by the GitHub Actions release workflow.
