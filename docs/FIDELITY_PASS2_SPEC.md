# SmartFlow X — Fidelity Pass 2 specification (states 01–11)

**Status:** implementation brief for visual work

**Audit branch:** `agent/fidelity-audit`

**Source branch read without merge:** `origin/design/final-ui-assets` at `e64d0492a857b997e18a52943266b3ed1e24c19a`

**Checkout at capture:** `f6b8688bd07e241c5fbb15d15e9f13a7ac591a10`

**Capture viewport:** 2560×1440 CSS px, Playwright Desktop Chrome, full viewport screenshots
**Render 12 / VEGA redesign:** excluded; keep the VEGA artwork from Main Shell 00.

## 1. Inputs and audit method

Visual authority is the approved `design/assets/final-ui/00_main_shell.webp` plus module renders `01`–`11`. All twelve local render hashes match `design/assets/final-ui/SHA256SUMS.txt`. Behavioral and module-opening authority is `design/final-ui-assets/BLUEPRINT_FINAL_v1.0.md` read directly from the remote design ref above; it was not merged into this branch. `INTERACTION_BLUEPRINT.md` and `SOURCE_IMPLEMENTATION_MAP.md` on that same ref were also read for interaction boundaries and component ownership. Where the older interaction draft conflicts with Blueprint FINAL, FINAL wins (in particular, quick symbols are exactly XAUUSD, BTCUSD and DJ30).

Fresh captures are in the git-ignored local folder `artifacts/screenshots/`: `00_main_shell.png`, `01_trade_planner_pro.png` through `08_instrument_selector.png`, the three 09 views (`09_positions_orders_account.png`, `09_orders.png`, `09_account.png`), `10_command_palette.png`, `11_context_panel.png`, and `vega_context.png`. The existing capture scenario completed **1 passed**. PNG headers confirm 2560×1440 for every file. Its API responses are a synthetic visual fixture, not a live MT5 connection or evidence of production data. The 09 captures are all states of one module, not three additional blueprint screens.

## 2. Reading this specification

- **[V] Visual gap** means the capability/data is already present, but its composition, scale, visibility, or hierarchy is missing from the captured UI.
- **[F] Functional gap** means a behavior explicitly required by Blueprint FINAL is absent or cannot be confirmed in this visual-only audit. Do not imitate it with a dead control. Track it separately from visual implementation and use the existing engine/bridge contract if it is later authorized.
- **[KEEP]** marks a render detail that is not required by the blueprint. It is not a request to add a feature. This includes mock rows, unsupported indicators, extra alert types, and decorative controls that imply behavior.

The target is a coherent expanded state inside the approved shell, not a standalone replacement page. This pass changes presentation only. Preserve current event handlers, data contracts, engines, Risk Guard veto, and MT5/read-only boundaries.

## 3. Global shell and QHD visual contract

Use Main Shell 00 for every expanded state:

- Keep the continuous top telemetry bar, compact left instrument/VEGA rail, central chart toolbar/workspace, right compact Planner/Risk Guard rail, MTF strip, and bottom terminal. No new permanent sidebar, oversized brand panel, generic card grid, or full-page navigation.
- At 2560×1440 retain the shell’s current three-column proportions: each side rail is approximately 16–18% of viewport width; the central chart workspace is approximately 64–67% and remains the largest single region. The existing QHD CSS resolves the rails to about 410–470 px each. Do not enlarge either rail to make room for an expanded module.
- Drawer states 01–09 and 11 stay in the existing central chart frame, below the chart toolbar. Preserve the outer shell geometry and toolbar; opening a module must not push the grid sideways or permanently change column widths. Drawers may overlay the chart temporarily, as specified per state below. State 10 is the sole global overlay. State 09 is the sole expanded surface allowed to take vertical space from the chart.
- Reuse the Main Shell dark navy layered surfaces, clipped/angular cyan frame, selective magenta edges, and restrained glow. Cyan is structural/active; magenta is Planner emphasis, bearish/risk danger; amber is warning or market-level semantics. Keep chart grid, candles and labels readable through any translucent overlay. Do not use glow as a substitute for contrast.
- Expanded-state type scale at the QHD viewport: module title 20–22 px; section heading 15–17 px; body/form label 14–16 px; primary value 16–19 px; tertiary metadata never below 12 px. Use the approved display treatment only for module headings, Inter/Segoe UI for Polish interface copy, and tabular/monospace numerals for prices and telemetry. Keep the compact-shell telemetry scale compact.
- Typical expanded form/table controls are 42–50 px high, row height 42–48 px, inner padding 20–28 px, and inter-section gap 14–20 px. Use 8–12 px only for secondary metadata. Avoid the current pattern of small content at the top followed by a mostly unused drawer.
- Render only values the current engine, chart or broker metadata supplies. N/A, unavailable and empty-history states remain honest, legible empty states; do not populate screens with reference-image sample data.

