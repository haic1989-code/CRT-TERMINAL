# SmartFlow X — Plan wdrożenia narzędzi v1

**Data:** 2026-09-27
**Status:** zatwierdzony kierunek do dalszego projektowania UI
**Branch roboczy:** checkpoint/01-sunset-observatory

## 0. Cel

Zbudować jeden spójny terminal Forex, który wykorzystuje najlepsze sprawdzone mechanizmy open-source, ale prezentuje je jako własne moduły SmartFlow X w nowym retro/cyberpunk high-end UI.

Nie budujemy kolekcji osobnych pluginów. Budujemy własną warstwę domenową i UI, a open-source służy jako źródło algorytmów, workflow i wybranych implementacji.

---

# 1. Finalna selekcja narzędzi

## CORE — wdrażamy

### A. Trade Planner Pro
Źródła:
- EarnForex/PositionSizer — Apache-2.0
- EarnForex/RiskCalculator — Apache-2.0
- EarnForex/Breakeven-Line — Apache-2.0

Zakres SmartFlow X:
- LONG / SHORT
- cena wejścia
- lot / volume
- risk %
- margin
- commission
- TP1 / TP2 / TP3
- SL
- BE
- RR
- potential profit/loss
- portfolio risk
- cumulative breakeven dla wielu pozycji

### B. Risk Guard
Źródło:
- EarnForex/Account-Protector — Apache-2.0

Zakres:
- max risk per trade
- max daily loss
- max lot
- max exposure
- max number of positions
- spread/slippage guard
- trailing
- BE rules
- emergency close
- block-new-trades state

Risk Guard pozostaje niezależny od AI.

### C. Key Levels Engine
Źródło:
- EarnForex/Support-and-Resistance — Apache-2.0

Zakres:
- automatyczne wsparcia/opory
- alert po wybiciu
- session high/low
- previous day high/low jako późniejsze rozszerzenie
- VEGA levels jako oddzielna warstwa, nie zamiennik algorytmu

### D. FX Context Engine
Źródła:
- EarnForex/Currency-Strength-Matrix — Apache-2.0
- EarnForex/Trading-Session-Time — Apache-2.0
- EarnForex/Trade-Assistant — Apache-2.0
- EarnForex/Supertrend-Multi-Timeframe — Apache-2.0

Zakres:
- M5 / M15 / M30 / H1 / H4 / D1
- bullish / neutral / bearish
- currency strength
- aktywna sesja
- session overlap
- volatility
- market structure
- position vs key level

Nie pokazujemy wszystkich źródłowych wskaźników jako osobnych paneli. Użytkownik widzi skondensowany kontekst.

### E. Market Profile Engine
Źródło:
- EarnForex/MarketProfile — Apache-2.0

Zakres:
- Market Profile / TPO
- Point of Control
- Value Area
- High/Low Volume/Time nodes zależnie od modelu danych
- profile per session / custom range
- opcjonalny overlay na wykresie
- toggle w Market Tools

Market Profile jest CORE, ale domyślnie wyłączony, aby nie przeciążać wykresu.

### F. Alert Engine
Źródło:
- EarnForex/PriceAlert — Apache-2.0

Zakres:
- price alert lines
- alert above / below / cross
- alert enable/disable z wykresu
- przyszłościowo akcje typu: notify, ask VEGA, save snapshot

### G. Command / Context UX
Źródła:
- OpenTerminal — MIT
- OpenTerminalUI — MIT

Zakres:
- Command Palette
- symbol-aware Context Rail
- szybkie akcje bez stałego przeładowania UI
- workspace persistence jako etap po stabilizacji core

---

# 2. Co odkładamy

- Level 2 / DOM — nie teraz
- multi-chart 1–6 — po wersji Focus
- news trading jako osobny moduł — nie
- OANDA / cTrader adaptery — po stabilizacji MT5
- osobne RSI/MACD/CCI/Supertrend widgets jako stałe elementy — nie
- ciężki dashboard news/screener — nie
- execution algorithms typu TWAP — później, jeśli pojawi się realny use case

---

# 3. Warstwa integracyjna

Każde obce narzędzie trafia do własnego adaptera/engine.

Proponowana struktura:

src/
  engines/
    position-sizing/
    portfolio-risk/
    breakeven/
    risk-guard/
    key-levels/
    currency-strength/
    sessions/
    mtf-context/
    market-profile/
    alerts/
  adapters/
    mt5/
  domain/
    market/
    orders/
    positions/
    risk/
    context/
  ui/
    market-canvas/
    command-rail/
    trade-composer/
    context-panel/
    market-profile/
    vega/
    terminal-strip/

UI nie importuje bezpośrednio kodu EarnForex. Najpierw dane przechodzą przez nasz model domenowy.

---

# 4. Plan techniczny etapami

## ETAP 1 — License & Source Audit
Dla każdego CORE repo:
- wskazać konkretne pliki źródłowe
- ustalić, które algorytmy portujemy 1:1
- które przepisujemy do TS/Python
- zachować copyright/notices
- stworzyć THIRD_PARTY_NOTICES.md
- stworzyć ADR dla każdego realnego portu

Rezultat:
jasna mapa kodu bez ryzyka licencyjnego.

