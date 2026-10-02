import { describe, expect, it } from 'vitest'
import { manualLotSizing } from './manualLotSizing'
import type { SymbolSpec } from './contracts'
const spec:SymbolSpec={symbol:'XAUUSD',digits:2,tickSize:.01,tickValue:1,volumeMin:.01,volumeMax:100,volumeStep:.01}
describe('manual planner volume',()=>{
  it('keeps chosen lots when the stop changes and recalculates cash risk',()=>{
    expect(manualLotSizing(.23,2000,1990,spec,1800)).toMatchObject({volume:.23,riskCash:230,marginEstimate:414})
    expect(manualLotSizing(.23,2000,1980,spec).riskCash).toBe(460)
  })
  it('never rounds a requested volume up to the broker minimum',()=>{
    expect(manualLotSizing(.01,2000,1990,{...spec,volumeMin:.1,volumeStep:.1}).volume).toBe(0)
    expect(manualLotSizing(.29,2000,1990,{...spec,volumeMin:.1,volumeStep:.1}).volume).toBe(.2)
  })
  it('rejects absent specifications, invalid stops and the UI limits',()=>{
    for(const volume of [NaN,0,1.01])expect(manualLotSizing(volume,2000,1990,spec).volume).toBe(0)
    expect(manualLotSizing(.2,2000,2000,spec).volume).toBe(0)
    expect(manualLotSizing(.2,2000,1990,{...spec,tickSize:0}).volume).toBe(0)
  })
})
