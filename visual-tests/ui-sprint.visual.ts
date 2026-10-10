import { test, expect, type Page, type Route } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { laboratory } from './support/replay-fixture'

test.use({ actionTimeout: 15000 })
const output = path.join(process.cwd(), 'artifacts/screenshots/ui-sprint-review-v2')
async function openTerminal(page:Page) {
  await page.goto('/')
  const gate=page.getByRole('dialog',{name:'LUNA URUCHAMIA TERMINAL_'})
  if(await gate.count()){await gate.getByRole('button',{name:/Jestem gotowa.*Naciśnij Enter/}).click({timeout:30000});await expect(gate).toHaveCount(0,{timeout:10000})}
  const answer=page.getByRole('textbox',{name:'Wpisz odpowiedź tak'})
  await answer.fill('tak');await answer.press('Enter')
  await expect(page.locator('.deck-tools-toggle')).toBeVisible()
}
async function tools(page:Page,tab:string){
  const toggle=page.locator('.deck-tools-toggle')
  if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click()
  await page.getByRole('tab',{name:tab,exact:true}).click()
}
async function containment(page:Page,selectors:string[]){
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  for(const selector of selectors){const box=await page.locator(selector).boundingBox();expect(box,selector).toBeTruthy();expect(box!.x,selector).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width,selector).toBeLessThanOrEqual(page.viewportSize()!.width+1);expect(box!.y+box!.height,selector).toBeLessThanOrEqual(page.viewportSize()!.height+1)}
  const overflow=await page.locator('.fx-lab').count() ? await page.locator('.fx-lab').evaluate(el=>el.scrollWidth>el.clientWidth+1) : false
  expect(overflow).toBe(false)
}
for(const size of [{width:2560,height:1440},{width:1920,height:1080}])test(`UI sprint preview ${size.width}x${size.height}: tools, planner, management and local replay`,async({page})=>{
  test.setTimeout(120000)
  const errors:string[]=[],writes:string[]=[],tickRequests:string[]=[]
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).port==='8765'&&r.method()!=='GET')writes.push(r.url())})
  page.on('request',r=>{const url=new URL(r.url());if(url.pathname.startsWith('/v1/replay/archives/')&&url.pathname.endsWith('/ticks'))tickRequests.push(r.url())})
  await page.setViewportSize(size);await page.emulateMedia({reducedMotion:'reduce'})
  await page.route('http://127.0.0.1:8765/**',laboratory)
  await mkdir(output,{recursive:true});await openTerminal(page)
  const deck=page.locator('.matrix-command-deck'),chart=page.locator('.market-chart')
  await expect(deck.locator('.deck-tools-panel')).toHaveCount(0)
  await expect(deck.locator('.deck-context h3 .idx')).toHaveText('01')
  await expect(deck.locator('.deck-tools-toggle .idx')).toHaveText('02')
  await expect(deck.locator('.deck-planner h3 .idx')).toHaveText('03')
  await expect(deck.getByRole('heading',{name:/PLANNER TRANSAKCJI/})).toBeVisible()
  await containment(page,['.sf-right-column','.market-chart'])
  await page.screenshot({path:path.join(output,`terminal-${size.width}x${size.height}.png`)})
  await tools(page,'WSKAŹNIKI');await deck.getByRole('button',{name:'RSI',exact:true}).click();await expect(chart).toHaveAttribute('data-indicator-pane-count','1');await deck.getByRole('spinbutton',{name:'Okres RSI'}).fill('9')
  await tools(page,'POZIOMY');await deck.getByRole('button',{name:'DZIŚ · D-H / D-L',exact:true}).click();await expect(chart).toHaveAttribute('data-reference-level-count','2')
  await expect(deck.locator('.deck-tools-count')).toHaveText('2 AKTYWNE')
  await page.screenshot({path:path.join(output,`tools-${size.width}x${size.height}.png`)})
  await deck.locator('.deck-tools-toggle').click();await expect(deck.locator('.deck-tools-toggle')).toHaveAttribute('aria-expanded','false')
  await expect(deck.getByLabel('Aktywne wskaźniki')).toContainText('RSI 9')
  await page.screenshot({path:path.join(output,`tools-active-${size.width}x${size.height}.png`)})
  const plannerBox=await deck.locator('.deck-planner').boundingBox()
  await tools(page,'RYSOWANIE');await deck.getByRole('button',{name:'Poziom',exact:true}).click();await expect(deck.locator('.deck-tools-toggle')).toHaveAttribute('aria-expanded','false')
  await chart.click({position:{x:500,y:250}});await expect(page.locator('[data-drawing-kind="horizontal"]')).toHaveCount(1)
  await page.getByRole('button',{name:'Zarządzaj pozycją XAUUSD #8114021'}).click()
  await expect(deck.getByRole('heading',{name:/MANAGE POSITION/})).toBeVisible();await expect(deck.locator('.deck-directions')).toHaveCount(0);await expect(page.locator('.sf-chart-drawer')).toHaveCount(0)
  const manageBox=await deck.locator('.deck-manage').boundingBox();for(const dimension of ['x','y','width','height'] as const)expect(Math.abs(manageBox![dimension]-plannerBox![dimension]),dimension).toBeLessThanOrEqual(1)
  await expect(deck.locator('.deck-manage h3 .idx')).toHaveText('03')
  await containment(page,['.deck-planner','.sf-right-column'])
  const manageLayout=await deck.locator('.deck-manage').evaluate(el=>({clientHeight:el.clientHeight,scrollHeight:el.scrollHeight,children:[...el.children].map(child=>({className:child.className,height:child.getBoundingClientRect().height,margin:getComputedStyle(child).margin,lineHeight:getComputedStyle(child).lineHeight}))}))
  await writeFile(path.join(output,`manage-layout-${size.width}x${size.height}.json`),JSON.stringify(manageLayout,null,2))
  expect(manageLayout.scrollHeight,'Manage fits without clipped controls').toBeLessThanOrEqual(manageLayout.clientHeight+1)
  await writeFile(path.join(output,`geometry-${size.width}x${size.height}.json`),JSON.stringify({planner:plannerBox,manage:manageBox},null,2))
  await page.screenshot({path:path.join(output,`manage-${size.width}x${size.height}.png`)})
  await deck.getByRole('button',{name:'NOWY PLAN'}).click();await expect(deck.locator('.deck-directions')).toBeVisible()
  await page.getByRole('button',{name:/FX REPLAY/}).click()
  const lab=page.getByRole('dialog',{name:'FX REPLAY'})
  await expect(lab.getByRole('tab',{name:/ARCHIWA/})).toHaveAttribute('aria-selected','true');await expect(lab.locator('.fx-replay-import')).toHaveCount(0);await expect(lab.getByRole('button',{name:'START REPLAY'})).toBeDisabled()
  await expect(lab.locator('.fx-replay-archive')).toHaveCount(3);await containment(page,['.fx-lab','.fx-lab-sidebar'])
  await page.screenshot({path:path.join(output,`replay-empty-${size.width}x${size.height}.png`)})
  await lab.getByRole('button',{name:'WYBIERZ',exact:true}).first().click();await expect(lab.locator('.fx-session-card')).toContainText('XAUUSDs');await expect(lab.getByRole('button',{name:'START REPLAY'})).toBeEnabled()
  await expect(lab.getByRole('region',{name:'SESSION PREVIEW'})).toContainText('READY')
  await expect(lab.locator('.fx-preview-metadata')).toContainText('85 000')
  await expect(lab.locator('.fx-preview-provenance')).toContainText('MT5 · HISTORIA BROKERA')
  await expect(lab.locator('.fx-preview-integrity')).toContainText('aaaaaaaaaaaaaaaa')
  await expect(lab.locator('.fx-preview-timeline')).toBeVisible();await expect(lab.locator('.fx-lab-empty')).toHaveCount(0);await expect(lab.locator('.fx-lab-transport')).toHaveCount(0)
  await expect(lab.getByRole('button',{name:'OTWÓRZ REPLAY'})).toBeEnabled();expect(tickRequests).toEqual([])
  await containment(page,['.fx-session-preview','.fx-preview-actions'])
  await page.screenshot({path:path.join(output,`replay-selected-${size.width}x${size.height}.png`)})
  await lab.getByRole('button',{name:'START REPLAY'}).click();await expect(lab.locator('.fx-lab-transport')).toBeVisible();await lab.getByRole('button',{name:'Pauza',exact:true}).click()
  const seek=lab.getByRole('slider',{name:'Pozycja odtwarzania w całym archiwum'})
  await seek.evaluate(el=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(el,'7500');el.dispatchEvent(new Event('input',{bubbles:true}))});await expect(lab.getByRole('img',{name:'Wykres świecowy odtworzony z ticków archiwum'})).toBeVisible()
  await lab.getByLabel('TEMPO').selectOption('10')
  await lab.getByRole('button',{name:'Następna świeca'}).click()
  await containment(page,['.fx-lab','.fx-lab-transport'])
  await page.screenshot({path:path.join(output,`replay-session-${size.width}x${size.height}.png`)})
  await lab.locator('.fx-lab-header-actions').getByRole('button',{name:'NOWY IMPORT',exact:true}).click();await expect(lab.getByRole('tab',{name:'IMPORT',exact:true})).toHaveAttribute('aria-selected','true');await expect(lab.locator('.fx-replay-strategies')).toHaveCount(0)
  await page.screenshot({path:path.join(output,`replay-import-${size.width}x${size.height}.png`)})
  await lab.getByRole('tab',{name:'SESJA',exact:true}).click();await expect(lab.getByLabel('SALDO STARTOWE')).toHaveValue('10000')
  await seek.evaluate(el=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(el,'70000');el.dispatchEvent(new Event('input',{bubbles:true}))});await expect(seek).toHaveValue('70000');await expect(lab.locator('.fx-transport-heading')).toContainText('70 001')
  await lab.getByRole('button',{name:'Zamknij FX Replay'}).click();await tools(page,'WSKAŹNIKI');await expect(deck.getByRole('spinbutton',{name:'Okres RSI'})).toHaveValue('9')
  expect(writes).toEqual([]);expect(errors).toEqual([])
})

