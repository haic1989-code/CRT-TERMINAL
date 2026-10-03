# CRT Terminal

Local market terminal with manually confirmed DEMO execution in its Windows desktop shell. The React/Vite UI remains the same between browser preview and the packaged app.

## Aplikacja Windows

`npm run app:dev` uruchamia CRT Terminal w natywnym oknie Tauri. `npm run app:build`
tworzy instalatory MSI i NSIS EXE. Każda sesja aplikacji uruchamia własny most MT5
przez dołączony skrypt `mt5-bridge/start.ps1` w tle, na prywatnym porcie localhost.
Nie przejmuje mostu poprzedniej instalacji. Wymagany jest lokalny Python 3.13 x64;
przypięte pakiety są instalowane z dołączonego zestawu offline. Środowisko zapisuje się
w katalogu danych użytkownika, nie w chronionym folderze instalacji. MetaTrader
5 musi być uruchomiony i zalogowany.
Zmiana konta lub instalacji MT5 wymaga ponownego otwarcia CRT Terminal.
Opcjonalny `MT5_TERMINAL_PATH` wskazuje dokładny plik EXE terminalu MT5.
Zamknięcie okna pokazuje ekran wyłączania, zatrzymuje most z potwierdzeniem i
zamyka aplikację po zakończeniu sekwencji.
This repository starts from a clean slate; it does not contain or inherit AKARI code.

## Aktualny stan — Matrix terminal

Domyślny widok to zielony Matrix ze statyczną agentką w tle żywego
wykresu. Wykres, planner, wskaźniki, rysowanie, Market Context i Risk Guard
pozostają aktywnymi komponentami React. Dane pochodzą z lokalnego mostka MT5.
Poziomy wybiera się w konsoli CRT na wykresie. Integracja lokalnego modelu i
kafel Agent Advice zostały usunięte. Od 0.1.14 własny most aplikacji desktopowej obsługuje ręcznie potwierdzane zlecenia DEMO; konta rzeczywiste i podgląd przeglądarkowy są zablokowane dla egzekucji. Starszy widok jest
dostępny pod `?ui=legacy`.
Odzyskano również poprawkę TPO Market Profile opisaną w `MARKET_PROFILE_FIX.md`.

## Szybki start — Windows

1. Uruchom MetaTrader 5 i zaloguj się na konto brokerskie.
2. W katalogu głównym projektu wykonaj **dwuklik `START_SMARTFLOW_X.cmd`**. Nazwa skryptu startowego pozostaje bez zmian dla zgodności z dotychczasowym sposobem uruchamiania.
3. Starter sprawdzi MT5, uruchomi lokalny MT5 Bridge w osobnym oknie PowerShell,
   poczeka na health check, uruchomi lokalny terminal Matrix i otworzy
   `http://127.0.0.1:5173/`. Adres można nadpisać zmienną `SMARTFLOW_PREVIEW_URL`.

Wymagany jest Python 3.13 x64 dostępny jako `py` lub `python`. Przy pierwszym
uruchomieniu bridge sam utworzy środowisko i zainstaluje wymagane pakiety.
Obejście ExecutionPolicy dotyczy wyłącznie uruchomionego procesu PowerShell.
Zostaw MT5 uruchomiony. Bridge i terminal działają w tle. Logi lokalnego
terminalu są zapisywane w `.smartflow-runtime/`. Wymagany jest również Node.js
i zależności projektu zainstalowane poleceniem `npm ci`.

Bridge nasłuchuje tylko na `127.0.0.1`. Ręcznie uruchomiony most przeglądarkowy przyjmuje wyłącznie odczyt; egzekucja wymaga własnej sesji desktopowej, prywatnego tokenu i konta DEMO. Domyślnie akceptuje lokalne originy deweloperskie.
Dla konkretnego preview ustaw w tym samym środowisku
`SMARTFLOW_PREVIEW_URL` oraz `CRT_TERMINAL_ALLOWED_ORIGINS` na pełny origin
preview (bez ścieżki i wildcardu). Przykład uruchomienia:

```powershell
$env:SMARTFLOW_PREVIEW_URL = 'https://twoj-preview.vercel.app'
$env:CRT_TERMINAL_ALLOWED_ORIGINS = 'https://twoj-preview.vercel.app'
.\START_SMARTFLOW_X.cmd
```

Most MT5 używa identyfikatora protokołu `CRT_TERMINAL_MT5` i zmiennych `CRT_TERMINAL_*`. Starsze zmienne `SMARTFLOW_*` są nadal akceptowane jako aliasy zgodności.

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

## Ręczna egzekucja DEMO — 0.1.14

W prawym panelu wybierz kierunek i ustaw plan na wykresie. Planer nie otwiera
pozycji. W sekcji „Egzekucja · tylko DEMO” wybierz zlecenie oczekujące lub po
rynku, sprawdź je i osobno zatwierdź podsumowanie (ważność 20 sekund). Ceny
są dopasowane do kroku brokera i pokazane przed wysyłką. Wymagane są SL i pełny
TP. TP1–TP3, BE i zamykanie pozycji nie są wykonywane przez tę wersję.

Backend niezależnie sprawdza konto, aktualność ceny, symbol, lot, SL/TP, ryzyko
i margin. Limity: 2% na plan, 5% portfela, 5% dziennej straty, 60% wykorzystania
margin. Dzień liczony w UTC; ryzyko na SL nie gwarantuje ceny realizacji ani nie
obejmuje przyszłych opłat. Istniejąca pozycja lub oczekujące zlecenie na tym
samym symbolu blokuje kolejną ekspozycję.

Dziennik SQLite w `%LOCALAPPDATA%/CRTTerminal/execution/requests.sqlite3` zapisuje
zamiar przed `order_send`. Jeden identyfikator nie może spowodować ponownego
wysłania. Wynik nieznany blokuje kolejne zlecenia na koncie; odczyty uzgadniają go
z pozycjami, zleceniami i historią MT5. Restart i aktualizacja nie kasują blokady.
Nie usuwaj dziennika w celu ponowienia zlecenia. Brak dowodu wykonania nie jest
dowodem odrzucenia. W takim przypadku sprawdź historię MT5 i wynik u brokera.

Ta wersja jest kandydatem do ręcznej walidacji DEMO. Kompilacja i przegląd kodu
nie zastępują sprawdzenia wykonania, timeoutu, częściowego wypełnienia i restartu
w rzeczywistym terminalu DEMO. Podczas przygotowania wydania nie wysłano zleceń.
