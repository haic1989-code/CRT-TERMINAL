# FX Replay — profil i rozliczenia, etap 1 (0.1.39)

## Zakres

Silnik 3.1 zachowuje rzeczywiste ticki i API Python v2. Etap obejmuje rozliczenie kontraktów OTC w walucie rachunku oraz szacowanie margin z zamrożonego profilu brokera. Nie potwierdza pełnej równoważności z natywnym testerem MT5.

### Profil

- `symbol_info`: kontrakt, waluty, krok ceny/wolumenu, limity, typ kontraktu, initial/maintenance/hedged margin, większa noga hedge, stop/freeze, sposób wykonania, swap.
- `account_snapshot`: waluta, saldo, dźwignia, model rachunku, progi margin call/stop-out i czas pobrania.
- `broker_profile`: wersja, źródło, broker/serwer, jawne ograniczenia, próbki i osobne współczynniki BUY, SELL, BUY LIMIT, SELL LIMIT.
- Współczynniki initial są wyprowadzone z `order_calc_margin`, a nie z nieistniejących w Python SDK pól `margin_long/margin_short`. To wyłącznie obliczenia — żadna wysyłka zleceń.
- Kalibracja obejmuje minimum, środkowy i maksymalny wolumen oraz drugą cenę. Rozbieżność ze stałym wzorem blokuje profil. Zgodność w punktach próbnych nie dowodzi braku pośrednich progów dynamicznych; historia stawek nie jest znana.
- Stawki maintenance są szacowane jako równe initial. Rzeczywiste różne współczynniki maintenance wymagają dodatkowego źródła danych.

### P/L i ryzyko

Dla Forex, Forex No Leverage, CFD, CFD Index i CFD Leverage, przy walucie zysku równej walucie konta:

`P/L = kierunek × (cena zamknięcia − cena wejścia) × kontrakt × loty`.

BUY używa Ask na wejściu i Bid na wyjściu; SELL odwrotnie. Wielkość pozycji wg ryzyka i koszt Stop Loss używają tego samego modelu, prowizji i poślizgu. Znana różna waluta zysku nie jest przeliczana aktualną wartością ticka. Stare manifesty bez informacji o walucie zysku zachowują oznaczony szacunek tick-value; ich wynik nie jest przedstawiany jako potwierdzony wynik MT5.

### Margin

- Identyfikatory SDK: Forex `0`, CFD `2`, CFD Leverage `4`, Forex No Leverage `5`. Dźwignia dotyczy `0/4`, nigdy `5`.
- Obsługa margin w tym etapie wymaga rachunku hedging oraz waluty margin równej walucie depozytu. Brak obsługi powoduje jawny błąd symulacji, nie darmowe otwarcie pozycji.
- Initial/maintenance niezerowe zastępują standardowy wzór; brak maintenance oznacza initial. Bez fixed margin Forex używa kontraktu, CFD kontraktu i ceny; dźwignia tylko w stosownych trybach.
- Pozycje używają cen wejścia i ważonej ceny nóg. LIMIT używa swojej ceny i swojego współczynnika.
- `margin_hedged_use_leg`: większa wartość nogi wraz z oczekującymi zleceniami. W modelu podstawowym: część niepokryta + pokryta wg `margin_hedged` + oczekujące.
- Przed otwarciem porównywany jest margin portfela z kapitałem po spreadzie/poślizgu i prowizji wejścia. Kontrolowany jest `SYMBOL_VOLUME_LIMIT` dla kierunku.
- Przeciwstawne zlecenia przy różnych fixed initial/maintenance są na razie odrzucane z przyczyną. Ich kontrola przed wysyłką różni się od margin utrzymywanego portfela i wymaga kolejnego etapu.

### Historia i odtwarzalność

Manifest ticków nie jest nadpisywany. Powtórny import identycznego zakresu, źródła i symbolu z poprawionymi granicami używa pliku ticków oraz dopisuje oddzielną, niezmienną rewizję profilu. Run przypina ją podczas tworzenia zadania. Kolejne odświeżenie profilu nie zmienia istniejącego przebiegu. Starsze archiwa pozostają czytelne. CSV zachowuje jawne przypisanie symbolu przez użytkownika.

### Pozostałe etapy

- [ ] Rzeczywiste współczynniki maintenance i pełne tabele dynamicznych stawek margin.
- [ ] Kontrola fixed initial/maintenance przy przeciwstawnych zleceniach.
- [ ] Model netting i powiązanie zleceń, dealów oraz pozycji.
- [ ] Stop-out, swap, taryfy prowizji, sesje handlu, stops/freeze.
- [ ] Historyczne kursy walutowe i zmiany specyfikacji brokera.
- [ ] Świece w czasie serwera i warmup przed początkiem testu.
- [ ] Porównanie transakcja po transakcji z natywnym testerem na tym samym archiwum ticków.

## Źródła zasad

- [Wzory margin i hedging — MetaTrader 5](https://www.metatrader5.com/en/terminal/help/trading_advanced/margin_forex)
- [Właściwości i tryby kontraktu — MQL5](https://www.mql5.com/en/docs/constants/environment_state/marketinfoconstants)
- [Pola Python symbol_info — MetaQuotes](https://www.mql5.com/en/docs/python_metatrader5/mt5symbolinfo_py)

## Status odbioru

- PASS: kompilacja TypeScript/Vite, `cargo check --offline`, kontrola składni modułów Python.
- NOT RUN lokalnie: testy jednostkowe/wizualne, instalacja Windows i updater.
- NOT CONFIRMED: odczyt profilu z aktywnego MT5 i zgodność z testerem natywnym. Podczas tej sesji Python SDK nie nawiązał IPC z uruchomionym MT5 w zadanym czasie; nie wysyłano zleceń.
- Automatyczne CI i podpisane wydanie po push są osobnymi procesami; ich wynik należy sprawdzić na GitHub.
