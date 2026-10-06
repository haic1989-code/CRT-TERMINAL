# Audyt FX Replay — poprawki 0.1.38

Data: 2026-10-05/06. Baza porównania: commit `2967a47`, wersja 0.1.37.

## Werdykt

Poprzedni importer marnował czas na konwersję każdego ticka do obiektów Pythona i zapis osobnego wiersza SQLite. Odtwarzacz nie odwzorowywał czasu rynku, a część wzorów i wyników symulatora była błędna. Importer pomijał również ticki z końcówek sekund na granicach porcji.

W 0.1.38 te problemy zostały poprawione. Rzeczywisty tydzień XAUUSDs z cache uruchomionego MT5 zaimportowano w 3,52 s; kolejne wykonanie zajęło 3,79 s. To lokalny tester OTC ze skryptami Python i modelem hedgingu. **Nie ma jeszcze potwierdzonej równoważności z natywnym testerem MT5.**

## Pomiary

Zbiór: rzeczywiste ticki użytkownika, źródłowe archiwum otwarte wyłącznie do odczytu. Archiwa pomiarowe powstały osobno; żadnych zleceń nie wysyłano.

| Pomiar | Przed | Po |
|---|---:|---:|
| Zapis tych samych 200 000 ticków, mediana 3 powtórzeń | 1,781 s | 0,064 s |
| Prędkość samego zapisu | 112 301 tick/s | 3 122 171 tick/s |
| Miejsce zajęte przez próbkę i metadane | 27 230 208 B | 11 261 440 B |
| Odczyt ostatnich 10 000 ticków starego archiwum 2,95 mln rekordów | 305,9 ms, OFFSET | 7,95 ms, indeks sekwencji |
| SHA-256 tych samych 200 000 rekordów | — | identyczna ze starym formatem |

Zapis jest około **27,8 razy szybszy** w tym pomiarze; pliki zajmują około 59% mniej miejsca. Wyniki dotyczą tej maszyny i tego zbioru, nie są gwarancją czasu pobierania od brokera.

Osobne pomiary:

- Odczyt próbki z cache MT5: 0,249 s. API zwróciło 200 040 ticków w obejmujących sekundach; próbka benchmarku ma dokładnie 200 000 rekordów.
- Pełny import tygodnia: 2 949 303 ticki, 10 zapytań, 3,52 s łącznie; odczyt MT5 443 ms, walidacja/zapis bloków 1 976 ms. Pozostały czas obejmuje start procesu, metadane i finalizację. Drugie wykonanie: 3,79 s.
- Symulacja przykładowej EMA/ATR na całym tygodniu: 14,81 s, 1 371 świec M5, 46 zamknięć, 276 zdarzeń. Jest to test wykonania silnika, nie rekomendacja strategii ani ocena jej rentowności. Prowizja/poślizg wynosiły zero; benchmark nie miał kalibracji margin i nie potwierdza jej zgodności.

Powtarzalny pomiar identycznych rekordów: `scripts/benchmark-fx-replay.py`. Źródłem `--baseline` może być `replay_store.py` z commitu `2967a47`. Skrypt używa źródłowego DB w trybie read-only i zapisuje archiwa pomiarowe w katalogu tymczasowym. `--native` wykonuje wyłącznie odczyt ticków MT5.

## Znalezione błędy i wykonane poprawki

