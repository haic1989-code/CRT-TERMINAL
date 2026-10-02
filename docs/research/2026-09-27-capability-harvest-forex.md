# SmartFlow X — Capability Harvest / Forex Open-Source Research

**Data:** 2026-09-27  
**Status:** research / candidate backlog  
**Cel:** zebrać najlepsze, sprawdzone mechanizmy z istniejących terminali i narzędzi tradingowych, a następnie zdecydować co portować, co przeimplementować, a co traktować wyłącznie jako inspirację.

> Zasada: nie kopiujemy całych produktów ani ich identyfikacji wizualnej. Harvest dotyczy mechanizmów, workflow, architektury i — tylko tam, gdzie licencja na to pozwala — fragmentów implementacji. Przed dystrybucją produktu licencje zależności należy ponownie zweryfikować.

## Klasyfikacja

- **PORT** — kandydat do realnego wykorzystania kodu / algorytmu po przeglądzie licencji i dopasowaniu do architektury SmartFlow X.
- **REIMPLEMENT** — warto przenieść mechanizm lub architekturę, ale napisać własną implementację.
- **INSPIRATION ONLY** — inspiracja UX/architektoniczna; nie kopiujemy kodu.
- **SKIP** — niski priorytet lub ryzyko licencyjne/techniczne większe niż wartość.

---

# A. Dotychczasowy Capability Harvest — terminale ogólne

## 1. OpenTerminalUI — MIT
Repo: `Hitheshkaranth/OpenTerminalUI`

Interesujące:
- symbol-aware **Context Rail**: quote, pozycja, alerty, wydarzenia i quick actions zależne od aktualnego instrumentu;
- **Chart Workstation 1–6 wykresów**;
- presety layoutów;
- synchronizacja crosshair;
- persistence workspace;
- szybkie akcje z kontekstu symbolu;
- provenance/freshness danych i jawny status źródła.

**Decyzja:** PORT / REIMPLEMENT.

## 2. OpenTerminal — MIT
Repo: `ErTasselli/OpenTerminal`

Interesujące:
- drag/resize widgetów;
- zapamiętywanie layoutu;
- **Command Palette** / keyboard-first workflow;
- modułowy workspace;
- command/search zamiast upychania dziesiątek przycisków.

**Decyzja:** PORT / REIMPLEMENT.

## 3. vn.py — MIT
Repo: `vnpy/vnpy`

Interesujące:
- profesjonalny podział: trading / orders / positions / monitoring;
- dockowalne moduły;
- event-driven aktualizacje;
- dojrzała separacja danych od GUI.

**Decyzja:** REIMPLEMENT architektury/UX; stack Qt/Python nie pasuje bezpośrednio do React/TS.

## 4. Jesse — MIT
Repo: `jesse-ai/jesse`

Interesujące:
- wspólny chart workflow dla backtest / paper / live;
- markery egzekucji i historii transakcji na wykresie;
- składane/izolowane panele wskaźników;
- drill-down wykonania transakcji.

**Decyzja:** REIMPLEMENT / wybrane PORT-y po analizie.

## 5. Longbridge Terminal — Apache-2.0
Repo: `longbridge/longbridge-terminal`

Interesujące:
- Level 2 / depth;
- pozycje i historia egzekucji;
- jasne kontrakty danych i trading API;
- selektywne odświeżanie tylko zmienionych części UI (dirty flags);
- workflow pod szybkie narzędzia i AI tool-calling.

**Decyzja:** REIMPLEMENT; wybrane wzorce techniczne.

## 6. NOFX — AGPL-3.0
Repo: `NoFxAiOS/nofx`

Interesujące:
- AI proponuje, ale **runtime narzuca twarde limity ryzyka**;
- separacja AI od execution;
- audytowalna pętla decyzji.

**Decyzja:** INSPIRATION ONLY / własna implementacja Risk Gateway.

## 7. Fincept Terminal — AGPL / dual licensing
Repo: `Fincept-Corporation/FinceptTerminal`

Interesujące:
- modułowość research terminala;
- duża gęstość domen finansowych;
- desktopowy feeling.

**Decyzja:** INSPIRATION ONLY do czasu osobnej analizy licencyjnej.