test('Replay workspace retains MT5 and file import requests, reuse, cancellation and strategy parameters',async({page})=>{
  const requests:Record<string,unknown>[]=[]
  const job={id:'ui-import',archive_id:'ui-archive-xau',status:'complete',symbol:'XAUUSDs',from_ms:Date.UTC(2026,1,14),to_ms:Date.UTC(2026,1,16)-1,completed_through_ms:Date.UTC(2026,1,16)-1,tick_count:85000,progress:100,reused:true,error:null}
  let currentJob={...job}
  const run={id:'ui-run',archive_id:'ui-archive-xau',strategy_id:'strategy-example',status:'complete',params:{},report:null,error:null,progress_ticks:85000,total_ticks:85000,created_at:'2026-10-09',updated_at:'2026-10-09'}
  const reply=(route:Route,value:unknown)=>route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'X-CRT-Protocol, X-CRT-Instance','X-CRT-Protocol':'5','X-CRT-Instance':'visual-fixture'},body:JSON.stringify(value)})
  await page.emulateMedia({reducedMotion:'reduce'})
  await page.route('http://127.0.0.1:8765/**',async route=>{
    const pathname=new URL(route.request().url()).pathname
    if(pathname==='/v1/replay/imports'&&route.request().method()==='POST'){
      const payload=route.request().postDataJSON();requests.push(payload)
      currentJob={...job,...(payload.file_name?{status:'importing',progress:42,reused:false}:{}),symbol:payload.symbol}
      return reply(route,currentJob)
    }
    if(pathname==='/v1/replay/imports/ui-import')return reply(route,currentJob)
    if(pathname==='/v1/replay/imports/ui-import/cancel'){currentJob={...currentJob,status:'cancelled'};return reply(route,currentJob)}
    if(pathname==='/v1/replay/strategies/strategy-example/source')return reply(route,{id:'strategy-example',name:'EMA · przykład',api_version:2,source:'def on_tick(context, tick):\n    pass'})
    if(pathname==='/v1/replay/runs'&&route.request().method()==='POST'){requests.push(route.request().postDataJSON());return reply(route,run)}
    return laboratory(route)
  })
  await openTerminal(page);await page.getByRole('button',{name:/FX REPLAY/}).click()
  const lab=page.getByRole('dialog',{name:'FX REPLAY'})
  await lab.locator('.fx-lab-header-actions').getByRole('button',{name:'NOWY IMPORT',exact:true}).click()
  await lab.getByLabel('SYMBOL BROKERA',{exact:true}).fill('XAUUSDs')
  await lab.getByLabel('OD',{exact:true}).fill('2026-02-14');await lab.getByLabel('DO · WŁĄCZNIE',{exact:true}).fill('2026-02-15')
  await lab.getByRole('button',{name:'IMPORTUJ TICKI',exact:true}).click()
  await expect(lab.locator('.fx-replay-job')).toContainText('Ten zakres jest już w archiwum')
  expect(requests[0]).toEqual({symbol:'XAUUSDs',from_ms:Date.UTC(2026,1,14),to_ms:Date.UTC(2026,1,16)-1})
  await lab.getByRole('tab',{name:/ARCHIWA/}).click();await lab.getByRole('tab',{name:'IMPORT',exact:true}).click()
  await expect(lab.getByLabel('SYMBOL BROKERA')).toHaveValue('XAUUSDs');await expect(lab.getByLabel('OD',{exact:true})).toHaveValue('2026-02-14')
  await lab.getByLabel('ŹRÓDŁO HISTORII').selectOption('file');await lab.getByLabel('PLIK TICKÓW').selectOption('XAUUSDs_ticks.csv');await lab.getByLabel('CZAS EKSPORTU · PRZESUNIĘCIE OD UTC W MINUTACH').fill('120')
  await lab.getByRole('button',{name:'IMPORTUJ TICKI',exact:true}).click();await expect(lab.getByRole('button',{name:'ANULUJ IMPORT'})).toBeEnabled()
  expect(requests[1]).toEqual({...requests[0],file_name:'XAUUSDs_ticks.csv',utc_offset_minutes:120})
  await lab.getByRole('tab',{name:/ARCHIWA/}).click();await expect(lab.locator('.fx-import-notice')).toContainText('42%');await lab.locator('.fx-import-notice').click()
  await lab.getByRole('button',{name:'ANULUJ IMPORT'}).click();await expect(lab.locator('.fx-replay-job')).toContainText('Import anulowany')
  await lab.getByRole('tab',{name:/ARCHIWA/}).click();await lab.getByRole('button',{name:'WYBIERZ',exact:true}).first().click();await lab.getByRole('tab',{name:'SESJA',exact:true}).click()
  await lab.getByLabel('ZAPISANY SKRYPT').selectOption('strategy-example');await lab.getByLabel('SALDO STARTOWE').fill('12000');await lab.getByLabel('DŹWIGNIA').selectOption('50')
  await lab.getByRole('tab',{name:'IMPORT',exact:true}).click();await lab.getByRole('tab',{name:'SESJA',exact:true}).click()
  await expect(lab.getByLabel('SALDO STARTOWE')).toHaveValue('12000')
  await lab.getByRole('button',{name:'URUCHOM SYMULACJĘ'}).click();await expect(lab.locator('.fx-replay-job')).toContainText('Symulacja zakończona')
  expect(requests[2]).toMatchObject({archive_id:'ui-archive-xau',strategy_id:'strategy-example',params:{initial_balance:12000,leverage:50,account_currency:'USD',timeframe:'M5',indicator_model:'mt5'}})
})


