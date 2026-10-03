# CRT Terminal — most lokalny MT5

Adapter danych MT5 oraz ręczna egzekucja DEMO dla własnej sesji desktopowej CRT Terminal.

Od 0.1.7 aplikacja desktopowa uruchamia własny most na porcie nadanym przez
system. Od 0.1.22 sprawdza protokół 5, instancję i właściciela sesji. Ręczne uruchomienie
opisane poniżej nadal używa portu 8765 i służy podglądowi przeglądarkowemu.
Zmiana konta lub instalacji MT5 wymaga restartu aplikacji. Diagnostyka startu
i log mostu są zapisywane osobno dla każdej sesji w lokalnym katalogu danych
CRT Terminal. Błędy odczytu portfela nie są traktowane jak brak pozycji.

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
- godziny sesji kwotowań i handlu dla symbolu z natywnego API MQL5,
- do 100000 barów na żądanie, ograniczone historią dostępną w terminalu MT5.

Ręcznie uruchomiony bridge ma wyłączoną egzekucję. Własna sesja desktopowa
udostępnia `/v1/execution/status`, `/prepare`, `/execute` i `/requests/{id}`
(każda ścieżka z prefiksem `/v1/execution`). Wymagane są dokładny origin
`http://tauri.localhost`, prywatny token sesji i konto DEMO. Token pochodzi z
pliku endpointu odczytywanego przez natywną aplikację; nie jest zwracany przez
HTTP. `order_check` oraz `order_send` dostają ten sam, wcześniej pokazany
użytkownikowi słownik zlecenia. Nie ma automatycznych ponowień ani próbowania
innych polityk filling. Zasady i ograniczenia opisano w głównym README.

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

## Godziny sesji symbolu

Godziny sesji odczytuje dołączony, tylko odczytowy Expert Advisor
`CRTMarketSessions.mq5`. Korzysta z `SymbolInfoSessionQuote` i
`SymbolInfoSessionTrade`, zapisuje aktualny czas serwera oraz tygodniowe sesje
do pliku w katalogu Common\Files. Nie wysyła zleceń ani nie zmienia ustawień
handlu.

Jednorazowe uruchomienie:

1. W MetaTrader 5 wybierz **Plik → Otwórz folder danych**.
2. Skopiuj `CRTMarketSessions.mq5` do `MQL5\Experts`.
3. Otwórz ten plik w MetaEditor i skompiluj go klawiszem F7.
4. W MT5 odśwież Nawigator i przeciągnij **CRTMarketSessions** na wykres.
   Nie musisz włączać Algo Trading dla tego pomocnika; tylko odczytuje grafik
   i nigdy nie składa transakcji.
5. Pozostaw wykres z uruchomionym EA. Most odczytuje aktualizowany plik sesji
   z `Common\Files` i dopasowuje go do symbolu oraz konta.

Bez świeżego, kompletnego pliku sesji terminal pokaże brak grafiku i nie będzie
zgadywał statusu rynku na podstawie starego ticka. Po wykryciu zamkniętej sesji
blokuje przygotowanie nowej egzekucji.

## Rodzaje zleceń

Terminal udostępnia trzy jawne wybory: **Po rynku**, **Buy Limit** i
**Sell Limit**. Buy Limit jest przyjmowany tylko dla planu DŁUGA i ceny poniżej
Ask; Sell Limit tylko dla KRÓTKA i ceny powyżej Bid. Most nie zamienia już
automatycznie nieprawidłowej ceny Limit na zlecenie Stop. Zachowano kontrolę
DEMO, `order_check`, dziennik idempotencji i osobne potwierdzenie wysyłki.

## Broker używa innej nazwy złota

Bridge automatycznie szuka wariantów typu `XAUUSD.a`, `XAUUSDm`, `GOLD`.

Automatyczny wybór wymaga zgodnych metadanych walut i jednoznacznego wyniku.
Przy kilku wariantach lub braku odpowiednika most zwraca błąd. Wybierz dokładną
nazwę w interfejsie albo ustaw ją przed uruchomieniem:

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

`$env:CRT_TERMINAL_ALLOWED_ORIGINS = 'https://dokladny-adres-preview.vercel.app'`

Konfiguracja mostu używa prefiksu `CRT_TERMINAL_*`. Dla zgodności wstecznej nadal przyjmowane są starsze aliasy `SMARTFLOW_MT5_PORT`, `SMARTFLOW_BRIDGE_OWNER`, `SMARTFLOW_BRIDGE_ENDPOINT_FILE` i `SMARTFLOW_ALLOWED_ORIGINS`.

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
