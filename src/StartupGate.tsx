import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { readMt5BridgeReadiness } from './bridgeStartup'
import './startup-gate.css'

import { loadBootModules } from './bootModules'
import { checkTerminalUpdate, installTerminalUpdate } from './terminalUpdates'
import type { Update } from '@tauri-apps/plugin-updater'
const WARP_DURATION_MS = 7000
const loadWarp = () => import('./MatrixWarp')
const MatrixWarp = lazy(loadWarp)
class WarpFallback extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? null : this.props.children }
}
const WARP_RAYS = Array.from({ length: 84 }, (_, index) => ({
  '--ray-angle': `${index * 137.508}deg`,
  '--ray-delay': `${-(index % 19) * 73}ms`,
  '--ray-distance': `${3 + (index * 7 % 13)}vmin`,
  '--ray-length': `${55 + (index * 11 % 46)}vmax`,
} as CSSProperties))
const RAIN_COLUMNS = Array.from({ length: 30 }, (_, index) => ({
  left: `${(index / 29) * 100}%`,
  duration: `${8 + ((index * 7) % 11)}s`,
  delay: `${-((index * 13) % 17)}s`,
  content: Array.from({ length: 32 }, (_, digit) => ((index * 17 + digit * 7 + digit * index) % 2).toString()).join('\n'),
}))

async function readBridgeStartupMessage(): Promise<string> {
  try {
    const { invoke, isTauri } = await import('@tauri-apps/api/core')
    if (!isTauri()) return ''
    const raw = await invoke<string | null>('read_bridge_startup_status')
    if (!raw) return ''
    const status = JSON.parse(raw) as { message?: unknown }
    return typeof status.message === 'string' ? status.message : ''
  } catch {
    return ''
  }
}

