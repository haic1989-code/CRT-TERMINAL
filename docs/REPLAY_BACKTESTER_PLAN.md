# CRT Terminal — lokalny odtwarzacz i tester strategii

**Stan:** etap 1 wdrożony; etap 2 ma API, lokalne archiwum SQLite i ekran importu; rzeczywisty odbiór ticków MT5 pozostaje do wykonania\
**Zakres V1:** jeden instrument, rzeczywiste ticki MT5, skrypty strategii w Pythonie, wyłącznie symulowane zlecenia.

## Postęp

- [x] Uzgodnić rzeczywiste ticki MT5 jako jedyne źródło danych testowych.
- [x] Uzgodnić lokalne skrypty Python zamiast uruchamiania EA MQL5.
- [x] Uzgodnić przewijanie odtworzonego przebiegu w przód i w tył.
- [x] Uzgodnić przycisk `FX REPLAY` oraz CRT styl dedykowanego widoku.
- [x] Zapisać i wypchnąć plan do repozytorium.
- [x] Rozpocząć implementację pierwszego etapu: uruchamianie terminalu offline.

## Cel

Zbudować prosty tester działający lokalnie. MT5 służy do pobrania ticków i metadanych symbolu. Po imporcie historii tester działa bez aktywnego MT5 i bez połączenia z brokerem. Użytkownik może uruchamiać własne skrypty Python, zobaczyć symulowane wejścia i wyjścia, wynik w pipsach/punktach oraz płynnie przewijać przebieg w obu kierunkach.

Tester nie wysyła zleceń do MT5. Nie uruchamia plików `.mq5` ani `.ex5`.

## Tryb pracy aplikacji

Obecny start CRT wymaga gotowego mostu MT5 i świeżej historii wykresu. Przed udostępnieniem replay trzeba rozdzielić gotowość aplikacji od gotowości brokera: moduły i updater uruchamiają się normalnie, a brak MT5 przełącza terminal w stan offline. W tym stanie użytkownik może otworzyć wcześniej zapisane archiwum i odtwarzać test. Import nowej historii wymaga działającego MT5. Nie wyświetlamy fikcyjnego statusu „MT5 gotowe” ani przykładowych danych.

## Wejście do FX Replay i jego wygląd

- W głównym pasku CRT dodajemy widoczny przycisk `FX REPLAY`, dostępny niezależnie od stanu połączenia z MT5.
- Przycisk otwiera dedykowany widok odtwarzacza z wyborem archiwum, skryptu i zakresu testu. Wyjście z replay wraca do terminalu bez zmiany ustawień połączenia na żywo.
- Tło odtwarzacza korzysta z języka wizualnego CRT Terminal: ciemny granatowo-czarny ekran, chłodna niebieska poświata monitora, delikatna siatka i subtelne linie CRT. Typografia, ramki i akcenty zielono-cyjanowe pozostają spójne z konsolą terminalu; tekst i wykres mają zachować czytelność.
- Widok nie pokazuje panelu egzekucji DEMO/live. Wszystkie zlecenia w FX Replay są wyłącznie symulowane.

## Przepływ danych

1. Użytkownik wybiera symbol, interwał wykresu oraz zakres dat.
2. Most pobiera z MT5 ticki przez oficjalne `copy_ticks_range`, wraz z `time_msc`, Bid, Ask, Last, wolumenem i flagami, a także właściwości symbolu: cyfry, punkt, rozmiar ticka, kontrakt i krok wolumenu.
3. Import zapisuje lokalny zbiór CRT z manifestem: broker/serwer, symbol brokera, okres, strefa czasu, metadane symbolu, liczba ticków i informacja o kompletności. Brak historii, błąd pobrania, nieuporządkowane rekordy lub niewiarygodne ceny przerywają import. Nie tworzymy ticków z OHLC i nie uzupełniamy luk danymi syntetycznymi.
4. Po imporcie dane są przechowywane lokalnie w bazie SQLite `.crt-replay` i pozostają dostępne bez MT5. Osobne rekordy manifestu opisują źródło i specyfikację; rekord ticka zachowuje oryginalny czas w milisekundach i kolejność. Każdy test wskazuje konkretny zbiór i jego zakres.

