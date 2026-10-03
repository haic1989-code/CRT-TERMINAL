export const loadTerminal = () => import('./SmartFlowShell')
async function resourceDeadline(work: Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try { await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Resource timeout')), 8000) })]) }
  finally { clearTimeout(timer) }
}
export async function loadBootModules(report: (text: string) => void): Promise<void> {
  const steps: Array<[string, () => Promise<unknown>]> = [
    ['silnik wykresu', () => import('lightweight-charts')],
    ['wskaźniki i ich ustawienia', async () => { await import('./indicators/catalog'); await import('./indicators/preferences') }],
    ['planer, ryzyko, portfel i sesje', () => import('./engines')],
    ['poziomy odniesienia i podział celów', async () => { await import('./domain/referenceLevels'); await import('./domain/targetAllocations') }],
    ['narzędzia rysunkowe i wykres MT5', () => import('./MarketChart')],
    ['konsola Luny i prawy panel CRT', async () => { await import('./CrtChartConsole'); await import('./MatrixCommandDeck') }],
    ['ręczna egzekucja DEMO i komunikacja MT5', async () => { await import('./DemoExecutionPanel'); await import('./mt5Client') }],
    ['interfejs terminalu i zarządzanie modułami', loadTerminal],
  ]
  for (const [label, load] of steps) {
    await load()
    report(`Wczytałam ${label}.`)
  }
  try { await resourceDeadline(document.fonts.ready); report('Przygotowałam czcionki i styl CRT.') }
  catch { report('Czcionki nie odpowiedziały na czas. Użyję dostępnej czcionki terminalowej.') }
  const agent = new Image()
  agent.src = `${import.meta.env.BASE_URL}assets/chart-agent-background-v3.png`
  try { await resourceDeadline(agent.decode()); report('Wczytałam statyczne tło agentki.') }
  catch { report('Nie wczytałam tła agentki. Pozostałe moduły mogą pracować.') }
}
