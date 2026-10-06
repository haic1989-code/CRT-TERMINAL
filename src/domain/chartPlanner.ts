import type { BreakEvenMode, TradeSide } from './contracts'
import { clampPlannerPrice, createPlannerGeometry, snapToSymbolTick, type PricePrecision } from './plannerGeometry'

export type PlannerSide = TradeSide
export type PlannerLevel = 'tp' | 'tp1' | 'tp2' | 'tp3' | 'be' | 'entry' | 'sl'

export type PlannerState = {
  /** Full-position take profit remains independent from the optional partial targets. */
  tp: number
  tp1: number | null
  tp2: number | null
  tp3: number | null
  be: number | null
  entry: number
  sl: number
}

export type PlannerAccountingValues = {
  tickSize: number
  profitTickValue: number
  lossTickValue: number
}

export type PlannerVolumeConstraints = {
  min: number
  max: number
  step: number
}

export function createPlannerAtPrice(
  entry: number,
  side: PlannerSide,
  precision: PricePrecision,
  targets = { tp2: false, tp3: false },
  breakEvenMode: BreakEvenMode = 'manual',
): PlannerState {
  const geometry = createPlannerGeometry(entry, side, precision)
  const riskDistance = Math.abs(geometry.entry - geometry.stopLoss)
  const direction = side === 'long' ? 1 : -1
  const target = (multiple: number) => snapToSymbolTick(geometry.entry + direction * riskDistance * multiple, precision)
  return {
    tp: geometry.takeProfit,
    tp1: null,
    tp2: targets.tp2 ? target(2.8) : null,
    tp3: targets.tp3 ? target(3.7) : null,
    be: breakEvenMode === 'off' ? null : geometry.entry,
    entry: geometry.entry,
    sl: geometry.stopLoss,
  }
}

function plannerDistances(side: PlannerSide, planner: PlannerState) {
  return side === 'long'
    ? {
        reward: Math.max(planner.tp - planner.entry, 0.1),
        risk: Math.max(planner.entry - planner.sl, 0.1),
      }
    : {
        reward: Math.max(planner.entry - planner.tp, 0.1),
        risk: Math.max(planner.sl - planner.entry, 0.1),
      }
}

export function clampPlannerLevel(
  side: PlannerSide,
  level: PlannerLevel,
  price: number,
  current: PlannerState,
  precision: PricePrecision,
): PlannerState {
  if (level === 'be') return { ...current, be: snapToSymbolTick(price, precision) }
  if (level === 'tp') {
    const geometry = clampPlannerPrice(side, 'takeProfit', price, { entry: current.entry, stopLoss: current.sl, takeProfit: current.tp }, precision)
    return { ...current, tp: geometry.takeProfit }
  }
  if (level === 'tp1' || level === 'tp2' || level === 'tp3') {
    const targets: Array<number | null> = [current.tp1, current.tp2, current.tp3]
    const index = level === 'tp1' ? 0 : level === 'tp2' ? 1 : 2
    const tick = precision.tickSize > 0 ? precision.tickSize : 10 ** -precision.digits
    const direction = side === 'long' ? 1 : -1
    let previous = current.entry
    for (let i = index - 1; i >= 0; i -= 1) if (targets[i] !== null) { previous = targets[i]!; break }
    let next: number | null = null
    for (let i = index + 1; i < targets.length; i += 1) if (targets[i] !== null) { next = targets[i]; break }
    const min = previous * direction + tick
    const max = next === null ? Infinity : next * direction - tick
    const bounded = snapToSymbolTick(Math.min(max, Math.max(min, price * direction)) * direction, precision)
    if (level === 'tp1') return { ...current, tp1: bounded }
    if (level === 'tp2') return { ...current, tp2: bounded }
    return { ...current, tp3: bounded }
  }
  const geometry = clampPlannerPrice(side, level === 'sl' ? 'stopLoss' : 'entry', price, { entry: current.entry, stopLoss: current.sl, takeProfit: current.tp }, precision)
  return { ...current, tp: geometry.takeProfit, entry: geometry.entry, sl: geometry.stopLoss }
}

export function plannerMetrics(side: PlannerSide, planner: PlannerState | null) {
  if (!planner) return null
  const { reward, risk } = plannerDistances(side, planner)
  return { reward, risk, rr: reward / risk }
}

export function estimatePlannerOutcome(
  side: PlannerSide,
  planner: PlannerState,
  lots: number,
  values?: PlannerAccountingValues,
) {
  const metrics = plannerMetrics(side, planner)
  if (!metrics || !values) return null

  const { tickSize, profitTickValue, lossTickValue } = values
  if (tickSize <= 0 || lots <= 0 || profitTickValue <= 0 || lossTickValue <= 0) return null

  return {
    tpMoney: (metrics.reward / tickSize) * profitTickValue * lots,
    slMoney: (metrics.risk / tickSize) * lossTickValue * lots,
    rr: metrics.rr,
  }
}

export function clampLots(value: number, constraints?: PlannerVolumeConstraints) {
  const min = constraints?.min || 0.01
  const max = constraints?.max || 100
  const step = constraints?.step || 0.01
  const bounded = Math.min(max, Math.max(min, value))
  const snapped = Math.round((bounded - min) / step) * step + min
  const precision = step < 0.01 ? 3 : step < 0.1 ? 2 : 1
  return Number(snapped.toFixed(precision))
}
