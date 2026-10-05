# CRT Terminal 0.1.33

- FX Replay otrzymał zielono-czarną oprawę CRT spójną z głównym terminalem.
- Okno odtwarzania zajmuje centralną część widoku; import, archiwa i skrypty strategii są w bocznym panelu.
- Pusty ekran odtwarzacza pokazuje ramkę monitora i status oczekiwania, także przed importem pierwszego archiwum.
- Układ dostosowuje się do węższych ekranów, przenosząc odtwarzacz nad narzędzia.

- FX Replay automatycznie przechodzi między stronami ticków podczas odtwarzania w przód i w tył; ręczne sterowanie porcjami pozostaje dostępne.

- FX Replay importuje ticki z MT5 przez `copy_ticks_range` w godzinnych porcjach.
- Archiwum SQLite zachowuje brokerowy czas w milisekundach, kolejność, Bid/Ask/Last, wolumen i flagi oraz manifest z symbolem i specyfikacją.
- Niekompletny, anulowany lub przerwany import jest oznaczany osobno i nie może zostać użyty do odtwarzania.
- Dostępne są odczyt postępu, anulowanie importu, lista archiwów i stronicowany odczyt ticków; API nie składa zleceń.
- Przycisk `FX REPLAY` otwiera ekran CRT do ustawienia symbolu i zakresu oraz podglądu statusu archiwów.
- Dodano wersję 1 kontraktu Python: `on_start(context)`, `on_tick(context, tick)`, `on_stop(context)`; import waliduje składnię i wymagane funkcje.
- Symulację uruchamia oddzielny Python z `-I -S`, bez pakietów środowiska mostu MT5. Udostępnia wyłącznie BUY/SELL, BUY LIMIT/SELL LIMIT, SL/TP oraz pełne i częściowe zamknięcie symulowanych pozycji.
- Wyniki zapisują skrót skryptu i archiwum, parametry, metryki oraz stronicowany dziennik zdarzeń. Koszty prowizji, swapu i poślizgu są jawnie oznaczone jako niemodelowane.
- Ręczne uruchomienie strategii na archiwum z MT5 pozostaje do weryfikacji.
- Ekran FX Replay pozwala zapisać skrypt, wybrać archiwum i parametry, uruchomić/anulować symulację oraz obejrzeć postęp, metryki i zdarzenia bieżącej porcji ticków.
- Dziennik przechowuje kolejność ticka źródłowego, a odtwarzacz pobiera Entry/Exit dla aktualnie wyświetlanej porcji.
- Odtwarzacz pokazuje świece składane z ticków Bid, znaczniki zdarzeń strategii, oś czasu, wybór interwału, krok tick/świeca, tempo oraz odtwarzanie i cofanie.
- Dane są ładowane porcjami po 10 000 ticków; przechodzenie do kolejnych i poprzednich porcji obsługuje większe archiwa bez wczytywania całej historii do pamięci.
- Import ticków i wykonanie FX Replay nie zostały ręcznie potwierdzone na MT5.

Aktualizacje nadal wymagają jawnego kliknięcia w terminalu.
