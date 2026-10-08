# DEMO pending execution flow

Planner supplies direction, exact broker symbol, account identity, volume and entry/SL/TP. Its LIMIT/STOP label is a preview. One explicit user confirmation creates a durable clientRequestId, calls prepare, and sends that confirmed plan once. A changed Planner cancels the send. UI tick timestamps, quote age, preview classification and session telemetry cannot authorize or reject execution.

For each prepare/send preflight, the owning authenticated backend reads symbol_info_tick directly once. The shared quotes.py policy requires a positive finite timestamp and valid positive Bid/Ask with Ask >= Bid. Past age over 15,000 ms fails closed. A timestamp ahead of Windows has age zero; negative elapsed time is clock skew, not evidence of an old tick. No frontend-clock fallback or widened stale-age threshold is used.

After snapping entry to the broker tick grid, LONG below/above Ask becomes BUY LIMIT/STOP; SHORT above/below Bid becomes SELL LIMIT/STOP. Exact equality fails closed with PENDING_AT_QUOTE. Send reclassifies from its newly read tick and returns the final kind; the panel displays the returned type. Direction, entry, volume and stops remain the user's confirmed intent.

Backend account/session/trading permission, exact symbol, volume min/max/step, tick size/point, stops, exposure and risk/margin checks precede order_check. The resulting normalized request is the same dictionary persisted at SUBMITTING and passed to order_send. No second tick read or reclassification follows order_check. Broker rejection remains authoritative.

SQLite BEGIN IMMEDIATE claims INTENT before final preflight. FULL synchronous WAL and durable SUBMITTING precede broker mutation. A duplicate ID returns its journal state; it cannot send again, including after restart. UNKNOWN/ACKNOWLEDGED states require reconciliation and block other account requests. There is no automatic resend.

Regression tests use only mocked MT5. They cover four pending kinds, backend preview override, prepare/send type change, clock skew, old/missing/invalid ticks, equality, concurrent clicks, durable barriers, restart, uncertain sends, authentication, DEMO-only, broker permissions and journal failure. Playwright exercises the real panel and transport with intercepted requests. CI runs the full JS/TS, Python, build and browser suites before any new signed updater release. Installed Windows/MT5 and update acceptance remain separate manual gates.
