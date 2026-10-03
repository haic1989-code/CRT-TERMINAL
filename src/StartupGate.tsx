import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { readMt5BridgeReadiness } from './bridgeStartup'
import './startup-gate.css'

const SESSION_KEY = 'smartflow-x:startup-ready:v1'
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
const STATUS_LINES = [
  { label: 'SILNIK WYKRESU', value: 'GOTOWY' },
  { label: 'MODUŁY INTERFEJSU', value: 'GOTOWE' },
  { label: 'MOST MT5', value: 'POŁĄCZONY' },
]
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

function hasCompletedStartup() {
  try {
    return window.sessionStorage.getItem(SESSION_KEY) === 'complete'
  } catch {
    return false
  }
}

export function StartupGate({ children }: { children: ReactNode }) {
  const forcedBoot = new URLSearchParams(window.location.search).has('boot')
  const [visible, setVisible] = useState(() => forcedBoot || !hasCompletedStartup())
  const [phase, setPhase] = useState(0)
  const [closing, setClosing] = useState(false)
  const [bridgeReady, setBridgeReady] = useState(false)
  const [bridgeStartupMessage, setBridgeStartupMessage] = useState('')
  const [checking, setChecking] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const continueButton = useRef<HTMLButtonElement>(null)
  const closeTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(closeTimer.current), [])
  useEffect(() => {
    if (visible && !matchMedia('(prefers-reduced-motion: reduce)').matches) void loadWarp().catch(() => {})
  }, [visible])

  useEffect(() => {
    if (!visible) return
    // Milestone animation must never move the state backwards after a fast bridge health check.
    const milestones = [260, 560].map((delay, index) => window.setTimeout(() => setPhase(current => Math.max(current, index + 1)), delay))
    let dead = false
    let timer = 0
    const check = async () => {
      setChecking(true)
      const { ready, message } = await readMt5BridgeReadiness()
      if (dead) return
      const startupMessage = ready ? '' : await readBridgeStartupMessage()
      if (dead) return
      setChecking(false)
      setBridgeReady(ready)
      setBridgeStartupMessage([message, startupMessage].filter(Boolean).join(' · '))
      if (ready) setPhase(STATUS_LINES.length)
      else { setPhase(2); timer = window.setTimeout(check, 1200) }
    }
    void check()
    return () => { dead = true; milestones.forEach(window.clearTimeout); window.clearTimeout(timer) }
  }, [visible, attempt])

  useEffect(() => { if (!visible) window.dispatchEvent(new Event('smartflow-x:startup-ready')) }, [visible])

  const continueToTerminal = useCallback(() => {
    if (phase < STATUS_LINES.length || !bridgeReady || closing) return
    try {
      window.sessionStorage.setItem(SESSION_KEY, 'complete')
    } catch {
      // The gate still works when storage is disabled; it will reappear next load.
    }
    setClosing(true)
    if (forcedBoot) {
      const url = new URL(window.location.href)
      url.searchParams.delete('boot')
      window.history.replaceState({}, '', url)
    }
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    closeTimer.current = window.setTimeout(() => setVisible(false), reducedMotion ? 160 : WARP_DURATION_MS)
  }, [bridgeReady, closing, forcedBoot, phase])

  useEffect(() => {
    if (visible && phase >= STATUS_LINES.length) continueButton.current?.focus()
  }, [phase, visible])

  useEffect(() => {
    if (!visible) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || phase < STATUS_LINES.length) return
      event.preventDefault()
      continueToTerminal()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [continueToTerminal, phase, visible])

  return <>
    <div className="startup-app-content" inert={visible || undefined}>
      {children}
    </div>
    {visible && <div className={`sf-startup-overlay${closing ? ' is-closing' : ''}`} style={{ '--warp-duration': `${WARP_DURATION_MS}ms` } as CSSProperties} role="dialog" aria-modal="true" aria-labelledby="startup-title">
      {closing && <div className="sf-startup-warp" aria-hidden="true">
        {WARP_RAYS.map((style, index) => <span key={index} className="sf-startup-warp-ray" style={style}><i>{index % 2 ? '01' : '10'}</i></span>)}
        <WarpFallback><Suspense fallback={null}><MatrixWarp durationMs={WARP_DURATION_MS} /></Suspense></WarpFallback>
      </div>}
      <div className="sf-startup-rain" aria-hidden="true">
        {RAIN_COLUMNS.map((column, index) => <span key={index} style={{ left: column.left, animationDuration: column.duration, animationDelay: column.delay }}>{column.content}</span>)}
      </div>
      <div className="sf-startup-vignette" aria-hidden="true" />
      <section className="sf-startup-window">
        <header className="sf-startup-titlebar">
          <span aria-hidden="true" />
          <div><small>SESJA LOKALNA // SYSTEM RYNKOWY</small><strong id="startup-title">LUNA URUCHAMIA TERMINAL</strong></div>
          <span className="sf-startup-build">START</span>
        </header>
        <div className="sf-startup-content" aria-live="polite">
          <p className="sf-startup-command">User &gt; uruchom-terminal</p>
          <div className="sf-startup-status-list">
            {STATUS_LINES.map((line, index) => <p key={line.label} className={`sf-startup-status sf-startup-status--${index}`}><span>{line.label}</span><b>{index === 2 ? bridgeReady ? line.value : checking ? 'SPRAWDZANIE' : 'OCZEKIWANIE' : phase > index ? line.value : 'OCZEKIWANIE'}</b><i>{index === 2 ? bridgeReady ? 'GOTOWE' : checking ? 'ŁĄCZENIE' : 'BRAK' : phase > index ? 'GOTOWE' : '...'}</i></p>)}
          </div>
          {bridgeReady && phase >= STATUS_LINES.length && <button ref={continueButton} className="sf-startup-ready" type="button" onClick={continueToTerminal} disabled={closing}>
            <span>Luna › Jestem gotowa, admin.</span><b>Naciśnij Enter — zabiorę Cię do terminalu.</b><i aria-hidden="true">▌</i>
          </button>}
          {!bridgeReady && <><p className="sf-startup-wait">{checking ? 'Luna › Łączę się z Twoim MT5' : 'Luna › Nie potwierdziłam jeszcze połączenia z MT5'}<span aria-hidden="true">...</span></p>{bridgeStartupMessage && <p className="sf-startup-diagnostic" role="status">Luna › {bridgeStartupMessage}</p>}</>}
        </div>
        <footer className="sf-startup-footer"><span>SESJA LOKALNA</span><span>WYKRES / WSKAŹNIKI</span><span>STAN: {bridgeReady ? 'GOTOWY' : 'ŁĄCZENIE MT5'}</span></footer>
      </section>
    </div>}
  </>
}
