import type { TradeSide } from './contracts'

export type PricePrecision = { digits: number; tickSize: number }
export type PlannerGeometry = { entry: number; stopLoss: number; takeProfit: number }
export type PlannerLevel = 'entry' | 'stopLoss' | 'takeProfit'

export function snapToSymbolTick(price: number, precision: PricePrecision): number {
  const digits = Math.max(0, Math.min(12, precision.digits))
  const tick = precision.tickSize > 0 ? precision.tickSize : 10 ** -digits
  return Number((Math.round(price / tick) * tick).toFixed(digits))
}

export function createPlannerGeometry(entry: number, side: TradeSide, precision: PricePrecision): PlannerGeometry {
  const tick = precision.tickSize > 0 ? precision.tickSize : 10 ** -precision.digits
  const snappedEntry = snapToSymbolTick(entry, precision)
  const risk = Math.max(tick * 10, Math.abs(snappedEntry) * 0.00092)
  const reward = risk * 1.9
  return side === 'long'
    ? { entry: snappedEntry, stopLoss: snapToSymbolTick(snappedEntry - risk, precision), takeProfit: snapToSymbolTick(snappedEntry + reward, precision) }
    : { entry: snappedEntry, stopLoss: snapToSymbolTick(snappedEntry + risk, precision), takeProfit: snapToSymbolTick(snappedEntry - reward, precision) }
}

export function clampPlannerPrice(side: TradeSide, level: PlannerLevel, price: number, current: PlannerGeometry, precision: PricePrecision): PlannerGeometry {
  const tick = precision.tickSize > 0 ? precision.tickSize : 10 ** -precision.digits
  const rounded = snapToSymbolTick(price, precision)
  if (side === 'long') {
    if (level === 'takeProfit') return { ...current, takeProfit: Math.max(rounded, snapToSymbolTick(current.entry + tick, precision)) }
    if (level === 'stopLoss') return { ...current, stopLoss: Math.min(rounded, snapToSymbolTick(current.entry - tick, precision)) }
    return { ...current, entry: Math.min(Math.max(rounded, snapToSymbolTick(current.stopLoss + tick, precision)), snapToSymbolTick(current.takeProfit - tick, precision)) }
  }
  if (level === 'takeProfit') return { ...current, takeProfit: Math.min(rounded, snapToSymbolTick(current.entry - tick, precision)) }
  if (level === 'stopLoss') return { ...current, stopLoss: Math.max(rounded, snapToSymbolTick(current.entry + tick, precision)) }
  return { ...current, entry: Math.min(Math.max(rounded, snapToSymbolTick(current.takeProfit + tick, precision)), snapToSymbolTick(current.stopLoss - tick, precision)) }
}

export function translatePlannerGeometry(current: PlannerGeometry, delta: number, precision: PricePrecision): PlannerGeometry {
  return {
    entry: snapToSymbolTick(current.entry + delta, precision),
    stopLoss: snapToSymbolTick(current.stopLoss + delta, precision),
    takeProfit: snapToSymbolTick(current.takeProfit + delta, precision),
  }
}