## Skrypt strategii

Strategia jest plikiem Python opartym na jawnym API CRT, a nie dowolnym plikiem MQL5. Minimalny interfejs V1:

- `on_start(context)` — konfiguracja i inicjalizacja stanu;
- `on_tick(context, tick)` — wywołanie dla każdego ticka z archiwum;
- `on_stop(context)` — podsumowanie stanu po ostatnim ticku.

`context` udostępnia symbol i jego specyfikację, bieżące Bid/Ask, czas symulacji, świece zbudowane z ticków dla wybranego interwału, stan pozycji oraz metody składania **wyłącznie symulowanych** zleceń. V1 obsługuje pozycje rynkowe BUY/SELL, zlecenia BUY LIMIT/SELL LIMIT, SL/TP, zamknięcie i częściowe zamknięcie. Nie implementuje pełnego API MQL5. Kontrakt strategii i wersja API są zapisane w raporcie, aby późniejsza zmiana API nie zmieniała po cichu starych wyników.

Silnik przyjmuje sygnały deterministycznie w kolejności ticków. Zmiana kodu, parametrów lub założeń kosztów tworzy nowe uruchomienie; nie zmienia zakończonego przebiegu.

## Wykonanie i wyniki

- BUY otwiera się po Ask i zamyka po Bid; SELL otwiera się po Bid i zamyka po Ask.
- Wynik pozycji wyliczamy z cen faktycznie użytych w symulacji. Pokazujemy pipsy, gdy konwencję instrumentu da się ustalić z metadanych lub konfiguracji; w przeciwnym razie pokazujemy zmianę ceny i liczbę punktów/ticków brokera bez nazywania ich pipsem.
- Prowizję, swap i poślizg pokazujemy jako osobne, jawne założenia. Brak danych o koszcie oznacza „nieuwzględniono”, a nie zero potwierdzone przez brokera.
- Rejestrujemy każde wejście, częściowe zamknięcie, zamknięcie, zmianę salda i powód zamknięcia. Wykres oznacza Entry i wyjścia; wynik zamkniętej pozycji pokazuje `+` albo `−`.
- Odtwarzanie wstecz przesuwa kursor po wcześniej wyliczonym przebiegu zdarzeń. Nie wywołuje kodu strategii wstecz. Zmiana strategii lub danych uruchamia obliczenie od początku.

## Płynność

Obliczenia tickowe działają poza renderowaniem wykresu. Silnik może przetworzyć wiele ticków między klatkami obrazu; wykres odświeża się osobno, zgodnie z prędkością odtwarzania. Sterowanie obejmuje Start/Pauza, krok tick/bar, prędkość i suwak czasu. Cofanie oraz skok do wybranego czasu korzystają z wcześniej zapisanego dziennika wyników.

## Lista realizacji

### Etap 1 — start offline

- [ ] Rozdzielić gotowość modułów CRT od gotowości mostu MT5.
- [ ] Pozwolić przejść do terminalu bez MT5; pokazać uczciwy status offline i pusty wykres bez danych przykładowych.
- [ ] Zachować obecny start live, kontrolę aktualizacji i komunikaty Luny.
- [ ] Kryterium ukończenia: aplikacja uruchamia się bez MT5, a połączenie live nadal działa po jego dostępności.

### Etap 2 — import i archiwum ticków

- [x] Dodać pobieranie zakresu rzeczywistych ticków dla wybranego symbolu przez MT5 `copy_ticks_range`.
- [x] Zachować `time_msc`, kolejność rekordów, Bid, Ask, Last, wolumen i flagi; nie tworzyć ticków z OHLC.
- [x] Zapisać dane i manifest symbolu/brokera w lokalnej bazie SQLite `.crt-replay`.
- [x] Dodać postęp, anulowanie i błędy importu; przerwany zakres jest oznaczany jako niekompletny.
- [x] Udostępnić API listy archiwów i stronicowanego odczytu ticków wraz ze stanem kompletności.
- [x] Dodać widok FX Replay dla wyboru symbolu i zakresu, importu oraz przeglądania archiwów.
- [ ] Kryterium ukończenia: po rzeczywistym imporcie archiwum otwiera się bez aktywnego MT5 i zachowuje oryginalną kolejność ticków.

