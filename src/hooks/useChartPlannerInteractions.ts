import { useEffect, type Dispatch, type MutableRefObject, type PointerEvent as ReactPointerEvent, type SetStateAction } from 'react'
import type { CandlestickData, IChartApi, ISeriesApi, Logical, UTCTimestamp } from 'lightweight-charts'
import { clampPlannerLevel, type PlannerLevel, type PlannerSide, type PlannerState } from '../domain/chartPlanner'
import { snapToSymbolTick, translatePlannerGeometry } from '../domain/plannerGeometry'
import type { PlannerPrimitiveHit, PositionPlannerPrimitive } from '../positionPlannerPrimitive'
import type { Mt5SymbolInfo } from '../mt5Client'

type PlannerTimeRange = { start: number; end: number }
type PlannerGestureCleanup = (cancel?: boolean, notify?: boolean) => void

type UseChartPlannerInteractionsOptions = {
  rootRef: MutableRefObject<HTMLDivElement | null>
  chartRef: MutableRefObject<IChartApi | null>
  candlesRef: MutableRefObject<ISeriesApi<'Candlestick'> | null>
  plannerPrimitiveRef: MutableRefObject<PositionPlannerPrimitive | null>
  plannerRef: MutableRefObject<PlannerState | null>
  plannerTimeRef: MutableRefObject<PlannerTimeRange | null>
  plannerSideRef: MutableRefObject<PlannerSide | null>
  plannerGestureCleanupRef: MutableRefObject<PlannerGestureCleanup | null>
  chartInteractionLockedRef: MutableRefObject<boolean>
  syncPlannerPrimitiveRef: MutableRefObject<() => void>
  symbol: string
  timeframe: string
  data: CandlestickData<UTCTimestamp>[]
  symbolInfo?: Mt5SymbolInfo
  plannerDirty: boolean
  setPlanner: Dispatch<SetStateAction<PlannerState | null>>
  setPlannerTime: Dispatch<SetStateAction<PlannerTimeRange | null>>
  setPlannerDirty: Dispatch<SetStateAction<boolean>>
  setMovingPlanner: Dispatch<SetStateAction<boolean>>
  setResizingPlanner: Dispatch<SetStateAction<'left' | 'right' | null>>
  setActivePlannerLevel: Dispatch<SetStateAction<PlannerLevel | null>>
  syncDrawingCoordinates: () => void
}

function precision(info?: Mt5SymbolInfo) {
  return { digits: info?.digits ?? 2, tickSize: info?.trade_tick_size || info?.point || 0.01 }
}

