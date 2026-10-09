import { describe, expect, it } from 'vitest'
import { mergeMt5PositionsLive, type Mt5Position, type Mt5PositionLive } from './mt5Client'

const previous: Mt5Position[] = [{
  ticket: 7,
  symbol: 'XAUUSD',
  type: 'buy',
  volume: 0.1,
  price_open: 2300,
  sl: 2290,
  tp: 2320,
  profit: 1,
  swap: -0.1,
  commission: -0.25,
  time: 1000,
}]

describe('live position merge', () => {
  it('updates floating pnl immediately while preserving commission from the slower full snapshot', () => {
    const live: Mt5PositionLive[] = [{
      ticket: 7,
      symbol: 'XAUUSD',
      type: 'buy',
      volume: 0.1,
      price_open: 2300,
      sl: 2290,
      tp: 2320,
      profit: 4.75,
      swap: -0.12,
      time: 1000,
    }]
    expect(mergeMt5PositionsLive(previous, live)).toEqual([{ ...live[0], commission: -0.25 }])
  })

  it('treats the live snapshot as authoritative for opened and closed tickets', () => {
    const live: Mt5PositionLive[] = [{
      ticket: 8,
      symbol: 'XAUUSD',
      type: 'sell',
      volume: 0.05,
      price_open: 2310,
      sl: 2320,
      tp: 2290,
      profit: -2.5,
      swap: 0,
      time: 1100,
    }]
    expect(mergeMt5PositionsLive(previous, live)).toEqual([{ ...live[0], commission: 0 }])
    expect(mergeMt5PositionsLive(previous, [])).toEqual([])
  })
})
