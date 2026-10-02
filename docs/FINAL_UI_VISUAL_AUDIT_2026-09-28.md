# SmartFlow X Final UI Visual Audit

**Phase:** baseline audit before fidelity fixes  
**Viewport:** 2560×1440 (primary reference)  
**Branch / HEAD at audit:** `work/final-ui-integration-v1` / `b2ad7773aaafd95e30a9de3f32cf81b032601556`  
**Screenshots:** `artifacts/screenshots/00_main_shell.png` through `11_context_panel.png` (local, ignored by Git).  
**Render 12:** excluded.

## Source note

The requested `design/final-ui-assets/BLUEPRINT_FINAL_v1.0.md` is absent from this checkout. The approved images are present under `design/assets/final-ui/`. `docs/design/2026-09-27-ui-blueprint-v2.md` is an earlier architecture blueprint, so this audit uses the approved Main Shell image as the global visual authority and the approved 01–11 images for expanded states, as instructed.

## State results

| State | Result | QHD comparison |
|---|---|---|
| 00 Main Shell | **MAJOR MISMATCH** | Chart and left/center/right regions are present, but fixed-width rails and 6–12 px labels render too small at QHD. Side rails are undersized relative to the reference; the chart occupies too much of the full shell width. Rectangular borders lack the clipped frame language. VEGA is in the left rail but its portrait is cropped by the narrow column. |
| 01 Trade Planner Pro | **MAJOR MISMATCH** | Drawer overlays the chart without grid reflow, but its fields and TP allocation occupy only the upper portion. Text and controls are too small; reference gives the planner a larger chart and parameter composition. |
| 02 Risk Guard | **MAJOR MISMATCH** | Risk summary and hard-limit telemetry exist, but the expanded view is a pair of compact tables with a large unused lower area. The reference has larger status, exposure visualization, controls, and stronger cyan/magenta hierarchy. |
| 03 FX Context Engine | **MAJOR MISMATCH** | Currency/session/MTF information is present, but small rows and bars sit at the top of a mostly empty drawer. Reference uses a denser six-panel composition with more readable labels and stronger hierarchy. |
| 04 Market Profile | **MAJOR MISMATCH** | Profile settings are present, but the drawer hides the chart and leaves most of the surface empty. The reference pairs settings with a dominant profile chart and summary strip. |
| 05 Drawing Tools | **MAJOR MISMATCH** | Available tools are represented as a 3×3 grid of broad rectangular buttons. The reference uses a compact categorized tool rail alongside a large annotated chart and style controls. |
| 06 Indicators Browser | **MAJOR MISMATCH** | Search and active indicator settings work, but the captured view shows a minimal result and one active row in a mostly empty drawer. Reference fills the view with the indicator catalogue and a substantial settings/active region. |
| 07 Alert Engine | **MAJOR MISMATCH** | Price alert creation and active alert display are present, but the expanded view is sparse and omits the reference's large form, notification tabs, history table, and density. No new alert capabilities are proposed in this visual pass. |
| 08 Instrument Selector | **MAJOR MISMATCH** | Search, quick instruments, and broker symbols work, but the expanded view is a compact list with no reference-sized category navigation or instrument detail composition. |
| 09 Positions / Orders / Account | **MAJOR MISMATCH** | The screenshot remains a shell view with a short bottom terminal table. The reference is a full, readable terminal surface combining positions, orders, account telemetry, and connection status. |
| 10 Command Palette | **MAJOR MISMATCH** | Escape/backdrop behavior works, but the palette is a narrow single-column list with tiny rows, positioned near the top. The reference uses a larger centered surface with category navigation and stronger suggestion hierarchy. |
| 11 Context Panel | **MAJOR MISMATCH** | Context facts and key-level status are present, but they form two small columns at the top with substantial unused space. Reference has a quote header, context and key-level regions, quick actions, recent signals, and sentiment. |

## Dimension audit

- **Layout and proportions:** the 00 shell regions are recognizable, but at 2560×1440 the 245 px left and 278 px right columns stay fixed instead of scaling toward the approved proportions. The center column becomes too wide relative to the reference rails.
- **Spacing:** control and row gaps remain at compact desktop values, leaving large empty regions beneath most expanded modules.
- **Chart dominance:** the chart is clearly dominant. Its share of the full shell is above the approved balance because both side columns are too narrow; target is approximately 65–70% of the central composition.
- **Typography and readability:** the dominant QHD issue. Several labels are 6–9 px and values 8–12 px, so telemetry is difficult to read at the reference viewport.
- **Borders and clipped geometry:** outlines are mostly thin, straight rectangles. The approved frames use layered, angular clipped corners and stronger module boundaries.
- **Neon hierarchy and palette:** navy, cyan, and magenta are present, but controls and panels use nearly uniform low-intensity borders. Orange/sunset is largely absent from the UI hierarchy.
- **Panel positioning and drawer sizing:** module drawers are anchored inside the chart box and overlay it without moving the shell; this interaction is correct. At QHD they remain only the center-column surface and their content is undersized relative to the references.
- **Overlay behavior:** command palette backdrop and drawer layering work. No initial drawer or command popup is opened by application state.
- **Bottom panel height:** the positions/orders/account capture is a short terminal strip rather than the expanded reference surface. Resizing is available and the visual test exercises it.
- **VEGA placement:** the panel remains on the left as in 00; its portrait crop is too tight at the current fixed column width. The approved VEGA treatment itself is unchanged.
- **Telemetry density:** main-shell metrics are present; expanded states often have much lower visible density than their references because their content is concentrated at the top.
- **Icon and button sizing:** chart actions, tabs, close controls, and form controls remain small at QHD.

