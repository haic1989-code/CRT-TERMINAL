# Gotowość egzekucji — ocena przed wdrożeniem

Data: 2026-10-03. Baza: 0.1.13, commit 950fdd8. Odczyt kodu.

## Werdykt: brak gotowości do wysyłki zleceń

Istnieje planer, odczyt portfela, kalkulacje MT5 i frontendowy Risk Guard.
Most identyfikuje proces, terminal i konto. To dobra baza do integracji,
ale nie stanowi jeszcze kanału egzekucji.

Brakuje: serwerowej polityki DEMO, autoryzacji operacji zapisu, order_check,
order_send, trwałej idempotencji i uzgodnienia niejednoznacznego wyniku.
Nie ma obsługi częściowego wykonania, wyboru filling mode ani brokera jako
źródła prawdy o wyniku. Sam frontendowy Risk Guard nie chroni endpointu.

## Zakres pierwszego wdrożenia zatwierdzony przez użytkownika

- Wyłącznie DEMO. Brak automatycznego handlu.
- Ręczne pojedyncze zlecenie market lub pending (limit/stop).
- Obowiązkowe SL i pełny TP. TP1–TP3 i BE nie są automatyzowane.
- Przegląd konkretnego żądania w panelu przed osobnym kliknięciem wysyłki.
- Tylko aplikacja desktop, dokładny Origin i token własnej instancji.
- Trwały dziennik SQLite. Ten sam clientRequestId nie wysyła drugi raz.
- Zapis INTENT/SUBMITTING przed wysyłką. Niepewny wynik blokuje dalsze
  wysyłki na tym koncie, także z innej instancji aplikacji.
- Uzgodnienie pozycji, zleceń i historii; brak automatycznych ponowień.
- Natywne wyliczenia ryzyka/margin i świeże dane w moście. Limity jak
  w terminalu: 2% transakcja, 5% portfel i strata dzienna, 60% margin.
- Blokada istniejącej ekspozycji na tym samym symbolu w pierwszej wersji,
  aby uniknąć przypadkowego odwrócenia/redukcji pozycji nettingowej.

Kompilacja nie jest dowodem poprawnej egzekucji. Nie wysyłano zleceń DEMO
ani LIVE podczas prac. Akceptacja brokera i zachowanie po zerwaniu
połączenia wymagają odbioru na koncie DEMO.

Podstawa integracji: [order_check](https://www.mql5.com/en/docs/python_metatrader5/mt5ordercheck_py),
[order_send](https://www.mql5.com/en/docs/python_metatrader5/mt5ordersend_py),
[właściwości symbolu i filling](https://www.mql5.com/en/docs/constants/environment_state/marketinfoconstants).
