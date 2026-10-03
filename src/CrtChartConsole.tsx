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
}

/** Chart feedback only; selectable levels live in the text Command Deck. */
export function CrtChartConsole({notice, motionPaused, periodPrompt = null, onPeriodSubmit, onPeriodCancel}:Props) {
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
    {notice && <div role="status" aria-live="polite" aria-atomic="true"><TypedLine text={notice.text} sequence={notice.id} paused={motionPaused} /></div>}
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