## 8. Atlas Market Terminal — brak standardowego LICENSE w repo
Repo: `Ayman5456/atlas-market-terminal`

Interesujące:
- detachable workspace;
- floating docks;
- profesjonalny research cockpit.

**Decyzja:** INSPIRATION ONLY.

---

# B. Forex / MT4 / MT5 / cTrader — najciekawsze znalezione projekty

## 1. EarnForex PositionSizer — Apache-2.0
Repo: `EarnForex/PositionSizer`

Zakres:
- lot size z ryzyka;
- account size/currency;
- commission;
- margin;
- potential portfolio risk & profit;
- swaps;
- możliwość otwierania transakcji z panelu.

**Znaczenie dla SmartFlow X:** bardzo wysoki priorytet. To pokrywa dużą część Position Plannera.

**Decyzja:** PORT algorytmów / REIMPLEMENT UI w TypeScript.

## 2. EarnForex MarketProfile — Apache-2.0
Repo: `EarnForex/MarketProfile`

Zakres:
- Market Profile / TPO;
- pokazanie obszarów, w których cena spędzała najwięcej czasu;
- poziomy istotne dla tradingu;
- MT4, MT5 i cTrader.

**Decyzja:** REIMPLEMENT / możliwy PORT algorytmu.

## 3. EarnForex Account Protector — Apache-2.0
Repo: `EarnForex/Account-Protector`

Zakres:
- automatyczne awaryjne zamykanie pozycji;
- wiele warunków bezpieczeństwa;
- filtry pozycji/zleceń;
- trailing stop;
- break-even trailing;
- akcje czasowe;
- emergency button.

**Znaczenie:** bardzo dobry materiał dla przyszłego **Risk Gateway / Account Guard**.

**Decyzja:** REIMPLEMENT, logikę warunków można harvestować.

## 4. EarnForex Support-and-Resistance — Apache-2.0
Repo: `EarnForex/Support-and-Resistance`

Zakres:
- automatyczne poziomy S/R oparte o fraktale;
- alerty po zamknięciu ponad oporem / pod wsparciem.

**Znaczenie:** kandydat do "Kluczowych poziomów wg Vegi".

**Decyzja:** PORT algorytmu / REIMPLEMENT wizualizacji.

## 5. EarnForex RiskCalculator — Apache-2.0
Repo: `EarnForex/RiskCalculator`

Zakres:
- potencjalne ryzyko i reward dla wielu otwartych pozycji i pending orders.

**Znaczenie:** portfolio-level risk view oraz rozszerzenie Position Plannera.

**Decyzja:** PORT / REIMPLEMENT.

## 6. EarnForex Trade Assistant — Apache-2.0
Repo: `EarnForex/Trade-Assistant`

Zakres:
- multi-timeframe sygnały;
- stochastic, RSI, CCI entry, CCI trend;
- confluence + alerty.

**Znaczenie:** inspiracja/algorytmy dla naszego **Kontekstu rynku M5/M15/M30/H1/H4/D1**.

**Decyzja:** REIMPLEMENT; nie kopiować sygnałów 1:1 jako "AI prawdę", tylko wykorzystać jako jeden z inputów strukturalnych.

## 7. EarnForex Currency Strength Matrix — Apache-2.0
Repo: `EarnForex/Currency-Strength-Matrix`

Zakres:
- siła 8 głównych walut;
- wiele par i timeframe’ów;
- alerty.

**Znaczenie:** bardzo ciekawy opcjonalny moduł Forex: **Currency Strength / relative strength board**.

**Decyzja:** wysoki priorytet REIMPLEMENT / możliwy PORT algorytmu.

## 8. EarnForex Supertrend Multi-Timeframe — Apache-2.0
Repo: `EarnForex/Supertrend-Multi-Timeframe`

Zakres:
- multi-timeframe panel trendu;
- Supertrend na aktywnym TF;
- alerty.

**Znaczenie:** dodatkowy input do naszego Context Engine.

**Decyzja:** opcjonalny REIMPLEMENT.

## 9. EarnForex Trading Session Time — Apache-2.0
Repo: `EarnForex/Trading-Session-Time`

Zakres:
- sesje jako linie, prostokąty lub kolorowane świece;
- wiele instancji;
- alert start/end sesji.

