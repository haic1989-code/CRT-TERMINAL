# CRT Terminal 0.1.39

- FX Replay engine 3.1 calculates P/L and risk from contract size for supported OTC instruments whose profit currency equals the deposit currency. Known currency mismatches are no longer priced using a current tick-value conversion.
- Fixed leverage mode identifiers: Forex 0 and CFD Leverage 4 scale with leverage; Forex No Leverage 5 does not.
- Imports capture a versioned broker financial profile with symbol/account settings, separate read-only BUY/SELL/BUY LIMIT/SELL LIMIT margin calibrations, sampled price/volume consistency, and hedged-margin rules. Unsupported profiles explain why financial simulation is blocked; tick playback remains available.
- New profiles estimate portfolio margin using entry and limit prices, contract calculation mode, fixed initial/maintenance amounts, larger-leg or basic hedge rules, and directional volume limits. Order admission includes opening spread/slippage and commission.
- Repeating an exact cacheable MT5 import refreshes the financial profile without downloading stored ticks. Profile revisions are append-only; runs pin their revision, leaving the original tick manifest and earlier reports unchanged.
- Reports identify contract P/L versus legacy estimates and frozen-profile margin versus legacy per-lot estimates. Current broker specifications are not historical specifications. Maintenance rates use inferred initial rates; sampled calibration is not a complete broker tier schedule.
- Netting, swap, stop-out, historical currency conversions/spec changes, and trade-session enforcement remain pending. Opposite orders with differing fixed initial/maintenance amounts are explicitly rejected pending a dedicated pre-trade model. Full native MT5 tester parity remains unconfirmed.
- Frontend/Rust compilation and Python syntax are checked separately from tests and installed Windows/update acceptance. This stage does not send live trading requests.

## Previous performance improvements retained

- Real ticks are stored in packed binary blocks; metadata and events remain in SQLite. Existing archives remain readable.
- Read-only MT5 history imports run in a separate process, avoiding the live bridge's Python lock. Exact same-source/range archives with corrected import boundaries are reused.
- MT5 requests enclose the requested milliseconds in full seconds and filter locally. Older imports could omit subsecond ticks at chunk boundaries: reimport legacy archives for accurate tests.
- FX Replay can read MT5 tick CSV/TSV exports from its displayed `FXReplay/inbox` folder. Explicit export timezone and symbol are required; bars/OHLC are rejected. MT5 supplies current symbol/account metadata at import; replay then works offline.
- Measured on this Windows machine: median write of 200,000 identical real ticks improved from 1.781 s to 0.064 s, with identical canonical SHA-256. Full cached MT5 week: 2,949,303 ticks in 3.52 s. Broker downloads and other datasets may take longer.
- Replay uses recorded timestamps, a whole-archive seek slider, speeds through 1000x, adjacent-window prefetch, and candle prefix indexing without future prices.
- EMA/ATR use verified MetaQuotes formulas by default; `indicator_model: legacy_v2` preserves older calculations. Engine version 3.1 is recorded in new reports.
- Fixed points/money unit mixing, total bar counts, missing exit quote valuation and Limit fills through gaps crossing SL.
- Outcomes still use estimated historical money/margin and a hedging position model. Native MT5 tester parity, netting, stop-out, broker sessions, historical FX conversion and swaps are not implemented/validated. Exchange symbols with Last charts are rejected by this Bid/Ask OTC simulator.
- No trading requests are sent by import/replay. DEMO execution guards and explicit update confirmation remain in place.
- Signed Windows installer and updater manifest are produced by GitHub Actions. Source validation does not confirm installation/update acceptance.