## ETAP 2 — Data Contracts
Zdefiniować niezależne kontrakty:
- Tick
- Candle
- SymbolSpec
- AccountState
- Position
- PendingOrder
- RiskState
- KeyLevel
- SessionState
- CurrencyStrength
- MTFContext
- MarketProfileSnapshot
- AlertRule

Rezultat:
engines nie zależą od MT5 ani od Reacta.

## ETAP 3 — MT5 Bridge Expansion
Obecny bridge rozszerzyć o:
- positions
- pending orders
- symbol/account metadata potrzebne do position sizing
- commission/swap jeśli dostępne
- margin/order_calc helpers
- ewentualnie order_calc_profit
- connection/freshness state

Na razie execution pozostaje osobnym krokiem bezpieczeństwa.

## ETAP 4 — Trade Planner Core
Najpierw logika bez nowego UI:
- PositionSizer
- RiskCalculator
- Breakeven
- TP1/TP2/TP3
- BE
- live recalculation przy dragowaniu

Testy:
- różne symbole
- różne contract sizes
- broker min/step/max lot
- buy/sell
- edge cases

## ETAP 5 — Risk Guard
- policy engine
- limity
- warnings
- hard block
- emergency state
- state machine

VEGA tylko odczytuje wynik; nie może go nadpisać.

## ETAP 6 — Forex Intelligence
Uruchomić niezależne engines:
- Currency Strength
- Session Engine
- Key Levels
- MTF Context
- volatility/structure inputs

Wynik składa się do jednego MarketContextSnapshot.

## ETAP 7 — Market Profile
Port algorytmu:
- TPO/profile calculation
- session/custom range
- POC/Value Area
- caching/recompute rules

Potem własny renderer SmartFlow X.

## ETAP 8 — Alerts
- alert lines
- rule evaluation
- local notifications
- event bus
- future VEGA hook

## ETAP 9 — VEGA Context API
VEGA otrzymuje ustrukturyzowany pakiet:
- MarketContextSnapshot
- KeyLevels
- RiskState
- active planner
- account/position summary
- Market Profile summary
- data freshness

AI interpretuje stan. Nie liczy core risk/market math od zera.

## ETAP 10 — Final UI Integration
Dopiero po zatwierdzeniu renderów:
- Command Rail
- Market Canvas
- Trade Composer
- Context module
- Market Profile
- Risk Guard
- Alert UX
- VEGA
- Positions/Orders strip
- Command Palette

---

# 5. Plan renderów UI — osobny tor

Kierunek:
**retro / Japanese cyberpunk / industrial high-end workstation**

Nie używać:
- generic SaaS cards
- ciągłych zaokrąglonych ramek
- magenta everywhere
- glassmorphism everywhere
- neon glow everywhere

Używać:
- obsidian / gunmetal / deep navy
- cyan / amber / phosphor green jako funkcjonalne akcenty
- magenta/violet głównie dla VEGA/brand
- techniczne separatory
- CRT/phosphor micro-glow
- industrial console geometry
- gęsta, profesjonalna typografia
- anime/semi-anime VEGA

## Render 1 — MAIN SHELL
Bez popupów.
Pokazać:
- top instrument strip
- 3-symbol command rail
- chart
- bottom positions/orders strip
- VEGA dock
- status Risk Guard
- Market Profile toggle/indicator, ale bez otwartego profilu

## Render 2 — TRADE PLANNER
Osobny render modułu:
- LONG/SHORT
- TP1/2/3
- SL
- BE
- lot/risk/margin/RR
- profit/loss

## Render 3 — FX CONTEXT
Osobny render:
- MTF rows
- currency strength
- session
- volatility
- structure
- expanded explanation

## Render 4 — MARKET PROFILE
Osobny render:
- profile/TPO
- POC
- value area
- session range
- controls

## Render 5 — RISK GUARD
Osobny render:
- SAFE/WARNING/BLOCKED
- rules
- exposure
- emergency control

## Render 6 — DRAWING/INDICATOR TOOL DRAWER
Osobny render.

## Render 7 — VEGA CONVERSATION / ANALYSIS
Osobny render.

Zasada:
**żaden popup/drawer nie jest otwarty na głównym renderze.**

---

# 6. Przekazanie do Work po zatwierdzeniu renderów

Pakiet wejściowy do Work:
1. Masterplan
2. Capability Harvest
3. ten Plan Wdrożenia
4. zatwierdzony MAIN SHELL render
5. zatwierdzone rendery modułów
6. lista repo źródłowych + licencje
7. obecny branch repo
8. aktualny MT5 bridge
9. PASS criteria
10. kolejność implementacji

Cel Work:
- audit repo
- utworzenie warstw engines/adapters/domain/ui
- port/reimplementation wybranych narzędzi
- integracja z MT5 bridge
- implementacja zatwierdzonego UI
- uruchomienie przez Render/local Windows flow
- screenshot comparison do referencji
- iteracje do PASS

---

# 7. Definition of Done dla pierwszej integracji

Pierwszy "vertical slice" po Work powinien mieć:
- live XAUUSD z MT5
- Trade Planner Pro działający na realnych symbol metadata
- Risk Guard
- Key Levels
- Session state
- Currency Strength / MTF context
- Market Profile
- alert line
- VEGA korzystająca z ustrukturyzowanego context snapshot
- nowy zatwierdzony retro/cyberpunk shell
- zero regresji w obecnym chart navigation/planner drag