type BootLine = { text: string; warning?: boolean }
export function StartupGate({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(true)
  const [closing, setClosing] = useState(false)
  const [modulesReady, setModulesReady] = useState(false)
  const [bridgeReady, setBridgeReady] = useState(false)
  const [chartReady, setChartReady] = useState(false)
  const [dataChecksFinished, setDataChecksFinished] = useState(false)
  const [updatesChecked, setUpdatesChecked] = useState(false)
  const [update, setUpdate] = useState<Update | null>(null)
  const [installing, setInstalling] = useState(false)
  const [installFailed, setInstallFailed] = useState(false)
  const [progress, setProgress] = useState('')
  const [fatal, setFatal] = useState('')
  const [diagnostic, setDiagnostic] = useState('')
  const [lines, setLines] = useState<BootLine[]>([{ text: 'Luna › Witaj, admin. Przygotowuję Twój terminal.' }])
  const [cursor, setCursor] = useState({ row: 0, char: 0 })
  const closeTimer = useRef<number | undefined>(undefined)
  const activeUpdate = useRef<Update | null>(null)
  const log = useRef<HTMLDivElement>(null)
  const report = useCallback((text: string, warning = false) => setLines(current => [...current, { text: `Luna › ${text}`, warning }]), [])
  useEffect(() => {
    let dead = false
    const controller = new AbortController()
    let timer = 0
    const chartLoaded = () => { if (!dead) setChartReady(true) }
    window.addEventListener('crt:chart-ready', chartLoaded)
    void loadWarp().catch(() => {})
    void loadBootModules(text => { if (!dead) report(text) }).then(() => {
      if (!dead) setModulesReady(true)
    }).catch(error => { if (!dead) { setFatal(String(error)); report('Nie wczytałam modułu terminalu. Uruchom mnie ponownie.', true) } })
    report('Sprawdzam opublikowane aktualizacje…')
    void checkTerminalUpdate().then(result => {
      if (dead) { void result.update?.close(); return }
      activeUpdate.current = result.update
      setUpdate(result.update)
      setUpdatesChecked(true)
      report(result.message, result.warning)
    })
    report('Sprawdzam własny most MT5 i połączenie z brokerem…')
    const connect = async () => {
      const readiness = await readMt5BridgeReadiness(AbortSignal.any([controller.signal, AbortSignal.timeout(2500)]))
      if (dead) return
      setBridgeReady(readiness.ready)
      if (readiness.ready) {
        setDiagnostic('')
        report('Potwierdziłam zgodny most MT5 i połączenie z brokerem. Świeżość cen sprawdzę osobno na wykresie.')
        const { fetchMt5Positions, fetchMt5Orders, fetchMt5ContextBars, fetchMt5Bars } = await import('./mt5Client')
        const checks = [
          ['otwarte pozycje', fetchMt5Positions(AbortSignal.timeout(6000))],
          ['zlecenia oczekujące', fetchMt5Orders(AbortSignal.timeout(6000))],
          ['kontekst rynkowy', fetchMt5ContextBars('XAUUSD', AbortSignal.timeout(6000))],
          ['historię poziomów dziennych', fetchMt5Bars('D1', 40, AbortSignal.timeout(6000))],
          ['historię poziomów tygodniowych', fetchMt5Bars('W1', 10, AbortSignal.timeout(6000))],
        ] as const
        const snapshots = await Promise.allSettled(checks.map(([, work]) => work))
        if (!dead) {
          snapshots.forEach((result, index) => report(result.status === 'fulfilled' ? `Wczytałam ${checks[index][0]} z MT5.` : `Nie wczytałam danych: ${checks[index][0]}. Ten moduł poczeka na poprawne dane.`, result.status === 'rejected'))
          setDataChecksFinished(true)
        }
      } else {
        const detail = await readBridgeStartupMessage()
        if (dead) return
        setDiagnostic([readiness.message, detail].filter(Boolean).join(' · '))
        timer = window.setTimeout(() => void connect(), 1500)
      }
    }
    void connect().catch(error => { if (!dead) setFatal(String(error)) })
    return () => {
      dead = true; controller.abort(); window.clearTimeout(timer); window.clearTimeout(closeTimer.current)
      window.removeEventListener('crt:chart-ready', chartLoaded)
      void activeUpdate.current?.close()
    }
  }, [report])
  useEffect(() => { if (chartReady) report('Wczytałam historię MT5 i przygotowałam świece na wykresie.') }, [chartReady, report])
  useEffect(() => {
    if (cursor.row >= lines.length) return
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setCursor({ row: lines.length, char: 0 }); return }
    const timer = window.setTimeout(() => setCursor(current => current.char >= lines[current.row].text.length
      ? { row: current.row + 1, char: 0 } : { ...current, char: current.char + 3 }), 16)
    return () => window.clearTimeout(timer)
  }, [lines, cursor])
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }) }, [cursor])
  const ready = modulesReady && bridgeReady && chartReady && dataChecksFinished && updatesChecked && !update && !fatal && !installFailed && !installing
  const continueToTerminal = useCallback(() => {
    if (!ready || closing || cursor.row < lines.length) return
    setClosing(true)
    closeTimer.current = window.setTimeout(() => {
      setVisible(false)
      window.dispatchEvent(new Event('smartflow-x:startup-ready'))
    }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 160 : WARP_DURATION_MS)
  }, [ready, closing, cursor.row, lines.length])
  useEffect(() => {
    if (!visible) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && !(event.target instanceof HTMLElement && event.target.closest('button'))) {
        event.preventDefault(); continueToTerminal()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible, continueToTerminal])
  const install = async () => {
    if (!update || installing) return
    setInstalling(true)
    try { await installTerminalUpdate(update, setProgress) }
    catch { setInstallFailed(true); setProgress('Luna › Nie ukończyłam aktualizacji. Uruchom ponownie obecną wersję i sprawdź połączenie.'); setInstalling(false) }
  }
  return <>
    <div className="startup-app-content" inert={visible || undefined}>{modulesReady && children}</div>
    {visible && <div className={`sf-startup-overlay sf-startup-boot${closing ? ' is-closing' : ''}`} style={{ '--warp-duration': `${WARP_DURATION_MS}ms` } as CSSProperties} role="dialog" aria-modal="true" aria-labelledby="startup-title">
      {closing && <div className="sf-startup-warp" aria-hidden="true">
        {WARP_RAYS.map((style, index) => <span key={index} className="sf-startup-warp-ray" style={style}><i>{index % 2 ? '01' : '10'}</i></span>)}
        <WarpFallback><Suspense fallback={null}><MatrixWarp durationMs={WARP_DURATION_MS} /></Suspense></WarpFallback>
      </div>}
      <div className="sf-startup-rain" aria-hidden="true">{RAIN_COLUMNS.map((column, index) => <span key={index} style={{ left: column.left, animationDuration: column.duration, animationDelay: column.delay }}>{column.content}</span>)}</div>
      <section className="crt-boot-console">
        <header><small>CRT // SESJA LOKALNA</small><h1 id="startup-title">LUNA URUCHAMIA TERMINAL_</h1></header>
        <div ref={log} className="crt-boot-log" role="log" aria-live="polite">
          {lines.map((line, index) => index <= cursor.row && <p key={index} className={line.warning ? 'is-warning' : ''}>
            <span className="crt-boot-accessible">{line.text}</span><span aria-hidden="true">{index < cursor.row ? line.text : line.text.slice(0, cursor.char)}{index === cursor.row && <i className="crt-boot-cursor">▌</i>}</span>
          </p>)}
        </div>
        {!bridgeReady && !fatal && <p className="crt-boot-diagnostic">Luna › Czekam na MT5… {diagnostic}</p>}
        {modulesReady && bridgeReady && !chartReady && <p className="crt-boot-diagnostic">Luna › Czekam na historię świec z MT5…</p>}
        {update && !installFailed && <div className="crt-boot-actions"><button disabled={installing} onClick={() => void install()}>Zainstaluj wersję {update.version}</button><button disabled={installing} onClick={() => { void update.close(); activeUpdate.current = null; setUpdate(null); report('Zostaję przy obecnej wersji, zgodnie z Twoim wyborem.') }}>Uruchom obecną wersję</button></div>}
        {progress && <p role="status">{progress.startsWith('Luna') ? progress : `Luna › ${progress}`}</p>}
        {(fatal || installFailed) && <div className="crt-boot-actions"><button onClick={() => { void import('@tauri-apps/plugin-process').then(module => module.relaunch()).catch(() => window.location.reload()) }}>Uruchom ponownie</button></div>}
        {ready && <button className="crt-boot-enter" disabled={closing || cursor.row < lines.length} onClick={continueToTerminal}>Luna › Jestem gotowa. Naciśnij Enter — zabiorę Cię do terminalu.</button>}
      </section>
    </div>}
  </>
}