## 4. State specifications

### 01 — Trade Planner Pro

**Obecny layout (capture):** Full-height drawer over the central chart box; the shell rails remain in place. Direction buttons span the top. Plan fields and sizing metrics are two compact text/table columns; TP1–TP3 allocation and BE controls sit in a narrow lower band. The chart can be seen only dimly behind the drawer; there is no distinct chart-preview region inside the expanded Planner.

**Docelowy layout i proporcje:** In the central work frame, reserve about 40% width for controls and 60% for the live chart preview. Place LONG/SHORT at the top of the control column, then Entry, SL, TP1–TP3 with each allocation, and BE mode. The chart preview occupies the full height beside the controls and shows the same active plan with labeled Entry/SL/TP/BE levels and risk/reward regions. Put Margin, RR, potential profit and potential loss in one full-width summary strip along the bottom of this frame. Keep the global right compact Planner visible as a shell element; it must not become a second expanded form.

**Braki i szczegóły:** [V] Distinct preview, field hierarchy, and readable bottom summary. Current long/short, drag geometry, optional targets, allocation and BE controls are existing behavior; arrange those controls, do not invent additional plan types. [F] None established by this capture for the visual arrangement. [KEEP] Do not add autonomous execution or controls beyond the approved planner flow.

**Typografia / density / spacing / controls:** Use the global expanded scale. Group price fields into 44–50 px rows; keep TP allocation adjacent to its target instead of a detached table. Direction controls share width equally. Maintain a single clear primary calculation/summary area and avoid repeating the compact rail’s figures as another field list.

**Chart relationship:** Chart geometry remains the working object, not a thumbnail. Dragging Entry/SL/TP updates the same visible plan and calculation values; collapsing the module leaves that geometry active.

**Komponenty/pliki:** `src/SmartFlowShell.tsx` (compact rail and drawer host), `src/ModuleDrawer.tsx` (planner body), `src/MarketChart.tsx` (plan preview/labels), `src/styles.css` (`.sf-drawer-planner`, planner layout and QHD type/spacing).

### 02 — Risk Guard

**Obecny layout (capture):** Full central-frame drawer with a shallow SAFE hero, two columns of small hard-limit/current-state rows, one emergency-close strip, and a large unused lower area. The persistent right-rail Risk Guard remains visible.

**Docelowy layout i proporcje:** Use a prominent status band across the top (roughly 14–18% of the drawer height) with shield, SAFE/WARNING/BLOCKED and its exact reason. Below it use two balanced columns: left “Hard Limits” and “Soft Warnings” settings/status; right “Current / projected state” with a large exposure gauge and account figures. Under the account figures show separate horizontal usage bars for daily loss, open positions and aggregate exposure. Isolate Emergency Close in a full-width bottom band with the affected scope and its confirmation affordance. Keep the lower third useful; do not stretch individual rows to fill it.

**Braki i szczegóły:** [V] A high-contrast state hero, exposure visualization, three metric bars and full-height hierarchy. [F] Blueprint FINAL requires editable limits, explicit save/confirmation for critical edits and a confirmed emergency action. The capture currently shows read-only metric rows; treat any absent handler as a separate functional gap. Do not draw inert switches or make a read-only bridge appear capable of closing live trades. [KEEP] No invented risk metrics or changed risk policy.

