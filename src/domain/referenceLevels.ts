import type { MarketBar } from './contracts'

export type ReferenceLevelGroup = 'today' | 'previous-day' | 'week' | 'previous-week' | 'opens'
export type ReferenceLevel = {
  id: string
  group: ReferenceLevelGroup
  title: string
  price: number
  color: string
  lineStyle: 'solid' | 'dashed'
}

const isValidBar = (bar: MarketBar | undefined): bar is MarketBar => Boolean(
  bar && Number.isFinite(bar.time) && Number.isFinite(bar.open) && bar.open > 0 &&
  Number.isFinite(bar.high) && bar.high > 0 && Number.isFinite(bar.low) && bar.low > 0,
)

/** Use native MT5 D1/W1 candles so broker session boundaries and DST stay authoritative. */
export function calculateReferenceLevels(dailyBars: readonly MarketBar[], weeklyBars: readonly MarketBar[]): ReferenceLevel[] {
  const daily = dailyBars.filter(isValidBar).sort((a, b) => a.time - b.time)
  const weekly = weeklyBars.filter(isValidBar).sort((a, b) => a.time - b.time)
  const today = daily.at(-1)
  const previousDay = daily.at(-2)
  const currentWeek = weekly.at(-1)
  const previousWeek = weekly.at(-2)
  const levels: ReferenceLevel[] = []
  const add = (id: string, group: ReferenceLevelGroup, title: string, price: number | undefined, color: string, lineStyle: ReferenceLevel['lineStyle']) => {
    if (Number.isFinite(price) && Number(price) > 0) levels.push({ id, group, title, price: Number(price), color, lineStyle })
  }
  add('day-high', 'today', 'D-H', today?.high, '#55e6c1', 'solid')
  add('day-low', 'today', 'D-L', today?.low, '#55e6c1', 'solid')
  add('previous-day-high', 'previous-day', 'PDH', previousDay?.high, '#f4ce75', 'dashed')
  add('previous-day-low', 'previous-day', 'PDL', previousDay?.low, '#f4ce75', 'dashed')
  add('week-high', 'week', 'W-H', currentWeek?.high, '#82baff', 'solid')
  add('week-low', 'week', 'W-L', currentWeek?.low, '#82baff', 'solid')
  add('previous-week-high', 'previous-week', 'PWH', previousWeek?.high, '#c49aff', 'dashed')
  add('previous-week-low', 'previous-week', 'PWL', previousWeek?.low, '#c49aff', 'dashed')
  add('day-open', 'opens', 'D-O', today?.open, '#ffbd68', 'dashed')
  add('week-open', 'opens', 'W-O', currentWeek?.open, '#ffbd68', 'dashed')
  return levels
}