test('Session preview shows only supplied provenance, omits absent integrity and opens existing replay',async({page})=>{
  let tickRequests=0
  await page.emulateMedia({reducedMotion:'reduce'})
  await page.route('http://127.0.0.1:8765/**',async route=>{
    const url=new URL(route.request().url())
    if(url.pathname==='/v1/replay/archives')return route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*','Access-Control-Expose-Headers':'X-CRT-Protocol, X-CRT-Instance','X-CRT-Protocol':'5','X-CRT-Instance':'visual-fixture'},body:JSON.stringify({database:'visual-fixture-only',values:[{id:'ui-archive-xau',status:'complete',symbol:'XAUUSDs',requested_symbol:'XAUUSDs',from_ms:Date.UTC(2026,9,2),to_ms:Date.UTC(2026,9,9)-1,tick_count:85000,sha256:null,broker:'',server:'',manifest:{source:'MT5 tick CSV export supplied by user'},error:null,created_at:'2026-10-09',updated_at:'2026-10-09'}]})})
    if(url.pathname.startsWith('/v1/replay/archives/')&&url.pathname.endsWith('/ticks'))tickRequests++
    return laboratory(route)
  })
  await openTerminal(page);await page.getByRole('button',{name:/FX REPLAY/}).click()
  const lab=page.getByRole('dialog',{name:'FX REPLAY'})
  await lab.getByRole('button',{name:'WYBIERZ',exact:true}).click()
  const preview=lab.getByRole('region',{name:'SESSION PREVIEW'})
  await expect(preview).toContainText('MT5 · EKSPORT CSV');await expect(preview).toContainText('Niepodany')
  await expect(preview.locator('.fx-preview-integrity')).toHaveCount(0);await expect(preview).not.toContainText('100%');expect(tickRequests).toBe(0)
  await preview.getByRole('button',{name:'OTWÓRZ REPLAY'}).click()
  await expect(lab.locator('.fx-lab-transport')).toBeVisible();await expect(preview).toHaveCount(0);await expect(lab.getByRole('tab',{name:'SESJA',exact:true})).toHaveAttribute('aria-selected','true');await expect(lab.getByRole('button',{name:'Odtwórz',exact:true})).toBeEnabled();expect(tickRequests).toBeGreaterThan(0)
})
