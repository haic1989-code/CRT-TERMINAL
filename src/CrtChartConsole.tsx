import { useEffect, useRef, useState } from 'react'

function TypedLine({text, sequence = 0, paused}: {text:string; sequence?:number; paused:boolean}) {
  const [visible, setVisible] = useState('')
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    let timer: ReturnType<typeof setInterval> | undefined
    const start = () => {
      clearInterval(timer)
      if (paused || media.matches) { setVisible(text); return }
      let index = 0
      setVisible('')
      timer = setInterval(() => {
        index += 2
        setVisible(text.slice(0, index))
        if (index >= text.length) clearInterval(timer)
      }, 24)
    }
    start()
    media.addEventListener('change', start)
    return () => {clearInterval(timer); media.removeEventListener('change', start)}
  }, [text, sequence, paused])
  return <p className="crt-console-line"><span className="crt-console-readable">{text}</span><span aria-hidden="true">Luna › {visible}<i className="crt-console-cursor">▌</i></span></p>
}

type Props = {
  notice:{text:string; id:number} | null
  motionPaused:boolean
  periodPrompt?: {indicator:'SMA 20'|'EMA 50'; token:number} | null
  onPeriodSubmit?: (indicator:'SMA 20'|'EMA 50', period:number) => void
  onPeriodCancel?: () => void
  instrumentPrompt?: boolean
  instrumentSymbol?: string
  symbolQuery?: string
  symbolOptions?: Array<{symbol:string;description:string;visible:boolean}>
  symbolSearchLoading?: boolean
  onSymbolQuery?: (query:string) => void
  onInstrumentSelect?: (symbol:string) => void
  onInstrumentCancel?: () => void
}

/** CRT chart messages and short symbol/indicator prompts. */
export function CrtChartConsole({notice, motionPaused, periodPrompt = null, onPeriodSubmit, onPeriodCancel, instrumentPrompt = false, instrumentSymbol = '', symbolQuery = '', symbolOptions = [], symbolSearchLoading = false, onSymbolQuery, onInstrumentSelect, onInstrumentCancel}:Props) {
  const [question,setQuestion] = useState('')
  const [value,setValue] = useState('')
  const [error,setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const promptText = 'Luna › Jaki okres średniej mam ustawić, admin? :)'
  useEffect(() => {
    if (!periodPrompt) { setQuestion(''); setValue(''); setError(''); return }
    setQuestion(''); setValue(''); setError('')
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (motionPaused || media.matches) { setQuestion(promptText); return }
    let index = 0
    const timer = window.setInterval(() => {
      index += 2
      setQuestion(promptText.slice(0,index))
      if (index >= promptText.length) window.clearInterval(timer)
    },32)
    return () => window.clearInterval(timer)
  },[periodPrompt?.token,motionPaused])
  useEffect(() => { if (periodPrompt && question === promptText) input.current?.focus({preventScroll:true}) },[periodPrompt,question])
  const submit = (event:React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!periodPrompt || question !== promptText || !onPeriodSubmit) return
    const period = Number(value.trim())
    if (!/^[0-9]{1,3}$/.test(value.trim()) || !Number.isInteger(period) || period < 2 || period > 200) {
      setError('Podaj mi liczbę całkowitą od 2 do 200.')
      input.current?.focus({preventScroll:true})
      return
    }
    onPeriodSubmit(periodPrompt.indicator,period)
  }
  return <aside className="crt-chart-console" aria-label="Konsola wykresu CRT">
    {notice && !instrumentPrompt && <div role="status" aria-live="polite" aria-atomic="true"><TypedLine text={notice.text} sequence={notice.id} paused={motionPaused} /></div>}
    {instrumentPrompt && <section className="crt-instrument-prompt" role="dialog" aria-label="Wybór symbolu">
      <p className="crt-instrument-message">Luna › Jaki instrument mam wyświetlić?</p>
      <label className="crt-instrument-search"><span>SYMBOL BROKERA</span><input autoFocus type="search" value={symbolQuery} placeholder="Szukaj, np. BTCUSD…" onChange={event=>onSymbolQuery?.(event.target.value)} /></label>
      <div className="crt-instrument-quick" aria-label="Szybki wybór instrumentu">{['XAUUSD','BTCUSD','DJ30'].map(item=><button type="button" key={item} aria-pressed={instrumentSymbol===item} onClick={()=>onInstrumentSelect?.(item)}>{item}</button>)}</div>
      <div className="crt-instrument-results" aria-label="Symbole dostępne u brokera">
        {symbolSearchLoading && <small className="crt-instrument-hint">Luna › Pobieram listę symboli z MT5…</small>}
        {!symbolSearchLoading && symbolOptions.slice(0,8).map(item=><button type="button" key={item.symbol} className={instrumentSymbol===item.symbol?'active':''} onClick={()=>onInstrumentSelect?.(item.symbol)}><b>{item.symbol}</b><span>{item.description || (item.visible?'WIDOCZNY':'DOSTĘPNY')}</span></button>)}
        {!symbolSearchLoading && symbolQuery.trim() && symbolOptions.length===0 && <small className="crt-instrument-hint">Luna › Nie znalazłam takiego symbolu u brokera.</small>}
        {!symbolSearchLoading && !symbolQuery.trim() && symbolOptions.length===0 && <small className="crt-instrument-hint">Luna › Wybierz szybki symbol albo wpisz nazwę brokera.</small>}
      </div>
      <button type="button" className="crt-instrument-cancel" onClick={onInstrumentCancel}>ANULUJ</button>
    </section>}
    {periodPrompt && <div className="crt-agent-period" role="status" aria-live="polite">
      <p className="crt-agent-question"><span className="crt-console-readable">{promptText}</span><span aria-hidden="true">{question}<i className="crt-console-cursor">▌</i></span></p>
      {question === promptText && <form className="crt-agent-period-form" onSubmit={submit}>
        <label className="crt-agent-period-line" htmlFor="crt-agent-period-value">Proszę podaj wartość</label>
        <input ref={input} id="crt-agent-period-value" aria-label="Okres średniej" autoComplete="off" inputMode="numeric" placeholder="_" maxLength={3} value={value} style={{width:`${Math.max(1,value.length+1)}ch`}} onChange={event=>{setValue(event.target.value.replace(/[^0-9]/g,'').slice(0,3));setError('')}} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();onPeriodCancel?.()}}}/>
      </form>}
      {error && <p className="crt-agent-period-error">{error}</p>}
    </div>}
  </aside>
}
