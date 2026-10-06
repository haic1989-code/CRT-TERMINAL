import type { UTCTimestamp } from 'lightweight-charts'

export type ChartDrawingPoint = { time: UTCTimestamp; price: number }
export type ChartAnnotationKind = 'vertical' | 'horizontal' | 'trend' | 'ray' | 'rectangle' | 'channel' | 'measure' | 'fib' | 'text'
export type ChartAnnotation = { id: string; kind: ChartAnnotationKind; points: ChartDrawingPoint[]; label?: string }
export type ChartDrawingStore = Record<string, ChartAnnotation[]>

export const DRAWING_POINT_COUNTS: Record<ChartAnnotationKind, number> = {
  vertical: 1,
  horizontal: 1,
  trend: 2,
  ray: 2,
  rectangle: 2,
  channel: 3,
  measure: 2,
  fib: 2,
  text: 1,
}
