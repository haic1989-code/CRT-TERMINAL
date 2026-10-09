import type { Route } from '@playwright/test'
import { routeFixture } from './terminal-fixture'
const fromMs = Date.UTC(2026, 9, 2)
const archive = { id:'ui-archive-xau',status:'complete',requested_symbol:'XAUUSDs',symbol:'XAUUSDs',broker:'MetaQuotes Ltd.',server:'TradeQuo-Server',from_ms:fromMs,to_ms:fromMs+7*86400000-1,tick_count:85000,sha256:'a'.repeat(64),manifest:{source:'MetaTrader5.copy_ticks_range',mt5_range_boundary_policy:'enclosing_seconds_filter_ms_v1',financial_snapshot:{account_snapshot:{currency:'USD',balance:10000,leverage:100},broker_profile:{supported:true,version:3,captured_at_ms:fromMs}}},error:null,created_at:'2026-10-09',updated_at:'2026-10-09' }
const json = (route:Route, value:unknown)=>route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'X-CRT-Protocol, X-CRT-Instance','X-CRT-Protocol':'5','X-CRT-Instance':'visual-fixture'},body:JSON.stringify(value)})
export async function laboratory(route:Route) {
  const url = new URL(route.request().url())
  if(url.pathname==='/v1/replay/archives')return json(route,{database:'visual-fixture-only',values:[archive,{...archive,id:'ui-archive-eur',symbol:'EURUSD',requested_symbol:'EURUSD',tick_count:240000},{...archive,id:'ui-archive-incomplete',status:'interrupted',tick_count:12000,sha256:null,error:'Import przerwany. Wybierz ponownie ten sam zakres.'}]})
  if(url.pathname==='/v1/replay/strategies')return json(route,{api_version:2,values:[{id:'strategy-example',name:'EMA · przykład',api_version:2,sha256:'b'.repeat(64)}]})
  if(url.pathname.endsWith('/ticks')){
    const offset=Number(url.searchParams.get('offset')||0),limit=Math.min(30000,archive.tick_count-offset)
    return json(route,{offset,limit,total:archive.tick_count,values:Array.from({length:limit},(_,i)=>{const n=offset+i,bid=2780+Math.sin(n/150)*6+Math.sin(n/2700)*15+n/9000;return {sequence:n,time_msc:fromMs+n*1000,bid,ask:bid+.24,last:0,volume:1,volume_real:1,flags:6}})})
  }
  if(url.pathname==='/v1/replay/inbox')return json(route,{folder:'Local replay inbox',values:[{name:'XAUUSDs_ticks.csv',bytes:1024*1024}]})
  return routeFixture(route)
}
