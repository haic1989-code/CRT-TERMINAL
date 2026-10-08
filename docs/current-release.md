# CRT Terminal 0.1.45

- The bridge-provided `quote_age_ms` is the shared freshness source for the chart's live status and execution gate.
- Execution still requires a live quote no older than 15 seconds and valid positive Bid/Ask values with Ask at or above Bid. Invalid age data fails closed.
- A bounded timestamp calculation is used only when `quote_age_ms` is absent. The gate no longer derives safety from the truncated `lastTickAt` when bridge age is available.
- DEMO execution, bridge authentication, journal/idempotency, and pending LIMIT/STOP mapping are unchanged.

# CRT Terminal 0.1.44

- Pending orders are classified from the current fresh Bid/Ask: LONG below Ask is BUY LIMIT, LONG above Ask is BUY STOP, SHORT above Bid is SELL LIMIT, and SHORT below Bid is SELL STOP.
- Entry at the quote or invalid/stale Bid/Ask data keeps the order blocked.
- MT5 bridge validation and mapping cover all four pending order types.

# CRT Terminal 0.1.43

- Recovery no longer lets an orphaned browser-local pending-request ID block DEMO execution when the authoritative MT5 bridge status reports no unresolved request and that local-only ID returns HTTP 404 `REQUEST_NOT_FOUND`.
- Only that exact local-only 404 is cleared. Any request ID reported by the server journal, any other backend error, or any uncertain send state remains fail-closed and is never resent automatically.
- The structured execution error retains HTTP status and backend code so recovery decisions do not depend on parsing display text.
- DEMO-only, owning desktop session, execution token, durable SQLite journal, idempotency, risk checks and one-shot send controls are unchanged.
- Validation is delegated to CI before the signed updater release is published.

# CRT Terminal 0.1.42

- Execution confirmation now shows the bridge's HTTP status, backend error code and broker explanation instead of hiding them behind a generic handshake message.
- Bridge protocol/instance failures remain visible as handshake errors. Network transport failures are labeled separately and do not imply that an order was sent.
- MT5 preflight and send exceptions are retained as bounded diagnostics without tracebacks. A send exception remains `UNKNOWN`; reconciliation is required and automatic resend stays disabled.
- DEMO-only, owning desktop session, authentication token, durable request journal, idempotency, risk checks and one-shot send controls are unchanged.
- Validation: focused TypeScript tests, bridge Python tests, and production frontend build passed locally. CI and signed Windows/update acceptance remain pending.

# CRT Terminal 0.1.41

- Frontend cleanup completes the MarketChart modularization: chart construction, indicator lifecycle, drawing interactions and planner interactions are extracted into focused modules.
- CSS is split by terminal area, and confirmed-unused selectors were removed after checking runtime imports, dynamic states and visual coverage.
- No UI redesign, trading logic, FX Replay calculations, Planner semantics, drawing behavior or MT5 bridge protocol changes are intended.
- Validation: JavaScript unit tests, TypeScript/Vite build, Python bridge tests and syntax checks, Playwright visual tests, and `npm audit` passed in CI. Windows installation and in-app update acceptance remain unverified.

# CRT Terminal 0.1.40

- FX Replay history selection defaults to full local calendar days: the beginning of the first selected date through the last millisecond of the final selected date, inclusive. The default range is the last seven completed days, ending yesterday.
- Selecting today imports only through the moment the request starts, with an explicit Luna message that the day is incomplete. Future dates remain unavailable. An optional exact date/time mode retains intraday range selection and access to earlier cache ranges.
- Calendar boundaries use local date arithmetic, including daylight-saving transitions; archives still store UTC timestamps. No broker session timezone is guessed, and no ticks are synthesized outside a session.
- TypeScript/Vite and Rust compilation are separate from installed Windows acceptance. No local tests were added or run for this scoped date-selector fix.

## Broker accounting improvements retained (0.1.39)

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