export function useChartPlannerInteractions({
  rootRef,
  chartRef,
  candlesRef,
  plannerPrimitiveRef,
  plannerRef,
  plannerTimeRef,
  plannerSideRef,
  plannerGestureCleanupRef,
  chartInteractionLockedRef,
  syncPlannerPrimitiveRef,
  symbol,
  timeframe,
  data,
  symbolInfo,
  plannerDirty,
  setPlanner,
  setPlannerTime,
  setPlannerDirty,
  setMovingPlanner,
  setResizingPlanner,
  setActivePlannerLevel,
  syncDrawingCoordinates,
}: UseChartPlannerInteractionsOptions) {
  const startPlannerGesture = (part: PlannerPrimitiveHit | PlannerLevel, event: ReactPointerEvent<HTMLDivElement>) => {
    plannerGestureCleanupRef.current?.(true)
    const root = rootRef.current
    const chart = chartRef.current
    const candles = candlesRef.current
    const original = plannerRef.current
    const originalRange = plannerTimeRef.current
    const side = plannerSideRef.current
    if (!root || !chart || !candles || !original || !originalRange || !side) return
    const rect = root.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const logical0 = chart.timeScale().coordinateToLogical(x)
    const logicalX0 = logical0 === null ? null : chart.timeScale().logicalToCoordinate(logical0)
    const logicalX1 = logical0 === null ? null : chart.timeScale().logicalToCoordinate((Number(logical0) + 1) as Logical)
    const price0 = candles.coordinateToPrice(y)
    const price1 = candles.coordinateToPrice(y + 1)
    if (logical0 === null || logicalX0 === null || logicalX1 === null || logicalX0 === logicalX1 || price0 === null || price1 === null) return
    const barsPerPixel = 1 / (logicalX1 - logicalX0)
    const pricePerPixel = price1 - price0
    const chartPrecision = precision(symbolInfo)
    const startPlanner = { ...original }
    const startRange = { ...originalRange }
    const startClientX = event.clientX
    const startClientY = event.clientY
    const pointerId = event.pointerId
    const dirtyBefore = plannerDirty
    const interactionsBefore = { handleScroll: structuredClone(chart.options().handleScroll), handleScale: structuredClone(chart.options().handleScale) }
    const autoScaleBefore = chart.priceScale('right').options().autoScale
    const shiftBefore = chart.timeScale().options().shiftVisibleRangeOnNewBar
    const visible = chart.timeScale().getVisibleLogicalRange()
    const widthBars = startRange.end - startRange.start
    const minWidth = Math.min(widthBars, Math.max(8, 160 * Math.abs(barsPerPixel)))
    const maxLogical = Math.max(startRange.end, data.length - 1 + Math.max(60, visible ? (Number(visible.to) - Number(visible.from)) * .6 : 180), visible ? Number(visible.to) + widthBars : 0)
    event.preventDefault()
    event.stopPropagation()
    root.setPointerCapture(pointerId)
    chartInteractionLockedRef.current = true
    chart.applyOptions({ handleScroll: false, handleScale: false })
    chart.priceScale('right').applyOptions({ autoScale: false })
    chart.timeScale().applyOptions({ shiftVisibleRangeOnNewBar: false })
    setMovingPlanner(part === 'body')
    setResizingPlanner(part === 'resize-left' ? 'left' : part === 'resize-right' ? 'right' : null)
    setActivePlannerLevel(part === 'body' || part.startsWith('resize-') ? null : part as PlannerLevel)

    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return
      const dx = (e.clientX - startClientX) * barsPerPixel
      const dy = (e.clientY - startClientY) * pricePerPixel
      let next = startPlanner
      let range = startRange
      if (part === 'body') {
        const start = Math.max(0, Math.min(maxLogical - widthBars, startRange.start + dx))
        range = { start, end: start + widthBars }
        const delta = Math.max(dy, chartPrecision.tickSize - Math.min(startPlanner.entry, startPlanner.sl, startPlanner.tp))
        const translated = translatePlannerGeometry({ entry: startPlanner.entry, stopLoss: startPlanner.sl, takeProfit: startPlanner.tp }, delta, chartPrecision)
        next = {
          ...startPlanner,
          entry: translated.entry,
          sl: translated.stopLoss,
          tp: translated.takeProfit,
          tp1: startPlanner.tp1 === null ? null : snapToSymbolTick(startPlanner.tp1 + delta, chartPrecision),
          tp2: startPlanner.tp2 === null ? null : snapToSymbolTick(startPlanner.tp2 + delta, chartPrecision),
          tp3: startPlanner.tp3 === null ? null : snapToSymbolTick(startPlanner.tp3 + delta, chartPrecision),
          be: startPlanner.be === null ? null : snapToSymbolTick(startPlanner.be + delta, chartPrecision),
        }
      } else if (part === 'resize-left') {
        range = { start: Math.max(0, Math.min(startRange.end - minWidth, startRange.start + dx)), end: startRange.end }
      } else if (part === 'resize-right') {
        range = { start: startRange.start, end: Math.min(maxLogical, Math.max(startRange.start + minWidth, startRange.end + dx)) }
      } else {
        const level = part as PlannerLevel
        const value = startPlanner[level]
        if (value === null) return
        next = clampPlannerLevel(side, level, value + dy, startPlanner, precision(symbolInfo))
        // Entry-linked break-even remains attached until the user separates it.
        if (level === 'entry' && startPlanner.be === startPlanner.entry) next = { ...next, be: next.entry }
      }
      plannerRef.current = next
      plannerTimeRef.current = range
      setPlanner(next)
      setPlannerTime(range)
      setPlannerDirty(true)
      syncPlannerPrimitiveRef.current()
    }

    const finish = (cancel = false, notify = true) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancelPointer)
      window.removeEventListener('blur', blur)
      window.removeEventListener('keydown', key)
      plannerGestureCleanupRef.current = null
      chartInteractionLockedRef.current = false
      if (root.hasPointerCapture(pointerId)) root.releasePointerCapture(pointerId)
      if (chartRef.current === chart) {
        chart.applyOptions(interactionsBefore)
        chart.priceScale('right').applyOptions({ autoScale: autoScaleBefore })
        chart.timeScale().applyOptions({ shiftVisibleRangeOnNewBar: shiftBefore })
      }
      if (notify) {
        setMovingPlanner(false)
        setResizingPlanner(null)
        setActivePlannerLevel(null)
        window.requestAnimationFrame(syncDrawingCoordinates)
        if (cancel) {
          plannerRef.current = startPlanner
          plannerTimeRef.current = startRange
          setPlanner(startPlanner)
          setPlannerTime(startRange)
          setPlannerDirty(dirtyBefore)
          syncPlannerPrimitiveRef.current()
        }
      }
    }
    const up = (e: PointerEvent) => { if (e.pointerId === pointerId) finish() }
    const cancelPointer = (e: PointerEvent) => { if (e.pointerId === pointerId) finish(true) }
    const blur = () => finish(true)
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); finish(true) } }
    plannerGestureCleanupRef.current = finish
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancelPointer)
    window.addEventListener('blur', blur)
    window.addEventListener('keydown', key)
  }

  useEffect(() => () => plannerGestureCleanupRef.current?.(false, false), [symbol, timeframe])

  return { startPlannerGesture }
}
