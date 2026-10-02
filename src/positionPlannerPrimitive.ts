import type { Logical } from 'lightweight-charts'

export type PlannerPrimitiveSide = 'long' | 'short'
export type PlannerPrimitiveHit = 'body' | 'tp' | 'entry' | 'sl' | 'resize-left' | 'resize-right'

/** Interpolate chart logical coordinates so the planner remains smooth while dragging. */
export function plannerLogicalToCoordinate(scale: { logicalToCoordinate: (value: Logical) => number | null }, logical: number): number | null {
  if (!Number.isFinite(logical)) return null
  const index = Math.floor(logical)
  const start = scale.logicalToCoordinate(index as Logical)
  const end = scale.logicalToCoordinate((index + 1) as Logical)
  return start === null || end === null ? null : start + (end - start) * (logical - index)
}

export type PlannerPrimitiveState = {
  side: PlannerPrimitiveSide
  tp: number
  entry: number
  sl: number
  startLogical: number
  endLogical: number
  labelOpacity?: number
  rewardFill?: number
  riskFill?: number
  rewardBorder?: number
  riskBorder?: number
  digits?: number
  fullTpProfitLabel?: string
  fullSlLossLabel?: string
}

type Geometry = {
  left: number; right: number; top: number; bottom: number
  tpY: number; entryY: number; slY: number
  rewardTop: number; rewardBottom: number; riskTop: number; riskBottom: number
}

const COLORS = {
  profit: [49, 232, 219] as const,
  entry: [255, 210, 119] as const,
  risk: [255, 98, 137] as const,
}

