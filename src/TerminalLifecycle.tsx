import { useEffect, useRef, useState, type ReactNode } from 'react'
import { stopMt5Bridge } from './bridgeShutdown'
import './shutdown-terminal.css'

const lines = ['Wyłączam wskaźniki', 'Zamykam strumień wykresu', 'Zamykam terminal', 'Rozłączam MT5']

export function TerminalLifecycle({children}:{children:ReactNode}) {
  const [closing,setClosing]=useState(false), [phase,setPhase]=useState(0)
  const [result,setResult]=useState<'waiting'|'done'|'error'>('waiting'), [error,setError]=useState('')
  const [desktopApp,setDesktopApp]=useState(false)
  const [attempt,setAttempt]=useState(0)
  const closeRef=useRef<HTMLDivElement>(null)
  useEffect(()=>{
    const close=()=>setClosing(true)
    window.addEventListener('smartflow-x:shutdown',close)
    let unlisten:(()=>void)|undefined
    void import('@tauri-apps/api/core').then(async({isTauri})=>{
      if(!isTauri())return
      setDesktopApp(true)
      const {getCurrentWindow}=await import('@tauri-apps/api/window')
      unlisten=await getCurrentWindow().onCloseRequested(event=>{
        event.preventDefault()
        window.dispatchEvent(new Event('smartflow-x:shutdown'))
      })
    }).catch(()=>{/* Browser previews do not expose the native window API. */})
    return()=>{window.removeEventListener('smartflow-x:shutdown',close);unlisten?.()}
  },[])
  useEffect(()=>{
    if(!closing)return
    let dead=false
    closeRef.current?.focus()
    try { sessionStorage.removeItem('smartflow-x:startup-ready:v1') } catch { /* local closing still works */ }
    const timers=[300,650,1000,1350].map((delay,index)=>window.setTimeout(()=>setPhase(index+1),delay))
    const start=window.setTimeout(()=>{
      import('@tauri-apps/api/core').then(({isTauri})=>stopMt5Bridge({allowUnavailable:isTauri()})).then(async()=>{
        if(dead)return
        setResult('done')
        const {isTauri}=await import('@tauri-apps/api/core')
        if(isTauri()){
          setDesktopApp(true)
          window.setTimeout(()=>void import('@tauri-apps/api/window').then(({getCurrentWindow})=>getCurrentWindow().destroy()),1200)
        }
      }).catch(reason=>{if(!dead){setError(reason instanceof Error?reason.message:String(reason));setResult('error')}})
    },1400)
    return()=>{dead=true;timers.forEach(window.clearTimeout);window.clearTimeout(start)}
  },[closing,attempt])
  if(!closing)return <>{children}</>
  return <div className="sf-startup-overlay sf-shutdown-overlay" role="dialog" aria-modal="true" aria-labelledby="shutdown-title" ref={closeRef} tabIndex={-1}>
    <div className="sf-startup-vignette" aria-hidden="true"/>
    <section className="sf-startup-window">
      <header className="sf-startup-titlebar"><span aria-hidden="true"/><div><small>SESJA LOKALNA // SYSTEM RYNKOWY</small><strong id="shutdown-title">ZAMYKANIE TERMINALU</strong></div><span className="sf-startup-build">WYJŚCIE</span></header>
      <div className="sf-startup-content" aria-live="polite">
        <p className="sf-startup-command">User &gt; zamknij-terminal</p>
        <div className="sf-startup-status-list">{lines.map((line,index)=>phase>index&&<p key={line} className={`sf-startup-status sf-startup-status--${index}`}><span>{index===3?'MT5':'SYSTEM'}</span><b>{line}</b><i>{index===3?result==='done'?'WYŁ.':result==='error'?'BŁĄD':'OCZEKIWANIE':'WYŁ.'}</i></p>)}</div>
        {result==='waiting'&&<p className="sf-startup-wait">Luna › Kończę sesję…</p>}
        {result==='done'&&<><h1 className="sf-shutdown-bye">Do zobaczenia, admin!</h1><p className="sf-shutdown-note">Luna › Wyłączyłam terminal i most.{` `}{desktopApp?'Aplikacja zaraz się zamknie.':'Możesz zamknąć tę kartę.'}</p></>}
        {result==='error'&&<div role="alert" className="sf-shutdown-error"><p>Luna › Nie potwierdziłam zatrzymania mostu: {error}</p><button className="sf-startup-ready" onClick={()=>{setResult('waiting');setError('');setAttempt(value=>value+1)}}>PONÓW ZAMYKANIE MOSTU</button></div>}
      </div>
      <footer className="sf-startup-footer"><span>SESJA LOKALNA</span><span>WSKAŹNIKI / WYKRES WYŁ.</span><span>{result==='done'?'MOST MT5 ZATRZYMANY':result==='error'?'NIE POTWIERDZONO ZAMKNIĘCIA':'ZAMYKANIE'}</span></footer>
    </section>
  </div>
}
