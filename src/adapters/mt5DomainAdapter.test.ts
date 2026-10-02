import { describe, expect, it } from 'vitest'
import type { Mt5Account, Mt5Order, Mt5Position, Mt5SymbolInfo } from '../mt5Client'
import { mt5AccountToDomain, mt5OrderToDomain, mt5PositionToDomain, mt5SymbolToDomain } from './mt5DomainAdapter'

describe('MT5 domain adapter', () => {
  it('fails closed when the bridge account snapshot is missing', () => {
    expect(mt5AccountToDomain(null)).toMatchObject({ tradeAllowed: false, observedAt: 0, equity: 0 })
  })

  it('maps broker positions into the SmartFlow position contract', () => {
    const raw: Mt5Position = { ticket: 41, symbol: 'XAUUSD.a', type: 'sell', volume: 0.2, price_open: 2310, sl: 2320, tp: 2280, profit: 5, swap: -1, commission: -0.4, time: 100 }
    expect(mt5PositionToDomain(raw)).toEqual({ id: 41, symbol: 'XAUUSD.a', side: 'short', volume: 0.2, openPrice: 2310, stopLoss: 2320, takeProfit: 2280, profit: 5, swap: -1, commission: -0.4, openedAt: 100 })
  })

  it.each([
    ['2', 'long', 'limit'], ['3', 'short', 'limit'], ['4', 'long', 'stop'],
    ['5', 'short', 'stop'], ['6', 'long', 'stop_limit'], ['7', 'short', 'stop_limit'],
    ['ORDER_TYPE_BUY_STOP_LIMIT', 'long', 'stop_limit'], ['ORDER_TYPE_SELL_LIMIT', 'short', 'limit'],
  ] as const)('normalizes pending order type %s', (type, side, kind) => {
    const raw: Mt5Order = { ticket: 9, symbol: 'BTCUSD', type, volume_initial: 0.1, price_open: 50000, sl: 49000, tp: 52000, price_current: 50100, time_setup: 1 }
    expect(mt5OrderToDomain(raw)).toMatchObject({ id: 9, side, kind, volume: 0.1, price: 50000, stopLoss: 49000, takeProfit: 52000 })
  })

  it('keeps broker sizing and tick-value metadata behind a domain symbol spec', () => {
    const raw: Mt5SymbolInfo = { symbol: 'DJ30.cash', description: 'Dow Jones', path: 'Indices', digits: 1, point: 0.1, spread: 4, trade_tick_size: 0.1, trade_tick_value: 0.25, trade_tick_value_profit: 0.25, trade_tick_value_loss: 0.24, trade_contract_size: 1, volume_min: 0.1, volume_max: 100, volume_step: 0.1, currency_base: 'USD', currency_profit: 'USD', currency_margin: 'USD', trade_mode: 4, visible: true }
    expect(mt5SymbolToDomain(raw)).toMatchObject({ symbol: 'DJ30.cash', tickSize: 0.1, tickValueLoss: 0.24, volumeMin: 0.1, volumeStep: 0.1, tradeMode: 4 })
  })

  it('maps the account transport fields to the account snapshot contract', () => {
    const raw: Mt5Account = { login: 1, server: 'demo', name: 'Trader', company: 'Broker', currency: 'USD', leverage: 100, balance: 1000, equity: 990, profit: -10, margin: 50, margin_free: 940, margin_level: 1980, trade_allowed: true, trade_expert: true, margin_mode: 0, day_pnl: -10, observed_at: 123 }
    expect(mt5AccountToDomain(raw)).toMatchObject({ balance: 1000, equity: 990, freeMargin: 940, floatingPnl: -10, dayPnl: -10, tradeAllowed: true, observedAt: 123 })
  })
})