**Typografia / density / spacing / controls:** Global expanded scale; status 28–34 px, section heads 16 px, metric labels 14 px and values 17–20 px. Keep four hard-limit rows and protection rows aligned on a consistent baseline. Distinguish hard limits from informational warnings by label and color, not by two nearly identical tables. Give the emergency control at least 48 px height and clear separation.

**Chart relationship:** Uses the central workstation zone while open; it does not add a permanent right rail or resize the shell. The chart and compact rail state return unchanged on close. Risk Guard remains the execution veto.

**Komponenty/pliki:** `src/SmartFlowShell.tsx` (persistent `.sf-risk-card`), `src/ModuleDrawer.tsx` (risk body and emergency area), `src/styles.css` (`.sf-risk-hero`, `.sf-emergency-zone`, risk drawer grid and status styles). Keep `src/engines/*` behavior unchanged.

### 03 — FX Context Engine

**Obecny layout (capture):** Currency-strength bars and structure occupy the left half; session rows, six MTF tiles and bias summary occupy the top-right. Content stops around mid-height, leaving most of the drawer empty. The compact MTF strip remains visible below the chart frame.

**Docelowy layout i proporcje:** Fill the drawer as six aligned panels in a 3-column × 2-row dashboard. Top row: MTF direction (about 34% width), currency strength (about 30%), session/overlap (about 36%). Bottom row: volatility, market structure/momentum, and key-level relationship/short bias, each about one third. MTF lists all six frames M5/M15/M30/H1/H4/D1; strength is a ranked currency list; session gives active/closed state and overlap; bottom panels use bars/rows only for values the current engines return.

**Braki i szczegóły:** [V] Balanced six-panel composition and use of the full available height. [F] Currency strength may be unavailable for a non-FX active instrument or without engine inputs; do not fabricate values to imitate the render. [KEEP] The illustrative world map in render 03 is not required by Blueprint FINAL. No new map, signal engine or analysis action is requested.

**Typografia / density / spacing / controls:** Global expanded scale. Use 6 consistent MTF rows at 44–50 px; currency rows 40–46 px with currency, proportional bar and value. Session and structure rows share 14–18 px vertical rhythm. The active timeframe/status is highlighted once; avoid nested tiny cards and wide dead areas.

**Chart relationship:** Temporary FX surface occupies only the central chart box; it does not open alongside Context Panel. Closing it restores chart and compact MTF strip. Clicking MTF in the strip remains a Context Panel action and does not change the main chart timeframe.

**Komponenty/pliki:** `src/SmartFlowShell.tsx` (MTF strip and open route), `src/ModuleDrawer.tsx` (FX body), `src/styles.css` (`.sf-strength-row`, `.sf-session-row`, `.sf-mtf-drawer-grid` and expanded grid). Keep `src/engines/*` calculations unchanged.

### 04 — Market Profile

**Obecny layout (capture):** Session/custom-range controls and profile values use two half-width columns across the drawer. The profile chart is behind a dark overlay and is difficult to read; the lower half has little content. The TPO overlay and POC/VAH/VAL are already rendered on the underlying chart.

**Docelowy layout i proporcje:** Within the central frame, use a settings rail about 27–30% wide and a chart region about 70–73% wide. The chart region keeps the candle chart plus the single active TPO profile legible. Put a five-cell strip directly below the chart for POC, VAH, VAL, TPO count, and the selected session/range, using only available snapshot values. Settings rail order: session/custom range; profile mode; POC/Value Area/TPO visibility; density and width; left/right position; reset. Settings remain attached to this chart frame.

**Braki i szczegóły:** [V] Dominant readable profile chart, bounded settings rail, and bottom value summary. [F] Blueprint requires session/custom range, TPO/profile mode, live updates and visibility controls. If a listed mode is not implemented, report it separately; do not present a disabled dropdown as working. [KEEP] No second active profile, independent volume feed, or invented volume totals. Keep the live-update/no-Apply behavior already present.

