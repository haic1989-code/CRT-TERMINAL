import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import type { ChartTimeframe, MarketFeedStatus, PlannerSnapshot } from './MarketChart'
import { gsap } from 'gsap'
import { INDICATOR_CATALOG, type IndicatorId, type IndicatorSettings } from './indicators/catalog'
import type { ReferenceLevelGroup } from './domain/referenceLevels'
import { runDeckTextMotion, type DeckMotionMode } from './deckTextMotion'
import type { Position } from './domain/contracts'
import './matrix-command-deck.css'

type Appearance = { profile: 'chill' | 'normal' | 'power'; mode: DeckMotionMode | null; fall: number; rewrite: number; dynamics: boolean }
const STORAGE = 'smartflow-x:matrix-text-deck:v1'
function readAppearance(): Appearance {
  const base: Appearance = { profile: 'normal', mode: null, fall: 2, rewrite: 3, dynamics: true }
  try { const saved = JSON.parse(localStorage.getItem(STORAGE) || 'null'); return { profile: ['chill','normal','power'].includes(saved?.profile) ? saved.profile : base.profile, mode: ['fall','rewrite'].includes(saved?.mode) ? saved.mode : null, fall: Math.max(1, Math.min(5, Math.round(Number(saved?.fall) || 2))), rewrite: Math.max(1, Math.min(5, Math.round(Number(saved?.rewrite) || 3))), dynamics: typeof saved?.dynamics === 'boolean' ? saved.dynamics : true } } catch { return base }
}
type Props = {
  executionPanel: React.ReactNode; quoteSample: string
  position: Position | null; currentPrice?: number; currency: string; digits: number; onNewPlan: () => void
  plannerLoss: string | null; plannerProfit: string | null
  feedStatus: MarketFeedStatus; contextLive: boolean; contextSnapshots: Record<string, string>
  symbol: string; contextTimeframe: ChartTimeframe; directions: Record<string, string>; session: string
  onContext: (tf: ChartTimeframe) => void
  levels: Array<{ id: ReferenceLevelGroup; label: string; detail: string }>; activeLevels: ReferenceLevelGroup[]; onLevel: (id: ReferenceLevelGroup) => void
  indicators: IndicatorId[]; settings: IndicatorSettings; onIndicator: (id: IndicatorId) => void; onPeriod: (id: IndicatorId, period: number) => void; onPeriodRequest: (id: IndicatorId) => void
  profile: boolean; onProfile: () => void; volume: boolean; onVolume: () => void
  drawing: string; onDrawing: (id: string) => void
  planner: PlannerSnapshot | null; lot: number; appliedLot: number | null; onLot: (lot: number) => void
  lotMin: number; lotMax: number; lotStep: number; lotContractLabel: string
  targets: { tp1: boolean; tp2: boolean; tp3: boolean }; targetLots: number[]; allocations: number[]; volumeStep: number
  placing: string | null; onTarget: (id: 'tp1' | 'tp2' | 'tp3') => void; onDisableTarget: (id: 'tp1' | 'tp2' | 'tp3') => void; onAllocation: (index: number, value: number) => void
  onPreviewPhosphor: () => void; onPreviewScan: () => void; scanRunning: boolean
  onPlan: (side: 'long' | 'short') => void; onCancel: () => void; paused: boolean
}
function Text({children, className = ''}: {children: React.ReactNode; className?: string}) { return <span data-deck-text className={className}>{children}</span> }
function volumeText(value:number,step:number) { const decimals=Array.from({length:9},(_,index)=>index).find(count=>Math.abs(step-Number(step.toFixed(count)))<1e-9)??8;return Number(value).toFixed(decimals) }
function Status({on}: {on:boolean}) { return <Text className={`status status-${on?'on':'off'}`}>{on?'[WŁ.]':'[WYŁ.]'}</Text> }
function Heading({index,children}:{index:string;children:React.ReactNode}) { return <h3><Text className="idx">{index}</Text><Text>{children}</Text></h3> }
function DirectionBar({trend, sample, active, updatesActive, phase}: {trend:string; sample:string; active:boolean; updatesActive:boolean; phase:number}) {
  const bar = useRef<HTMLSpanElement>(null)
  const previous = useRef(sample)
  useEffect(() => {
    if (!active || trend === 'unavailable' || !bar.current) return
    const context = gsap.context(() => {
      gsap.fromTo('.direction-beam', { x: -28 }, { x: 82, duration: 1.35, delay: phase * .17, repeat: -1, repeatDelay: .12, ease: 'none' })
      gsap.fromTo('i', { opacity: .38 }, { opacity: 1, duration: .45, stagger: { each: .09, repeat: -1, yoyo: true }, ease: 'sine.inOut' })
    }, bar)
    const pause = () => context.getTweens().forEach((tween: gsap.core.Tween) => document.hidden ? tween.pause() : tween.resume())
    document.addEventListener('visibilitychange', pause)
    pause()
    return () => { document.removeEventListener('visibilitychange', pause); context.revert() }
  }, [active, trend, phase])
  useEffect(() => {
    const changed = previous.current !== sample
    previous.current = sample
    const row = bar.current?.closest('.context-item')
    if (!changed || !updatesActive || !row || trend === 'unavailable' || document.hidden) return
    const pulse = gsap.fromTo(row, { '--update-glow': .38 }, { '--update-glow': 0, duration: 1.1, ease: 'power2.out' })
    return () => { pulse.kill(); (row as HTMLElement).style.removeProperty('--update-glow') }
  }, [sample, updatesActive, trend])
  return <span className={`direction-bar direction-${trend}`} data-motion={active ? 'on' : 'off'} aria-hidden="true" ref={bar}>
    {[0,1,2,3,4].map(segment=><i key={segment}/>)}<b className="direction-beam" />
  </span>
}
// Row-major pairs keep M5/M15/M30 in the left column and H1/H4/D1 on the right.
const contexts = ['M5','H1','M15','H4','M30','D1'] as const
const tools = [{id:'horizontal',label:'Poziom'}, {id:'trend',label:'Linia trendu'}, {id:'fib',label:'Fibo'}, {id:'rectangle',label:'Strefa'}]
const intro = 'Jestem Luna. Będę obserwować rynek razem z Tobą. Napisz TAK, a otworzę narzędzia, wskaźniki i planer. Każde zlecenie DEMO sprawdzimy i potwierdzisz osobno.'
const indicatorLabels: Record<string,string> = {'Bollinger Bands':'Wstęgi Bollingera','Market Profile':'Profil rynku','Tick Volume':'Wolumen tickowy'}
const contextLabels: Record<string,string> = {LONDON:'LONDYN','NEW YORK':'NOWY JORK',TOKYO:'TOKIO',ASIA:'AZJA',LOW:'NISKA',NORMAL:'UMIARKOWANA',HIGH:'WYSOKA',UNAVAILABLE:'BRAK DANYCH'}
const polishContext = (value:string) => value.split(' · ').map(part=>contextLabels[part] || part).join(' · ')

