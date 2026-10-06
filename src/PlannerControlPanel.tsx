import {
  clampLots,
  estimatePlannerOutcome,
  plannerMetrics,
  type PlannerAccountingValues,
  type PlannerSide,
  type PlannerState,
  type PlannerVolumeConstraints,
} from './domain/chartPlanner'

type PlannerControlPanelProps = {
  side: PlannerSide | null
  placingSide: PlannerSide | null
  planner: PlannerState | null
  symbol?: string
  currency: string
  equity?: number
  lots: number
  volumeStep: number
  accountingValues?: PlannerAccountingValues
  volumeConstraints?: PlannerVolumeConstraints
  formatPrice: (price: number) => string
  onLotsChange: (lots: number) => void
  onArm: (side: PlannerSide) => void
  onClear: () => void
}

export function PlannerControlPanel({
  side,
  placingSide,
  planner,
  symbol,
  currency,
  equity,
  lots,
  volumeStep,
  accountingValues,
  volumeConstraints,
  formatPrice,
  onLotsChange,
  onArm,
  onClear,
}: PlannerControlPanelProps) {
  const metrics = side && planner ? plannerMetrics(side, planner) : null
  const outcome = side && planner ? estimatePlannerOutcome(side, planner, lots, accountingValues) : null
  const status = placingSide ? 'WYBIERZ WEJŚCIE' : planner && side ? 'AKTYWNY' : 'GOTOWY'
  const riskPct = outcome && equity
    ? (outcome.slMoney / Math.max(equity, 0.01)) * 100
    : null

  return (
    <section className="planner-control-panel planner-control-panel--v2" data-planner-ui="true" aria-label="Planer pozycji">
      <div className="planner-control-panel__header planner-control-panel__header--v2">
        <div>
          <span className="planner-control-panel__eyebrow">SMARTFLOW · PLANER POZYCJI</span>
          <strong>PLANER POZYCJI</strong>
        </div>
        <span className={`planner-control-panel__status planner-control-panel__status--${placingSide ? 'placing' : planner ? 'active' : 'off'}`}>
          {status}
        </span>
      </div>

      <div className="planner-control-panel__instrument">
        <span>{symbol || 'XAUUSD'}</span>
        <small>{side ? side.toUpperCase() : 'WYBIERZ KIERUNEK'}</small>
      </div>

      <div className="planner-control-panel__directions">
        <button
          type="button"
          className={`planner-direction-button planner-direction-button--long${placingSide === 'long' || side === 'long' ? ' is-active' : ''}`}
          onClick={() => onArm('long')}
        >
          <span>DŁUGA</span>
          <small>ZYSK POWYŻEJ</small>
        </button>
        <button
          type="button"
          className={`planner-direction-button planner-direction-button--short${placingSide === 'short' || side === 'short' ? ' is-active' : ''}`}
          onClick={() => onArm('short')}
        >
          <span>KRÓTKA</span>
          <small>ZYSK PONIŻEJ</small>
        </button>
      </div>

      {placingSide && (
        <div className="planner-control-panel__placement">
          <span className="planner-control-panel__placement-dot" />
          Kliknij punkt WEJŚCIA na wykresie
        </div>
      )}

      {!placingSide && planner && side && metrics && (
        <>
          <div className="planner-control-panel__trade-grid">
            <div className="planner-control-panel__volume">
              <span className="planner-control-panel__field-label">WOLUMEN</span>
              <div className="planner-lot-stepper">
                <button type="button" onClick={() => onLotsChange(clampLots(lots - volumeStep, volumeConstraints))}>−</button>
                <input
                  aria-label="Wolumen pozycji"
                  inputMode="decimal"
                  value={lots}
                  onChange={(event) => {
                    const parsed = Number(event.target.value.replace(',', '.'))
                    if (Number.isFinite(parsed)) onLotsChange(clampLots(parsed, volumeConstraints))
                  }}
                />
                <button type="button" onClick={() => onLotsChange(clampLots(lots + volumeStep, volumeConstraints))}>+</button>
              </div>
              <small>LOT</small>
            </div>

            <div className="planner-control-panel__rr-card">
              <span>R:R</span>
              <strong>{metrics.rr.toFixed(2)}</strong>
              <small>reward / risk</small>
            </div>
          </div>

          <div className="planner-control-panel__money">
            <div className="planner-money-card planner-money-card--profit">
              <span>TP · SZAC. WYNIK</span>
              <strong>{outcome ? `+${outcome.tpMoney.toFixed(2)} ${currency}` : '—'}</strong>
              <small>{formatPrice(planner.tp)}</small>
            </div>
            <div className="planner-money-card planner-money-card--risk">
              <span>SL · SZAC. STRATA</span>
              <strong>{outcome ? `−${outcome.slMoney.toFixed(2)} ${currency}` : '—'}</strong>
              <small>
                {formatPrice(planner.sl)}
                {riskPct !== null ? ` · ${riskPct.toFixed(2)}% equity` : ''}
              </small>
            </div>
          </div>

          <div className="planner-control-panel__levels">
            <div><span>WEJŚCIE</span><strong>{formatPrice(planner.entry)}</strong></div>
            <div><span>TP</span><strong className="metric-profit">{formatPrice(planner.tp)}</strong></div>
            <div><span>SL</span><strong className="metric-risk">{formatPrice(planner.sl)}</strong></div>
          </div>

          <div className="planner-control-panel__hint">
            ŚRODEK = przesuń X/Y · KRAWĘDZIE = zmień szerokość · TP/WEJŚCIE/SL = zmień cenę
          </div>
        </>
      )}

      {!placingSide && !planner && (
        <div className="planner-control-panel__hint planner-control-panel__hint--empty">
          Wybierz pozycję długą albo krótką, a następnie kliknij punkt wejścia.
        </div>
      )}

      {(planner || placingSide) && (
        <button type="button" className="planner-control-panel__clear" onClick={onClear}>
          ZAMKNIJ PLANER
        </button>
      )}
    </section>
  )
}