**Typografia / density / spacing / controls:** Global scale; settings labels 14–15 px, values 16–18 px, section labels 15–17 px. Use 44–48 px setting rows and 12–16 px gaps. Five summary values are equal-height cells with one large number each. Keep the chart axis and profile labels unobstructed.

**Chart relationship:** Profile remains visible while settings are edited and after settings close. Closing the drawer must not toggle off the overlay. Keep POC/VAH/VAL lines on the main chart and preserve the one-profile limit.

**Komponenty/pliki:** `src/SmartFlowShell.tsx` (toolbar toggle/settings actions), `src/ModuleDrawer.tsx` (profile controls), `src/MarketChart.tsx` (profile overlay and level labels), `src/styles.css` (`.sf-drawer-profile`, chart/settings split and summary strip).

### 05 — Drawing Tools

**Obecny layout (capture):** A single vertical stack of nine broad rectangular tool buttons uses about one third of the drawer; the chart remains visible behind the right side. The note field stretches across the bottom of the entire drawer, and tool names lack the compact icon/category hierarchy of the reference.

**Docelowy layout i proporcje:** Retain the central chart frame. Allocate about 28–32% to a left tool rail and 68–72% to the chart. Make the chart the tall dominant surface; place the user note field and its arm action in a compact secondary row below the tool list, not across the chart. Present the existing tools as compact icon+label rows, grouped under visual headings for Lines, Shapes, Fibonacci, Measurement and Text/Delete. Keep the last-three quick drawing controls in the chart toolbar. A small selected-tool state remains visible after the drawer closes.

**Braki i szczegóły:** [V] Compact categorized rail, active-tool hierarchy, and a clear relationship between the tool list and chart. [F] No drawing capability is classified as missing here: the capture scenario exercised tool selection, placed a vertical line/note, and Escape returned to pointer. [KEEP] Implement only Trend Line, Horizontal, Vertical, Rectangle/Zone, Channel, Fibonacci, Measurement, Text/Note and Eraser/Delete. Do not request circles, arrows, pitchforks, style/color/opacity editors, layout saving or other reference-only controls unless separately approved in the blueprint.

**Typografia / density / spacing / controls:** Global scale. Tool rows 44–50 px with a 20–24 px glyph, 15–16 px label, and at most one 12 px helper line. Use 8–12 px row gaps; keep destructive clear/delete action separated and visually subordinate to active tools. Do not turn each tool into a large card.

**Chart relationship:** Drawer overlays only the bounded left part of the chart frame; the larger right area remains fully readable. Selecting a tool closes the browser, drawings persist, and Escape returns to pointer as already specified.

**Komponenty/pliki:** `src/SmartFlowShell.tsx` (toolbar and quick tools), `src/ModuleDrawer.tsx` (tool list/note), `src/MarketChart.tsx` (drawing overlay), `src/styles.css` (`.sf-drawer-drawing`, `.sf-tool-grid`, `.sf-quick-draw`).

### 06 — Indicators Browser

**Obecny layout (capture):** Search spans the drawer; five available indicator cards appear as a two-column grid on the left and a single compact active-indicator row/settings control on the right. Most of the drawer height is unused despite the section being open.

**Docelowy layout i proporcje:** Use one searchable list column of about 56–60% width and an active/settings column of about 40–44%. List rows fill a single vertical scroll area with consistent icon, indicator name, registered category and enable state. The right column places settings for the selected/active indicator first and the active-indicator list below it. Keep search across the top of the module. This makes the existing catalogue scannable and gives its current settings a real work area without forcing additional permanent chart columns.

**Braki i szczegóły:** [V] Full-height list/settings hierarchy and more readable active settings. [F] Blueprint requires search, available/active entries, enable/disable, settings and removal; current capture shows these for the registered items. If any specific registered item lacks an action, report the actual gap rather than showing an inert toggle. [KEEP] Use only `src/indicators/catalog.ts` entries. Do not add indicators, favorites/stars, line-style/color controls or algorithms to match the much larger illustrative catalogue in render 06.

**Typografia / density / spacing / controls:** Global scale. Catalog row height 54–64 px; name 15–16 px, category 12–13 px. Settings labels 14–15 px; inputs 42–48 px. Use one selection highlight and clear switch state. The active list must not compete with the main settings panel for the same row.