function rgba(color: readonly [number, number, number], alpha: number) {
  return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`
}

export function plannerHitPart(g: Geometry, x: number, y: number, _showTp1 = true): PlannerPrimitiveHit | null {
  if (x < g.left - 10 || x > g.right + 10 || y < g.top - 24 || y > g.bottom + 24) return null
  const levels = ([['tp', g.tpY] as const, ['entry', g.entryY] as const, ['sl', g.slY] as const])
    .map(([part, levelY]) => ({ part, distance: Math.abs(y - levelY) }))
    .sort((a, b) => a.distance - b.distance)
  if (levels[0]?.distance <= 9) return levels[0].part
  if (Math.abs(x - (g.left + g.right) / 2) <= 110) {
    const labels = [
      { part: 'tp' as const, y: g.tpY - 13 },
      { part: 'entry' as const, y: g.entryY + 13 },
      { part: 'sl' as const, y: g.slY + 13 },
    ]
    const label = labels.map(item => ({ ...item, distance: Math.abs(y - item.y) })).sort((a, b) => a.distance - b.distance)[0]
    if (label.distance <= 10) return label.part
  }
  // The invisible space between levels remains a convenient whole-plan drag area.
  return x >= g.left && x <= g.right && y >= g.top && y <= g.bottom ? 'body' : null
}

class PlannerRenderer {
  constructor(private readonly source: PositionPlannerPrimitive) {}

  draw(target: any) {
    const geometry = this.source.geometry()
    const state = this.source.state()
    if (!geometry || !state) return
    target.useBitmapCoordinateSpace((scope: any) => {
      const ctx = scope.context
      const hx = scope.horizontalPixelRatio
      const vy = scope.verticalPixelRatio
      const px = (value: number) => Math.round(value * hx)
      const py = (value: number) => Math.round(value * vy)
      const lw = Math.max(1, Math.round(Math.min(hx, vy)))
      const left = px(geometry.left)
      const right = px(geometry.right)
      const opacity = state.labelOpacity ?? 0.95

      const drawLevel = (yCss: number, color: readonly [number, number, number], label: string, value: number, labelAbove = false, extra = '') => {
        const y = py(yCss)
        ctx.save()
        ctx.strokeStyle = rgba(color, 0.9)
        ctx.lineWidth = lw
        ctx.beginPath()
        ctx.moveTo(left, y + 0.5 * lw)
        ctx.lineTo(right, y + 0.5 * lw)
        ctx.stroke()

        const text = `> ${label} · ${value.toFixed(state.digits ?? 2)}${extra ? ` · ${extra}` : ''}`
        ctx.font = `600 ${Math.max(10, Math.round(11 * vy))}px "Cascadia Code", Consolas, monospace`
        ctx.textAlign = 'center'
        ctx.textBaseline = labelAbove ? 'bottom' : 'top'
        ctx.shadowColor = '#04111f'
        ctx.shadowBlur = py(3)
        const labelY = y + py(labelAbove ? -6 : 6)
        const textWidth = ctx.measureText(text).width
        ctx.fillStyle = 'rgba(4, 13, 24, 0.94)'
        ctx.fillRect((left + right - textWidth) / 2 - px(5), labelY - py(labelAbove ? 15 : 2), textWidth + px(10), py(17))
        ctx.fillStyle = rgba(color, opacity)
        ctx.fillText(text, (left + right) / 2, labelY)
        ctx.restore()
      }

      // Only the three MT5-style levels are drawn; no planner box, shaded table or resize rails.
      drawLevel(geometry.tpY, COLORS.profit, 'FULL TP', state.tp, true, state.fullTpProfitLabel)
      drawLevel(geometry.entryY, COLORS.entry, 'ENTRY', state.entry)
      drawLevel(geometry.slY, COLORS.risk, 'SL', state.sl, false, state.fullSlLossLabel)
    })
  }
}

class PlannerPaneView {
  private readonly rendererInstance: PlannerRenderer
  constructor(source: PositionPlannerPrimitive) { this.rendererInstance = new PlannerRenderer(source) }
  renderer() { return this.rendererInstance }
  zOrder() { return 'top' as const }
}

export class PositionPlannerPrimitive {
  private attachedParams: any = null
  private currentState: PlannerPrimitiveState | null = null
  private readonly views: PlannerPaneView[]

  constructor() { this.views = [new PlannerPaneView(this)] }
  attached(param: any) { this.attachedParams = param; param.requestUpdate() }
  detached() { this.attachedParams = null }
  paneViews() { return this.views }
  updateAllViews() { /* geometry is read directly from the chart when painted */ }
  setState(state: PlannerPrimitiveState | null) {
    const current = this.currentState
    if (current === null && state === null) return
    if (current && state) {
      const keys = Object.keys(state) as Array<keyof PlannerPrimitiveState>
      if (keys.length === Object.keys(current).length && keys.every((key) => Object.is(current[key], state[key]))) return
    }
    this.currentState = state ? { ...state } : null
    this.attachedParams?.requestUpdate()
  }
  state() { return this.currentState }

  geometry(): Geometry | null {
    const params = this.attachedParams
    const state = this.currentState
    if (!params || !state) return null
    const timeScale = params.chart.timeScale()
    const x1 = plannerLogicalToCoordinate(timeScale, state.startLogical)
    const x2 = plannerLogicalToCoordinate(timeScale, state.endLogical)
    const tpY = params.series.priceToCoordinate(state.tp)
    const entryY = params.series.priceToCoordinate(state.entry)
    const slY = params.series.priceToCoordinate(state.sl)
    if (x1 === null || x2 === null || tpY === null || entryY === null || slY === null) return null
    return {
      left: Math.min(x1, x2), right: Math.max(x1, x2),
      top: Math.min(tpY, entryY, slY), bottom: Math.max(tpY, entryY, slY),
      tpY, entryY, slY,
      rewardTop: Math.min(tpY, entryY), rewardBottom: Math.max(tpY, entryY),
      riskTop: Math.min(entryY, slY), riskBottom: Math.max(entryY, slY),
    }
  }

  hitPart(x: number, y: number): PlannerPrimitiveHit | null {
    const g = this.geometry()
    return g ? plannerHitPart(g, x, y) : null
  }

  hitTest(x: number, y: number) {
    const part = this.hitPart(x, y)
    if (!part) return null
    return {
      externalId: `smartflow-planner:${part}`,
      zOrder: 'top' as const,
      cursorStyle: part === 'body' ? 'move' : part.startsWith('resize-') ? 'ew-resize' : 'ns-resize',
    }
  }
}
