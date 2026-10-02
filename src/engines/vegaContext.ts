import type { MarketContextSnapshot, TradeSide } from '../domain/contracts'

export type VegaContextAnalysis = {
  bias: 'BULLISH' | 'BEARISH' | 'MIXED' | 'UNAVAILABLE'
  summary: string
  observations: string[]
  proposalSide: TradeSide | null
}


export type VegaTradeProposal = {
  symbol: string
  timeframe: string
  side: TradeSide
  entry: number
  stopLoss: number
  takeProfit: number
  support: number | null
  resistance: number | null
  stopReference: number
  targetReference: number | null
  targetMethod: 'KEY LEVEL' | '2R FALLBACK'
  rewardRisk: number
  riskAllowed: boolean
  riskVetoes: string[]
  createdAt: number
}

/** Deterministic, read-only analysis over the SmartFlow context snapshot. */
export const VegaContextAdvisor = {
  analyze(snapshot: MarketContextSnapshot): VegaContextAnalysis {
    const directions = Object.values(snapshot.mtf).filter((direction) => direction === 'bullish' || direction === 'bearish')
    const bullish = directions.filter((direction) => direction === 'bullish').length
    const bearish = directions.length - bullish
    const bias: VegaContextAnalysis['bias'] = directions.length === 0
      ? 'UNAVAILABLE'
      : bullish > bearish ? 'BULLISH' : bearish > bullish ? 'BEARISH' : 'MIXED'
    const freshQuote = snapshot.quote.status === 'live' && snapshot.quote.price !== null && snapshot.quote.price > 0
    const proposalSide = freshQuote && (bias === 'BULLISH' || bias === 'BEARISH') ? bias === 'BULLISH' ? 'long' : 'short' : null
    const observations: string[] = []
    if (directions.length) observations.push(`MTF: ${bullish} byczych, ${bearish} niedźwiedzich z ${directions.length} dostępnych interwałów.`)
    else observations.push('MTF: brak wystarczającej historii do potwierdzenia kierunku.')

    const price = snapshot.quote.price
    if (price !== null) {
      const supports = snapshot.keyLevels.filter((level) => level.kind === 'support' && level.price <= price).sort((a, b) => b.price - a.price)
      const resistances = snapshot.keyLevels.filter((level) => level.kind === 'resistance' && level.price >= price).sort((a, b) => a.price - b.price)
      if (supports[0]) observations.push(`Najbliższe potwierdzone wsparcie: ${supports[0].price}.`)
      if (resistances[0]) observations.push(`Najbliższy potwierdzony opór: ${resistances[0].price}.`)
    }

    const activeSessions = snapshot.sessions.filter((session) => session.open)
    observations.push(activeSessions.length
      ? `Aktywne sesje: ${activeSessions.map((session) => `${session.id} ${session.localTime}`).join(', ')}.`
      : 'Sesje Tokyo, London i New York są obecnie poza godzinami otwarcia.')

    const strongest = Object.entries(snapshot.currencyStrength).sort((a, b) => b[1] - a[1])[0]
    const weakest = Object.entries(snapshot.currencyStrength).sort((a, b) => a[1] - b[1])[0]
    if (strongest && weakest) observations.push(`FX strength H1: ${strongest[0]} najsilniejsza (${strongest[1].toFixed(2)}%), ${weakest[0]} najsłabsza (${weakest[1].toFixed(2)}%).`)
    if (snapshot.marketProfile) observations.push(`Market Profile TPO: POC ${snapshot.marketProfile.poc}, VAH ${snapshot.marketProfile.vah}, VAL ${snapshot.marketProfile.val}.`)
    observations.push(`Ryzyko portfela: ${snapshot.portfolioRisk.usedRiskPercent.toFixed(2)}% · ${snapshot.portfolioRisk.openPositions} pozycji · ${snapshot.portfolioRisk.pendingOrders} zleceń oczekujących.`)
    if (snapshot.portfolioRisk.incompleteStops) observations.push(`Risk Guard widzi ${snapshot.portfolioRisk.incompleteStops} ekspozycje bez kompletnego wyliczenia ryzyka.`)
    observations.push(`Risk Guard: ${snapshot.riskGuard.state}.`)
    if (!snapshot.riskGuard.allowed) observations.push(`RISK GUARD VETO: ${snapshot.riskGuard.reasons.join(' ')}`)
    else if (snapshot.riskGuard.warnings.length) observations.push(`RISK GUARD SOFT WARNING: ${snapshot.riskGuard.warnings.join(' ')}`)

    const summary = !freshQuote
      ? `Brak świeżej ceny dla ${snapshot.symbol}; nie tworzę kierunkowej propozycji.`
      : bias === 'BULLISH'
        ? `${snapshot.symbol}: przewaga byczego kierunku MTF (${bullish}/${directions.length}). To kontekst do weryfikacji, nie sygnał transakcyjny.`
        : bias === 'BEARISH'
          ? `${snapshot.symbol}: przewaga niedźwiedziego kierunku MTF (${bearish}/${directions.length}). To kontekst do weryfikacji, nie sygnał transakcyjny.`
          : bias === 'MIXED'
            ? `${snapshot.symbol}: interwały MTF są podzielone; poczekaj na czytelniejszy układ.`
            : `${snapshot.symbol}: brak wystarczających danych kontekstowych do oceny kierunku.`
    return { bias, summary, observations, proposalSide }
  },
  propose(snapshot: MarketContextSnapshot, requestedTickSize = 0.01): VegaTradeProposal | null {
    const analysis = this.analyze(snapshot)
    const side = analysis.proposalSide
    const mid = snapshot.quote.price
    if (!side || mid === null || !(mid > 0)) return null
    const tick = Number.isFinite(requestedTickSize) && requestedTickSize > 0 ? requestedTickSize : 0.01
    const round = (price: number) => Number((Math.round(price / tick) * tick).toPrecision(12))
    const entry = round(side === 'long' ? (snapshot.quote.ask ?? mid) : (snapshot.quote.bid ?? mid))
    const supports = snapshot.keyLevels.filter(level => level.kind === 'support' && level.price < entry).map(level => level.price)
    const resistances = snapshot.keyLevels.filter(level => level.kind === 'resistance' && level.price > entry).map(level => level.price)
    const support = supports.length ? Math.max(...supports) : snapshot.marketProfile && snapshot.marketProfile.val < entry ? snapshot.marketProfile.val : null
    const resistance = resistances.length ? Math.min(...resistances) : snapshot.marketProfile && snapshot.marketProfile.vah > entry ? snapshot.marketProfile.vah : null
    const stopReference = side === 'long' ? support : resistance
    if (stopReference === null) return null
    const buffer = Math.max(tick * 2, entry * 0.00015)
    const stopLoss = round(side === 'long' ? stopReference - buffer : stopReference + buffer)
    const risk = Math.abs(entry - stopLoss)
    if (!(risk > 0) || (side === 'long' ? stopLoss >= entry : stopLoss <= entry)) return null
    const structuralTarget = side === 'long' ? resistance : support
    const structuralRewardRisk = structuralTarget === null ? 0 : Math.abs(structuralTarget - entry) / risk
    // A nearby opposing level can make a structurally valid target a poor trade.
    // In that case keep the support/resistance as context and use the explicit 2R fallback.
    const targetReference = structuralRewardRisk >= 1.5 ? structuralTarget : null
    const targetMethod = targetReference !== null ? 'KEY LEVEL' as const : '2R FALLBACK' as const
    const takeProfit = round(targetReference !== null
      ? targetReference
      : side === 'long' ? entry + 2 * risk : entry - 2 * risk)
    if (!(side === 'long' ? takeProfit > entry : takeProfit < entry)) return null
    return {
      symbol: snapshot.symbol, timeframe: snapshot.timeframe, side, entry, stopLoss, takeProfit,
      support, resistance, stopReference, targetReference, targetMethod,
      rewardRisk: Math.abs(takeProfit - entry) / risk,
      riskAllowed: snapshot.riskGuard.allowed, riskVetoes: [...snapshot.riskGuard.reasons], createdAt: snapshot.capturedAt,
    }
  },
}