**Chart relationship:** Temporary browser overlays the chart in the central frame. Enabled overlays remain on the main chart; only indicators registered as separate-pane create a pane. Closing restores the full chart and must not reset active indicator settings.

**Komponenty/pliki:** `src/SmartFlowShell.tsx` (drawer host and toolbar action), `src/ModuleDrawer.tsx` (catalog/settings layout), `src/indicators/catalog.ts` (existing catalogue boundary only), `src/MarketChart.tsx` (overlay/pane relationship), `src/styles.css` (`.sf-drawer-indicators` and its list/settings grid).

### 07 — Alert Engine

**Obecny layout (capture):** The alert form is a shallow horizontal row at the top; one active alert is visible below and history is an empty right-hand column. Most of the frame is blank. The screenshot includes one real fixture alert created by the capture scenario; its empty history is not a missing history feature.

**Docelowy layout i proporcje:** Use a vertically ordered module: a clear title/new-alert action; a full-width form with symbol/price, condition and create action aligned in 2–3 columns; then an active-alert table across the frame; then a history table across the frame. Allocate roughly 26–30% height to form, 35–40% to active alerts, and the remainder to history, with internal scroll if data exceeds the available height. Table columns should show symbol, condition, price, enabled status and existing row actions; history uses time, symbol, condition, price and event. Keep every row aligned and legible.

**Braki i szczegóły:** [V] Full-width table hierarchy, readable form controls and a reserved history section. [F] Existing rule behaviors are Above/Below/Cross, enable/disable, edit/delete, history, and reopening an alert from its chart line. Current empty history reflects no fired events in the fixture. [KEEP] Do not add conditional-alert types, email/push delivery, comments, expiry controls or notification tabs from render 07; those are not required by Blueprint FINAL.

**Typografia / density / spacing / controls:** Global scale; table headings 13–14 px, rows 42–48 px, form controls 44–48 px, 12–16 px spacing. Use magenta for alert/trigger emphasis and cyan for enabled/selected state. The empty-history state should occupy the proper table region with one honest explanatory message, never fabricated rows.

**Chart relationship:** Drawer is temporary in the central frame. Active alert lines stay on the chart after close; clicking a line reopens the same editor focused on that alert. Keep the underlying shell geometry unchanged.

**Komponenty/pliki:** `src/SmartFlowShell.tsx` (toolbar/open state and alert-line routing), `src/ModuleDrawer.tsx` (form, active list, history), `src/MarketChart.tsx` (persistent alert lines/editor hit target), `src/styles.css` (`.sf-alert-create`, `.sf-alert-row`, alert drawer table layout).

### 08 — Instrument Selector

**Obecny layout (capture):** A full-chart-frame drawer has a search row, three quick-symbol buttons, and flat broker-result rows containing symbol, description and visible state. It hides nearly all chart content and uses only a small fraction of the available vertical space. The quick set already matches FINAL.

**Docelowy layout i proporcje:** Attach a bounded selector flyout to the instrument/chart toolbar edge, approximately 60–68% of central-frame width and full usable chart height; leave the other chart area visible. Within it place search and PIN on one top row, the exact quick set XAUUSD/BTCUSD/DJ30 below, then a dense scrollable broker-symbol list. Give the symbol name the strongest row weight, followed by existing broker description/path and visible/available state. Use a clear selected-symbol highlight. Keep the list readable without widening or shifting the global shell.

**Braki i szczegóły:** [V] Bounded flyout geometry, symbol-list density and selected-row hierarchy. [F] Search, quick symbols, PIN, selection, and close-on-select are exercised behaviors. [KEEP] The reference’s category tabs, favorites, quote-change/high-low columns, sparkline and timeframe buttons are not specified by Blueprint FINAL and are unsupported by the current symbol-metadata contract; do not invent those data or controls. Do not add EURUSD/GBPUSD to the default quick set.

