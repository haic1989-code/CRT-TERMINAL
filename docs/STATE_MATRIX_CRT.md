# SmartFlow X — zapis postępu Matrix / CRT

Zapis: 2026-10-01. Gałąź: `work/dragon-terminal-ui-v1`.

Domyślny terminal to zielony Matrix z działającym wykresem MT5, agentką w tle oraz konsolą CRT po prawej. Ramki, przyciski, przełączniki i suwaki mają wykończenie CRT; animowane napisy i skanowanie można zatrzymać przyciskiem FX. Poziomy są wybierane z listy w konsoli na wykresie, z efektem pisania i podsumowaniem aktywnych grup. Nie otwierają okna. Paleta poleceń, oba przyciski w górnym pasku, dodatkowy przycisk w konsoli, skrót Ctrl+K oraz logika i historia komend zostały usunięte na polecenie użytkownika.

## Utrwalone źródła i assety

- `public/assets/agent-terminal-hq.webp`: oryginalna grafika odzyskana bez zmian z podglądu HTML; 1122×1402, SHA256 `defffd97db65c23f53ebf8c09082e201900d22e1dea72d0c4994eea58399b98e`.
- `design/references/smartflow-x-terminal-preview-v2.html`: oryginalny dostarczony podgląd wraz z osadzoną grafiką; SHA256 `8ec0bc92ca1148a07c13c0416956ad5b21750d98d1e2c91cc907dd6f3b1a6138`.
- `design/checkpoints/matrix-crt-levels-qhd.png`: bieżący wygląd przy 2560×1440, z jawnymi danymi testowymi.
- `src/matrix-terminal.css`, `src/matrix-crt.css`: zintegrowane style terminalu i konsoli.
- `MARKET_PROFILE_FIX.md`: odzyskana poprawka TPO, zaimplementowana i przetestowana w kodzie silnika.

## Uruchomienie

`START_SMARTFLOW_X.ps1` uruchamia lokalny terminal pod `http://127.0.0.1:5173/` oraz mostek MT5. Mostek działa w trybie odczytu. Integracja lokalnego modelu oraz Agent Advice zostały usunięte: interfejs, klient, endpoint, parser, schemat odpowiedzi, blokada zapytań i nakładka poziomów modelu.

## Weryfikacja

Po integracji: 89/89 testów logiki, 19/19 testów mostka, 12/12 testów interfejsu poza istniejącym starym testem zbiorczym. Ten test zbiorczy zawodził również na poprzedniej bazie.

Po ostatnim usunięciu palety i zmianie okna Poziomy: budowa PASS; cztery ukierunkowane testy interfejsu PASS (MTF/VEGA, Matrix, rysowanie/poziomy, okna modułów). Potwierdzono brak przycisków i palety w działającym terminalu oraz status MT5 LIVE. Silniki i mostek nie zmieniły się w ostatniej poprawce. Nie wykonano zleceń.

## Historia odzyskania

- `896a2ce`: połączenie Matrix z rzeczywistymi narzędziami MT5, oryginalny asset, poprawka TPO, start lokalny i naprawa limitu Qwen.
- `3108c25`: wykończenie konsoli CRT, ruchome napisy, nowe ramki i kontrolki.
- `2238647`: usunięcie całej palety poleceń i dopasowanie Poziomów do CRT.

Ten zapis i assety przechowywane są w repozytorium, aby kolejna rozmowa mogła kontynuować pracę bez odzyskiwania plików z historii czatu. Katalog test-results nie jest częścią tego zapisu.

## Ostatnie szlify — 50f5898

Pięć nagłówków modułów przewija się niezależnie i używa osobnych barw CRT. FX oraz prefers-reduced-motion zatrzymują te animacje. W bieżącym panelu Matrix usunięto cztery narożne wejścia do dodatkowych okien (FX, wskaźniki, rysowanie, planer). Parametry okresów aktywnych wskaźników są dostępne w rozwijanej sekcji wewnątrz kafla; zapis ustawień po odświeżeniu został sprawdzony. Zachowano POZIOMY, podstawowe rysowanie, MTF i sterowanie planem na wykresie. Współdzielone moduły używane przez starszy widok pozostają w repozytorium.

Nowy zrzut: `design/checkpoints/matrix-crt-final-qhd.png` (2560×1440, dane testowe). Budowa PASS; cztery testy Matrix / nagłówków i ustawień / planera / TP1–TP3 PASS. Potwierdzono w działającym terminalu pięć animowanych nagłówków, brak czterech przycisków i MT5 LIVE.


## Etap hologram / konsola wykresu — 2026-10-01

- Agentka jest przygaszoną projekcją fosforową, z pasem skanowania i siatką przestrzenną. Oryginalny WebP pozostaje niezmieniony.
- Konsola znajduje się w prawym górnym rogu wykresu. Lista obsługuje kilka grup, Gotowe, Escape i przywrócenie fokusu. Wybór jest zapamiętywany. Brak historii jest jawnie sygnalizowany.
- Potwierdzenia działań obejmują rysunki, wskaźniki i planner. Pisanie dotyczy działań, nie każdego ticka. FX i prefers-reduced-motion zatrzymują efekty.
- Fibo liczy zniesienie od drugiego punktu (0%) w stronę pierwszego (100%). Początek i koniec zaznaczamy zgodnie z ruchem impulsu. Starsze zapisane kotwice pozostają zachowane, ale ceny przypisane do procentów są teraz liczone w poprawionym kierunku.
- Podstawa porównania: https://www.mql5.com/en/tools/trading-calculators/fibonacci-calculator oraz https://www.tradingview.com/support/solutions/43000518158-fibonacci-retracement-drawing-tool/ .
- Budowa i TypeScript PASS; 92/92 testów logiki; 13/13 pozostałych testów mostka; 5/5 ukierunkowanych testów interfejsu. Sprawdzono QHD 2560×1440, 1440×900 oraz 390×844. Zrzuty tego etapu korzystają z jawnych danych testowych; nie są dowodem połączenia z rzeczywistym MT5.
- Zrzuty: design/checkpoints/matrix-hologram-console-qhd.png, matrix-hologram-console-1440.png, matrix-hologram-console-390.png.

Kontrola lokalnego runtime po integracji: mostek healthy/read-only, brak endpointu /v1/advice w OpenAPI; odczyt 100 rzeczywistych świec MT5; przeglądarka potwierdziła MT5 LIVE, dwa poziomy dzienne i brak błędów strony. Nie wysyłano zleceń.
