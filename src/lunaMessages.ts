/** Presentation only: keep risk-engine identifiers and calculations unchanged. */
export function lunaMessage(text: string): string {
  if (text === 'PLAN ANULOWANY') return 'Anulowałam plan. Możesz przygotować następny.'
  if (text.includes('Podgląd skanu zakończony')) return 'Skończyłam podgląd skanu. To animacja, nie sygnał wybicia.'
  if (text.startsWith('POZYCJA ')) return `Przygotowuję plan ${text.includes('DŁUGA') ? 'kupna' : 'sprzedaży'}. Wskaż wejście na wykresie; potem możesz przeciągnąć SL i pełny TP.`
  if (text.endsWith(' WYŁĄCZONO')) return `Wyłączyłam ${text.slice(0, -10)}.`
  if (text.endsWith(' WŁĄCZONO')) return `Włączyłam ${text.slice(0, -9)}.`
  if (text.includes('ZAZNACZ PUNKTY')) return 'Wskaż punkty na wykresie. Escape anuluje rysowanie.'
  if (text.endsWith(' ZAPISANE')) return 'Zapisałam rysunek na wykresie.'
  return text
}

const riskMessages: Record<string, string> = {
  'No active trade plan.': 'Najpierw przygotuj plan na wykresie.',
  'Broker account is not permitted to trade.': 'Konto nie ma teraz uprawnień do handlu.',
  'Market quote is stale or has an invalid timestamp.': 'Czekam na świeże notowanie z poprawnym czasem.',
  'Account snapshot is stale.': 'Czekam na aktualne dane konta.',
  'Positions or orders snapshot is stale.': 'Czekam na aktualną listę pozycji i zleceń.',
  'New trades are disabled by the Risk Guard hard policy.': 'Polityka ryzyka blokuje nowe transakcje.',
  'Proposed risk exceeds the per-trade hard limit.': 'Ten plan przekracza limit ryzyka na transakcję.',
  'Plan volume is unavailable or below the broker minimum.': 'Wolumen nie jest ustalony albo jest poniżej minimum brokera.',
  'Proposed volume exceeds the max-lot hard limit.': 'Wolumen przekracza ustalone maksimum.',
  'Current spread is unavailable for the configured spread guard.': 'Nie mam spreadu potrzebnego do kontroli planu.',
  'Current spread exceeds the configured hard limit.': 'Spread przekracza ustalony limit.',
  'Slippage estimate is unavailable for the configured slippage guard.': 'Nie mam oszacowania poślizgu wymaganego przez ustawiony limit.',
  'Estimated slippage exceeds the configured hard limit.': 'Oszacowany poślizg przekracza ustalony limit.',
  'Proposed margin requirement is unavailable.': 'Nie potwierdziłam wymaganego margin dla planu.',
  'Proposed margin exceeds free margin.': 'Plan potrzebuje więcej margin, niż masz dostępne.',
  'Plan has no valid stop-loss distance.': 'Potrzebuję SL w poprawnej odległości od wejścia.',
  'Long plan stop must be below entry.': 'Dla kupna ustaw SL poniżej wejścia.',
  'Short plan stop must be above entry.': 'Dla sprzedaży ustaw SL powyżej wejścia.',
  'At least one open or pending position has no reliable stop-risk estimate.': 'Nie znam ryzyka co najmniej jednej pozycji lub zlecenia. Sprawdź jego SL.',
  'Combined portfolio risk exceeds the hard limit.': 'Łączne ryzyko portfela przekracza limit.',
  'Daily loss limit reached.': 'Dzienny limit straty został osiągnięty. Wstrzymuję nowe zlecenia.',
  'Margin level is unavailable or invalid while margin is in use.': 'Nie mam poprawnego poziomu zabezpieczenia istniejących pozycji.',
  'Projected margin usage exceeds the hard limit.': 'Po wysyłce wykorzystanie margin przekroczyłoby limit.',
  'Proposed risk is approaching the per-trade hard limit.': 'Ryzyko tego planu zbliża się do limitu.',
  'Proposed volume is approaching the max-lot hard limit.': 'Wolumen zbliża się do maksimum.',
  'Current spread is approaching the configured hard limit.': 'Spread zbliża się do limitu.',
  'Estimated slippage is approaching the configured slippage guard.': 'Oszacowany poślizg zbliża się do limitu.',
  'Estimated slippage is approaching the configured hard limit.': 'Oszacowany poślizg zbliża się do limitu.',
  'Combined portfolio risk is approaching the hard limit.': 'Ryzyko portfela zbliża się do limitu.',
  'Daily loss is approaching the hard limit.': 'Dzienna strata zbliża się do limitu.',
  'Projected margin usage is approaching the hard limit.': 'Wykorzystanie margin zbliża się do limitu.',
}
export function lunaRisk(text: string): string {
  return riskMessages[text] || `Potrzebuję wyjaśnienia tego warunku, zanim uznam plan za gotowy: ${text}`
}
