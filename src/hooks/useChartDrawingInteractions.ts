import { useEffect, useRef, useState, type MutableRefObject, type PointerEvent as ReactPointerEvent } from 'react'
import type { CandlestickData, IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts'
import { drawingTimeAtLogical } from '../domain/drawingGeometry'
import { DRAWING_POINT_COUNTS, type ChartAnnotation, type ChartAnnotationKind, type ChartDrawingPoint } from '../domain/chartDrawings'
import type { ChartTimeframe } from '../MarketChart'

type DrawingRequest = { tool: string; label?: string; nonce: number } | null | undefined
type PointGesture = { pointerId: number; x: number; y: number; dragged: boolean }
type UseChartDrawingInteractionsOptions = {
  rootRef: MutableRefObject<HTMLDivElement | null>
  chartRef: MutableRefObject<IChartApi | null>
  candlesRef: MutableRefObject<ISeriesApi<'Candlestick'> | null>
  data: CandlestickData<UTCTimestamp>[]
  timeframe: ChartTimeframe
  drawingRequest: DrawingRequest
  drawingKind: ChartAnnotationKind | null
  setAnnotations: (update: (current: ChartAnnotation[]) => ChartAnnotation[]) => void
  onDrawingComplete?: (reason: 'saved' | 'tools') => void
}

export function useChartDrawingInteractions({
  rootRef,
  chartRef,
  candlesRef,
  data,
  timeframe,
  drawingRequest,
  drawingKind,
  setAnnotations,
  onDrawingComplete,
}: UseChartDrawingInteractionsOptions) {
  const [drawingRevision, setDrawingRevision] = useState(0)
  const [drawingAnchors, setDrawingAnchors] = useState<ChartDrawingPoint[]>([])
  const [drawingCursor, setDrawingCursor] = useState<ChartDrawingPoint | null>(null)
  const drawingSequenceRef = useRef<ChartDrawingPoint[]>([])
  const drawingGestureRef = useRef<PointGesture | null>(null)
  const drawingActiveRef = useRef(false)
  const drawingMoveFrameRef = useRef<number | null>(null)

  const invalidateDrawing = () => setDrawingRevision(revision => revision + 1)

  const syncDrawingCoordinates = () => {
    if (drawingMoveFrameRef.current !== null) return
    drawingMoveFrameRef.current = window.requestAnimationFrame(() => {
      drawingMoveFrameRef.current = null
      invalidateDrawing()
    })
  }

  const resetDrawing = () => {
    drawingGestureRef.current = null
    drawingSequenceRef.current = []
    setDrawingAnchors([])
    setDrawingCursor(null)
  }

  useEffect(() => () => {
    if (drawingMoveFrameRef.current !== null) window.cancelAnimationFrame(drawingMoveFrameRef.current)
  }, [])

  const readDrawingPoint = (clientX: number, clientY: number): ChartDrawingPoint | null => {
    const root = rootRef.current
    const candles = candlesRef.current
    const chart = chartRef.current
    if (!root || !chart || !candles || !data.length) return null
    const rect = root.getBoundingClientRect()
    const x = clientX - rect.left
    const y = clientY - rect.top
    const plotHeight = chart.panes()[0]?.getHeight() ?? rect.height
    if (x < 0 || x > chart.timeScale().width() || y < 0 || y > plotHeight) return null
    const price = candles.coordinateToPrice(y)
    const logical = chart.timeScale().coordinateToLogical(x)
    const directTime = chart.timeScale().coordinateToTime(x)
    const timeframeSeconds = ({ M1: 60, M5: 300, M15: 900, M30: 1800, H1: 3600, H4: 14400, D1: 86400 })[timeframe]
    const time = directTime ?? (logical === null ? null : drawingTimeAtLogical(Number(logical), data, timeframeSeconds))
    return price === null || time === null || !Number.isFinite(price) ? null : { time: time as UTCTimestamp, price }
  }

  const addDrawingPoint = (point: ChartDrawingPoint) => {
    if (!drawingKind) return
    const previous = drawingSequenceRef.current.at(-1)
    if (previous && previous.time === point.time && Math.abs(previous.price - point.price) < 1e-9) return
    const points = [...drawingSequenceRef.current, point]
    const required = DRAWING_POINT_COUNTS[drawingKind]
    if (points.length < required) {
      drawingSequenceRef.current = points
      setDrawingAnchors(points)
      setDrawingCursor(point)
      return
    }
    setAnnotations(current => [...current, {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      kind: drawingKind,
      points,
      label: drawingKind === 'text' ? drawingRequest?.label?.trim() : undefined,
    }])
    drawingSequenceRef.current = []
    setDrawingAnchors([])
    setDrawingCursor(null)
    drawingGestureRef.current = null
    onDrawingComplete?.('saved')
  }

  const handleDrawingMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    syncDrawingCoordinates()
    if (!drawingRequest) return
    event.stopPropagation()
    setDrawingCursor(readDrawingPoint(event.clientX, event.clientY))
    const gesture = drawingGestureRef.current
    if (gesture && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) >= 5) gesture.dragged = true
  }

  const handleDrawingUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drawingRequest) return
    event.stopPropagation()
    const gesture = drawingGestureRef.current
    drawingGestureRef.current = null
    if (!gesture || gesture.pointerId !== event.pointerId || !gesture.dragged) return
    const point = readDrawingPoint(event.clientX, event.clientY)
    if (point) addDrawingPoint(point)
  }

  const handleDrawingDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drawingRequest) return false
    event.preventDefault()
    event.stopPropagation()
    if (drawingRequest.tool === 'erase' || drawingRequest.tool === 'clear') return true
    const point = readDrawingPoint(event.clientX, event.clientY)
    if (!point || !drawingKind) return true
    const isFirstPoint = drawingSequenceRef.current.length === 0
    addDrawingPoint(point)
    if (isFirstPoint && DRAWING_POINT_COUNTS[drawingKind] === 2) {
      drawingGestureRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, dragged: false }
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    return true
  }

  const handleDrawingCancel = () => {
    drawingGestureRef.current = null
    drawingSequenceRef.current = []
    setDrawingAnchors([])
    setDrawingCursor(null)
  }

  return {
    drawingRevision,
    drawingAnchors,
    drawingCursor,
    drawingSequenceRef,
    drawingGestureRef,
    drawingActiveRef,
    syncDrawingCoordinates,
    invalidateDrawing,
    resetDrawing,
    handleDrawingMove,
    handleDrawingUp,
    handleDrawingDown,
    handleDrawingCancel,
  }
}
