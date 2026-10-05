# CRT Terminal 0.1.27

- FX Replay importuje ticki z MT5 przez `copy_ticks_range` w godzinnych porcjach.
- Archiwum SQLite zachowuje brokerowy czas w milisekundach, kolejność, Bid/Ask/Last, wolumen i flagi oraz manifest z symbolem i specyfikacją.
- Niekompletny, anulowany lub przerwany import jest oznaczany osobno i nie może zostać użyty do odtwarzania.
- Dostępne są odczyt postępu, anulowanie importu, lista archiwów i stronicowany odczyt ticków; API nie składa zleceń.
- Przycisk `FX REPLAY` otwiera ekran CRT do ustawienia symbolu i zakresu oraz podglądu statusu archiwów.

Aktualizacje nadal wymagają jawnego kliknięcia w terminalu.
