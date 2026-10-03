# CRT Terminal 0.1.21

- Most MT5 otrzymuje spójną tożsamość `CRT_TERMINAL_MT5` i protokół v4 po stronie terminalu, aplikacji Tauri oraz bridge'a Python.
- Nagłówki transportowe i wyłączania mostu używają prefiksu `X-CRT-Terminal-*`.
- Zmienne środowiskowe mostu mają prefiks `CRT_TERMINAL_*`; starsze `SMARTFLOW_*` nadal działają jako aliasy zgodności.
- Atrapy testowe startu i wyłączania odzwierciedlają uwierzytelnione odpowiedzi mostu.

Aktualizacje nadal wymagają jawnego kliknięcia. Aplikacja zachowuje dotychczasowy identyfikator instalacji Windows, aby aktualizacja z poprzedniej wersji działała w tym samym miejscu. Weryfikacja instalacji na Windows i połączenia z działającym MT5 pozostaje ręczna. Nie wykonano żadnych operacji brokerskich.
