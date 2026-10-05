# CRT Terminal 0.1.36

- FX Replay archives the MT5 account balance, deposit currency, leverage, margin mode, symbol margin specification and broker-calculated BUY/SELL margin calibration at import time.
- FX Replay now offers editable starting balance and leverage for real-tick simulations, initialized from the selected archive's MT5 account snapshot.
- Simulated orders that exceed estimated free margin are recorded as `order_rejected`; the backtest continues and reports estimated peak margin, minimum free margin and rejected order count.
- Margin is an estimate calibrated with MT5 `order_calc_margin` at the import quote. Historical conversion rates, changing broker margin rules, stop-out, swaps and broker commission schedules are not reconstructed.
- Signed Windows installer and updater manifest are published by the GitHub Actions release workflow.
