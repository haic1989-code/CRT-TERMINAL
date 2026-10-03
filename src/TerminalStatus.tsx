import type { Mt5Account, Mt5Order, Mt5Position } from './mt5Client'
import type { MarketFeedState } from './MarketChart'

export type TerminalFocus = 'all' | 'positions' | 'orders' | 'account'
type Props = {
  feed: MarketFeedState
  account: Mt5Account | null
  positions: Mt5Position[]
  orders: Mt5Order[]
  positionsObservedAt: number | null
  ordersObservedAt: number | null
  clockNow: number
  focus: TerminalFocus
  onFocus: (focus: TerminalFocus) => void
  symbol: string
  alertEvents: { ruleId: string; symbol: string; price: number; firedAt: number }[]
}

const amount = (value: number | undefined) => Number.isFinite(value) ? value!.toFixed(2) : 'N/D'

export function TerminalStatus(p: Props) {
  const stale = (observed: number | null) => observed === null || p.clockNow - observed > 15000 ? ' · NIEAKTUALNE' : ''

  const orderType = (type: string) => type.replace('BUY', 'KUPNO').replace('SELL', 'SPRZEDAŻ').replaceAll('_', ' ')
  const positions = p.focus === 'all' ? p.positions.slice(0, 4) : p.positions
  const orders = p.focus === 'all' ? p.orders.slice(0, 3) : p.orders
  return <><div className={'dragon-terminal-log' + (p.focus !== 'all' ? ' focused' : '')} aria-label="Statusy terminala">
    {(p.feed.status !== 'live' || !p.feed.marketSession?.available) && <p className="negative" role="status" title={p.feed.message}>Luna › {!p.feed.marketSession?.available ? 'Nie odczytuję godzin sesji. Uruchom pomocnik CRTMarketSessions w MT5; do tego czasu zlecenia są zablokowane.' : p.feed.status === 'connecting' ? 'Łączę się z MT5.' : p.feed.status === 'error' ? 'Czekam na połączenie z MT5.' : p.feed.status === 'closed' ? 'Rynek jest zamknięty według godzin sesji symbolu. Pokazuję ostatnie notowania.' : p.feed.status === 'stale' ? 'Sesja jest otwarta, ale nie ma świeżego ticka.' : 'Pokazuję historię notowań.'}</p>}
    {(p.focus === 'all' || p.focus === 'positions') && positions.map(position => <p key={position.ticket} data-terminal-status="position" className="dragon-position-status"><span className="dragon-position-prefix">&gt; #{position.ticket}</span> · <span className="dragon-position-symbol">{position.symbol}</span> · <span className={position.type === 'buy' ? 'positive' : 'negative'}>{position.type === 'buy' ? 'KUPNO' : 'SPRZEDAŻ'}</span> · <span className={position.profit >= 0 ? 'positive dragon-pnl-value' : 'negative dragon-pnl-value'} key={amount(position.profit)}>P/L {amount(position.profit)} {p.account?.currency || ''}</span></p>)}
    {p.focus === 'all' && p.positions.length > 4 && <button onClick={() => p.onFocus('positions')}>&gt; +{p.positions.length - 4} POZYCJI / POKAŻ STATUSY</button>}
    {(p.focus === 'all' || p.focus === 'orders') && orders.map(order => <p key={order.ticket} data-terminal-status="order" className="dragon-order-status">&gt; ZLECENIE #{order.ticket} {order.symbol} {orderType(order.type)} {order.volume_initial} LOT @ {order.price_open} · OCZEKUJĄCE{stale(p.ordersObservedAt)}</p>)}
    {p.focus === 'all' && p.orders.length > 3 && <button onClick={() => p.onFocus('orders')}>&gt; +{p.orders.length - 3} ZLECEŃ / POKAŻ STATUSY</button>}
    {p.focus === 'positions' && p.positions.length === 0 && <p>Luna › Nie masz otwartych pozycji.</p>}
    {p.focus === 'orders' && p.orders.length === 0 && <p>Luna › Nie masz zleceń oczekujących.</p>}
    {p.focus === 'account' && !p.account && <p>Luna › Czekam na dane konta.</p>}
    {p.alertEvents.filter(event => event.symbol === p.symbol && p.clockNow - event.firedAt < 15000).slice(0, 2).map(event => <p className="dragon-alert" key={event.ruleId + event.firedAt}>&gt; ALERT {event.symbol} @ {event.price}</p>)}
    {(positions.length > 0 || orders.length > 0) && p.focus !== 'account' && <span className="dragon-terminal-cursor" aria-hidden="true">▌</span>}
    {p.focus !== 'all' && <button onClick={() => p.onFocus('all')}>&gt; POKAŻ WSZYSTKIE STATUSY</button>}
  </div>
    <div className="dragon-account-terminal" aria-label="Status konta">
      {p.account ? <p className="dragon-account-status" data-terminal-status="account">
        <span className="dragon-account-prefix">&gt; KONTO {p.account.currency}</span>
        <span className="dragon-account-balance" key={'bal' + amount(p.account.balance)}>SALDO <b>{amount(p.account.balance)}</b></span>
        <span className="dragon-account-equity" key={'eq' + amount(p.account.equity)}>KAPITAŁ <b>{amount(p.account.equity)}</b></span>
        <span className="dragon-account-free" key={'free' + amount(p.account.margin_free)}>WOLNE <b>{amount(p.account.margin_free)}</b></span>
        <span className={(p.account.day_pnl ?? 0) >= 0 ? 'positive' : 'negative'} key={'day' + amount(p.account.day_pnl)}>DZISIAJ <b>{amount(p.account.day_pnl)}</b></span>
        {(!p.account.observed_at || p.clockNow - p.account.observed_at > 15000 || p.account.observed_at > p.clockNow + 1000) && <span className="negative">DANE KONTA NIEAKTUALNE</span>}
        <span className="dragon-terminal-cursor" aria-hidden="true">▌</span>
      </p> : <p className="dragon-account-status">Luna › Czekam na dane konta. <span className="dragon-terminal-cursor" aria-hidden="true">▌</span></p>}
    </div>
  </>
}

