# SmartFlow X — UI Blueprint v2

**Data:** 2026-09-27  
**Target:** 2560×1440 (2K), desktop Windows  
**Status:** architecture blueprint — before high-end visual render  
**Principle:** geometry and hierarchy first; visual effects later.

## 1. Core rule

The chart is the product surface. Permanent chrome must consume as little area as possible. All secondary tools appear as contextual overlays, drawers, or compact rails.

Target chart visibility in the default state: **~78% of the usable content area**.

## 2. Screen geometry at 2560×1440

| Region | X | Y | W | H | State |
|---|---:|---:|---:|---:|---|
| Top Command Strip | 0 | 0 | 2560 | 64 | always visible |
| Left Command Rail | 0 | 64 | 168 | 1376 | always visible |
| Market Canvas | 168 | 64 | 2072 | 1376 | always visible |
| VEGA Dock | 2240 | 64 | 320 | 1376 | always visible, visually light |
| Context Drawer | 168 | 64 | 360 | 1376 | hidden by default |
| Tool Drawer | 168 | 64 | 360 | 1376 | hidden by default |
| Indicator Drawer | 168 | 64 | 400 | 1376 | hidden by default |
| Trade Composer | contextual | contextual | 340–420 | 420–620 | hidden until planner active |
| Command Palette | centered | 150 | 760 | auto | hidden until shortcut |
| Conversation Drawer | 1840 | 64 | 400 | 1376 | hidden until VEGA interaction |

The VEGA dock visually belongs to the outer shell, but the Market Canvas can extend visually beneath subtle transparent portions of it.

## 3. Top Command Strip

One continuous high-end instrument strip, not separate SaaS cards.

Left:
- SMARTFLOW X
- active symbol
- timeframe
- connection/data state

Center/right:
- Kapitał
- Zysk dzisiaj
- Skuteczność dzisiaj
- Timer świecy
- Czas serwera

No permanent search field. Global actions use Command Palette.

## 4. Left Command Rail

Fixed width: **168 px**.

Top section:
- 3 instrument slots only
- symbol typography is the visual identity; no decorative symbol images

Primary actions:
- Rysuj
- Poziomy
- Wskaźniki
- Alerty
- Kontekst

Bottom:
- workspace/profile
- settings
- compact connection/risk state indicator

The rail itself never expands horizontally. Clicking an action opens a separate contextual drawer over the left edge of the Market Canvas.

## 5. Market Canvas

The chart starts immediately below the 64 px top strip and runs to the bottom edge.

Default state contains only:
- candles
- price/time axes
- grid
- current price
- active drawings
- active planner geometry
- optional key levels / sessions / alerts

No RSI/MACD panes by default.
No permanent planner panel.
No permanent news panel.
No decorative widgets inside the chart.

Background must be visually distinct from the shell:
- lower contrast
- less saturated
- calmer material
- enough luminance separation so candles remain dominant

The chart background can contain subtle depth/parallax but cannot compete with market data.

## 6. Trade Composer / Position Planner Pro

Activation:
- Command Rail > Rysuj > Long / Short
- Command Palette
- chart hotkey

The primary position object lives on the chart. A compact Trade Composer appears next to the selected planner object or docked to a chart edge if space is limited.

Sections:
- LONG / SHORT state
- Cena wejścia
- Wolumen / lot
- Take Profit: TP1 / TP2 / TP3
- Stop Loss
- Break Even
- RR
- Potencjalny zysk
- Potencjalna strata
- Ryzyko %

Behavior:
- drag entry/SL/TP directly on chart
- values update in real time
- TP1/TP2/TP3 can be individually enabled/disabled
- BE can be armed as a management rule
- composer can collapse to a small trade chip

The composer must feel like an execution instrument, not a form.

## 7. Market Context Engine

Not permanently displayed as a large panel.

When Context is opened, show compact rows:
- M5 — Byczy / Neutralny / Niedźwiedzi
- M15 — ...
- M30 — ...
- H1 — ...
- H4 — ...
- D1 — ...

Each row can expand to reveal its contributing factors:
- market structure
- currency strength
- session
- volatility
- position relative to key level
- optional indicator context

This engine is data-driven; VEGA consumes it but does not own the calculation.

## 8. Key Levels Engine

Single toggle in the left rail: **Poziomy**.

Default labels in Polish:
- Wsparcie 1 / 2 / 3
- Opór 1 / 2 / 3

Optional later layers:
- session high/low
- previous day high/low
- weekly high/low
- VEGA proposal levels

The chart must never be flooded with all layers simultaneously.

## 9. VEGA Dock

No mandatory slant. Geometry is simple and premium.

Width: **320 px** at 2560×1440.

Content:
- large agent render — dominant element
- VEGA
- state: OBSERWUJĘ / ANALIZUJĘ / OSTRZEŻENIE / POZYCJA AKTYWNA / NEWS
- one concise message
- two primary actions:
  - Zapytaj
  - Pokaż propozycję na wykresie

No key levels, indicators, market stats, or extra dashboards inside the agent dock.

When the user opens a conversation, the Conversation Drawer temporarily replaces part of the chart width. Closing it restores full Market Canvas width.

## 10. Risk Guard

Primarily invisible.

Visible only through:
- compact state indicator
- warnings
- confirmation gates
- emergency action when required

Planned capabilities:
- max risk per trade
- max daily loss
- max open exposure
- max lot
- spread/slippage protection
- optional BE/trailing rules
- emergency close / block-new-trades state

Risk Guard must remain independent from VEGA.

## 11. Command Palette

Shortcut: Ctrl+K.

Examples:
- XAUUSD
- M15
- Rysuj Long
- Rysuj Short
- Fibonacci
- Wsparcie / Opór
- Dodaj alert
- Pokaż kontekst
- Otwórz planner
- Pokaż pozycje
- Zapisz workspace
- VEGA: analizuj rynek

This removes the need for dozens of permanent buttons.

## 12. Workspace behavior

Default workspace: **Focus**.
Chart dominates and only essential rails are visible.

Future presets:
- Focus
- Multi-Timeframe
- Position Management
- Research

The user can save their own workspace after the core shell is stable.

## 13. Responsive target

Primary: 2560×1440.
Secondary: 1920×1080.

At 1920×1080:
- Left Rail shrinks to ~144 px
- VEGA Dock shrinks to ~280 px
- typography scales down
- drawers overlay rather than reduce chart width
- chart remains priority

## 14. Visual direction for the next render

The first render should be nearly monochromatic:
- obsidian / graphite / gunmetal / soft white
- only minimal semantic color
- no global magenta wash
- no decorative glow soup
- no generic rounded-card dashboard
- no giant empty gaps
- no permanent bottom bar

After geometry is accepted, introduce SmartFlow X identity:
- restrained electric accent
- material hierarchy
- subtle depth
- signature motion
- refined background
- final VEGA integration

## 15. PASS criteria for blueprint

- chart clearly owns the screen
- permanent UI chrome is minimal
- planner is contextual, not a permanent panel
- VEGA is visible but not blocking trading
- tools are discoverable without permanent clutter
- context can be expanded without becoming a dashboard
- all required trader information is reachable in one interaction
- layout can plausibly scale to 1920×1080
