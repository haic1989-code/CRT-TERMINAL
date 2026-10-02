export type IndicatorPlacement = 'overlay' | 'pane'

const indicatorEntries = [
  { id: 'SMA 20', placement: 'overlay', defaultPeriod: 20 },
  { id: 'EMA 50', placement: 'overlay', defaultPeriod: 50 },
  { id: 'VWAP', placement: 'overlay' },
  { id: 'Bollinger Bands', placement: 'overlay', defaultPeriod: 20 },
  { id: 'RSI', placement: 'pane', defaultPeriod: 14, scale: [0, 100] },
] as const

export type IndicatorId = typeof indicatorEntries[number]['id']
export type IndicatorDefinition = { id: IndicatorId; placement: IndicatorPlacement; defaultPeriod?: number; scale?: readonly [number, number] }
export const INDICATOR_CATALOG: readonly IndicatorDefinition[] = indicatorEntries
export type IndicatorSetting = { visible: boolean; period?: number }
export type IndicatorSettings = Partial<Record<IndicatorId, IndicatorSetting>>
export type IndicatorPreferences = { active: IndicatorId[]; settings: IndicatorSettings }

export function indicatorDefinition(id: string): IndicatorDefinition | undefined {
  return INDICATOR_CATALOG.find((indicator) => indicator.id === id)
}

export function isIndicatorId(value: unknown): value is IndicatorId {
  return typeof value === 'string' && indicatorDefinition(value) !== undefined
}

export function normalizeIndicatorPeriod(id: IndicatorId, value: number) {
  const definition = indicatorDefinition(id)
  if (definition?.defaultPeriod === undefined) return undefined
  const period = Number.isFinite(value) ? Math.round(value) : definition.defaultPeriod
  return Math.max(2, Math.min(500, period))
}