**Typografia / density / spacing / controls:** Global scale. Search 44–48 px; quick-symbol buttons 52–60 px; result rows 48–56 px with 15–17 px symbol and 13–14 px metadata. Keep PIN a compact, visible checkbox. Align result state at the far edge; avoid multi-column quote values without those data.

**Chart relationship:** Flyout overlays part of the chart and never shifts the app grid. Selecting a symbol closes by default (PIN may retain the selector) and lets existing symbol-change routing update chart/context/planner state.

**Komponenty/pliki:** `src/SmartFlowShell.tsx` (instrument trigger and shell symbol), `src/ModuleDrawer.tsx` (selector/search/PIN/results), `src/styles.css` (`.sf-drawer-instruments`, `.sf-selector-head`, `.sf-quick-symbols`, `.sf-symbol-results`). Keep `src/mt5Client.ts` and broker API contract unchanged.

### 09 — Positions / Orders / Account

**Obecny layout (capture):** The expanded bottom strip remains a shallow table below the shell; the three captures show Positions, Orders and Account one at a time. Positions has useful rows, Orders has one pending row, and Account has five summary values. The panel begins under the left rail rather than replacing it. It does not approach the scale or combined information density of render 09.

**Docelowy layout i proporcje:** Expand upward within the bottom central workspace to approximately 55–65% of the useful application height, temporarily reducing chart height while leaving the top telemetry and side rails intact. Render a module header/tab row, then all three existing data groups in the expanded composition: Positions table first (about 36% of panel height), Orders table second (about 27%), and Account summary/status band last (about 20%). Use the remaining space for headers/gaps. Show only fields available from current domain data: symbol, direction/type, volume, entry/trigger, P&L, SL/TP/status, and account equity/balance/margin/free margin/floating P&L. Keep each table independently scrollable if needed.

**Braki i szczegóły:** [V] Full-height expanded terminal, visible Positions+Orders+Account composition and clearer summary band. [F] Blueprint separately lists compact contextual row actions (modify SL/TP, close/partial close, cancel pending) and position/order chart focus. Current bridge is read-only; captures prove row selection/focus only, not trade modification. Treat unsupported actions as a functional gap and do not display dead ellipsis/action buttons or claim they execute. [KEEP] Render 09’s History tab, batch checkboxes, New Order action and extra P&L metrics are not required by Blueprint FINAL.

**Typografia / density / spacing / controls:** Global scale; terminal headers 14–16 px, table headings 13–14 px, values 14–16 px, row heights 44–52 px. Account metrics use 5–6 evenly spaced cells with values 18–22 px. Use compact contextual controls only where their handler exists. The resize affordance stays easy to find and drag.

**Chart relationship:** This is the only state that reduces chart height; collapse restores the prior chart frame immediately. Selecting a position/order retains current symbol-switch and level-focus behavior. Keep shell side rails and top strip visible.

**Komponenty/pliki:** `src/SmartFlowShell.tsx` (`.sf-bottom-panel`, tab state and `BottomTable`), `src/styles.css` (`.sf-bottom-panel`, `.sf-bottom-tabs`, `.sf-table`, `.sf-account-row`). `src/mt5Client.ts` remains the read-only data boundary.

### 10 — Command Palette

**Obecny layout (capture):** A global, centered palette occupies about 60% of QHD width and most of the viewport height. It has an auto-focused search field and a single full-width result list; the rest of Main Shell is blurred behind it. This already matches the blueprint’s overlay/focus model, but the rows and small secondary labels are visually understated.

**Docelowy layout i proporcje:** Keep a global overlay centered horizontally and in the upper-middle region, about 58–64% of viewport width and no more than 88–90% of viewport height. Search stays full width at the top. Below it keep one command list with a strong active row, primary action name, secondary detail and right-aligned Enter/key hint. Use subtle section dividers to separate the existing recent/frequent actions from the remaining matching commands when the query is empty; do not create a second navigation system.

**Braki i szczegóły:** [V] Stronger search/active-row/suggestion hierarchy and readable type. [F] Current Ctrl+K, focus, Escape, arrows and Enter behavior is present and exercised. [KEEP] Blueprint does not require a category rail, shortcut aliases, full natural-language parsing or new command families. Do not add them to imitate the reference image.

