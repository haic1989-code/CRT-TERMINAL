# CRT Terminal — lokalny odtwarzacz i tester strategii

**Stan:** konstrukcja zatwierdzona do realizacji  
**Zakres V1:** jeden instrument, rzeczywiste ticki MT5, skrypty strategii w Pythonie, wyłącznie symulowane zlecenia.

## Cel

Zbudować prosty tester działający lokalnie. MT5 służy do pobrania ticków i metadanych symbolu. Po imporcie historii tester działa bez aktywnego MT5 i bez połączenia z brokerem. Użytkownik może uruchamiać własne skrypty Python, zobaczyć symulowane wejścia i wyjścia, wynik w pipsach/punktach oraz płynnie przewijać przebieg w obu kierunkach.

Tester nie wysyła zleceń do MT5. Nie uruchamia plików `.mq5` ani `.ex5`.

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

## Etapy realizacji

### 1. Historia tickowa

- Dodać do mostu pobieranie zakresu rzeczywistych ticków z walidacją i limitem zakresu.
- Dodać kontrakt zbioru CRT, lokalny zapis oraz ekran wyboru symbolu/zakresu i postęp importu.
- Pokazać liczbę ticków, źródło, zakres oraz stan kompletności przed rozpoczęciem testu.

### 2. Lokalny silnik i API Python

- Uruchamiać skrypt strategii na zaimportowanym zbiorze bez wywołań do MT5.
- Dodać symulowane pozycje BUY/SELL, zamknięcia i jawne rozliczanie Bid/Ask.
- Zapisywać wersję skryptu, konfigurację, hash danych oraz wszystkie zdarzenia przebiegu.

### 3. Odtwarzacz na wykresie

- Wyświetlać świece agregowane z ticków archiwum, zachowując rzeczywisty strumień ticków jako wejście silnika.
- Dodać Start/Pauza, krokowanie, regulację szybkości i przewijanie w obie strony.
- Rysować Entry/Exit oraz wynik w pipsach/punktach i podsumowanie transakcji.

### 4. Wydajność i domknięcie

- Zmierzyć import i replay na reprezentatywnych zbiorach przed optymalizacją.
- Dodać indeks czasu/partycje danych i checkpointy tylko tam, gdzie pomiary wykażą potrzebę.
- Zweryfikować zgodność wyników po ponownym uruchomieniu tego samego skryptu na tych samych danych.

## Kolejność wdrożenia i granice

Najpierw powstaje kompletna pionowa ścieżka dla jednego symbolu: import → lokalny skrypt → symulowane transakcje → odtwarzanie → raport. Dopiero po jej sprawdzeniu rozszerzamy tester o wiele symboli, optymalizację parametrów, portfel strategii i zaawansowane modele kosztów.

Zakres V1 pozostaje tylko do odczytu względem MT5. Żaden element testera nie może wywołać `order_send`, otworzyć pozycji DEMO ani rzeczywistej ani zmienić ustawień konta.

## Pierwszy zakres implementacji

Najpierw realizujemy import rzeczywistych ticków dla jednego instrumentu i zakresu dat, lokalny zapis SQLite `.crt-replay` oraz walidację manifestu. Potem powstaje runner Pythona z kontraktem strategii i symulacją zleceń, a następnie integracja odtwarzacza z wykresem. Limit wielkości pojedynczego importu ustalimy na podstawie pomiarów MT5 na XAUUSD i BTCUSD; przekroczenie limitu dzielimy na jawne porcje zamiast obcinać dane po cichu.
