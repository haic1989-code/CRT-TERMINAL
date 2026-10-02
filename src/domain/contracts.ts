export type TradeSide = 'long' | 'short'

export type MarketBar = {
  time: number
  open: number
  high: number
  low: number
  close: number
  tickVolume?: number
  realVolume?: number
}

export type SymbolSpec = {
  symbol: string
  digits: number
  tickSize: number
  tickValue: number
  tickValueProfit?: number
  tickValueLoss?: number
  volumeMin: number
  volumeMax: number
  volumeStep: number
  contractSize?: number
  currencyBase?: string
  currencyProfit?: string
  currencyMargin?: string
  tradeMode?: number
}

export type AccountSnapshot = {
  currency: string
  balance: number
  equity: number
  margin: number
  freeMargin: number
  marginLevel: number | null
  floatingPnl: number
  dayPnl?: number
  tradeAllowed: boolean
  observedAt: number
}

export type Position = {
  id: number
  symbol: string
  side: TradeSide
  volume: number
  openPrice: number
  stopLoss: number
  takeProfit: number
  profit: number
  swap: number
  commission: number
  openedAt: number
}

export type PendingOrder = {
  id: number
  symbol: string
  side: TradeSide
  kind: 'limit' | 'stop' | 'stop_limit'
  volume: number
  price: number
  stopLoss: number
  takeProfit: number
  currentPrice: number
  createdAt: number
}

export type BreakEvenMode = 'manual' | 'off' | 'after_tp1' | 'after_tp2' | 'after_tp3'

export type EmergencyCloseRequest = {
  positionIds: number[]
  pendingOrderIds: number[]
  requestedAt: number
  mode: 'confirm_only' | 'execute'
}

export type TradePlan = {
  symbol: string
  side: TradeSide
  entry: number
  stopLoss: number
  takeProfits: number[]
  volume: number
  riskPercent: number
  takeProfitAllocations?: number[]
  breakEvenMode?: BreakEvenMode
  breakEvenPrice?: number
  commissionPerLot?: number
}

export type PriceLevel = { price: number; kind: 'support' | 'resistance'; time: number }

export type ProfileBin = { price: number; tpo: number }
export type MarketProfile = {
  bins: ProfileBin[]
  poc: number
  vah: number
  val: number
  totalTpo: number
  source: 'bar_range_tpo'
}

export type AlertRule = {
  id: string
  symbol: string
  level: number
  condition: 'above' | 'below' | 'cross'
  enabled: boolean
  lastSide?: 'above' | 'below'
}

export type AlertEvent = { ruleId: string; symbol: string; price: number; firedAt: number }

export type MarketContextSnapshot = {
  capturedAt: number
  symbol: string
  timeframe: string
  quote: { price: number | null; bid: number | null; ask: number | null; observedAt: number | null; status: string }
  mtf: Record<string, 'bullish' | 'bearish' | 'neutral' | 'unavailable'>
  currencyStrength: Record<string, number>
  sessions: Array<{ id: string; open: boolean; localTime: string }>
  keyLevels: PriceLevel[]
  marketProfile: Pick<MarketProfile, 'poc' | 'vah' | 'val' | 'source'> | null
  portfolioRisk: { usedRiskCash: number; usedRiskPercent: number; incompleteStops: number; openPositions: number; pendingOrders: number; floatingPnl: number }
  riskGuard: { allowed: boolean; state: 'SAFE' | 'WARNING' | 'BLOCKED'; reasons: string[]; warnings: string[] }
  planner: TradePlan | null
}