| Problem | Poprawka | Stan |
|---|---|---|
| Python scalar/tuple i INSERT dla każdego ticka | Walidacja kolumn NumPy, zapis bloków 56 B/rekord, SHA-256 w trakcie zapisu | DONE |
| UI czeka na wielką transakcję ticków SQLite | SQLite przechowuje metadane; duży zapis nie zajmuje blokady odczytu archiwów | DONE |
| Pobieranie historii blokuje Pythonowy most notowań/egzekucji | Osobny proces importera bez modułu egzekucji, związany z konkretnym terminalem i brokerem | DONE |
| OFFSET musi pomijać miliony wcześniejszych rekordów | Keyset `sequence >= offset` dla starych DB; bezpośredni seek dla nowych plików | DONE |
| Końcówki sekund porcji nie trafiają do historii | Żądanie obejmuje pełne sekundy, filtrowanie odbywa się dokładnie w milisekundach | DONE |
| Powtórny import identycznego zakresu | Ponowne użycie gotowego archiwum tego samego źródła, symbolu i zakresu z poprawioną polityką granic | DONE |
| Brak odczytu historii użytkownika z folderu | Import CSV/TSV ticków z `FXReplay/inbox`, jawny offset UTC, streaming, odrzucenie OHLC | DONE |
| „1×” oznaczało kilka ticków na sekundę | Zegar timestampów ticków, rAF, wyszukiwanie binarne; 1×–1000× w obie strony | DONE |
| Suwak obejmował tylko bieżące 10 000 ticków | Suwak całego archiwum, okna 30 000 i sąsiedni prefetch | DONE |
| Wykres skanował wszystkie wcześniejsze ticki każdej klatki | Indeks świec i zapisane prefiksy OHLC, najwyżej 140 świec w renderze | DONE |
| Przyszłe maksimum/minimum przy optymalizacji wykresu | Bieżąca świeca używa tylko prefiksu do aktualnego kursora, również przy cofaniu | DONE |
| EMA seed SMA i ATR Wilder odbiegały od źródeł MetaQuotes | EMA od pierwszej ceny, ATR z kroczącej średniej TR od drugiej świecy; jawny wariant `legacy_v2` | DONE |
| `net_points_volume` sumowało kwoty w walucie | Punkty × wolumen; kwoty nadal są osobnym wynikiem | DONE |
| Raport liczby świec zatrzymywał się na 10 000 | Osobny całkowity licznik | DONE |
| Limit wypełniony przez lukę za SL przerywał run | Po wypełnieniu Limit SL sprawdzany jest na rzeczywistej cenie wyjścia; nie jest ponownie walidowany względem lepszego fill | DONE |
| Brak Bid/Ask pomijał otwartą pozycję w equity | Equity niedostępne zamiast pozornego wyniku; końcowe rozliczenie bez quote odmawia zakończenia | DONE |
| Wybrany zapisany bot API v2 nie ładował się do edytora | Źródło wybranego skryptu jest wczytywane; generacja żądań odrzuca nieaktualne odpowiedzi | DONE |
| Pobierano tylko pierwsze 5 000 zdarzeń okna | Paginacja wszystkich zdarzeń bieżącego okna; dziennik renderuje ostatnie 500 do kursora, wykres ostatnie 1 000 markerów | DONE |

## Starsze archiwa — potrzebny ponowny import dla dokładnych testów

Porównanie tygodnia wykazało:

- wszystkie 2 948 605 rekordów starego archiwum znajdują się w nowym, identyczne i w tej samej kolejności;
- nowy odczyt zawiera 698 dodatkowych ticków w 105 sekundach;
- dodatkowe ticki mają niezerowe milisekundy: 1–992 ms; odpowiadają pominiętym końcówkom sekund porcji.

Stare archiwa pozostają czytelne i mogą służyć do powtórki. UI ostrzega o błędzie dawnego importera, raport zapisuje `legacy_boundary_risk`. Nowy cache nie uznaje starego importu za poprawiony i nie podmienia go automatycznie. Do dokładnego backtestu **zaimportuj wybrany stary zakres ponownie**. Dawne zakończone wyniki pozostają zapisami dawnego silnika; aby skorzystać z poprawionych obliczeń trzeba wykonać nową symulację.

## Import z folderu

1. W MT5 wyeksportuj **ticki**, a nie świece. W CRT wybierz „Eksport ticków z folderu”.
2. Umieść zamknięty plik CSV/TSV/TXT w wyświetlonym folderze `FXReplay/inbox` i odśwież listę.
3. Podaj dokładny symbol, zakres i przesunięcie czasu eksportu względem UTC (0 dla UTC, 120 dla UTC+2). Daty zakresu w formularzu używają lokalnej strefy Windows.
4. Plik wymaga kolumn DATE, TIME, BID, ASK. LAST, VOLUME, VOLUME_REAL, FLAGS są opcjonalne; puste pola ceny zachowują wcześniejszy odczyt. Pierwszy tick musi określać Bid i Ask. Brak FLAGS oznacza flagi wyliczane ze zmian pól, opisane w manifeście.
5. Plik nie zapisuje tożsamości brokera/symbolu: przypisanie jest jawnie wykonane przez użytkownika. MT5 dostarcza aktualną specyfikację i migawkę konta; nie są to historyczne parametry dla każdego ticka.

