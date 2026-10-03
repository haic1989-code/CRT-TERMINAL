import { useState } from 'react'
import { lunaRisk } from './lunaMessages'
import type { AlertRule, PriceLevel } from './domain/contracts'
import { INDICATOR_CATALOG } from './indicators/catalog'
import { allocateTargetLots } from './domain/targetAllocations'

const format = (value?: number) => Number.isFinite(value) ? Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—'
const money = (value: number | null | undefined, currency = 'USD') => Number.isFinite(value) ? Number(value).toFixed(2) + ' ' + currency : '—'

function Field({ label, value, green, red }: { label: string; value: string; green?: boolean; red?: boolean }) {
  return <div className="sf-field"><span>{label}</span><b className={green ? 'positive' : red ? 'negative' : ''}>{value}</b></div>
}

export function ModuleDrawer(p: any) {
  const [indicatorFocus, setIndicatorFocus] = useState<string | null>(null)
  const {
    drawer, plannerTargets, setPlannerTargetEnabled, selectPlannerTarget, disablePlannerTarget, takeProfitAllocations, updateTargetAllocation,
    breakEvenMode, setBreakEvenMode, breakEvenRule, managedPosition, requestEmergencyClose,
    focusedAlertId, setFocusedAlertId, focusAlert, indicatorQuery, setIndicatorQuery, indicatorSettings,
    setIndicatorSettings, profileCustomStart, setProfileCustomStart, profileCustomEnd, setProfileCustomEnd,
    profileView, setProfileView, resetMarketProfile, instrumentPinned, setInstrumentPinned, selectInstrument,
    drawingNote, setDrawingNote, timeframe, contextTimeframe, symbol, feed,
    planner, metrics, fullTpProfitLabel, marginEstimate, planRisk, setPlanRisk, requestPlan, exposure, guard, currencies,
    strengthLoading, sessions, profile, profileEnabled, setProfileEnabled, profileSession, setProfileSession,
    setDrawTool, selectedIndicator, setSelectedIndicator, alerts, setAlerts, alertEvents, alertDraft,
    setAlertDraft, alertCondition, setAlertCondition, addAlert, symbolQuery, setSymbolQuery, symbolResults,
    setDrawer, mtfDirections, breakeven, positions = 0,
  } = p
  const contextSummary = drawer === 'context' ? p.focusedContextSummary : p.contextSummary
  const keyLevels = drawer === 'context' ? p.focusedContextKeyLevels : p.keyLevels
  const preferredIndicator = indicatorFocus && selectedIndicator.includes(indicatorFocus) ? indicatorFocus : selectedIndicator[0]
  const activeIndicator = INDICATOR_CATALOG.find((indicator) => indicator.id === preferredIndicator)
  const activeIndicatorSettings = activeIndicator ? indicatorSettings[activeIndicator.id] ?? { visible: true } : null
  const targetCloseLots = allocateTargetLots(Number(metrics?.volume) || 0, takeProfitAllocations ?? [], [Boolean(plannerTargets?.tp1), Boolean(plannerTargets?.tp2), Boolean(plannerTargets?.tp3)], feed?.symbolInfo?.volume_step ?? 0.01)
  const updateIndicatorSetting = (name: string, patch: Record<string, unknown>) => setIndicatorSettings((current: any) => ({
    ...current,
    [name]: { ...(current[name] ?? { visible: true }), ...patch },
  }))

  if (drawer === 'planner') return <div className="sf-drawer-body sf-planner-layout">
    <section className="sf-planner-controls" aria-label="Trade Planner Pro">
      {managedPosition && <p className="sf-source-note">READ ONLY · {managedPosition.symbol} · {managedPosition.side.toUpperCase()} · {managedPosition.volume.toFixed(2)} LOT</p>}
      <div className="sf-module-directions"><button className="long" aria-pressed={planner?.side === 'long'} onClick={() => requestPlan('long')}>↗ LONG</button><button className="short" aria-pressed={planner?.side === 'short'} onClick={() => requestPlan('short')}>↘ SHORT</button></div>
      <label className="sf-setting-field">RISK / TRADE · {Number(planRisk).toFixed(1)}%<input aria-label="Ryzyko na transakcję" type="range" min="0.1" max="2" step="0.1" value={planRisk} onChange={(event) => setPlanRisk(Number(event.target.value))} /></label>
      <div className="sf-planner-summary"><div><small>RISK</small><b className="negative">{metrics ? '-' + money(metrics.riskCash, feed.account?.currency) : '—'}</b></div><div><small>PROFIT</small><b className="positive">{plannerTargets?.tp1 || plannerTargets?.tp2 || plannerTargets?.tp3 ? metrics && Number.isFinite(metrics.rewardCash) ? '+' + money(metrics.rewardCash, feed.account?.currency) : '—' : fullTpProfitLabel ?? '—'}</b></div></div>
      <div className="sf-target-config" aria-label="Wybór take profit i lotów do zamknięcia">
        {planner ? <>
        <div className="dragon-target-selector" aria-label="Wybierz cel TP do ustawienia">{(['tp1', 'tp2', 'tp3'] as const).map(target => <button type="button" key={target} aria-pressed={plannerTargets[target]} className={plannerTargets[target] ? 'is-active' : ''} onClick={() => selectPlannerTarget(target)}>{target.toUpperCase()}</button>)}</div>
        {(['tp1', 'tp2', 'tp3'] as const).map((target, index) => {
          if (!plannerTargets[target]) return null
          const total = Number(metrics?.volume) || 0
          const lots = targetCloseLots[index]
          const step = feed.symbolInfo?.volume_step || 0.01
          const price = index === 0 ? planner?.tp1 : index === 1 ? planner?.tp2 : planner?.tp3
          return <div className="dragon-target-row" key={target}><span><b>{target.toUpperCase()}</b><small>{price ? format(price) : 'SET ON CHART'}</small></span><input type="range" aria-label={`${target.toUpperCase()} lotów do zamknięcia`} min="0" max={Math.max(total, step)} step={step} value={total ? Math.min(total, lots) : 0} disabled={!total} onChange={(event) => updateTargetAllocation(index, total ? Number(event.target.value) / total * 100 : 0)} /><output>{total ? lots.toFixed(2) : '—'} <small>LOT</small></output><button type="button" className="dragon-target-disable" aria-label={`Wyłącz ${target.toUpperCase()}`} onClick={() => disablePlannerTarget(target)}>×</button></div>
        })}
        </> : <p className="sf-planner-target-hint">Luna › Najpierw ustaw plan na wykresie, potem wybierz TP1–TP3.</p>}
      </div>
      <div className="sf-permission">PLAN PODGLĄDOWY · ZLECENIA WYŁĄCZONE</div>
    </section>
  </div>

  if (drawer === 'risk') {
    const riskValue = Math.max(0, Number(exposure.usedRiskPercent) || 0)
    const dailyLoss = Math.max(0, Number(guard.dailyLossPct) || 0)
    const openPositions = Math.max(0, Number(positions) || 0)
    const riskReason = guard.reasons.length ? guard.reasons.map(lunaRisk).join(' · ') : guard.warnings.length ? guard.warnings.map(lunaRisk).join(' · ') : 'Luna › Nie widzę teraz blokady w danych tego planu.'
    return <div className="sf-drawer-body sf-risk-layout">
      <section className={'sf-risk-hero ' + guard.state.toLowerCase()}>
        <span className="sf-risk-shield" aria-hidden="true">⬡</span>
        <div><small>RISK GUARD · STATUS OCHRONY</small><strong>{guard.state}</strong><span>{riskReason}</span></div>
      </section>
      <div className="sf-risk-columns">
        <section className="sf-risk-limits">
          <div className="sf-risk-section"><h3>HARD LIMITS</h3><Field label="RYZYKO / TRANSAKCJA" value="2.00%" /><Field label="RYZYKO PORTFELA" value="5.00%" /><Field label="STRATA DZIENNA" value="5.00%" /><Field label="WYKORZYSTANIE MARGIN" value="60.00%" /></div>
          <div className="sf-risk-section sf-risk-protection"><h3>PROTECTION STATUS</h3><Field label="MAX LOT" value={feed.symbolInfo?.volume_max ? format(feed.symbolInfo.volume_max) : '—'} /><Field label="SPREAD GUARD" value="NIEUSTAWIONY" /><Field label="SLIPPAGE GUARD" value="NIEUSTAWIONY" /><Field label="BLOCK NEW TRADES" value="OFF" /><p className="sf-source-note">Limity są prezentowane jako status. Edycja i zapis limitów nie są dostępne w tym widoku.</p></div>
          <div className="sf-risk-section sf-risk-warnings"><h3>SOFT WARNINGS</h3>{guard.warnings.length ? guard.warnings.map((warning: string) => <p className="sf-warning-reason" key={warning}>Luna › {lunaRisk(warning)}</p>) : <p>Luna › Nie mam dodatkowych ostrzeżeń dla tego planu.</p>}</div>
        </section>
        <section className="sf-risk-current">
          <h3>CURRENT / PROJECTED STATE</h3>
          <div className="sf-risk-gauge"><div><span>AGGREGATE EXPOSURE</span><strong>{riskValue.toFixed(2)}%</strong></div><div className="sf-risk-meter"><span style={{ width: Math.min(100, riskValue / 5 * 100) + '%' }} /></div><small>Wykorzystanie limitu ryzyka portfela · 5.00%</small></div>
          <div className="sf-risk-account">
            <Field label="EQUITY" value={money(feed.account?.equity, feed.account?.currency)} />
            <Field label="BALANCE" value={money(feed.account?.balance, feed.account?.currency)} />
            <Field label="FREE MARGIN" value={money(feed.account?.margin_free, feed.account?.currency)} />
            <Field label="PROJECTED RISK" value={Number(guard.projectedRiskPercent).toFixed(2) + '%'} />
            <Field label="PROJECTED MARGIN" value={Number(guard.projectedMarginUsagePct).toFixed(2) + '%'} />
            <Field label="SPREAD" value={feed.symbolInfo ? feed.symbolInfo.spread + ' pkt' : '—'} />
          </div>
          <div className="sf-risk-usage">
            <h3>LIMIT USAGE</h3>
            <div className="sf-risk-usage-row"><span>DAILY LOSS</span><div className="sf-risk-meter"><span className="warning" style={{ width: Math.min(100, dailyLoss / 5 * 100) + '%' }} /></div><b>{dailyLoss.toFixed(2)}% / 5.00%</b></div>
            <div className="sf-risk-usage-row"><span>OPEN POSITIONS</span><div className="sf-risk-count-meter" aria-label={openPositions + ' otwartych pozycji; limit nieustawiony'}>{Array.from({ length: Math.min(openPositions, 24) }, (_, index) => <i key={index} />)}</div><b>{openPositions} · LIMIT NIEUSTAWIONY</b></div>
            <div className="sf-risk-usage-row"><span>AGGREGATE EXPOSURE</span><div className="sf-risk-meter"><span style={{ width: Math.min(100, riskValue / 5 * 100) + '%' }} /></div><b>{riskValue.toFixed(2)}% / 5.00%</b></div>
          </div>
          <div className="sf-risk-extras"><Field label="RYZYKO KWOTOWE" value={money(exposure.usedRiskCash, feed.account?.currency)} /><Field label="POZYCJE BEZ STOPA" value={String(exposure.incompleteStops)} /><Field label="BREAK-EVEN NETTO" value={breakeven ? format(breakeven) : '—'} /><Field label="QUOTE FRESHNESS" value={feed.status.toUpperCase()} />{guard.reasons.map((reason: string) => <p className="sf-block-reason" key={reason}>Luna › {lunaRisk(reason)}</p>)}</div>
        </section>
      </div>
      <div className="sf-emergency-zone"><div><strong>ZAMYKANIE POZYCJI · JESZCZE NIEDOSTĘPNE</strong><span>{openPositions} otwartych pozycji · {p.pendingOrderCount ?? '—'} oczekujących zleceń. Luna › Zamykanie pozycji wykonaj bezpośrednio w MT5.</span></div><button type="button" onClick={requestEmergencyClose}>INFORMACJA OD LUNY</button></div>
    </div>
  }

  if (drawer === 'fx') {
    const rankedCurrencies = [...currencies].sort((left: [string, number], right: [string, number]) => right[1] - left[1])
    const activeSessions = sessions.filter((session: any) => session.open)
    return <div className="sf-drawer-body sf-fx-layout">
      <section className="sf-fx-panel sf-fx-mtf"><h3>MTF DIRECTION</h3><div className="sf-mtf-drawer-grid">{['M5', 'M15', 'M30', 'H1', 'H4', 'D1'].map((tf) => <div className={tf === contextTimeframe ? 'active' : ''} key={tf}><span>{tf}</span><b>{mtfDirections[tf] === 'bullish' ? '↑ BYCZY' : mtfDirections[tf] === 'bearish' ? '↓ NIEDŹWIEDZI' : mtfDirections[tf] === 'unavailable' ? 'BRAK DANYCH' : '— NEUTRALNY'}</b></div>)}</div></section>
      <section className="sf-fx-panel sf-fx-strength"><h3>SIŁA WALUT · ZMIANA CENY H1</h3>{strengthLoading ? <p>Luna › Pobieram dane z MT5…</p> : rankedCurrencies.length ? rankedCurrencies.map(([code, value]: [string, number], index: number) => <div className="sf-strength-row" key={code}><b>{index + 1}. {code}</b><div><span style={{ width: Math.max(2, Math.min(100, Math.abs(value) * 24)) + '%' }} className={value >= 0 ? 'positive-bar' : 'negative-bar'} /></div><strong className={value >= 0 ? 'positive' : 'negative'}>{value >= 0 ? '+' : ''}{value.toFixed(2)}%</strong></div>) : <p className="sf-empty-context">Luna › Nie znalazłam dostępnych par FX w Twoim MT5.</p>}</section>
      <section className="sf-fx-panel sf-fx-sessions"><h3>SESSIONS / OVERLAP</h3>{sessions.map((session: any) => <div className="sf-session-row" key={session.id}><span>{session.id.replace('_', ' ').toUpperCase()}</span><b>{session.localTime}</b><i className={session.open ? 'open' : ''}>{session.open ? 'OPEN' : 'CLOSED'}</i></div>)}<div className="sf-fx-overlap"><span>OVERLAP</span><b>{activeSessions.length > 1 ? activeSessions.length + ' SESJE AKTYWNE' : activeSessions.length === 1 ? 'BRAK NAKŁADANIA' : 'BRAK AKTYWNYCH SESJI'}</b></div><Field label="AKTYWNA SESJA" value={contextSummary.activeSession} /></section>
      <section className="sf-fx-panel sf-fx-volatility"><h3>VOLATILITY</h3><div className="sf-fx-primary-value">{contextSummary.volatilityState}</div><Field label="VOLATILITY RATIO" value={contextSummary.volatilityRatio === null ? 'N/A' : contextSummary.volatilityRatio.toFixed(2) + 'x'} /><p className="sf-source-note">Wartość pochodzi z bieżącego kontekstu instrumentu.</p></section>
      <section className="sf-fx-panel sf-fx-structure"><h3>MARKET STRUCTURE / MOMENTUM</h3><Field label="MARKET STRUCTURE" value={contextSummary.structure} /><Field label="RELATIVE STRENGTH" value={contextSummary.strengthValue === null ? contextSummary.strengthLabel : contextSummary.strengthLabel + ' · ' + contextSummary.strengthValue.toFixed(2)} /><Field label="SYMBOL" value={symbol} /></section>
      <section className="sf-fx-panel sf-fx-levels"><h3>KEY LEVELS / BIAS</h3><Field label="NEAREST SUPPORT" value={contextSummary.nearestSupport === null ? '—' : format(contextSummary.nearestSupport)} green /><Field label="NEAREST RESISTANCE" value={contextSummary.nearestResistance === null ? '—' : format(contextSummary.nearestResistance)} red /><Field label="RELATIONSHIP" value={contextSummary.keyLevelRelation} />{profileEnabled && profile && <Field label="PROFILE POC · VAH · VAL" value={format(profile.poc) + ' · ' + format(profile.vah) + ' · ' + format(profile.val)} />}<p className="sf-fx-summary">{contextSummary.summary}</p></section>
    </div>
  }

  if (drawer === 'profile') {
    const selectedRange = profileSession === 'day' ? 'OSTATNIE 24 GODZINY' : profileSession === 'week' ? 'OSTATNIE 7 DNI' : (profileCustomStart || '—') + ' → ' + (profileCustomEnd || '—')
    return <div className="sf-drawer-body sf-profile-layout">
      <section className="sf-profile-settings">
        <h3>SESSION / CUSTOM RANGE</h3>
        <div className="sf-profile-controls"><button className={profileSession === 'day' ? 'active' : ''} onClick={() => setProfileSession('day')}>DZIENNY</button><button className={profileSession === 'week' ? 'active' : ''} onClick={() => setProfileSession('week')}>TYGODNIOWY</button><button className={profileSession === 'custom' ? 'active' : ''} onClick={() => setProfileSession('custom')}>CUSTOM</button></div>
        <Field label="OKRES" value={selectedRange} />
        {profileSession === 'custom' && <div className="sf-profile-custom"><label>OD<input aria-label="Market Profile od" type="datetime-local" value={profileCustomStart} onChange={(event) => setProfileCustomStart(event.target.value)} /></label><label>DO<input aria-label="Market Profile do" type="datetime-local" value={profileCustomEnd} onChange={(event) => setProfileCustomEnd(event.target.value)} /></label></div>}
        <h3>PROFILE MODE</h3><Field label="CURRENT MODE" value="TPO · BAR RANGE" /><p className="sf-source-note">Aktywny profil TPO korzysta z zakresu barów MT5. Przełączanie trybu profilu nie jest dostępne.</p>
        <h3>PROFILE VISIBILITY</h3><button className="sf-primary-button" onClick={() => setProfileEnabled(!profileEnabled)}>{profileEnabled ? 'UKRYJ PROFIL NA WYKRESIE' : 'POKAŻ PROFIL NA WYKRESIE'}</button>
        <div className="sf-profile-visibility"><label><input aria-label="Pokaż TPO" type="checkbox" checked={profileView.showTpo} onChange={(event) => setProfileView((current: any) => ({ ...current, showTpo: event.target.checked }))} /> TPO / HISTOGRAM</label><label><input aria-label="Pokaż POC" type="checkbox" checked={profileView.showPoc} onChange={(event) => setProfileView((current: any) => ({ ...current, showPoc: event.target.checked }))} /> POC</label><label><input aria-label="Pokaż Value Area" type="checkbox" checked={profileView.showValueArea} onChange={(event) => setProfileView((current: any) => ({ ...current, showValueArea: event.target.checked }))} /> VAH / VAL</label></div>
        <label className="sf-setting-field">GĘSTOŚĆ<input aria-label="Gęstość profilu" type="range" min="1" max="12" step="1" value={profileView.density} onChange={(event) => setProfileView((current: any) => ({ ...current, density: Number(event.target.value) }))} /><b>{profileView.density}</b></label>
        <label className="sf-setting-field">SZEROKOŚĆ<input aria-label="Szerokość profilu" type="range" min="5" max="35" step="1" value={profileView.widthPct} onChange={(event) => setProfileView((current: any) => ({ ...current, widthPct: Number(event.target.value) }))} /><b>{profileView.widthPct}%</b></label>
        <label className="sf-setting-field">POZYCJA<select aria-label="Pozycja profilu" value={profileView.position} onChange={(event) => setProfileView((current: any) => ({ ...current, position: event.target.value }))}><option value="right">PRAWA</option><option value="left">LEWA</option></select></label>
        <button className="sf-profile-reset" onClick={resetMarketProfile}>RESET / DOMYŚLNE</button>
        <p className="sf-source-note">Zmiany działają live — bez Apply. Zamknięcie ustawień nie ukrywa aktywnego profilu.</p>
      </section>
      <section className="sf-profile-visual" aria-label="Aktywny profil na głównym wykresie">
        <div className="sf-profile-chart-caption"><span>CHART · {symbol}</span><b>ONE ACTIVE TPO PROFILE</b></div>
        <div className="sf-profile-summary">
          <div><small>POC</small><b>{profile ? format(profile.poc) : '—'}</b></div><div><small>VAH</small><b>{profile ? format(profile.vah) : '—'}</b></div><div><small>VAL</small><b>{profile ? format(profile.val) : '—'}</b></div><div><small>TPO COUNT</small><b>{profile ? String(profile.totalTpo) : '—'}</b></div><div><small>SESSION / RANGE</small><b>{selectedRange}</b></div>
        </div>
      </section>
    </div>
  }

  if (drawer === 'drawing') {
    const toolGroups = [
      { title: 'LINIE', tools: [['trend', 'Linia trendu', '↗'], ['ray', 'Promień', '⇢'], ['horizontal', 'Linia pozioma', '↔'], ['vertical', 'Linia pionowa', '↕']] },
      { title: 'KSZTAŁTY', tools: [['rectangle', 'Prostokąt / strefa', '▱'], ['channel', 'Kanał', '⫽']] },
      { title: 'ZNIESIENIA FIBONACCIEGO', tools: [['fib', 'Fibonacci', 'F']] },
      { title: 'POMIARY', tools: [['measure', 'Pomiar', '↗']] },
      { title: 'TEKST / USUWANIE', tools: [['erase', 'Wybierz / usuń rysunek', '⌫'], ['clear', 'Wyczyść rysunki', '×']] },
    ]
    const twoPointTools = ['trend', 'ray', 'rectangle', 'measure', 'fib']
    return <div className="sf-drawer-body sf-drawing-body"><div className="sf-drawing-tool-rail">
      {toolGroups.map((group) => <section className="sf-tool-group" key={group.title}><h3>{group.title}</h3>{group.tools.map(([id, label, icon]) => <button key={id} className={'sf-drawing-tool' + (p.drawTool === id ? ' active' : '')} onClick={() => setDrawTool(id)}><b aria-hidden="true">{icon}</b><span>{label}<small>{id === 'clear' ? 'WYCZYŚĆ · POTWIERDŹ' : id === 'erase' ? 'OTWÓRZ LISTĘ RYSUNKÓW' : id === 'channel' ? 'AKTYWUJ · TRZY PUNKTY' : twoPointTools.includes(id) ? 'AKTYWUJ · DWA PUNKTY' : 'AKTYWUJ · KLIKNIJ WYKRES'}</small></span></button>)}</section>)}
      <div className="sf-drawing-note"><label>NOTATKA NA WYKRESIE<input aria-label="Treść notatki na wykresie" value={drawingNote} maxLength={80} onChange={(event) => setDrawingNote(event.target.value)} placeholder="Wpisz własną notatkę…" /></label><button type="button" disabled={!String(drawingNote || '').trim()} onClick={() => setDrawTool('text', drawingNote)}>AKTYWUJ NOTATKĘ</button></div>
      <p className="sf-source-note">Wybierz narzędzie, a drawer zamknie się przed rysowaniem. Escape wraca do wskaźnika.</p>
    </div></div>
  }

  if (drawer === 'indicators') {
    const available = INDICATOR_CATALOG.filter((indicator) => indicator.id.toLowerCase().includes(String(indicatorQuery || '').trim().toLowerCase()))
    return <div className="sf-drawer-body sf-indicator-browser">
      <input className="sf-search-field" aria-label="Szukaj wskaźników" placeholder="Szukaj wskaźników…" value={indicatorQuery} onChange={(event) => setIndicatorQuery(event.target.value)} />
      <div className="sf-indicator-columns">
        <section className="sf-indicator-catalog"><h3>DOSTĘPNE · KATALOG WSKAŹNIKÓW</h3><div className="sf-indicator-list">
          {available.map((indicator) => {
            const active = selectedIndicator.includes(indicator.id)
            return <button key={indicator.id} aria-label={'Dodaj ' + indicator.id} className={'sf-indicator-catalog-row' + (active ? ' active' : '')} disabled={active} onClick={() => {
              setSelectedIndicator((items: string[]) => items.includes(indicator.id) ? items : [...items, indicator.id])
              setIndicatorSettings((current: any) => ({ ...current, [indicator.id]: { ...(current[indicator.id] ?? { visible: true }), visible: true } }))
              setIndicatorFocus(indicator.id)
            }}>
              <span className="sf-indicator-type">{indicator.placement === 'pane' ? 'P' : 'O'}</span><span><b>{indicator.id}</b><small>{indicator.placement === 'pane' ? 'SEPARATE PANE' : 'CHART OVERLAY'}</small></span><small>{active ? 'AKTYWNY' : 'DODAJ'}</small>
            </button>
          })}
          {available.length === 0 && <p>Luna › Nie znalazłam pasującego wskaźnika.</p>}
        </div></section>
        <section className="sf-indicator-workspace">
          <div className="sf-indicator-selected">
            <h3>SETTINGS · WYBRANY WSKAŹNIK</h3>
            {activeIndicator && activeIndicatorSettings ? <><div className="sf-indicator-selected-title"><span className="sf-indicator-type">{activeIndicator.placement === 'pane' ? 'P' : 'O'}</span><strong>{activeIndicator.id}</strong><small>{activeIndicator.placement === 'pane' ? 'SEPARATE PANE' : 'CHART OVERLAY'}</small></div>
              {activeIndicator.defaultPeriod !== undefined ? <label className="sf-indicator-period">OKRES<input aria-label={'Okres ' + activeIndicator.id} type="number" min="2" max="500" step="1" value={activeIndicatorSettings.period ?? activeIndicator.defaultPeriod} onChange={(event) => updateIndicatorSetting(activeIndicator.id, { period: Math.max(2, Math.min(500, Number(event.target.value) || 2)) })} /></label> : <div className="sf-indicator-method">UTC DAY · TYPICAL PRICE · TICK VOLUME · RESET 00:00 UTC</div>}
              {activeIndicator.scale && <Field label="SKALA" value={activeIndicator.scale[0] + '–' + activeIndicator.scale[1]} />}
              <p className="sf-source-note">Ustawienia są stosowane do aktywnego wskaźnika na wykresie.</p>
            </> : <p className="sf-indicator-empty">Wybierz wskaźnik z katalogu albo dodaj go, aby zobaczyć dostępne ustawienia.</p>}
          </div>
          <div className="sf-indicator-active">
            <h3>ACTIVE INDICATORS</h3>
            {selectedIndicator.length ? <div className="sf-indicator-active-list">{selectedIndicator.map((name: string) => {
              const indicator = INDICATOR_CATALOG.find((item) => item.id === name)
              if (!indicator) return null
              const settings = indicatorSettings[name] ?? { visible: true }
              return <div className={'sf-indicator-row' + (preferredIndicator === name ? ' selected' : '')} data-indicator-name={name} data-indicator-placement={indicator.placement} key={name}>
                <button className="sf-indicator-pick" onClick={() => setIndicatorFocus(name)}><span className="sf-indicator-type">{indicator.placement === 'pane' ? 'P' : 'O'}</span><b>{name}</b></button>
                <label className="sf-indicator-visible"><input type="checkbox" aria-label={'Widoczność ' + name} checked={settings.visible !== false} onChange={(event) => updateIndicatorSetting(name, { visible: event.target.checked })} /> WIDOCZNY</label>
                <button aria-label={'Usuń ' + name} onClick={() => { setSelectedIndicator((items: string[]) => items.filter((item) => item !== name)); if (indicatorFocus === name) setIndicatorFocus(null) }}>×</button>
              </div>
            })}</div> : <p>Luna › Nie włączyłeś jeszcze wskaźników.</p>}
          </div>
        </section>
      </div>
      <p className="sf-source-note">Używane są wyłącznie wskaźniki zarejestrowane w katalogu: SMA 20, EMA 50, VWAP, Bollinger Bands i RSI.</p>
    </div>
  }

  if (drawer === 'alerts') {
    return <div className="sf-drawer-body sf-alert-layout">
      <div className="sf-alert-title-row"><div><h3>ALERT ENGINE · {symbol}</h3><p>Warunki Above, Below i Cross. Alerty pozostają liniami na głównym wykresie.</p></div>{focusedAlertId && <button className="sf-alert-new" onClick={() => { setFocusedAlertId(null); setAlertDraft('') }}>NOWY ALERT</button>}</div>
      <div className={'sf-alert-create' + (focusedAlertId ? ' is-focused' : '')}><label>{focusedAlertId ? 'EDYCJA ALERTU' : 'NOWY POZIOM CENY'}<input type="number" value={alertDraft} onChange={(event) => setAlertDraft(event.target.value)} placeholder="Poziom ceny" /></label><label>WARUNEK<select value={alertCondition} onChange={(event) => setAlertCondition(event.target.value)}><option value="cross">Cross</option><option value="above">Above</option><option value="below">Below</option></select></label><button className="sf-primary-button" onClick={addAlert}>{focusedAlertId ? 'ZAPISZ ALERT' : 'UTWÓRZ ALERT'}</button></div>
      <div className="sf-alert-tables">
        <section className="sf-alert-table-section"><div className="sf-alert-section-title"><h3>ACTIVE ALERTS</h3><span>{alerts.length} REGUŁ</span></div><div className="sf-alert-table-scroll"><div className="sf-alert-table-head"><span>SYMBOL</span><span>CONDITION</span><span>PRICE</span><span>STATUS</span><span>AKCJE</span></div>
          {alerts.length ? alerts.map((alert: AlertRule) => <div className={'sf-alert-row' + (focusedAlertId === alert.id ? ' is-focused' : '')} data-alert-id={alert.id} key={alert.id}>
            <b className="sf-alert-symbol">{alert.symbol}</b><span className="sf-alert-condition">{alert.condition.toUpperCase()}</span><b className="sf-alert-price">{format(alert.level)}</b><label className="sf-alert-toggle"><input aria-label={'Włącz alert ' + alert.level} type="checkbox" checked={alert.enabled} onChange={() => setAlerts((items: AlertRule[]) => items.map((item) => item.id === alert.id ? { ...item, enabled: !item.enabled } : item))} />{alert.enabled ? 'ON' : 'OFF'}</label><div className="sf-alert-row-actions"><button className="sf-alert-focus" aria-label={'Edytuj alert ' + alert.level} onClick={() => focusAlert(alert.id)}>EDYTUJ</button><button aria-label={'Usuń alert ' + alert.level} onClick={() => setAlerts((items: AlertRule[]) => items.filter((item) => item.id !== alert.id))}>×</button></div>
          </div>) : <p className="sf-alert-empty">Luna › Nie masz jeszcze aktywnych alertów.</p>}
        </div></section>
        <section className="sf-alert-table-section sf-alert-history-section"><div className="sf-alert-section-title"><h3>HISTORY</h3><span>{alertEvents.length} ZDARZEŃ</span></div><div className="sf-alert-table-scroll"><div className="sf-alert-history-head"><span>TIME</span><span>SYMBOL</span><span>CONDITION</span><span>PRICE</span><span>EVENT</span></div>
          {alertEvents.length ? alertEvents.map((event: any, index: number) => { const rule = alerts.find((item: AlertRule) => item.id === event.ruleId); return <div className="sf-alert-history-row" key={event.ruleId + '-' + event.firedAt + '-' + index}><span>{new Date(event.firedAt).toLocaleTimeString()}</span><span>{event.symbol || '—'}</span><span>{rule?.condition.toUpperCase() || '—'}</span><b>{format(event.price)}</b><span>FIRED</span></div> }) : <p className="sf-alert-empty">Luna › Zapiszę tu zdarzenie, kiedy zostanie spełniony warunek alertu.</p>}
        </div></section>
      </div>
    </div>
  }

  if (drawer === 'instruments') return <div className="sf-drawer-body sf-instrument-layout">
    <div className="sf-selector-head"><input className="sf-search-field" autoFocus placeholder="Szukaj symbolu brokera…" value={symbolQuery} onChange={(event) => setSymbolQuery(event.target.value)} /><label className={'sf-pin-toggle' + (instrumentPinned ? ' active' : '')}><input aria-label="Przypnij wybór instrumentu" type="checkbox" checked={instrumentPinned} onChange={(event) => setInstrumentPinned(event.target.checked)} /> PRZYPNIJ</label></div>
    <div className="sf-quick-symbols">{['XAUUSD', 'BTCUSD', 'DJ30'].map((quickSymbol) => <button className={symbol === quickSymbol ? 'active' : ''} key={quickSymbol} onClick={() => selectInstrument(quickSymbol)}>{quickSymbol}<small>{quickSymbol === symbol ? 'WYBRANY INSTRUMENT' : 'SZYBKI WYBÓR'}</small></button>)}</div>
    <div className="sf-symbol-list-heading"><h3>SYMBOLE BROKERA</h3><span>{symbolResults.length} DOSTĘPNYCH</span></div>
    <div className="sf-symbol-results">{symbolResults.map((item: any) => <button className={item.symbol === symbol ? 'active' : ''} key={item.symbol} onClick={() => selectInstrument(item.symbol)}><b>{item.symbol}</b><span>{item.description || item.path || 'Opis niedostępny'}</span><small>{item.visible ? 'WIDOCZNY' : 'DOSTĘPNY'}</small></button>)}{symbolResults.length === 0 && <p>Luna › Nie znalazłam pasującego instrumentu.</p>}</div>
    <p className="sf-source-note">{instrumentPinned ? 'Przypięty wybór · lista pozostaje otwarta.' : 'Po wyborze lista zostanie zamknięta.'}</p>
  </div>

  if (drawer === 'context') return <div className="sf-drawer-body sf-context-layout">
    <header className="sf-context-quote">
      <div className="sf-context-symbol"><small>ACTIVE SYMBOL</small><strong>{feed.symbol || symbol}</strong></div>
      <div className="sf-context-last"><small>LAST PRICE</small><strong>{feed.lastPrice ? format(feed.lastPrice) : '—'}</strong></div>
      <div className="sf-context-bidask"><span>BID <b>{format(feed.bid)}</b></span><span>ASK <b>{format(feed.ask)}</b></span></div>
      <span className="sf-context-chip">CONTEXT {contextTimeframe}</span><span className={'sf-context-chip sf-context-freshness ' + feed.status}>FRESHNESS · {feed.status.toUpperCase()}</span>
    </header>
    <div className="sf-context-grid">
      <section className="sf-context-facts"><h3>INSTRUMENT CONTEXT</h3><Field label="CHART TIMEFRAME" value={timeframe} /><Field label="KIERUNEK MTF" value={mtfDirections?.[contextTimeframe] || '—'} /><Field label="STRUKTURA" value={contextSummary.structure} /><Field label="VOLATILITY" value={contextSummary.volatilityRatio === null ? contextSummary.volatilityState : contextSummary.volatilityState + ' · ' + contextSummary.volatilityRatio.toFixed(2) + 'x'} /><Field label="SESJA" value={contextSummary.activeSession} /><Field label="RELATIVE STRENGTH" value={contextSummary.strengthValue === null ? contextSummary.strengthLabel : contextSummary.strengthValue.toFixed(2)} /><Field label="NET BREAK-EVEN" value={breakeven ? format(breakeven) : '—'} />{profileEnabled && profile && <Field label="PROFILE POC / VAH / VAL" value={format(profile.poc) + ' / ' + format(profile.vah) + ' / ' + format(profile.val)} />}</section>
      <section className="sf-context-levels"><h3>KEY LEVELS</h3><Field label="NAJBLIŻSZY SUPPORT" value={contextSummary.nearestSupport === null ? '—' : format(contextSummary.nearestSupport)} green /><Field label="NAJBLIŻSZY RESISTANCE" value={contextSummary.nearestResistance === null ? '—' : format(contextSummary.nearestResistance)} red /><Field label="RELACJA DO POZIOMÓW" value={contextSummary.keyLevelRelation} />{keyLevels.length ? keyLevels.slice(-6).reverse().map((level: PriceLevel, index: number) => <Field key={level.time + '-' + index} label={level.kind.toUpperCase() + ' · ' + new Date(level.time * 1000).toLocaleDateString()} value={format(level.price)} green={level.kind === 'support'} red={level.kind === 'resistance'} />) : <p className="sf-context-empty">Za mało barów do potwierdzonych poziomów fraktalnych.</p>}</section>
      <aside className="sf-context-actions"><h3>CONTEXT ACTIONS</h3><button className="sf-primary-button" onClick={() => setDrawer('planner')}>TRADE PLANNER PRO</button><button className="sf-primary-button" onClick={() => setDrawer('alerts')}>ALERT ENGINE</button><p className="sf-source-note">Interwał kontekstu pozostaje niezależny od głównego wykresu.</p></aside>
    </div>
    <section className="sf-context-summary"><h3>SHORT SUMMARY</h3><p>{contextSummary.summary}</p></section>
  </div>

  return <div className="sf-drawer-body"><p>Moduł nie jest dostępny.</p></div>
}