**Znaczenie:** bardzo użyteczne dla Forex: Asia / London / New York i overlap.

**Decyzja:** PORT logiki czasowej / własna wizualizacja.

## 10. EarnForex Breakeven Line — Apache-2.0
Repo: `EarnForex/Breakeven-Line`

Zakres:
- łączna cena breakeven dla wielu transakcji na tym samym symbolu;
- dystans do BE;
- total P/L;
- total volume;
- liczba transakcji.

**Znaczenie:** świetny feature dla aktywnego zarządzania pozycją.

**Decyzja:** PORT / REIMPLEMENT.

## 11. EarnForex News Trader — Apache-2.0
Repo: `EarnForex/News-Trader`

Zakres:
- workflow transakcji wokół publikacji makro;
- parametry czasu i ceny;
- MT4/MT5/cTrader.

**Znaczenie:** nie kopiować strategii wejścia; wartościowy jako źródło workflow i zachowania terminala podczas news events.

**Decyzja:** INSPIRATION / wybrane mechanizmy czasowe.

## 12. EarnForex PriceAlert — Apache-2.0
Repo: `EarnForex/PriceAlert`

Zakres:
- poziomy alertów bezpośrednio na wykresie;
- szybkie włączanie/wyłączanie alertów.

**Znaczenie:** naturalne rozszerzenie Drawing Engine / Alert Line.

**Decyzja:** PORT / REIMPLEMENT.

---

# C. Broker / execution / architecture

## 1. Darwinex DWX Connect — BSD-3-Clause
Repo: `darwinex/dwxconnect`

Zakres:
- MT4 i MT5;
- tick/bar subscriptions;
- trading z zewnętrznego języka bez pisania strategii w MQL;
- prosty file-based bridge;
- limity np. MaximumOrders i MaximumLotSize po stronie EA.

**Znaczenie:** bardzo wartościowy materiał porównawczy dla naszego MT5 Local Bridge i późniejszego execution adaptera.

**Decyzja:** REIMPLEMENT / wykorzystać wybrane wzorce; nie zastępować obecnego bridge bez benchmarku.

## 2. Spotware cTrader OpenApiPy — MIT
Repo: `spotware/OpenApiPy`

Zakres:
- oficjalny Python package do cTrader Open API;
- async;
- protobuf messages.

**Znaczenie:** świetny kandydat na przyszły drugi broker adapter po MT5.

**Decyzja:** future adapter candidate.

## 3. OANDA v20 Python — MIT
Repo: `oanda/v20-python`

Zakres:
- oficjalny Python binding/API dla OANDA v20.

**Znaczenie:** przyszły bezpośredni Forex broker adapter niezależny od MT5.

**Decyzja:** future adapter candidate.

## 4. QuantConnect LEAN — Apache-2.0
Repo: `QuantConnect/Lean`

Potwierdzone interesujące elementy:
- natywny model `Forex`;
- OANDA brokerage model;
- FX-specific caching/filtering;
- multi-resolution Forex;
- modularne risk management models;
- dojrzały model order/portfolio/brokerage.

**Znaczenie:** źródło wzorców domenowych dla Market Data Core / Broker Core / Risk Gateway.

**Decyzja:** REIMPLEMENT architektury; wybrane algorytmy mogą być analizowane pod Apache-2.0.

## 5. NautilusTrader — LGPL-3.0
Repo: `nautechsystems/nautilus_trader`

Zakres:
- production-grade Rust-native trading engine;
- FX, equities, futures, options;
- event-driven architecture;
- backtest i live na wspólnym kodzie;
- modular adapters;
- execution algorithms;
- order emulation;
- execution reconciliation;
- FX rollover simulation.

**Znaczenie:** bardzo silna inspiracja dla finalnej architektury runtime/execution.

**Decyzja:** REIMPLEMENT / architektura; osobno przeanalizować LGPL przed ewentualnym linkowaniem kodu.

---

# D. Projekty, z których nie chcemy bezpośrednio kopiować kodu

## EA31337 Libre — GPL-3.0
Multi-strategy Forex robot MQL4/MQL5, >35 strategii, multi-timeframe.

