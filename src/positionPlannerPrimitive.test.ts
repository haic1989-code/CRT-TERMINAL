import { describe, expect, it } from 'vitest'
import { plannerHitPart, plannerLogicalToCoordinate, PositionPlannerPrimitive } from './positionPlannerPrimitive'

const g = {left: 100, right: 400, top: 100, bottom: 400, tpY: 100, entryY: 300, slY: 400, rewardTop: 100, rewardBottom: 300, riskTop: 300, riskBottom: 400}
describe('planner gesture selection', () => {
  it('keeps TP, entry and SL editable at both border anchors', () => {
    for (const x of [100, 400]) {
      expect(plannerHitPart(g, x, 100)).toBe('tp')
      expect(plannerHitPart(g, x, 300)).toBe('entry')
      expect(plannerHitPart(g, x, 400)).toBe('sl')
    }
  })
  it('keeps the chart free of width handles while allowing whole-plan movement', () => {
    expect(plannerHitPart(g, 100, 200)).toBe('body')
    expect(plannerHitPart(g, 400, 200)).toBe('body')
    expect(plannerHitPart(g, 105, 250)).toBe('body')
    expect(plannerHitPart(g, 200, 200)).toBe('body')
    expect(plannerHitPart(g, 80, 200)).toBeNull()
  })
  it('allows dragging centered terminal captions above TP and below Entry and SL', () => {
    expect(plannerHitPart(g, 250, 80)).toBe('tp')
    expect(plannerHitPart(g, 250, 320)).toBe('entry')
    expect(plannerHitPart(g, 250, 420)).toBe('sl')
    expect(plannerHitPart(g, 110, 420)).toBeNull()
  })
  it('chooses the nearest level when tight plans have overlapping hit areas', () => {
    expect(plannerHitPart({...g, entryY: 112}, 160, 111)).toBe('entry')
  })
  it('keeps the full-position TP editable when optional TP1 is disabled', () => {
    expect(plannerHitPart(g, 150, 100, false)).toBe('tp')
  })
})

it('projects fractional planner anchors smoothly through the integer-only chart API', () => {
  const scale = {logicalToCoordinate: (index: number) => Number.isInteger(index) ? 20 + index*5 : 0}
  expect(plannerLogicalToCoordinate(scale, 10.25)).toBe(71.25)
  expect(plannerLogicalToCoordinate(scale, 10)).toBe(70)
  expect(plannerLogicalToCoordinate(scale, NaN)).toBeNull()
})

it('does not invalidate the canvas when the planner label state has not changed', () => {
  const primitive = new PositionPlannerPrimitive()
  let updates = 0
  primitive.attached({ requestUpdate: () => { updates += 1 } })
  const state = { side: 'long' as const, tp: 110, entry: 100, sl: 95, startLogical: 1, endLogical: 5, fullTpProfitLabel: '+20 USD', fullSlLossLabel: '−10 USD' }
  primitive.setState(state)
  const afterFirstState = updates
  primitive.setState({ ...state })
  expect(updates).toBe(afterFirstState)
  primitive.setState({ ...state, fullTpProfitLabel: '+21 USD' })
  expect(updates).toBe(afterFirstState + 1)
  const afterProfitUpdate = updates
  primitive.setState({ ...state, fullSlLossLabel: '−11 USD' })
  expect(updates).toBe(afterProfitUpdate + 1)
})
