# Audyt CRT Terminal 0.1.6

Data: 2026-10-02. Baza: `main`, commit `79841e7`. Audyt kodu, obliczeń i kontrolowanych przypadków błędów. Kod aplikacji nie został zmieniony.

## Wniosek

Terminal ma działającą podstawę do odczytu danych i planowania. Integracja MT5 wymaga poprawek przed uznaniem danych, statusu połączenia i wyliczeń planera za niezawodne. Szczególnie istotne są: błędy odczytu zamieniane w pusty portfel, różna cena używana dla historii i świec bieżących, niebezpieczny dobór symbolu oraz ponowne używanie istniejącego mostu bez sprawdzenia jego wersji i właściciela.

P1 oznacza wysoki priorytet ze względu na wiarygodność danych. P2 oznacza kolejny etap napraw.

## Najważniejsze ustalenia

### 1. P1 — błąd MT5 przedstawiany jako pusty portfel

`mt5-bridge/bridge.py:480–515`: `positions_get() or ()` i `orders_get() or ()` zamieniają zarówno poprawny pusty wynik, jak i `None` oznaczające błąd w tę samą odpowiedź. Odpowiedź otrzymuje świeży `observed_at`. Frontend przyjmuje ją jako aktualny portfel, co może zaniżyć ekspozycję i osłabić kontrolę ryzyka. Podobny problem występuje przy historii transakcji w obliczaniu statystyk konta.

Potwierdzenie: kontrolowana symulacja `positions_get=None` i `orders_get=None` zwróciła `values: []` z aktualnym znacznikiem czasu.

