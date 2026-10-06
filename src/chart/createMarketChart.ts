import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineStyle,
  createChart,
  type CandlestickData,
  type UTCTimestamp,
} from 'lightweight-charts'

type VolumeBar = { time: UTCTimestamp; value: number; color: string }

type CreateMarketChartOptions = {
  container: HTMLElement
  matrixTheme: boolean
  data: CandlestickData<UTCTimestamp>[]
  volumeData: VolumeBar[]
  volumeVisible: boolean
  priceFormatter: (price: number) => string
  precision: number
  minMove: number
  hasFreshTick: boolean
}

/** Creates the chart and its primary series with the terminal's established visual contract. */
export function createMarketChart({
  container,
  matrixTheme,
  data,
  volumeData,
  volumeVisible,
  priceFormatter,
  precision,
  minMove,
  hasFreshTick,
}: CreateMarketChartOptions) {
  const chart = createChart(container, {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: 'rgba(0, 0, 0, 0)' },
      textColor: 'rgba(247, 245, 255, 0.94)',
      attributionLogo: true,
      fontFamily: '"Cascadia Code", Consolas, monospace',
      fontSize: 11,
    },
    localization: {
      locale: 'pl-PL',
      dateFormat: 'dd.MM.yy',
      priceFormatter,
    },
    grid: {
      vertLines: { color: matrixTheme ? 'rgba(85, 240, 161, 0.055)' : 'rgba(164, 104, 255, 0.055)', style: LineStyle.Solid },
      horzLines: { color: matrixTheme ? 'rgba(85, 240, 161, 0.065)' : 'rgba(255, 82, 184, 0.065)', style: LineStyle.Solid },
    },
    rightPriceScale: {
      visible: true,
      borderVisible: !matrixTheme,
      borderColor: 'rgba(207, 170, 255, 0.22)',
      alignLabels: true,
      scaleMargins: { top: 0.09, bottom: 0.11 },
    },
    leftPriceScale: { visible: false },
    timeScale: {
      borderVisible: !matrixTheme,
      borderColor: 'rgba(207, 170, 255, 0.22)',
      timeVisible: true,
      secondsVisible: false,
      rightOffset: 5,
      barSpacing: 5.6,
      minBarSpacing: 1.7,
      maxBarSpacing: 22,
    },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: matrixTheme ? 'rgba(85, 240, 161, 0.44)' : 'rgba(203, 88, 255, 0.44)', width: 1, style: LineStyle.Dashed, labelBackgroundColor: matrixTheme ? '#0b2815' : '#24132f' },
      horzLine: { color: matrixTheme ? 'rgba(85, 240, 161, 0.42)' : 'rgba(255, 78, 169, 0.42)', width: 1, style: LineStyle.Dashed, labelBackgroundColor: matrixTheme ? '#0b2815' : '#2a1020' },
    },
    // Plain wheel scrolls history; Ctrl + wheel scales, matching MT5.
    handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    handleScale: { axisPressedMouseMove: true, mouseWheel: false, pinch: true },
  })

  const candles = chart.addSeries(CandlestickSeries, {
    upColor: matrixTheme ? '#55f0a1' : '#14dcff',
    downColor: matrixTheme ? '#ff6977' : '#ff3b9d',
    wickVisible: true,
    borderVisible: true,
    borderUpColor: matrixTheme ? '#a8ffd1' : '#54eeff',
    borderDownColor: matrixTheme ? '#ff8d96' : '#ff63b2',
    wickUpColor: matrixTheme ? 'rgba(85, 240, 161, 0.96)' : 'rgba(47, 227, 255, 0.96)',
    wickDownColor: matrixTheme ? 'rgba(255, 105, 119, 0.96)' : 'rgba(255, 74, 157, 0.96)',
    priceLineVisible: false,
    lastValueVisible: true,
    priceFormat: { type: 'price', precision, minMove },
  })
  candles.setData(data)
  if (hasFreshTick) window.dispatchEvent(new Event('crt:chart-ready'))

  const volumes = chart.addSeries(HistogramSeries, {
    priceScaleId: 'volume',
    priceFormat: { type: 'volume' },
    lastValueVisible: false,
    priceLineVisible: false,
  })
  volumes.setData(volumeData)
  volumes.applyOptions({ visible: volumeVisible })
  chart.priceScale('volume').applyOptions({ visible: false, scaleMargins: { top: 0.82, bottom: 0 } })

  return { chart, candles, volumes }
}
