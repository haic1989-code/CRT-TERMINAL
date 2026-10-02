# Text Command Deck integration — 2026-10-01

The accepted frameless CLI menu replaces the default Matrix right-hand cards. The chart, MT5 read-only adapter, artwork, drawing engine and scope-specific persistence remain connected to their existing implementations. `?ui=legacy` keeps its existing layout and risk-based sizing.

## Accepted behavior

- Full introduction, fixed frameless `User` prompt, `yes` + Enter, then `welcome back admin :)`. This is a visual introduction, not authentication. Chart data loads before the menu is unlocked.
- Five aligned text sections: Market Context, Reference Levels, Indicators, Drawing Tools and Trade Planner. All options are available inline; context selection does not switch the chart timeframe.
- Chill/Normal/Power palettes and heading/status animation. Appearance is persisted; the introduction reappears on reload.
- Effects hides all menu text together, then drops the actual glyphs from above with individual random timing. Rewrite hides all text together and types it in word order. Each has intensity 1–5. These two modes are mutually exclusive. Pause, reduced motion and component cleanup restore the original text.
- Manual LOT control 0.01–1.00 replaces Risk %. Broker minimum/maximum/step still determine supported volume; unsupported minimum returns zero and volume never rounds up. Cash risk, chart target profit and margin queries use the resulting volume. Stop changes no longer silently resize the requested lot.
- TP controls retain chart placement and genuine lot allocations. No order submission was added. Qwen, Search and Command Palette remain retired.
- The former chart level picker is removed; the chart console now only reports selections and notifications.

## References and verification

`design/references/command-deck-text-approved.html` archives the accepted interactive proposal. Screenshots under `design/checkpoints/matrix-text-deck-*` show the integrated application using explicitly mocked MT5 data, not live account acceptance.

Build and all 95 unit tests passed. Browser coverage checks the full introduction, settings persistence, real chart handlers, manual lot margin requests, TP placement, drawing gestures and scope cancellation, palettes, text restoration, pause and reduced motion, QHD/1440/mobile containment and absence of MT5 writes. Full results are recorded after the final browser run.

The local terminal is served at http://127.0.0.1:5173/. MT5 and bridge connectivity require their own live runtime; fixture tests do not prove live feed availability. Existing bundle-size warnings are separate from this default Matrix menu change.

## Final validation

- Production build: PASS (TypeScript + Vite).
- Unit tests: PASS, 95 tests / 14 files.
- Default Matrix/browser regressions: PASS, 14 tests, including dedicated integration and effects coverage; fixtures explicitly mock MT5.
- Live local page: PASS for `yes` entry, welcome message and five sections; no JavaScript page errors. MT5/bridge were not running, so live quote acceptance is NOT RUN.
- Extended legacy module audit: FAIL on the existing `MANAGE POSITION` / managed-position overlay expectation. `src/ModuleDrawer.tsx` is identical to the pre-change baseline (SHA256 F0C094DBCFA1BF7D1D8CCE71953251CC1BF2DCDD6DC2F292CD1D51A1DF348978); it displays a read-only position source note. This change does not claim the old module audit is green. Test locator mistakes for duplicate sliders and already-closed drawers were repaired to reach this existing mismatch.

## Cursor and shutdown follow-up — 2026-10-01

Startup completion now returns keyboard focus to the frameless User input. The
extra cursor after the question is removed; the visible cursor is positioned
in the input, including before it receives focus.

EXIT unmounts the terminal, stops polling, and shows the same window styling as
startup with sequential `turning off indicators`, `turning off chart stream`,
`turning off terminal`, `closing MT5 connection`, and `BYE ADMIN !`. The final
message requires an accepted shutdown of the same bridge process and confirmed
loss of its runtime endpoint; transient request timeouts do not count as success.
Failure remains visible with retry. The browser tab can then be closed manually.

Validation: build PASS; 98 unit tests PASS; 16 bridge tests PASS; five dedicated
browser cases PASS across the final runs. The real MT5/browser check confirmed
focus after startup, terminal unmount, the BYE screen, closed bridge port, exited
bridge launcher, and no JavaScript page errors. MetaTrader remained running.
The bridge was restarted afterward for the user's interactive review. No orders
or position modifications were submitted. Screenshot: `matrix-terminal-shutdown-qhd.png`.
