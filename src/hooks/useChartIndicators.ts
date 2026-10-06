import { useEffect, type MutableRefObject } from 'react'
import { LineSeries, LineStyle, type CandlestickData, type IChartApi, type UTCTimestamp } from 'lightweight-charts'
import { indicatorDefinition, type IndicatorId, type IndicatorSettings } from '../indicators/catalog'
import { calculateIndicatorSeries } from '../indicators/calculations'
import { getIndicatorBars } from '../indicators/chartBars'
import { vwapPresentation } from '../indicators/vwapPresentation'

export type IndicatorSeriesEntry = { id: IndicatorId; key: 'main' | 'upper' | 'lower'; series: any }
const RSI_PANE_HEIGHT = 140

type VolumeBar = { time: UTCTimestamp; value: number; color: string }

type UseChartIndicatorsOptions = {
  chartRef: MutableRefObject<IChartApi | null>
  rootRef: MutableRefObject<HTMLDivElement | null>
  seriesRef: MutableRefObject<IndicatorSeriesEntry[]>
  historyRef: MutableRefObject<CandlestickData<UTCTimestamp>[]>
  volumeDataRef: MutableRefObject<VolumeBar[]>
  data: CandlestickData<UTCTimestamp>[]
  lastBar: CandlestickData<UTCTimestamp> | null
  volumeData: VolumeBar[]
  indicators: IndicatorId[]
  indicatorSettings: IndicatorSettings
}

export function useChartIndicators({
  chartRef,
  rootRef,
  seriesRef,
  historyRef,
  volumeDataRef,
  data,
  lastBar,
  volumeData,
  indicators,
  indicatorSettings,
}: UseChartIndicatorsOptions) {
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !data.length) return
    seriesRef.current.forEach((entry) => chart.removeSeries(entry.series))
    seriesRef.current = []
    const bars = getIndicatorBars(historyRef.current, null, volumeDataRef.current)
    const addLine = (
      id: IndicatorId,
      key: 'main' | 'upper' | 'lower',
      name: string,
      values: Array<number | null>,
      color: string,
      style = LineStyle.Solid,
      paneIndex = 0,
      fixedRange?: { minValue: number; maxValue: number },
    ) => {
      const series = chart.addSeries(LineSeries, {
        color,
        lineWidth: 1,
        lineStyle: style,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        title: name,
        ...(fixedRange ? { autoscaleInfoProvider: () => ({ priceRange: fixedRange }) } : {}),
      }, paneIndex)
      const points = bars.flatMap((bar, index) => values[index] == null ? [] : [{ time: bar.time as UTCTimestamp, value: values[index]! }])
      series.setData(id === 'VWAP' ? vwapPresentation(points) : points)
      seriesRef.current.push({ id, key, series })
      return series
    }

    for (const id of indicators) {
      const settings = indicatorSettings[id] ?? { visible: true }
      if (settings.visible === false) continue
      const definition = indicatorDefinition(id)
      if (!definition) continue
      const period = settings.period ?? definition.defaultPeriod ?? 14
      const values = calculateIndicatorSeries(id, bars, period)
      const paneIndex = id === 'RSI' ? chart.panes().length : 0
      let rsiSeries: any = null
      for (const item of values) {
        const title = id === 'SMA 20' ? `SMA ${period}`
          : id === 'EMA 50' ? `EMA ${period}`
            : id === 'Bollinger Bands' ? `BB ${item.key} ${period}`
              : id === 'RSI' ? `RSI (${period})` : 'VWAP · DAY UTC'
        const color = id === 'SMA 20' ? '#ffe06b'
          : id === 'EMA 50' ? '#5eabff'
            : id === 'VWAP' ? '#b594ff'
              : id === 'RSI' ? '#5ce8ff' : 'rgba(238, 125, 255, .8)'
        const style = id === 'Bollinger Bands' ? LineStyle.Dashed : LineStyle.Solid
        const created = addLine(id, item.key, title, item.values, color, style, paneIndex, id === 'RSI' ? { minValue: 0, maxValue: 100 } : undefined)
        if (id === 'RSI') rsiSeries = created
      }
      if (id === 'RSI' && rsiSeries) {
        rsiSeries.createPriceLine({ price: 70, color: 'rgba(255, 89, 178, .72)', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '70' })
        rsiSeries.createPriceLine({ price: 30, color: 'rgba(92, 232, 255, .72)', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '30' })
        chart.priceScale('right', paneIndex).applyOptions({ visible: true, autoScale: true, scaleMargins: { top: 0.04, bottom: 0.04 } })
        chart.panes()[paneIndex]?.setHeight(RSI_PANE_HEIGHT)
      }
    }

    const paneCount = Math.max(0, chart.panes().length - 1)
    const visiblePaneScaleCount = chart.panes().slice(1).filter((_, index) => chart.priceScale('right', index + 1).options().visible).length
    if (rootRef.current) {
      rootRef.current.dataset.indicatorPaneCount = String(paneCount)
      rootRef.current.dataset.indicatorPaneScaleCount = String(visiblePaneScaleCount)
      rootRef.current.dataset.indicatorSeriesCount = String(seriesRef.current.length)
      rootRef.current.dataset.rsiPaneHeight = paneCount ? String(RSI_PANE_HEIGHT) : '0'
    }
    return () => {
      const current = chartRef.current
      if (current) seriesRef.current.forEach((entry) => { try { current.removeSeries(entry.series) } catch { /* chart is already being disposed */ } })
      seriesRef.current = []
      if (current && rootRef.current) {
        const panes = current.panes()
        rootRef.current.dataset.indicatorPaneCount = String(Math.max(0, panes.length - 1))
        rootRef.current.dataset.indicatorPaneScaleCount = String(panes.slice(1).filter((_, index) => current.priceScale('right', index + 1).options().visible).length)
        rootRef.current.dataset.indicatorSeriesCount = '0'
      }
    }
  }, [indicators, indicatorSettings, data])

  useEffect(() => {
    if (!data.length || !lastBar || seriesRef.current.length === 0) return
    const bars = getIndicatorBars(historyRef.current, lastBar, volumeDataRef.current)
    const calculatedById = new Map<IndicatorId, ReturnType<typeof calculateIndicatorSeries>>()
    for (const entry of seriesRef.current) {
      let calculated = calculatedById.get(entry.id)
      if (!calculated) {
        const definition = indicatorDefinition(entry.id)
        const period = indicatorSettings[entry.id]?.period ?? definition?.defaultPeriod ?? 14
        calculated = calculateIndicatorSeries(entry.id, bars, period)
        calculatedById.set(entry.id, calculated)
      }
      const values = calculated.find(item => item.key === entry.key)?.values ?? []
      const points = bars.flatMap((bar, index) => {
        const value = values[index]
        return value != null && Number.isFinite(value) ? [{ time: bar.time as UTCTimestamp, value }] : []
      })
      entry.series.setData(entry.id === 'VWAP' ? vwapPresentation(points) : points)
    }
  }, [data, lastBar, indicators, indicatorSettings])

  useEffect(() => {
    const entries = seriesRef.current.filter((entry) => entry.id === 'VWAP')
    if (!data.length || !entries.length) return
    const bars = getIndicatorBars(historyRef.current, lastBar, volumeDataRef.current)
    const values = calculateIndicatorSeries('VWAP', bars)[0].values
    const points = bars.flatMap((bar, index) => values[index] === null ? [] : [{ time: bar.time as UTCTimestamp, value: values[index]! }])
    entries.forEach((entry) => entry.series.setData(vwapPresentation(points)))
  }, [volumeData])
}