## Interaction and runtime baseline

The visual scenario passed at 2560×1440. It exercised planner, risk, FX context, profile, drawing, indicators, alerts, instrument selection, positions/orders/account, command palette, and context panel. Its final checks observed no page errors or browser console errors. It also verified topmost Escape behavior, drawer closure, bottom-panel resizing/persistence, and chart interactions. The drawer is absolutely positioned over the chart box, so opening it does not reflow the shell grid.

The initial 1672×941 capture is supplementary only and is not used for layout decisions.

## Fidelity pass results

**Primary viewport:** 2560×1440 for every screenshot from this pass. `playwright.config.ts` and the visual scenario both use QHD. The QHD captures are local under `artifacts/screenshots/`; render 12 remains excluded. Before ratings below are the baseline QHD ratings above. After ratings record remaining visual distance and do not mean user acceptance.

| State | Before | After | Remaining mismatch |
|---|---|---|---|
| 00 Main Shell | MAJOR MISMATCH | MINOR MISMATCH | QHD proportions, readable controls, angular frames, expanded rails, compact terminal, and visible TPO profile now align better. Reference still has denser neon framing, larger editorial type, a broader watchlist, and a different VEGA treatment. |
| 01 Trade Planner Pro | MAJOR MISMATCH | MAJOR MISMATCH | Planner controls are scaled and legible. The reference's control rail, chart preview, and bottom risk summary are not present as that composition. |
| 02 Risk Guard | MAJOR MISMATCH | MAJOR MISMATCH | Status, limits, and emergency controls are clearer. Reference exposure dial, balance telemetry, and risk bars are absent from the current module. |
| 03 FX Context Engine | MAJOR MISMATCH | MAJOR MISMATCH | Current currency strength, session, and MTF sections are larger. Their two-column arrangement remains different from the reference's six-panel composition. |
| 04 Market Profile | MAJOR MISMATCH | MAJOR MISMATCH | Daily profile is visible through the overlay and the settings remain readable. The reference's dedicated chart and bottom summary strip differ from the current settings and level fields. |
| 05 Drawing Tools | MAJOR MISMATCH | MAJOR MISMATCH | Tools now form a left rail beside the still-dominant chart. Current tools and note control do not fill the reference's categories, style controls, and denser tool catalogue. |
| 06 Indicators Browser | MAJOR MISMATCH | MAJOR MISMATCH | QHD capture shows the full current catalogue and active settings. It remains much sparser than the reference catalogue and detailed settings region. |
| 07 Alert Engine | MAJOR MISMATCH | MAJOR MISMATCH | Form and active-alert rows are readable. Current test data has one alert and empty history; notification categories and the reference's denser history table are absent. |
| 08 Instrument Selector | MAJOR MISMATCH | MAJOR MISMATCH | Search, quick symbols, and broker results are larger. Category navigation, market-data columns, and selected-instrument detail composition remain absent. |
| 09 Positions / Orders / Account | MAJOR MISMATCH | MAJOR MISMATCH | Expanded terminal rows are larger and the resize state is preserved. Current view remains the shell terminal table, without the reference's denser terminal summary and account composition. |
| 10 Command Palette | MAJOR MISMATCH | MAJOR MISMATCH | Palette is wider, centered, and readable. The current single-column command list differs from the reference's category rail and separated suggestion region. |
| 11 Context Panel | MAJOR MISMATCH | MAJOR MISMATCH | Instrument facts and levels are larger. Quote summary, quick-action group, recent signals, sentiment, and the reference's fuller use of space are absent. |

## Fidelity changes

- Added QHD-only sizing and geometry for the shell, chart toolbar, context strip, side panels, bottom terminal, drawers, and command palette. Smaller viewports keep their existing rules.
- The QHD shell now gives each side rail about 16.5% of the width, leaving about 65% for the central chart. The compact terminal is about 15% of viewport height; the existing resizer scales its saved height at QHD.
- Clipped angular frames and brighter cyan/magenta panel edges strengthen the approved synthwave hierarchy. VEGA artwork was not changed.
- Market Profile is visible by default to match render 00. This opens no drawer or popup. Its existing toggle remains available.
- Market Profile and Drawing Tools expanded surfaces reveal the underlying chart. Drawing Tools uses a left rail. No new module actions or data were added.
- Visual screenshots now run at 2560×1440. The test checks initial compact state, no default popup, one drawer at a time, unchanged chart-frame geometry while a drawer opens, Escape topmost behavior, resizing/persistence, and browser/page errors.

## Verification after the fidelity pass

- `npm test`: PASS — 7 files, 57 tests.
- `npm run build`: PASS — TypeScript and production bundle completed. Vite reported a large-chunk warning (about 512 kB minified).
- `npm run test:visual`: PASS — 1 Playwright scenario at 2560×1440; no page errors or browser console errors.
- The earlier 1672×941 capture was not used for fidelity decisions. No test result here is a user visual PASS.
