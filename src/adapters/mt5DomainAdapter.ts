import type { AccountSnapshot, PendingOrder, Position, SymbolSpec } from '../domain/contracts'
import type { Mt5Account, Mt5Order, Mt5Position, Mt5SymbolInfo } from '../mt5Client'

/** Translate transport payloads once at the bridge boundary. Engines only receive SmartFlow domain values. */
export function mt5AccountToDomain(account: Mt5Account | null | undefined): AccountSnapshot {
  return {
    currency: account?.currency ?? 'USD',
    balance: account?.balance ?? 0,
    equity: account?.equity ?? 0,
    margin: account?.margin ?? 0,
    freeMargin: account?.margin_free ?? 0,
    marginLevel: account?.margin_level ?? null,
    floatingPnl: account?.profit ?? 0,
    dayPnl: account?.day_pnl ?? 0,
    tradeAllowed: account?.trade_allowed ?? false,
    observedAt: account?.observed_at ?? 0,
  }
}

export function mt5PositionToDomain(position: Mt5Position): Position {
  return {
    id: position.ticket,
    symbol: position.symbol,
    side: position.type === 'buy' ? 'long' : 'short',
    volume: position.volume,
    openPrice: position.price_open,
    stopLoss: position.sl,
    takeProfit: position.tp,
    profit: position.profit,
    swap: position.swap,
    commission: position.commission,
    openedAt: position.time,
  }
}

function orderTypeCode(type: string): string {
  return type.trim().toLowerCase().replace(/^order_type_/, '')
}

export function mt5OrderToDomain(order: Mt5Order): PendingOrder {
  const type = orderTypeCode(order.type)
  const isBuy = ['2', '4', '6', 'buy_limit', 'buy_stop', 'buy_stop_limit'].includes(type)
  const kind: PendingOrder['kind'] = ['2', '3', 'buy_limit', 'sell_limit'].includes(type)
    ? 'limit'
    : ['6', '7', 'buy_stop_limit', 'sell_stop_limit'].includes(type)
      ? 'stop_limit'
      : 'stop'
  return {
    id: order.ticket,
    symbol: order.symbol,
    side: isBuy ? 'long' : 'short',
    kind,
    volume: order.volume_initial,
    price: order.price_open,
    stopLoss: order.sl,
    takeProfit: order.tp,
    currentPrice: order.price_current,
    createdAt: order.time_setup,
  }
}

export function mt5SymbolToDomain(info: Mt5SymbolInfo): SymbolSpec {
  return {
    symbol: info.symbol,
    digits: info.digits,
    tickSize: info.trade_tick_size,
    tickValue: info.trade_tick_value,
    tickValueProfit: info.trade_tick_value_profit,
    tickValueLoss: info.trade_tick_value_loss,
    volumeMin: info.volume_min,
    volumeMax: info.volume_max,
    volumeStep: info.volume_step,
    contractSize: info.trade_contract_size,
    currencyBase: info.currency_base,
    currencyProfit: info.currency_profit,
    currencyMargin: info.currency_margin,
    tradeMode: info.trade_mode,
  }
}