**Wartość:** wzorce strategii i organizacji MQL.  
**Decyzja:** INSPIRATION ONLY / własna implementacja.

## Backtrader — GPL-3.0
Live/backtest, historycznie OANDA i IB, order types, sizers, commission models, multiple timeframes.

**Wartość:** klasyczne wzorce backtest/broker/sizer.  
**Decyzja:** INSPIRATION ONLY; stary stack i licencja nie uzasadniają portu.

## AutoTrader — GPL-3.0, archived
Forex CFD przez OANDA, virtual broker, backtest, paper trading, SL/TP, dynamic position sizing.

**Wartość:** workflow.  
**Decyzja:** INSPIRATION ONLY.

## StockSharp
Repo publiczne, ale obecnie posiada **StockSharp Custom License**, nie standardową open-source license.

**Wartość:** bardzo szerokie wsparcie brokerów, trading from chart, cluster charts, volume profile, MT4/MT5/OANDA/FXCM/cTrader.  
**Decyzja:** INSPIRATION ONLY; nie kopiować kodu bez odrębnej zgody/licencji.

---

# E. Najciekawsze funkcje do SmartFlow X — shortlist v1

## P0 — bardzo mocni kandydaci
1. **Position Sizing Engine** — risk %, lot, commission, margin, swaps, potential P/L.
2. **Portfolio Risk Calculator** — ryzyko wszystkich aktywnych/pending pozycji.
3. **Breakeven Line** — skumulowany BE dla wielu pozycji na symbolu.
4. **Session Engine** — Asia / London / New York + overlap.
5. **Automatic Support/Resistance** — kluczowe poziomy.
6. **Currency Strength Matrix** — siła głównych walut.
7. **Account Protector / Risk Gateway** — hard limits, emergency rules, BE/trailing.
8. **Context Rail** — kontekst tylko dla aktywnego instrumentu.
9. **Command Palette** — funkcje bez zaśmiecania UI.
10. **Persistent Workspaces** — zapis układu i trybów pracy.

## P1 — następny poziom
11. Multi-Timeframe Context Engine.
12. Market Profile / TPO.
13. Price Alert Lines.
14. Multi-chart / MTF workstation.
15. Trade/execution markers na wykresie.
16. Optional Level 2 / depth module.
17. Execution reconciliation / audit trail.
18. Data freshness/provenance per stream.

## P2 — później
19. cTrader adapter.
20. OANDA adapter.
21. Execution algorithms (np. TWAP) dla odpowiednich instrumentów/use cases.
22. News-event state i specjalny risk mode.

---

# F. Wstępna strategia integracji

1. Nie kopiować całych aplikacji.
2. Każdy harvested feature dostaje osobny ADR.
3. Najpierw test algorytmu/UX w izolacji.
4. Kod MIT/Apache/BSD może być portowany po zachowaniu notice/copyright/licencji.
5. GPL/AGPL/custom/no-license: tylko pomysł/architektura, własna implementacja.
6. `THIRD_PARTY_NOTICES.md` przed pierwszym rzeczywistym portem kodu.
7. SmartFlow X zachowuje własny model domenowy; obce repo nie może dyktować architektury całego produktu.

---

# G. Następny research

Do głębszego audytu kodu:
- EarnForex/PositionSizer
- EarnForex/Account-Protector
- EarnForex/Currency-Strength-Matrix
- EarnForex/MarketProfile
- OpenTerminalUI Context Rail + Chart Workstation
- OpenTerminal Command Palette / workspace persistence
- QuantConnect LEAN Forex/Risk/Brokerage model
- NautilusTrader execution/risk/reconciliation
- Darwinex DWX Connect vs obecny SmartFlow MT5 Bridge

---

# H. Pomysły z referencji TikTok — do rozważenia (2026-10-01)

**Status:** kandydaci do backlogu; nic z poniższych nie jest zatwierdzone do implementacji. Zrzuty promocyjne traktujemy jako inspirację, a nie dowód skuteczności lub wydajności.

## 1. Skaner obserwowanych instrumentów

Polecenie tekstowe może opisać warunki, np. RSI poniżej progu i skok wolumenu. Deterministyczny skaner sprawdza wybraną listę symboli i zwraca trafienia wraz z interwałem, wartościami spełnionych warunków, czasem danych i krótkim uzasadnieniem. Wybrany wynik otwiera instrument na wykresie i może nanieść wskazane oznaczenia.