export function MatrixCommandDeck(p: Props) {
  const [unlocked,setUnlocked] = useState(false), [answer,setAnswer] = useState(''), [caret,setCaret] = useState(0), [notice,setNotice] = useState('')
  const [toolsOpen, setToolsOpen] = useState(false)
  const [toolsTab, setToolsTab] = useState<'levels' | 'indicators' | 'drawing'>('levels')
  const visibleIndicators = p.indicators.filter(id => p.settings[id]?.visible !== false).length + Number(p.profile) + Number(p.volume)
  const activeTools = p.activeLevels.length + visibleIndicators + Number(Boolean(p.drawing))
  const [previewUntil,setPreviewUntil] = useState(0)
  const quoteLight = useRef<HTMLSpanElement>(null), previousQuote = useRef(p.quoteSample)
  const [bootMotionDone,setBootMotionDone] = useState(false)
  const [appearance,setAppearance] = useState(readAppearance), [reduced,setReduced] = useState(() => matchMedia('(prefers-reduced-motion:reduce)').matches)
  const root = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), input = useRef<HTMLInputElement>(null)
  const cancelMotion = useRef<(() => void) | null>(null), booted = useRef(false)
  const [layout,setLayout] = useState(0)
  useEffect(() => { try { localStorage.setItem(STORAGE, JSON.stringify(appearance)) } catch { /* transient appearance */ } },[appearance])
  useEffect(() => { const media=matchMedia('(prefers-reduced-motion:reduce)'); const change=()=>setReduced(media.matches); media.addEventListener('change',change); change(); return()=>media.removeEventListener('change',change) },[])
  useEffect(() => { const focus=()=>{if(!unlocked) input.current?.focus({preventScroll:true})}; focus(); window.addEventListener('smartflow-x:startup-ready',focus); return()=>window.removeEventListener('smartflow-x:startup-ready',focus) },[unlocked])
  useEffect(() => { let width=root.current?.clientWidth; const observer=new ResizeObserver(()=>{if(root.current?.clientWidth!==width){width=root.current?.clientWidth;setLayout(value=>value+1)}}); if(root.current) observer.observe(root.current); return()=>observer.disconnect() },[])
  const signature = JSON.stringify([p.contextTimeframe,p.indicators,p.settings,p.profile,p.volume,p.activeLevels,p.drawing,p.planner?.side,p.placing,p.targets,p.lot,p.allocations,toolsOpen,toolsTab,p.position?.id])
  useLayoutEffect(() => {
    if (!unlocked || !root.current || !canvas.current || booted.current) return
    booted.current=true
    if (reduced || p.paused) { setBootMotionDone(true); return }
    // The first reveal is independent of live market updates.
    cancelMotion.current=runDeckTextMotion(root.current,canvas.current,'rewrite',5,()=>{cancelMotion.current=null;setBootMotionDone(true)})
    return()=>{cancelMotion.current?.();cancelMotion.current=null;setBootMotionDone(true)}
  },[unlocked,p.paused,reduced])
  useLayoutEffect(() => {
    if (!unlocked || !bootMotionDone || !root.current || !canvas.current || reduced || p.paused || !appearance.mode) return
    let dead=false, timer=0
    const mode=appearance.mode
    const intensity=mode==='fall'?appearance.fall:appearance.rewrite
    const run=()=>{if(dead)return;cancelMotion.current=runDeckTextMotion(root.current!,canvas.current!,mode,intensity,()=>{if(dead)return;timer=window.setTimeout(run,Math.max(3500,10000-intensity*1000))})}
    timer=window.setTimeout(run,600)
    return()=>{dead=true;window.clearTimeout(timer);cancelMotion.current?.();cancelMotion.current=null}
  },[unlocked,bootMotionDone,reduced,p.paused,appearance.mode,appearance.fall,appearance.rewrite,signature,layout])
  const motionActive = !reduced && !p.paused
  useLayoutEffect(() => {
    const slider = root.current?.querySelector<HTMLInputElement>('.lot-slider')
    if (!slider) return
    const fill = `${p.lotMax > p.lotMin ? Math.max(0, Math.min(100, (p.lot - p.lotMin) / (p.lotMax - p.lotMin) * 100)) : 0}%`
    if (!motionActive) { slider.style.setProperty('--fill', fill); return }
    const motion = gsap.to(slider, { '--fill': fill, duration: .45, ease: 'power2.out' })
    const glow = gsap.fromTo(slider, { boxShadow: '0 0 20px #ffd774bb' }, { boxShadow: '0 0 8px #e4c58b33', duration: .9 })
    return () => { motion.kill(); glow.kill() }
  }, [p.lot, p.lotMin, p.lotMax, unlocked, motionActive])
  useEffect(() => {
    if (!previewUntil) return
    const timer = window.setTimeout(() => setPreviewUntil(0), Math.max(0, previewUntil - Date.now()))
    return () => window.clearTimeout(timer)
  }, [previewUntil])
  useEffect(() => {
    const changed = previousQuote.current !== p.quoteSample
    previousQuote.current = p.quoteSample
    if (!quoteLight.current || !motionActive || document.hidden || (!previewUntil && (!changed || p.feedStatus !== 'live'))) return
    const pulse = gsap.fromTo(quoteLight.current, { backgroundColor: 'rgba(120,255,210,.55)', color: '#ffffff', boxShadow: '0 0 15px #79ecaa' }, { backgroundColor: 'rgba(120,255,210,0)', color: '#79ecaa', boxShadow: '0 0 0px transparent', duration: 1.1, repeat: previewUntil ? 5 : 0, repeatDelay: .2, ease: 'power2.out' })
    return () => { pulse.kill() }
  }, [p.quoteSample, p.feedStatus, motionActive, previewUntil])
  const act = (action:()=>void) => { cancelMotion.current?.(); action() }
  return <div className="matrix-command-deck" data-profile={appearance.profile} data-motion={motionActive ? 'on' : 'off'} data-feed={p.feedStatus} ref={root}>
    <div className="identity"><div className="deck-brand"><small>CRT // COMMAND</small><strong>Konsola rynku_</strong><span className="deck-feed-state"><i aria-hidden="true" />{p.feedStatus === 'live' ? 'MT5 · NA ŻYWO' : p.feedStatus === 'closed' ? 'MT5 · RYNEK ZAMKNIĘTY' : p.feedStatus === 'connecting' ? 'MT5 · ŁĄCZENIE' : p.feedStatus === 'history' ? 'MT5 · HISTORIA' : 'MT5 · BRAK AKTUALNYCH DANYCH'}</span></div><details className="deck-effects"><summary>Ustawienia efektów</summary><div className="appearance-controls">
      <div className="presets" aria-label="Motyw kolorystyczny"><span className="dim">Motyw</span>{(['chill','normal','power'] as const).map((profile,index)=><button key={profile} data-preset={profile} aria-pressed={appearance.profile===profile} onClick={()=>setAppearance(current=>({...current,profile}))}>{['Spokojny','Normalny','Mocny'][index]}</button>)}</div>
      <div className="effect-controls"><button aria-pressed={appearance.mode==='fall'} onClick={()=>setAppearance(current=>({...current,mode:current.mode==='fall'?null:'fall'}))}>Opad {appearance.mode==='fall'?'[WŁ.]':'[WYŁ.]'}</button><label className="effect-strength">Siła opadu <input aria-label="Natężenie opadu Matrix" type="range" min="1" max="5" step="1" value={appearance.fall} onChange={event=>setAppearance(current=>({...current,fall:Number(event.target.value)}))}/><output>{appearance.fall}</output></label></div>
      <div className="effect-controls"><button aria-pressed={appearance.mode==='rewrite'} onClick={()=>setAppearance(current=>({...current,mode:current.mode==='rewrite'?null:'rewrite'}))}>Pisanie {appearance.mode==='rewrite'?'[WŁ.]':'[WYŁ.]'}</button><label className="effect-strength">Tempo <input aria-label="Natężenie pisania terminalu" type="range" min="1" max="5" step="1" value={appearance.rewrite} onChange={event=>setAppearance(current=>({...current,rewrite:Number(event.target.value)}))}/><output>{appearance.rewrite}</output></label></div>
      <div className="effect-controls"><button aria-pressed={appearance.dynamics} onClick={()=>setAppearance(current=>({...current,dynamics:!current.dynamics}))}>Dynamika pasków {appearance.dynamics?'[WŁ.]':'[WYŁ.]'}</button></div><div className="demo-previews"><small>PODGLĄD ANIMACJI · BEZ ZMIANY DANYCH</small><button type="button" disabled={!motionActive} onClick={()=>setPreviewUntil(Date.now()+8000)}>Podgląd dynamiki panelu · 8 s</button><button type="button" onClick={p.onPreviewPhosphor}>Podgląd fosforu</button><button type="button" disabled={p.scanRunning} onClick={p.onPreviewScan}>Podgląd animacji skanu</button></div>
    </div></details></div>
    {!unlocked ? <div className="deck-intro"><p className="question">Luna › Wchodzimy razem do terminalu?</p><form className="ps-answer" onSubmit={event=>{event.preventDefault();if(answer.trim().toLowerCase()==='tak'){setUnlocked(true);setNotice('')}else setNotice('Luna › Wpisz TAK, a otworzę Ci narzędzia.')}}><label className="ps-prefix" htmlFor="matrix-deck-answer">User</label><span className="ps-entry" style={{'--caret-ch':caret} as CSSProperties}><input id="matrix-deck-answer" ref={input} aria-label="Wpisz odpowiedź tak" autoComplete="off" spellCheck={false} maxLength={8} value={answer} onChange={event=>{setAnswer(event.target.value);setCaret(event.target.selectionStart||0)}} onSelect={event=>setCaret(event.currentTarget.selectionStart||0)}/></span></form><p className="hint"><em>{intro}</em></p>{notice&&<p className="feedback" role="status">{notice}</p>}</div> : <div className="deck-content">
      <div className="session"><Text className="positive">Luna › Witaj ponownie, admin :)</Text></div>
      <span ref={quoteLight} className="deck-quote-pulse">{previewUntil ? 'PODGLĄD ANIMACJI · BEZ ZMIANY DANYCH' : 'BID / ASK · IMPULS PRZY ZMIANIE CENY'}</span><section className="deck-context"><Heading index="01">KONTEKST RYNKOWY</Heading><div className="pair-grid">{contexts.map((tf,index)=>{const trend=p.directions[tf]||'unavailable';return <button className="item context-item" key={tf} aria-label={`Kontekst ${tf}: ${trend==='bullish'?'wzrostowy':trend==='bearish'?'spadkowy':trend==='unavailable'?'brak danych':'neutralny'}`} aria-pressed={p.contextTimeframe===tf} onClick={()=>act(()=>p.onContext(tf))}><Text className={p.contextTimeframe===tf?'active':''}>{tf}</Text><DirectionBar trend={trend} sample={`${p.symbol}|${p.contextSnapshots[tf] ?? 'null'}`} active={motionActive && (appearance.dynamics || Boolean(previewUntil))} updatesActive={motionActive && p.contextLive} phase={index}/><Text className={trend==='bullish'?'positive':trend==='bearish'?'negative':'dim'}>{trend==='bullish'?'wzrostowy':trend==='bearish'?'spadkowy':trend==='unavailable'?'brak danych':'neutralny'}</Text></button>})}</div><div className="subline"><Text className="dim">{p.symbol} · {polishContext(p.session)}</Text></div><div className="subline"><Text className="dim">Światło pasków: {motionActive && appearance.dynamics ? 'aktywne' : 'wyłączone'} · ruch dekoracyjny</Text></div></section>
      <section className="deck-toolbox" aria-label="Narzędzia rynku">
        <button type="button" className="deck-tools-toggle" aria-expanded={toolsOpen} aria-controls="deck-tools-panel" onClick={()=>act(()=>setToolsOpen(value=>!value))}>
          <span><Text>NARZĘDZIA ·</Text><span className="deck-tools-count">{activeTools} AKTYWNE</span></span><span aria-hidden="true">{toolsOpen ? '⌃' : '⌄'}</span>
        </button>
        {activeTools > 0 && <div className="deck-tools-summary">{p.activeLevels.length > 0 && <span>POZIOMY {p.activeLevels.length}</span>}{visibleIndicators > 0 && <span>WSKAŹNIKI {visibleIndicators}</span>}{p.drawing && <span>{tools.find(tool=>tool.id===p.drawing)?.label ?? p.drawing} · aktywne</span>}</div>}
        {toolsOpen && <div id="deck-tools-panel" className="deck-tools-panel">
          <div role="tablist" aria-label="Kategorie narzędzi" className="deck-tools-tabs">{([['levels','POZIOMY'],['indicators','WSKAŹNIKI'],['drawing','RYSOWANIE']] as const).map(([id,label])=><button type="button" role="tab" key={id} id={'deck-tab-'+id} aria-selected={toolsTab===id} aria-controls={'deck-panel-'+id} tabIndex={toolsTab===id ? 0 : -1} onKeyDown={event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const ids=['levels','indicators','drawing'] as const;const index=event.key==='Home'?0:event.key==='End'?2:(ids.indexOf(toolsTab)+(event.key==='ArrowRight'?1:2))%3;setToolsTab(ids[index]);document.getElementById('deck-tab-'+ids[index])?.focus()}} onClick={()=>act(()=>setToolsTab(id))}>{label}</button>)}</div>
          <div role="tabpanel" id={'deck-panel-'+toolsTab} aria-labelledby={'deck-tab-'+toolsTab} className="deck-tools-body">
            {toolsTab === 'levels' && <>{p.levels.map(level=><button className="item level-item" key={level.id} aria-label={level.label} aria-pressed={p.activeLevels.includes(level.id)} onClick={()=>act(()=>p.onLevel(level.id))}><Text>{level.label}</Text><Status on={p.activeLevels.includes(level.id)}/></button>)}</>}
            {toolsTab === 'indicators' && <>      <div className="pair-grid">{INDICATOR_CATALOG.map(({id,defaultPeriod})=>{const average=id.startsWith('SMA ')||id.startsWith('EMA ');const active=p.indicators.includes(id)&&p.settings[id]?.visible!==false;const label=average?`${id.split(' ')[0]} ${p.settings[id]?.period??defaultPeriod}`:indicatorLabels[id]||id;return <button key={id} className="item" aria-label={label} aria-pressed={active} onClick={()=>act(()=>average?(active?p.onIndicator(id):p.onPeriodRequest(id)):p.onIndicator(id))}><Text>{label}</Text><Status on={active}/></button>})}<button className="item" aria-label="Profil rynku" aria-pressed={p.profile} onClick={()=>act(()=>p.onProfile())}><Text>Profil rynku</Text><Status on={p.profile}/></button><button className="item" aria-label="Wolumen tickowy" aria-pressed={p.volume} onClick={()=>act(()=>p.onVolume())}><Text>Wolumen tickowy</Text><Status on={p.volume}/></button></div><div className="inline-params">{INDICATOR_CATALOG.filter(indicator=>indicator.defaultPeriod!==undefined&&indicator.id!=='SMA 20'&&indicator.id!=='EMA 50').map(indicator=><label key={indicator.id}><Text className="dim">{indicator.id==='Bollinger Bands'?'BB':indicator.id.split(' ')[0]}</Text><input aria-label={`Okres ${indicator.id==='Bollinger Bands'?'wstęg Bollingera':indicator.id.split(' ')[0]}`} type="number" min="2" max="500" value={p.settings[indicator.id]?.period??indicator.defaultPeriod} onChange={event=>act(()=>p.onPeriod(indicator.id,Math.max(2,Math.min(500,Math.round(Number(event.target.value)||indicator.defaultPeriod!)))))} /></label>)}</div></>}
            {toolsTab === 'drawing' && <>      <div className="tools">{tools.map(tool=><button key={tool.id} aria-label={tool.label} aria-pressed={p.drawing===tool.id} onClick={()=>act(()=>{ p.onDrawing(tool.id); setToolsOpen(false) })}><Text className={p.drawing===tool.id?'active':''}>{p.drawing===tool.id?'› ':''}{tool.label}</Text></button>)}</div></>}
          </div>
        </div>}
      </section>
      {p.position ? <>      <section className="deck-planner deck-manage" aria-label="Manage Position">
        <Heading index="03">MANAGE POSITION</Heading>
        <div className="deck-managed-identity"><strong>{p.position?.symbol}</strong><span className={p.position?.side === 'long' ? 'positive' : 'negative'}>{p.position?.side === 'long' ? 'DŁUGA' : 'KRÓTKA'} · #{p.position?.id}</span></div>
        <div className="deck-managed-pnl"><small>BIEŻĄCY P/L · {p.currency}</small><strong className={(p.position?.profit ?? 0) >= 0 ? 'positive' : 'negative'}>{p.position?.profit.toLocaleString('pl-PL',{minimumFractionDigits:2,maximumFractionDigits:2})}</strong><span>{p.position?.volume.toFixed(2)} LOT</span></div>
        <div className="deck-plan-readout">{[['WEJŚCIE',p.position?.openPrice],['SL',p.position?.stopLoss],['TP',p.position?.takeProfit],['CENA',p.currentPrice]].map(([label,value]) => <div key={label}><small>{label}</small><strong>{typeof value === 'number' && value > 0 ? value.toFixed(p.digits) : '—'}</strong></div>)}</div>
        <p className="deck-management-note">Podgląd pozycji MT5. Zmianę SL/TP i zamknięcie wykonaj w MT5.</p>
        <button type="button" className="deck-new-plan" onClick={()=>act(p.onNewPlan)}>NOWY PLAN <span aria-hidden="true">↗</span></button>
      </section>
</> : <>      <section className="deck-planner"><Heading index="03">PLANNER TRANSAKCJI</Heading><div className="deck-directions pair-grid">{(['long','short'] as const).map(side=><button key={side} aria-label={`Ustaw pozycję ${side==='long'?'długą':'krótką'}`} aria-pressed={p.planner?.side===side} onClick={()=>act(()=>p.onPlan(side))}><Text className={side==='long'?'positive':'negative'}>{p.planner?.side===side?'› ':''}{side==='long'?'DŁUGA':'KRÓTKA'}</Text></button>)}</div><div className="lot-control"><label className="lot-heading" htmlFor="matrix-lot"><Text className="amber">Wielkość pozycji</Text><output data-deck-text>{volumeText(p.lot,p.lotStep)} lota</output></label><input id="matrix-lot" className="lot-slider" aria-label="Wielkość pozycji w lotach" type="range" min={p.lotMin} max={p.lotMax} step={p.lotStep} value={p.lot} disabled={p.lotMin>p.lotMax} onChange={event=>act(()=>p.onLot(Number(event.target.value)))} /><div className="lot-limits"><Text>{volumeText(p.lotMin,p.lotStep)}</Text><Text>{volumeText(p.lotMax,p.lotStep)} lot</Text></div><div className="subline lot-equivalent"><Text>{p.lotContractLabel}</Text></div>{p.lotMin>p.lotMax&&<div className="subline"><Text>Minimum brokera przekracza limit planera 1 lot.</Text></div>}{p.appliedLot!==null&&Math.abs(p.appliedLot-p.lot)>.000001&&<div className="subline"><Text>Wolumen wg kroku brokera: {volumeText(p.appliedLot,p.lotStep)} lota</Text></div>}</div><div className="deck-plan-readout" aria-label="Poziomy planu">{[['WEJŚCIE',p.planner?.entry],['SL',p.planner?.sl],['PEŁNY TP',p.planner?.tp]].map(([label,value]) => <div key={label}><small>{label}</small><strong>{typeof value === 'number' ? value.toFixed(p.digits) : '—'}</strong></div>)}</div>
        <div className="deck-plan-outcome"><span>STRATA PRZY SL<strong className="negative">{p.plannerLoss ?? '—'}</strong></span><span>ZYSK PRZY PEŁNYM TP<strong className="positive">{p.plannerProfit ?? '—'}</strong></span></div><div className="targets">{(['tp1','tp2','tp3'] as const).map(target=><button key={target} disabled={!p.planner} aria-label={`Cel ${target.toUpperCase()}`} aria-pressed={p.targets[target]} onClick={()=>act(()=>p.onTarget(target))}><Text>{p.placing===target?'› ':''}{target.toUpperCase()}</Text> <Status on={p.targets[target]}/></button>)}</div>
        {p.planner&&(['tp1','tp2','tp3'] as const).map((target,index)=>p.targets[target]&&<div key={target} className="target-allocation"><Text>{target.toUpperCase()} {p.planner?.[target]?.toFixed(2)??'NIEUSTAWIONY'}</Text><input aria-label={`${target.toUpperCase()} lotów do zamknięcia`} type="range" min="0" max={Math.max(p.appliedLot??0,p.volumeStep)} step={p.volumeStep} value={p.targetLots[index]??0} disabled={!p.appliedLot} onChange={event=>act(()=>p.onAllocation(index,p.appliedLot?Number(event.target.value)/p.appliedLot*100:0))}/><Text>{(p.targetLots[index]??0).toFixed(2)} lota</Text><button aria-label={`Wyłącz ${target.toUpperCase()}`} onClick={()=>act(()=>p.onDisableTarget(target))}>×</button></div>)}
        {p.planner&&<button className="cancel" onClick={()=>act(p.onCancel)}><Text className="dim">Anuluj plan</Text></button>}<div className="subline"><Text className="dim">Luna › Ustaw wejście, SL i pełny TP. Po rysowaniu zapytam o wysyłkę DEMO.</Text></div>
      </section>
</>}
      {p.executionPanel}
    </div>}
    <canvas className="matrix-fall" ref={canvas} aria-hidden="true"/>
  </div>
}
