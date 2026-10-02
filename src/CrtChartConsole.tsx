import { useEffect, useState } from 'react'

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
  return <p className="crt-console-line"><span className="crt-console-readable">{text}</span><span aria-hidden="true">&gt; {visible}<i className="crt-console-cursor">▌</i></span></p>
}

type Props = {
  notice:{text:string; id:number} | null
  motionPaused:boolean
}

/** Chart feedback only; selectable levels live in the text Command Deck. */
export function CrtChartConsole({notice, motionPaused}:Props) {
  return <aside className="crt-chart-console" aria-label="Konsola wykresu CRT">
    {notice && <div role="status" aria-live="polite" aria-atomic="true"><TypedLine text={notice.text} sequence={notice.id} paused={motionPaused} /></div>}
  </aside>
}