Naprawa: rozróżnić pusty wynik od błędu, zwracać błąd dostępności, zachować ostatni prawidłowy stan jako nieaktualny i blokować pozytywną ocenę ryzyka do czasu odzyskania odczytu. Dokumentacja: [positions_get — None oznacza błąd](https://www.mql5.com/en/docs/python_metatrader5/mt5positionsget_py).

### 2. P1 — bieżące świece mogą różnić się od MT5

`src/MarketChart.tsx:1256–1290`: historia pochodzi z natywnych świec MT5, natomiast bieżąca świeca jest budowana z `tick.mid`. MT5 tworzy świece według Bid dla instrumentów OTC albo Last dla instrumentów giełdowych. Powstaje niespójność cen; dla Bid różnica może odpowiadać połowie spreadu.

Odczyt ostatniego ticka co 500 ms może też pominąć ekstremum między odczytami. `refreshRecentVolumes` przy linii 1018 pobiera natywne świece, ale aktualizuje wolumen i część historii pomocniczej, bez pełnego uzgodnienia OHLC widocznego wykresu, brakujących świec i już obliczonych punktów wskaźników.

Naprawa: okresowo uzgadniać ostatnie OHLC i wskaźniki z MT5, uzupełniać luki po powrocie połączenia i używać ceny zgodnej z trybem wykresu instrumentu. Dokumentacja: [sposób tworzenia świec w MT5](https://www.metatrader5.com/en/terminal/help/trading_advanced/price_data).

### 3. P1 — wyszukiwanie symbolu może wybrać inny instrument

`mt5-bridge/bridge.py:214–250`: alias XAUUSD szuka wszystkich nazw zawierających XAU lub GOLD i wybiera najlepszą nawet wtedy, gdy żaden wynik nie odpowiada żądanemu instrumentowi. Wynik `symbol_select` jest ignorowany. Podobne ryzyko występuje przy szerokim wyszukiwaniu BTC.

Potwierdzenie: symulacja z jedynym kandydatem `XAUEUR` zwróciła go dla żądania `XAUUSD`, także przy `symbol_select=False`.

Naprawa: jawne mapowanie nazw brokera, sprawdzenie zgodności instrumentu i powodzenia wyboru; przy niejednoznaczności zwrócić błąd zamiast zastępować instrument.

### 4. P1 — istniejący most nie ma sprawdzanej wersji ani właściciela

`src-tauri/src/lib.rs:25–53`: dowolny proces nasłuchujący na porcie 8765 powoduje pominięcie uruchomienia mostu z aktualnej instalacji. Nie ma negocjacji wersji protokołu ani potwierdzenia pochodzenia procesu. `src/bridgeShutdown.ts:7` pobiera token zastanego mostu i go zamyka; aplikacja nie zapisuje, czy sama go uruchomiła. Nie znalazłem blokady drugiej instancji aplikacji.

Skutek możliwy na podstawie kodu: nowa rewizja korzysta ze starego mostu; dwie instancje współdzielą usługę, a zamknięcie jednej wyłącza połączenie drugiej. To wiarygodny mechanizm powracających problemów między rewizjami, ale nie ustalona przyczyna wcześniejszych zdarzeń użytkownika. Scenariusz nie został sprawdzony na żywo.

Naprawa: sprawdzać tożsamość i wersję mostu, rejestrować właściciela procesu oraz przyjąć jednoznaczne zasady działania wielu instancji.

### 5. P1 — gotowość mostu nie oznacza połączenia z brokerem

`mt5-bridge/bridge.py:147`: obecność `terminal_info` i `account_info` wystarcza do zaakceptowania połączenia, bez sprawdzenia `terminal.connected`. Health przy linii 368 zwraca `ok: true` również dla terminala odłączonego od brokera. `src/bridgeStartup.ts:3` sprawdza tylko `ok` i `read_only`.

Potwierdzenie: w kontrolowanej symulacji terminal z `connected=False` został zaakceptowany bez ponownej inicjalizacji.

Naprawa: osobno pokazywać działanie usługi, kontakt z lokalnym MT5, połączenie brokerskie oraz świeżość danych. Historia dostępna offline nie powinna oznaczać gotowości danych na żywo. Dokumentacja: [terminal_info](https://www.mql5.com/en/docs/python_metatrader5/mt5terminalinfo_py).

### 6. P2 — odświeżanie może utknąć bez limitu czasu

`src/mt5Client.ts:103`: standardowe zapytania nie mają własnego timeoutu. Kilka cykli odświeżania wywołuje je bez sygnału anulowania; zawieszone żądanie może pozostawić flagę `pending` i zatrzymać kolejne odczyty. Most szereguje wywołania MT5 wspólną blokadą. Kosztowne odczyty konta i historii w częstych snapshotach dodatkowo zwiększają obciążenie.

Naprawa: ograniczyć czas żądań, anulować je przy zmianie instrumentu i zamknięciu, pokazywać utratę aktualności, dodać kontrolowany powrót połączenia oraz buforować rzadsze statystyki konta. Wydajność całego mostu na rzeczywistym koncie pozostaje niesprawdzona.

### 7. P2 — suma zysku TP nie uwzględnia faktycznego podziału lotów

`src/engines/index.ts:410` wylicza zysk według procentów, a `src/SmartFlowShell.tsx:630` rozdziela loty według kroku wolumenu brokera. Suma przy linii 747 może więc różnić się od sumy pozycji TP. Przydział lotów korzysta także z flag włączenia celów, bez sprawdzenia, czy każdy cel ma ustawioną cenę.

Potwierdzenie: dla 0,01 lota, dwóch celów 50/50 i kroku 0,01 przydział wyniósł `[0.01, 0]`; testowy zysk procentowy wyniósł 0,20, a zysk z rzeczywistego podziału 0,10.

Naprawa: cel bez ceny otrzymuje zero lotów; wszystkie podsumowania liczyć z tego samego rozdziału po zaokrągleniu. Dla zgodności z brokerem używać również jego kalkulatora zysku, szczególnie dla różnych klas instrumentów.

## Wskaźniki i narzędzia

| Element | Ocena |
|---|---|
| SMA / EMA | Podstawowe wzory poprawne; brak porównania wszystkich wyników z natywnymi buforami MT5. |
| Bollinger / RSI | Poprawna podstawowa matematyka i testy; RSI korzysta z wygładzania Wildera. |
| VWAP | Przybliżenie z HLC3 i wolumenu tickowego, reset o północy UTC. Wymaga czytelnej informacji o sposobie liczenia. |
| Market Profile | TPO z zakresów świec, jawnie opisane jako `bar_range_tpo`. To nie profil rzeczywistego wolumenu transakcji. „Dzień/tydzień” oznacza ostatnie 24 h / 7 dni, a nie granice sesji. |
| Paski kontekstu | Pokazują kategorię kierunku; liczba segmentów nie jest pomiarem ADX ani siły ruchu. |
| Sesje | Strefy czasowe i DST obsługiwane; samo sprawdzenie godzin nie uwzględnia weekendów i świąt. |
| Alerty | Działają na odczytywanych cenach w otwartej aplikacji; mogą pominąć przejście poziomu między odczytami. |
| Skan zakresu | Efekt demonstracyjny: komunikat wykrycia uruchamia timer. Nie jest detektorem rzeczywistego wybicia; warto oznaczyć go jako symulację. |
| Rysowanie / planner | Funkcjonalna podstawa i testy pomocnicze; wymagane poprawki spójności przydziałów TP. |

## Jakość architektury

Zalety: rozdzielenie części obliczeń do silników i domeny, TypeScript w trybie strict, testy matematyki, ograniczenie mostu do localhost, konkretne dozwolone originy, token zamykania i brak endpointu wysyłania zleceń. Terminal jest obecnie aplikacją do odczytu i planowania, a nie wykonania transakcji.

Dług techniczny: `MarketChart.tsx` ma około 2128 linii, `SmartFlowShell.tsx` 838, arkusz stylów 4085; występują `any`, rozbudowane listy propsów i pozostałości starszych wariantów UI. Odpowiedzi HTTP są rzutowane na typy bez walidacji struktury w czasie działania. Potrzebne są mniejsze moduły oraz jawne kontrakty danych obejmujące symbol, interwał, konto, wersję i świeżość.

## Wyniki sprawdzeń

| Sprawdzenie | Wynik |
|---|---|
| Testy jednostkowe aplikacji | PASS — 104 testy |
| Testy jednostkowe mostu | PASS — 16 testów; stuby API, bez rzeczywistego MT5 |
| Kontrola typów | PASS |
| Build frontend | PASS; ostrzeżenie o głównym pakiecie JS przekraczającym 500 kB |
| Pełny zestaw Playwright | Zaobserwowano 4 błędy; resztę przerwano ze względu na nieaktualne wspólne selektory |
| Dwa aktualne scenariusze startu/zamykania | Oba zgłosiły PASS; proces przerwano podczas oczekiwania na zakończenie sprzątania |
| npm audit | 2 wpisy moderate dotyczące jednego advisory w narzędziach testowych; bez high/critical w wyniku npm |
| Most i MT5 na żywo | NOT RUN — brak usługi nasłuchującej na porcie 8765 |
| Bezpieczeństwo zależności Python/Rust | Nie wykonano pełnego audytu podatności |

Stare testy UI oczekują m.in. angielskiego potwierdzenia i poprzednich elementów wyglądu. Zielone testy jednostkowe nie zastępują aktualnych testów pełnego przepływu. Advisory zależności: [GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9).

## Zalecana kolejność

1. Błędy portfela, dobór symbolu, poprawna informacja o gotowości MT5.
2. Wersjonowanie i własność mostu między instalacjami oraz instancjami.
3. Uzgadnianie świec i wskaźników z natywnymi danymi MT5, odbudowa luk i timeouty.
4. Spójny podział TP i kalkulacja zysku po zaokrągleniu wolumenu.
5. Aktualizacja testów UI i zależności testowych, potem uporządkowanie komponentów.
6. Odbiór na uruchomionym MT5: odłączenie/powrót brokera, restart mostu, zmiana konta/instrumentu, różne nazwy brokerskie, aktualizacja instalacji i dwie instancje.

Nie wykonano zleceń ani zmian konfiguracji konta. Ocena kodu nie jest potwierdzeniem poprawnego zachowania wszystkich scenariuszy na żywym terminalu.
