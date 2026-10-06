import { useEffect, useRef, useState } from 'react'
import type { AlertEvent, AlertRule } from '../domain/contracts'
import { AlertEngine } from '../engines'

type AlertUpdater = AlertRule[] | ((current: AlertRule[]) => AlertRule[])

type UseAlertManagementOptions = {
  lastPrice?: number
  feedSymbol?: string
  selectedSymbol: string
  onSymbolChange: (symbol: string) => void
  onOpenAlerts: () => void
}

const ALERTS_KEY = 'smartflow-x:alerts:v1'
const ALERT_EVENTS_KEY = 'smartflow-x:alert-events:v1'

function readStoredAlerts(): AlertRule[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ALERTS_KEY) || '[]')
    return Array.isArray(parsed) ? parsed.filter((rule) => rule && typeof rule.id === 'string' && typeof rule.symbol === 'string' && Number.isFinite(rule.level)) : []
  } catch {
    return []
  }
}

function readStoredAlertEvents(): AlertEvent[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ALERT_EVENTS_KEY) || '[]')
    return Array.isArray(parsed) ? parsed.filter((event) => event && typeof event.ruleId === 'string' && Number.isFinite(event.price) && Number.isFinite(event.firedAt)).slice(0, 30) : []
  } catch {
    return []
  }
}

export function useAlertManagement({ lastPrice, feedSymbol, selectedSymbol, onSymbolChange, onOpenAlerts }: UseAlertManagementOptions) {
  const activeSymbol = feedSymbol || selectedSymbol
  const [alerts, setAlerts] = useState<AlertRule[]>(() => readStoredAlerts())
  const alertsRef = useRef<AlertRule[]>(alerts)
  const [events, setEvents] = useState<AlertEvent[]>(() => readStoredAlertEvents())
  const [focusedAlertId, setFocusedAlertId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [condition, setCondition] = useState<'above' | 'below' | 'cross'>('cross')

  useEffect(() => {
    if (!lastPrice || !alertsRef.current.length) return
    const firedEvents: AlertEvent[] = []
    const rules = alertsRef.current.map((rule) => {
      if (rule.symbol !== activeSymbol) return rule
      const result = AlertEngine.evaluate(rule, lastPrice, Date.now(), activeSymbol)
      if (result.event) firedEvents.push(result.event)
      return result.rule
    })
    alertsRef.current = rules
    setAlerts(rules)
    if (firedEvents.length) setEvents((current) => [...firedEvents, ...current].slice(0, 30))
  }, [lastPrice, feedSymbol, selectedSymbol])

  useEffect(() => {
    alertsRef.current = alerts
    try { window.localStorage.setItem(ALERTS_KEY, JSON.stringify(alerts)) } catch { /* persistence is best-effort */ }
  }, [alerts])

  useEffect(() => {
    try { window.localStorage.setItem(ALERT_EVENTS_KEY, JSON.stringify(events.slice(0, 30))) } catch { /* persistence is best-effort */ }
  }, [events])

  const saveAlert = () => {
    const level = Number(draft)
    if (!(level > 0)) return
    if (focusedAlertId) {
      const rules = alertsRef.current.map((rule) => rule.id === focusedAlertId ? { ...rule, level, condition, symbol: activeSymbol } : rule)
      alertsRef.current = rules
      setAlerts(rules)
      return
    }
    const rule = { id: crypto.randomUUID(), symbol: activeSymbol, level, condition, enabled: true } as AlertRule
    const rules = [rule, ...alertsRef.current]
    alertsRef.current = rules
    setAlerts(rules)
    setDraft('')
  }

  const updateAlerts = (update: AlertUpdater) => {
    const rules = typeof update === 'function' ? update(alertsRef.current) : update
    alertsRef.current = rules
    setAlerts(rules)
    if (focusedAlertId && !rules.some((rule) => rule.id === focusedAlertId)) setFocusedAlertId(null)
  }

  const focusAlert = (id: string) => {
    const rule = alertsRef.current.find((item) => item.id === id)
    if (!rule) return
    if (selectedSymbol !== rule.symbol) onSymbolChange(rule.symbol)
    setFocusedAlertId(rule.id)
    setDraft(String(rule.level))
    setCondition(rule.condition)
    onOpenAlerts()
  }

  return {
    alerts,
    events,
    focusedAlertId,
    setFocusedAlertId,
    draft,
    setDraft,
    condition,
    setCondition,
    saveAlert,
    updateAlerts,
    focusAlert,
  }
}
