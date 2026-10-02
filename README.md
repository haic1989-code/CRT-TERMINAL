# CRT Terminal

Read-only local market terminal, prepared for its Windows desktop shell. The React/Vite UI remains the same between browser preview and the packaged app.

## Aplikacja Windows

`npm run app:dev` uruchamia CRT Terminal w natywnym oknie Tauri. `npm run app:build`
tworzy instalatory MSI i NSIS EXE. Aplikacja sprawdza lokalny most MT5, a gdy go
nie wykryje, uruchamia dołączony skrypt `mt5-bridge/start.ps1` w tle. Pierwsze
uruchomienie mostu wymaga lokalnego Pythona; brakujące pakiety skrypt pobierze
z PyPI z użyciem `mt5-bridge/requirements.txt`. Środowisko Pythona zapisuje się
w katalogu danych użytkownika, nie w chronionym folderze instalacji. MetaTrader
5 musi być uruchomiony i zalogowany.
Zamknięcie okna pokazuje ekran wyłączania, zatrzymuje most z potwierdzeniem i
zamyka aplikację po zakończeniu sekwencji.
This repository starts from a clean slate; it does not contain or inherit AKARI code.

## Aktualny stan — Matrix terminal

Domyślny widok to zielony Matrix z hologramem agentki DESIGN V2 w tle żywego
wykresu. Wykres, planner, wskaźniki, rysowanie, Market Context i Risk Guard
pozostają aktywnymi komponentami React. Dane pochodzą z lokalnego mostka MT5.
Poziomy wybiera się w konsoli CRT na wykresie. Integracja lokalnego modelu i
kafel Agent Advice zostały usunięte. Mostek nie wysyła zleceń. Starszy widok jest
dostępny pod `?ui=legacy`.
Odzyskano również poprawkę TPO Market Profile opisaną w `MARKET_PROFILE_FIX.md`.

## Szybki start — Windows

1. Uruchom MetaTrader 5 i zaloguj się na konto brokerskie.
2. W katalogu głównym projektu wykonaj **dwuklik `START_SMARTFLOW_X.cmd`**.
3. Starter sprawdzi MT5, uruchomi lokalny MT5 Bridge w osobnym oknie PowerShell,
   poczeka na health check, uruchomi lokalny terminal Matrix i otworzy
   `http://127.0.0.1:5173/`. Adres można nadpisać zmienną `SMARTFLOW_PREVIEW_URL`.

Wymagany jest Python x64 dostępny jako `py` lub `python`. Przy pierwszym
uruchomieniu bridge sam utworzy środowisko i zainstaluje wymagane pakiety.
Obejście ExecutionPolicy dotyczy wyłącznie uruchomionego procesu PowerShell.
Zostaw MT5 uruchomiony. Bridge i terminal działają w tle. Logi lokalnego
terminalu są zapisywane w `.smartflow-runtime/`. Wymagany jest również Node.js
i zależności projektu zainstalowane poleceniem `npm ci`.

Bridge nasłuchuje tylko na `127.0.0.1`, przyjmuje wyłącznie odczyt i nie ma
endpointu składania zleceń. Domyślnie akceptuje lokalne originy deweloperskie.
Dla konkretnego preview ustaw w tym samym środowisku
`SMARTFLOW_PREVIEW_URL` oraz `SMARTFLOW_ALLOWED_ORIGINS` na pełny origin
preview (bez ścieżki i wildcardu). Przykład uruchomienia:

```powershell
$env:SMARTFLOW_PREVIEW_URL = 'https://twoj-preview.vercel.app'
$env:SMARTFLOW_ALLOWED_ORIGINS = 'https://twoj-preview.vercel.app'
.\START_SMARTFLOW_X.cmd
```

Szczegóły są w [`mt5-bridge/README.md`](mt5-bridge/README.md).

## Run locally — development

Requires Node.js 22.12+ or 24+.

```bash
npm install
npm run dev
```

Vite is configured to listen on `127.0.0.1` only. Build and type-check with:

```bash
npm run build
```

See [`docs/STATE_MATRIX_CRT.md`](docs/STATE_MATRIX_CRT.md) for the Matrix CRT
state and [`docs/decisions/0002-windows-desktop-runtime-tauri.md`](docs/decisions/0002-windows-desktop-runtime-tauri.md)
for the Windows desktop runtime decisions.