Obsługiwane są UTF-8/BOM i UTF-16/BOM, separatory TAB/semicolon/comma, format daty `YYYY.MM.DD` i czasu `HH:MM:SS[.mmm]`. Pliki cache `.tkc`/`.hcc` nie są odczytywane bezpośrednio. Stały offset nie rekonstruuje zmian DST; dla zakresu obejmującego zmianę strefy wyeksportuj UTC lub rozdziel źródło na zakresy z właściwym offsetem.

Gotowe archiwum działa offline. Pomyślny zapis oznacza ukończenie odczytu żądanych porcji/pliku, **nie dowód, że broker udostępnił całą historię bez luk**. Nie generujemy ticków na brakujące okresy.

## Co nadal odbiega od MT5

| Obszar | Stan |
|---|---|
| Test transakcja po transakcji względem natywnego testera i tej samej historii/kosztów | NOT RUN |
| Netting i reguły pozycji konta giełdowego | MISSING — używany jest jawny model hedgingu |
| Wykres Last / realizacja instrumentów giełdowych | MISSING — run jest odrzucany, żeby nie używać błędnego modelu Bid |
| Historyczny margin, przewalutowanie, swap, stop-out, taryfy prowizji | PARTIAL — migawka i szacunki; koszty jawnie konfigurowane |
| Sesje handlu, StopsLevel/FreezeLevel, kolejka i opóźnienie realizacji | MISSING |
| Serwerowe granice świec i rozgrzewka przed początkiem zakresu | PARTIAL — świece z ticków wyrównane do UTC; wskaźniki startują z początku archiwum |
| Wizualny kontekst wielu miesięcy przy dowolnym skoku | PARTIAL — okno 30 000 ticków z nakładaniem, a nie wszystkie świece serwerowe |
| Wielowalutowość / wiele symboli / optymalizacja wielu strategii | MISSING, poza V1 |
| Wydajność roku danych i BTCUSD | NOT RUN — sprawdzono tydzień XAUUSDs |

`indicator_model: mt5` opisuje wzory EMA/ATR, a nie certyfikat zgodności całego testera. Zarejestruj wskaźniki w `on_start`, aby inicjowały się od początku archiwum; późniejsze pierwsze wywołanie używa dostępnego bufora 10 000 świec. Natywny MT5 może dodatkowo synchronizować wcześniejszą historię.

## Walidacja

- 17 nowych testów Python: zapis/odczyt, SHA-256, powtarzające się milisekundy, brakujące granice sekund, nieprawidłowe dane, stare DB, CSV, offline worker, EMA/ATR, punkty, luki przez SL i całkowity licznik świec.
- 4 nowe testy TypeScript: prefiksy bez przyszłych OHLC, rzeczywisty zegar, wspólne milisekundy i brak zastępowania Bid przez Last.
- Przeglądarka QHD 2560×1440 na kontrolowanych danych: suwak całego archiwum, 100× w przód i w tył, odczyt folderu, bez błędów JavaScript. Nie zastępuje odbioru zainstalowanej aplikacji/WebView2.
- Import rzeczywistych ticków do osobnego archiwum oraz symulacja przykładowego skryptu w izolowanym procesie `-I -S`.
- Dwie symulacje tego samego tygodnia i skryptu: identyczny dziennik zdarzeń; czasy 14,81 s i 14,91 s.
- Pełny zestaw Python: 33 testy PASS; TypeScript: 108 testów PASS. Kompilacja frontendu, składnia Python i `cargo check --offline`: PASS.
- Akceptacja aktualizacji w zainstalowanej aplikacji Windows oraz porównanie transakcji z natywnym testerem MT5: NOT RUN.

## Źródła wzorców i zasad

- [Oficjalne copy_ticks_range: NumPy, UTC i parametry czasu](https://www.mql5.com/en/docs/python_metatrader5/mt5copyticksrange_py).
- [Właściwości testera MT5](https://www.metatrader5.com/en/terminal/help/algotrading/testing_features).
- [Biblioteka MovingAverages MetaQuotes](https://www.mql5.com/en/code/77) oraz rzeczywisty `MQL5/Include/MovingAverages.mqh` z lokalnego MT5.
- [ATR MetaQuotes](https://www.mql5.com/en/code/12) oraz rzeczywisty `MQL5/Indicators/Examples/ATR.mq5` z lokalnego MT5.
- [Dane cenowe: różnica ticków i świec, Bid oraz Last](https://www.metatrader5.com/en/terminal/help/trading_advanced/price_data).
