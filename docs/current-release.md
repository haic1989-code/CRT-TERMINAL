# CRT Terminal 0.1.22

- Most MT5 otrzymuje spójną tożsamość `CRT_TERMINAL_MT5` i protokół v4 po stronie terminalu, aplikacji Tauri oraz bridge'a Python.
- Nagłówki transportowe i wyłączania mostu używają prefiksu `X-CRT-Terminal-*`.
- Zmienne środowiskowe mostu mają prefiks `CRT_TERMINAL_*`; starsze `SMARTFLOW_*` nadal działają jako aliasy zgodności.
- Grafiki sesji symbolu pochodzą z natywnych godzin kwotowań/handlu MT5 przez dołączony, tylko odczytowy pomocnik MQL5. Bez kompletnego świeżego grafiku terminal nie zgaduje statusu zamknięcia.
- Egzekucja DEMO ma jawne tryby Po rynku, Buy Limit i Sell Limit; most odrzuca niewłaściwą stronę lub cenę Limit i nie zamienia jej w Stop.
- Protokół mostu zwiększono do v5 dla nowego odczytu sesji.

Aktualizacje nadal wymagają jawnego kliknięcia. Aplikacja zachowuje dotychczasowy identyfikator instalacji Windows, aby aktualizacja z poprzedniej wersji działała w tym samym miejscu. Pomocnik MQL5 wymaga jednorazowego skompilowania i uruchomienia na wykresie MT5. Nie wykonano żadnych operacji brokerskich ani zleceń DEMO.
