# CRT Terminal 0.1.28

- FX Replay importuje ticki z MT5 przez `copy_ticks_range` w godzinnych porcjach.
- Archiwum SQLite zachowuje brokerowy czas w milisekundach, kolejność, Bid/Ask/Last, wolumen i flagi oraz manifest z symbolem i specyfikacją.
- Niekompletny, anulowany lub przerwany import jest oznaczany osobno i nie może zostać użyty do odtwarzania.
- Dostępne są odczyt postępu, anulowanie importu, lista archiwów i stronicowany odczyt ticków; API nie składa zleceń.
- Przycisk `FX REPLAY` otwiera ekran CRT do ustawienia symbolu i zakresu oraz podglądu statusu archiwów.
- Dodano wersję 1 kontraktu Python: `on_start(context)`, `on_tick(context, tick)`, `on_stop(context)`; import waliduje składnię i wymagane funkcje.
- Symulację uruchamia oddzielny Python z `-I -S`, bez pakietów środowiska mostu MT5. Udostępnia wyłącznie BUY/SELL, BUY LIMIT/SELL LIMIT, SL/TP oraz pełne i częściowe zamknięcie symulowanych pozycji.
- Wyniki zapisują skrót skryptu i archiwum, parametry, metryki oraz stronicowany dziennik zdarzeń. Koszty prowizji, swapu i poślizgu są jawnie oznaczone jako niemodelowane.
- Ten krok nie dodaje jeszcze widoku zarządzania skryptami i odtwarzacza; ręczne uruchomienie przeciw archiwum z MT5 pozostaje do weryfikacji.

Aktualizacje nadal wymagają jawnego kliknięcia w terminalu.