**Typografia / density / spacing / controls:** Search input 18–20 px in a 64–76 px row; result title 16–18 px, detail 13–14 px, row height 58–68 px. Keep 12–18 px outer padding. The focused row uses a clear cyan edge/fill without reducing text contrast. Preserve keyboard-only use.

**Chart relationship:** This is the sole global overlay and temporarily takes focus above the shell without clearing the open drawer, plan, profile or terminal state. It must not reflow the shell.

**Komponenty/pliki:** `src/SmartFlowShell.tsx` (command registry, keyboard behavior and `.sf-command` markup), `src/styles.css` (`.sf-command-scrim`, `.sf-command`, row/input hierarchy). Do not change command action semantics.

### 11 — Context Panel

**Obecny layout (capture):** The central drawer is two columns: a long instrument-context fact list on the left and nearest levels, relationship, short summary and one VEGA action on the right. Values are present but small; both columns stop near the top half, leaving substantial empty space. It shows active symbol, context timeframe, main-chart timeframe, trend/structure, volatility, session, quote/freshness, break-even and profile levels when available.

**Docelowy layout i proporcje:** Keep this surface smaller in scope than FX Context Engine. Add a compact quote/context header (about 12–15% height) showing active symbol, existing last/Bid/Ask values, selected context timeframe and freshness. Below use three regions: instrument context at about 38% width, key levels at about 34%, and a narrow action/context column at about 28%. Put a concise summary at the bottom spanning the content width. Key Levels must show nearest support/resistance and relationship before any additional existing levels. Use only routes that already open an implemented Planner/Alert/VEGA action.

**Braki i szczegóły:** [V] Header/quote hierarchy, proportionate key-level panel, and a deliberate use of available height. [F] Blueprint requires active symbol/timeframe, trend/structure, volatility, nearest support/resistance, session, profile context and short summary; current capture contains these fields, with empty levels honestly reported when unconfirmed. [KEEP] “Recent signals”, sentiment, percent-change sparkline, favorite/watchlist action and any new market metric are not required by FINAL. Do not add an independent timeframe switch that silently changes the main chart timeframe.

**Typografia / density / spacing / controls:** Global scale; quote value 24–30 px, symbol 18–20 px, timeframe/freshness chips 13–14 px. Key-level rows 44–48 px with price aligned to the right; body facts 42–46 px. Preserve a compact visual distinction from the broader six-panel FX engine.

**Chart relationship:** Temporary contextual surface in the existing central frame; it does not open with FX Context Engine. Context timeframe stays independent of the chart timeframe. Closing returns to the unchanged Main Shell.

**Komponenty/pliki:** `src/SmartFlowShell.tsx` (`openContextTimeframe` and drawer host), `src/ModuleDrawer.tsx` (context/key-level content), `src/styles.css` (`.sf-drawer-context` and context grid). Keep `ContextSummaryEngine`, Key Levels and quote contracts unchanged.

## 5. Builder acceptance checklist

1. Capture 00 plus states 01–11 at exactly 2560×1440. Use the same visual fixture or disclose the data source; do not call fixture imagery live MT5 evidence.
2. Compare each expanded state against its numbered approved asset while keeping 00 shell geometry and VEGA art. The target module may reinterpret a render’s standalone framing only as needed to obey Blueprint FINAL’s shell/drawer rules.
3. Ensure readable QHD type and controls, fill the work area with the specified information hierarchy, and eliminate avoidable blank lower halves.
4. Verify chart visibility/persistence, overlay bounds and bottom-panel height exactly as specified for that state. Do not alter the shell grid to fit a drawer.
5. Mark [F] gaps separately. Do not add unsupported functions, data, rows, controls or engines to increase visual similarity. Never render a control that has no real handler.
6. Keep this pass in the frontend presentation surface: expected visual files are `src/SmartFlowShell.tsx`, `src/ModuleDrawer.tsx`, `src/MarketChart.tsx` where chart composition needs adjustment, and `src/styles.css`. No backend, MT5 bridge, domain engine or indicator catalogue changes are implied by this spec.