**Wartość:** szybki przegląd rynku bez ręcznego otwierania wielu wykresów. Zacząć od jawnej watchlisty; deklaracji skali typu „200 wykresów na minutę” nie przyjmować bez pomiaru na docelowym MT5 i brokerze.

**Decyzja:** REIMPLEMENT jako lokalny, tylko do odczytu moduł. Najpierw ustalić kontrakt warunków i freshness danych.

## 2. Polecenia agenta do obsługi wykresu

Agent mógłby zamieniać język naturalny na typowane polecenia CRT: ustawić symbol/interwał, uruchomić skan, pokazać wyniki, dodać czytelne oznaczenia albo rozpocząć replay. Polecenia wykonuje jawna lista funkcji aplikacji, nie dowolna automatyzacja kliknięć.

**Wartość:** szybsza obsługa terminalu przy zachowaniu przewidywalnego zachowania.

**Decyzja:** INSPIRATION ONLY na teraz. Potencjalny agent pozostaje analityczny i tylko do odczytu; bez składania, modyfikowania ani zamykania zleceń.

## 3. Replay i testowanie jawnych reguł

Badanie strategii na danych historycznych ze wspólną prezentacją wykresu, warunków wejścia i hipotetycznych wyników. Raport powinien podawać założenia o spreadzie, prowizji, poślizgu i jakości danych oraz zabezpieczać test przed look-ahead bias.

**Wartość:** sprawdzanie reguł zamiast polegania na samych opisach lub wygenerowanym skrypcie.

**Decyzja:** późniejszy osobny moduł badawczy po określeniu danych i silnika symulacji. Wyniki historyczne nie są obietnicą wyników na żywo.

## 4. Rozkłady wyników i ryzyko ogonowe

Inspiracją są widoczne na zrzutach rozkłady rezultatów i wizualizacje scenariuszy. Ewentualne widoki powinny pokazywać drawdown, rozrzut wyników, gorsze scenariusze i wrażliwość na koszty, a nie eksponować samą krzywą kapitału.

**Decyzja:** rozważyć razem z replay/backtestem; nie tworzyć dashboardu bez wiarygodnego silnika oraz opisanych założeń.

## 5. Kontekst sesji i wydarzeń

Połączenie sesji rynkowych z nadchodzącymi wydarzeniami może pokazać, kiedy instrumenty lub waluty będą wrażliwe. Pasuje to do prostego przełącznika radaru wydarzeń i alertów w istniejącym obszarze CRT, bez dokładania osobnego dużego panelu.

**Decyzja:** REIMPLEMENT jako kontekst i alerty po weryfikacji źródła, strefy czasowej, opóźnień i cache. Określenie „arbitraż stref czasowych” ze zrzutów nie jest przyjęte jako potwierdzona przewaga ani strategia.

## Publiczne projekty do dalszej lektury

