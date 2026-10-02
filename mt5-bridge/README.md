# CRT Terminal — most lokalny MT5

Adapter tylko do odczytu między lokalnym MetaTrader 5 a CRT Terminal.

## Co czyta

- aktualne konto MT5,
- broker/server,
- balance/equity/profit/margin,
- XAUUSD, BTCUSD, DJ30 lub wariant nazwy symbolu używany przez brokera,
- metadata symbolu,
- bid/ask/last,
- OHLC dla M1 / M5 / M15 / M30 / H1 / H4 / D1 / W1,
- pozycje, pending orders, metadane instrumentu i świeżość ticka,
- dzienny P/L, siłę walut i bary kontekstu MTF,
- brokerowe wyliczenie margin/profit (bez złożenia zlecenia),
- do 100000 barów na żądanie, ograniczone historią dostępną w terminalu MT5.

Bridge **nie posiada endpointu składania zleceń**.

## Odczyty v1

- `GET /v1/positions` — pozycje wraz z P/L, swapem i prowizją z historii dealów,
- `GET /v1/orders` — oczekujące zlecenia,
- `GET /v1/search-symbols?q=...` — wyszukiwanie nazw brokera,
- `GET /v1/context-bars?symbol=...` — bary M5/M15/M30/H1/H4/D1 dla MTF context,
- `GET /v1/fx-bars?timeframe=H1` — pary do Currency Strength,
- `GET /v1/calculate?action=margin|profit&...` — obliczenia MT5, bez efektów ubocznych,
- `/v1/bars` i `/v1/snapshot` przyjmują instrument `symbol`; odpowiedź tick zawiera `observed_at`, wiek i stan freshness.

## Uruchomienie — Windows

1. Uruchom MetaTrader 5 i zaloguj się na konto brokerskie.
2. Upewnij się, że historia XAUUSD jest dostępna w terminalu.
3. Zainstaluj CPython 3.13 x64. CRT Terminal dołącza przypięte pakiety mostu jako lokalny zestaw wheelhouse; instalacja nie pobiera ich ponownie przy kolejnych uruchomieniach.
4. Uruchom PowerShell w tym katalogu.
5. Wykonaj:

   `powershell -ExecutionPolicy Bypass -File .\start.ps1`

5. Sprawdź w przeglądarce:

   `http://127.0.0.1:8765/v1/health`

Powinien pojawić się JSON z `"ok": true`.

## Broker używa innej nazwy złota

Bridge automatycznie szuka wariantów typu `XAUUSD.a`, `XAUUSDm`, `GOLD`.

Jeśli wybierze źle:

`$env:MT5_SYMBOL="XAUUSD.a"`

i ponownie uruchom `start.ps1`.

## Niestandardowa instalacja MT5

`$env:MT5_TERMINAL_PATH="C:\Program Files\Broker MT5\terminal64.exe"`

## Historia

MetaTrader 5 zwraca tylko historię dostępną lokalnie w terminalu. W MT5 ustaw odpowiednio:

Tools -> Options -> Charts -> Max bars in chart

i pozwól terminalowi pobrać historię symbolu.

## Prywatność i originy przeglądarki

Bridge nasłuchuje wyłącznie na `127.0.0.1`. Dane konta są pobierane bezpośrednio
przez przeglądarkę z lokalnego bridge'a i nie przechodzą przez backend Render ani Vercel.

CORS dopuszcza dokładne originy lokalnego Vite i Tauri. Inne domeny są odrzucane,
dopóki nie dodasz ich jawnie. Dla pojedynczego preview ustaw przed uruchomieniem
bridge'a:

`$env:SMARTFLOW_ALLOWED_ORIGINS = 'https://dokladny-adres-preview.vercel.app'`

Origin musi być pełnym adresem `https://...` bez ścieżki i bez wildcardu.
Nie ustawiaj ogólnych wpisów typu `*.vercel.app` ani `*.onrender.com`.

## EXIT — zamknięcie terminalu i mostu

Przycisk `EXIT` w prawym górnym rogu witryny usuwa aktywny terminal z ekranu,
kończy jego odświeżanie i wyświetla okno `POWERSHELL SHUTDOWN`. Po potwierdzonym
zatrzymaniu mostu pojawia się `BYE ADMIN !`; wtedy można zamknąć kartę.
Samo zamknięcie karty krzyżykiem nie wysyła tej sekwencji.

`GET /v1/runtime` i `POST /v1/shutdown` obsługują wyłącznie cykl życia lokalnego
mostu. Wymagają dokładnego dozwolonego Origin, a shutdown dodatkowo tokenu
losowanego dla bieżącego procesu. Nie są endpointami handlowymi.
Zamykanie blokuje `_ensure_connected` przed kolejnym `mt5.initialize`, kończy
serwer i wywołuje `mt5.shutdown`. Nie zamyka aplikacji MT5 ani pozycji na koncie.
Okno uruchamiające bridge kończy się po poprawnym wyłączeniu procesu.

Jeśli most nie potwierdzi zamknięcia, ekran pokazuje błąd i pozwala ponowić
operację. Nie wyświetla wtedy pożegnania oznaczającego sukces.