### Etap 3 — Python i symulator

- [x] Zdefiniować wersjonowany interfejs skryptu: `on_start`, `on_tick`, `on_stop` oraz konfigurację parametrów.
- [x] Uruchamiać skrypt w osobnym lokalnym procesie bez pakietów zainstalowanych w środowisku MT5.
- [x] Udostępnić wyłącznie symulowane operacje: BUY/SELL, BUY LIMIT/SELL LIMIT, SL/TP, zamknięcie i częściowe zamknięcie.
- [x] Rozliczać BUY po Ask i wyjście po Bid; SELL po Bid i wyjście po Ask.
- [x] Zapisać kod/wersję API, parametry, hash archiwum, jawne założenia kosztów i stronicowane zdarzenia.
- [ ] Kryterium ukończenia: to samo archiwum, skrypt i parametry dają ten sam dziennik transakcji przy ponownym uruchomieniu.

### Etap 4 — przycisk i widok FX Replay

- [x] Dodać przycisk `FX REPLAY` do głównego paska CRT; ma być dostępny również w trybie offline.
- [ ] Otwierać dedykowany widok z wyborem archiwum, skryptu Python i parametrów symulacji.
- [ ] Zaprojektować tło w stylu CRT: ciemny granat, niebieska poświata monitora, delikatna siatka i subtelne linie ekranu.
- [ ] Dodać wykres archiwum, oś czasu, Start/Pauza, krok tick/bar, prędkość oraz przewijanie w przód i w tył.
- [ ] Rysować znaczniki Entry/Exit, wynik w pipsach/punktach oraz dziennik i podsumowanie transakcji.
- [ ] Nie wyświetlać w tym widoku panelu egzekucji DEMO/live; wszystkie operacje są symulowane.
- [ ] Kryterium ukończenia: można otworzyć lokalne archiwum, uruchomić strategię i płynnie obejrzeć zapisany przebieg w obu kierunkach.

### Etap 5 — wydajność i wydanie

- [ ] Zmierzyć czas importu i przetwarzania na rzeczywistych zbiorach XAUUSD i BTCUSD.
- [ ] Ustalić limity zakresu na podstawie pomiarów; większy zakres dzielić jawnie, nigdy nie ucinać bez informacji.
- [ ] Dodać indeksy, porcjowanie i checkpointy tylko tam, gdzie pomiary wykażą potrzebę.
- [ ] Zbudować aplikację i sprawdzić ręcznie start offline, import MT5, replay i powrót do widoku live.
- [ ] Przed każdym wydaniem zwiększyć wersję zgodnie z repozytoryjną zasadą pięciu plików i sprawdzić publikację podpisanego instalatora/updatera.
- [ ] Kryterium ukończenia: raport odtwarza założenia i źródło danych, a updater wskazuje właściwy instalator.

## Kolejność wdrożenia i granice

Najpierw powstaje kompletna pionowa ścieżka dla jednego symbolu: import → lokalny skrypt → symulowane transakcje → odtwarzanie → raport. Dopiero po jej sprawdzeniu rozszerzamy tester o wiele symboli, optymalizację parametrów, portfel strategii i zaawansowane modele kosztów.

Zakres V1 pozostaje tylko do odczytu względem MT5. Żaden element testera nie może wywołać `order_send`, otworzyć pozycji DEMO ani rzeczywistej ani zmienić ustawień konta.

## Granice V1

Najpierw kończymy pojedynczą ścieżkę dla jednego symbolu: start offline → import ticków → skrypt Python → symulowane transakcje → odtwarzanie → raport. Dopiero potem rozszerzamy tester o wiele symboli, optymalizację parametrów, portfel strategii i bardziej zaawansowane modele kosztów. Zakresy danych dzielimy jawnie; nigdy nie obcinamy historii po cichu.
