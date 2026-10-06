import type { Mt5Order, Mt5Position } from './mt5Client'

export type BottomTab = 'positions' | 'orders' | 'account'

type BottomTradingPanelProps = {
  expanded: boolean
  tab: BottomTab
  positions: Mt5Position[]
  orders: Mt5Order[]
  account: any
  symbol: string
  selectedPositionTicket: number | null
  selectedOrderTicket: number | null
  onSelectPosition: (position: Mt5Position) => void
  onSelectOrder: (order: Mt5Order) => void
}

const money = (value?: number, currency = 'USD') => Number.isFinite(value) ? `${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}` : '—'
const compact = (value?: number) => Number.isFinite(value) ? Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—'

function AccountSummary({ account }: { account: any }) {
  const metrics: [string, string][] = [
    ['BALANCE', money(account?.balance, account?.currency)],
    ['EQUITY', money(account?.equity, account?.currency)],
    ['MARGIN', money(account?.margin, account?.currency)],
    ['FREE MARGIN', money(account?.margin_free, account?.currency)],
    ['FLOATING P&L', money(account?.profit, account?.currency)],
    ['MARGIN LEVEL', account?.margin_level ? account.margin_level.toFixed(1) + '%' : '—'],
  ]
  return <div className="sf-account-row">{metrics.map(([label, value]) => <div key={label}><small>{label}</small><b>{value}</b></div>)}</div>
}

function PositionsTable({ positions, account, symbol, selectedPositionTicket, onSelectPosition }: Pick<BottomTradingPanelProps, 'positions' | 'account' | 'symbol' | 'selectedPositionTicket' | 'onSelectPosition'>) {
  return <table className="sf-table"><thead><tr><th>SYMBOL</th><th>TYPE</th><th>VOLUME</th><th>ENTRY</th><th>P&amp;L ({account?.currency || 'USD'})</th><th>SL</th><th>TP</th><th>SWAP / COMM.</th><th>STATUS</th></tr></thead><tbody>
    {positions.length ? positions.map((position) => <tr key={position.ticket} data-position-ticket={position.ticket} className={selectedPositionTicket === position.ticket ? 'sf-row-selected' : ''} tabIndex={0} onClick={() => onSelectPosition(position)} onKeyDown={(event) => { if (event.key === 'Enter') onSelectPosition(position) }}>
      <td>{position.symbol}</td><td className={position.type === 'buy' ? 'positive' : 'negative'}>{position.type.toUpperCase()}</td><td>{position.volume.toFixed(2)}</td><td>{compact(position.price_open)}</td><td className={position.profit >= 0 ? 'positive' : 'negative'}>{money(position.profit, account?.currency)}</td><td>{position.sl ? compact(position.sl) : '—'}</td><td>{position.tp ? compact(position.tp) : '—'}</td><td>{money(position.swap + position.commission, account?.currency)}</td><td>OPEN</td>
    </tr>) : <tr><td colSpan={9} className="sf-empty-row">Brak otwartych pozycji · {symbol} · bridge tylko do odczytu</td></tr>}
  </tbody></table>
}

function OrdersTable({ orders, selectedOrderTicket, onSelectOrder }: Pick<BottomTradingPanelProps, 'orders' | 'selectedOrderTicket' | 'onSelectOrder'>) {
  return <table className="sf-table"><thead><tr><th>SYMBOL</th><th>TICKET</th><th>TYPE</th><th>VOLUME</th><th>TRIGGER PRICE</th><th>SL</th><th>TP</th><th>STATUS</th></tr></thead><tbody>
    {orders.length ? orders.map((order) => <tr key={order.ticket} data-order-ticket={order.ticket} className={selectedOrderTicket === order.ticket ? 'sf-row-selected' : ''} tabIndex={0} onClick={() => onSelectOrder(order)} onKeyDown={(event) => { if (event.key === 'Enter') onSelectOrder(order) }}>
      <td>{order.symbol}</td><td>{order.ticket}</td><td>{order.type}</td><td>{order.volume_initial.toFixed(2)}</td><td>{compact(order.price_open)}</td><td>{order.sl ? compact(order.sl) : '—'}</td><td>{order.tp ? compact(order.tp) : '—'}</td><td>PENDING</td>
    </tr>) : <tr><td colSpan={8} className="sf-empty-row">Brak oczekujących zleceń z bridge MT5</td></tr>}
  </tbody></table>
}

export function BottomTradingPanel({ expanded, tab, positions, orders, account, symbol, selectedPositionTicket, selectedOrderTicket, onSelectPosition, onSelectOrder }: BottomTradingPanelProps) {
  if (!expanded && tab === 'account') return <AccountSummary account={account} />
  if (!expanded && tab === 'orders') return <OrdersTable orders={orders} selectedOrderTicket={selectedOrderTicket} onSelectOrder={onSelectOrder} />
  if (!expanded) return <PositionsTable positions={positions} account={account} symbol={symbol} selectedPositionTicket={selectedPositionTicket} onSelectPosition={onSelectPosition} />

  return <div className="sf-bottom-workspace" data-active-tab={tab}>
    <section className={'sf-bottom-section sf-bottom-positions' + (tab === 'positions' ? ' active' : '')} data-bottom-section="positions"><header><strong>POSITIONS</strong><span>{positions.length} OPEN</span></header><div><PositionsTable positions={positions} account={account} symbol={symbol} selectedPositionTicket={selectedPositionTicket} onSelectPosition={onSelectPosition} /></div></section>
    <section className={'sf-bottom-section sf-bottom-orders' + (tab === 'orders' ? ' active' : '')} data-bottom-section="orders"><header><strong>ORDERS</strong><span>{orders.length} PENDING</span></header><div><OrdersTable orders={orders} selectedOrderTicket={selectedOrderTicket} onSelectOrder={onSelectOrder} /></div></section>
    <section className={'sf-bottom-section sf-bottom-account' + (tab === 'account' ? ' active' : '')} data-bottom-section="account"><header><strong>ACCOUNT SUMMARY</strong><span>{account?.currency || 'USD'}</span></header><AccountSummary account={account} /></section>
  </div>
}
