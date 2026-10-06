import { useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { BottomTab } from '../BottomTradingPanel'

type BottomPanelPersistedState = { tab: BottomTab; expanded: boolean; height: number }

const LEGACY_STORAGE_KEY = 'smartflow-x:bottom-panel:v1'
const DRAGON_STORAGE_KEY = 'smartflow-x:dragon-bottom-panel:v2'

function readBottomPanelState(storageKey: string, maxHeightRatio: number): BottomPanelPersistedState {
  const fallback: BottomPanelPersistedState = { tab: 'positions', expanded: false, height: 230 }
  if (typeof window === 'undefined') return fallback
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) || 'null') as Partial<BottomPanelPersistedState> | null
    const tab: BottomTab = parsed?.tab === 'orders' || parsed?.tab === 'account' ? parsed.tab : 'positions'
    const expanded = Boolean(parsed?.expanded)
    const height = Math.max(180, Math.min(window.innerHeight * maxHeightRatio, Number(parsed?.height) || 230))
    return { tab, expanded, height }
  } catch {
    return fallback
  }
}

export function useBottomPanelState(isDragon: boolean) {
  const storageKey = isDragon ? DRAGON_STORAGE_KEY : LEGACY_STORAGE_KEY
  const maxHeightRatio = isDragon ? 0.38 : 0.65
  const [initialState] = useState(() => readBottomPanelState(storageKey, maxHeightRatio))
  const [tab, setTab] = useState<BottomTab>(initialState.tab)
  const [expanded, setExpanded] = useState(initialState.expanded)
  const [height, setHeight] = useState(initialState.height)

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({ tab, expanded, height }))
    } catch { /* persistence is best-effort */ }
  }, [tab, expanded, height, storageKey])

  const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const startY = event.clientY
    const panel = event.currentTarget.closest('.sf-bottom-panel')
    const parentHeight = panel?.parentElement?.getBoundingClientRect().height ?? window.innerHeight
    const minHeight = isDragon ? Math.min(180, parentHeight * 0.25) : parentHeight * 0.55
    const maxHeight = parentHeight * (isDragon ? 0.38 : 0.65)
    const startHeight = Math.max(panel?.getBoundingClientRect().height ?? height, minHeight)
    setExpanded(true)
    setHeight(startHeight)
    const move = (moveEvent: PointerEvent) => setHeight(Math.max(minHeight, Math.min(maxHeight, startHeight + startY - moveEvent.clientY)))
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop, { once: true })
    window.addEventListener('pointercancel', stop, { once: true })
  }

  return { tab, setTab, expanded, setExpanded, height, startResize }
}