- [TauricResearch/TradingAgents](https://github.com/TauricResearch/TradingAgents) — podział pracy agentów i proces analizy; projekt jest ukierunkowany na rynek akcji, więc traktować jako inspirację architektury.
- [kjpou1/forexfactory-mcp](https://github.com/kjpou1/forexfactory-mcp) — MCP dla danych kalendarza Forex Factory; opiera się na scraperze, więc wymaga oceny odporności i zasad źródła danych.
- [Qoyyuum/mcp-metatrader5-server](https://github.com/Qoyyuum/mcp-metatrader5-server) oraz [vincentwongso/mt5-trading-mcp](https://github.com/vincentwongso/mt5-trading-mcp) — przykłady narzędzi MCP dla MT5. Służą wyłącznie do porównania interfejsów i granic uprawnień; nie są kandydatami do podłączenia operacji transakcyjnych.

## Warunki przed przeniesieniem do aktywnego planu

1. Ustalić zakres symboli, interwałów i mierzalny czas skanowania.
2. Zapewnić timestamp, źródło i status świeżości każdej użytej obserwacji.
3. Oddzielić interpretację agenta od obliczeń i reguł wykonywanych deterministycznie.
4. Pozostawić zlecenia poza zakresem agenta; obecny mostek MT5 pozostaje tylko do odczytu.
5. Dla backtestu wymagać kontroli look-ahead, kosztów i porównywalnych wyników przed prezentacją statystyk.

---

# I. Pomysły z referencji Hyperliquid — do rozważenia (2026-10-01)

**Status:** kandydaci do backlogu. Zrzuty są promocyjnymi mockupami funkcji; nie potwierdzają jakości sygnałów, przepustowości ani zyskowności. Hyperliquid jest rynkiem krypto, więc nie przenosimy jego metryk 1:1 do Forex/MT5.

## 1. Karta ryzyka przed planem

Zebrać w jednym podglądzie proponowaną wielkość pozycji, stratę do SL, potencjalny wynik TP, relację zysku do ryzyka oraz — jeśli broker udostępnia wiarygodne dane — wymagany i wolny margin. W FX stosować zasady margin/stop-out brokera; nie wyświetlać krypto-wskaźnika ceny likwidacji jako uniwersalnego odpowiednika.

**Powiązanie:** rozszerzenie istniejącego kandydata Position Sizing Engine z sekcji E, nie osobny moduł. Nadal wyłącznie podgląd/plan; most MT5 pozostaje tylko do odczytu.

## 2. Uzasadnienie i warunki unieważnienia planu

Plan może zawierać bias, setup, warunki wejścia, SL/TP, relację zysku do ryzyka oraz krótkie uzasadnienie oparte na widocznych danych. Poziom pewności, jeśli kiedykolwiek pokazany, musi być opisany jako jakościowa ocena, a nie prawdopodobieństwo wygranej bez kalibracji.

**Decyzja:** rozważyć jako format przyszłego raportu skanera/agenta z sekcji H. Każdy punkt powinien wskazywać dane i czas, z których wynika; bez automatycznego składania zlecenia.

## 3. Historia stanu pozycji i scenariusze dalszych działań

Warto zbadać opcjonalny podgląd zmian: pozycja otwarta, teza nadal aktualna/unieważniona, zmiana SL, częściowa realizacja i warunek wyjścia. Agent może opisać warianty „jeśli momentum rośnie / słabnie”, ale nie może sam zmieniać stopa ani zamykać pozycji.

**Warunek UX:** kompaktowy komunikat aktywnej pozycji pozostaje zgodny z ustalonym formatem `ticket — symbol — kupno/sprzedaż — P/L`. Szczegóły historii mogą być dostępne dopiero po świadomym otwarciu widoku szczegółowego.

## 4. Przegląd wielu rynków i mikrostruktura

Zrzut pokazuje metryki perpetual futures, takie jak funding, open interest, głębokość arkusza i likwidacje. Są one specyficzne dla giełd krypto. Dla Forex ewentualny odpowiednik to spread, tick volume, zmienność, sesja i nadchodzące wydarzenia — wyłącznie jeśli źródło tych danych jest dostępne i oznaczone.

**Decyzja:** potraktować jako rozszerzenie skanera z sekcji H, bez obietnic monitorowania „128 rynków”, strumienia 24/7 ani opóźnienia poniżej sekundy przed benchmarkiem.

## Granice zastosowania

- Hyperliquid i operacje on-chain nie są częścią obecnego zakresu CRT/MT5.
- Nie dodawać autonomicznego wykonania, zarządzania SL ani zamykania pozycji przez agenta.
- Nie zmieniać obecnego zwięzłego raportu pozycji; rozszerzenia szczegółowe pozostają opcjonalne.
- Oddzielić obliczenia ryzyka od opisu agenta i pokazywać brakujące/nieświeże dane zamiast szacunków udających fakty.


# J. Własne mini EA i prosty tester CRT — do rozważenia (2026-10-01)

**Status:** kandydaci badawczy; bez zatwierdzenia do wdrożenia lub handlu live. Celem jest sprawdzanie jawnych reguł i ograniczonych zestawów parametrów dla XAUUSD, początkowo na M15.

**Następny krok implementacyjny:** utworzyć pierwsze mini-EA testowe dla wybicia zakresu sesji na XAUUSD M15. EA ma działać w Strategy Testerze, używać jawnych parametrów i nie składać zleceń na rachunku live. Po sprawdzeniu przepływu testu można dodać wariant odbicia od zakresu; EA cofnięcia w trendzie pozostaje kolejnym kandydatem. Implementację rozpocząć po zakończeniu bieżących prac CRT.

## 1. Wybicie zakresu sesji

Wyznaczyć zakres w zdefiniowanym oknie sesji. Sygnał powstaje dopiero po zamknięciu świecy poza zakresem; realizację modelować od następnego ticka. Testowane ustawienia: długość okna, minimalny bufor wybicia względem ATR, stop za zakresem lub według ATR, cel w wielokrotności ryzyka oraz godzina zamknięcia pozycji.

## 2. Odbicie od zakresu

Używa tych samych granic zakresu, ale testuje powrót do jego środka po odrzuceniu górnej lub dolnej krawędzi. Nie otwiera pozycji, gdy filtr wskazuje, że rynek przestaje być boczny. Testowane ustawienia: próg filtra trendu, warunek odrzucenia, stop za granicą z buforem ATR oraz wyjście przy środku zakresu.

## 3. Cofnięcie w trendzie

Kierunek określa filtr H1, a wejście na M15 następuje po cofnięciu i zamknięciu świecy z powrotem w kierunku trendu. Testowane ustawienia: średnie trendu, głębokość cofnięcia, filtr siły trendu, stop według ATR i cel w R.

## Proponowany przepływ testów

- Zacząć od dwóch wariantów Range Detectora: wybicie oraz odbicie. EA trendowy dodać po sprawdzeniu tego samego zakresu danych i raportowania.
- Uruchamiać tylko jeden przebieg naraz w kolejce; zapisywać postęp i wyniki po każdym zakończonym teście. Nie uruchamiać kilku rocznych EA równolegle.
- Zbudować własny panel CRT do wyboru EA, zakresu danych i parametrów oraz przeglądania porównywalnych wyników; MT5 Strategy Tester pozostaje silnikiem testów i symulacji.
- Każdy sygnał opierać na zamkniętej świecy, składać hipotetyczne wejście od następnego ticka, ograniczyć początkowy test do jednej pozycji i bez dokładania do pozycji.
- Utrzymywać identyczne koszty i zasady ryzyka między porównywanymi EA. Parametry ryzyka stroić osobno od parametrów sygnału.
- Raportować zysk/stratę netto, obsunięcie maksymalne, profit factor, expectancy w R, liczbę transakcji, koszty oraz osobne wyniki okresu strojenia i forward.
- Końcową ocenę kandydata wykonać na rzeczywistych tickach i niewidzianym okresie; nie wybierać wyłącznie najwyższego zysku z optymalizacji.
- EA pozostają w zakresie Strategy Testera. Integracja z mostem MT5 nie może automatycznie włączać zleceń live.

**Decyzja:** rozważyć jako pierwszy własny research workflow CRT. Reguły i zakresy parametrów należy zatwierdzić przed implementacją; wyniki historyczne nie dowodzą przyszłej przewagi.


# K. Aktualizacja GitHub Actions — wykonane

Zaktualizowano akcje w obu workflow na gałęzi `crt-terminal`:
- `actions/checkout@v7`
- `actions/setup-node@v7`
- `actions/upload-artifact@v6`

Nowy build instalatora zakończył się powodzeniem (workflow run `36941000904`, commit `ac855c30dea0bab5b461d9c46dc54fe7c9fb484f`). Ostrzeżenia Node dotyczące `punycode` / `url.parse()` oraz ostrzeżenie o runtime Node 20 nie wystąpiły. Pozostało ostrzeżenie Vite o głównym pliku JavaScript powyżej 500 KB — to osobne zadanie optymalizacyjne.

**Następny krok implementacyjny:** mini-EA wybicia zakresu sesji dla Strategy Testera, zgodnie z sekcją J.

**Wyjaśnienie:** GitHub Actions runner to host/maszyna zarządzana przez GitHub (w tym buildzie `windows-latest`), która pobiera repozytorium i wykonuje kroki workflow. Wersje Node wymienione powyżej są runtime’em akcji CI; nie zmieniają wersji ani składników CRT Terminalu.
