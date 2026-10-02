import { afterEach, describe, expect, it, vi } from 'vitest'
import { stopMt5Bridge } from './bridgeShutdown'
const runtime={instance:'instance-a',shutdown_token:'token-a',closing:false}
const json=(value:unknown)=>new Response(JSON.stringify(value))
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals()})
describe('bridge shutdown confirmation',()=>{
  it('confirms shutdown after the bridge accepts and exits its local listener',async()=>{
    vi.stubGlobal('window',globalThis)
    vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(json(runtime)).mockResolvedValueOnce(json({accepted:true,instance:'instance-a'})).mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(stopMt5Bridge()).resolves.toBeUndefined()
  })
  it('rejects an incompatible old bridge without sending shutdown',async()=>{
    const fetch=vi.fn().mockResolvedValue(new Response('',{status:404}));vi.stubGlobal('fetch',fetch)
    await expect(stopMt5Bridge()).rejects.toThrow('HTTP 404');expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('lets the desktop close when bridge startup never opened its listener',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(stopMt5Bridge({allowUnavailable:true})).resolves.toBeUndefined()
  })
  it('does not claim success when another instance replaces the closing bridge',async()=>{
    vi.useFakeTimers();vi.stubGlobal('window',globalThis)
    vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(json(runtime)).mockResolvedValueOnce(json({accepted:true,instance:'instance-a'})).mockResolvedValue(json({...runtime,instance:'instance-b'})))
    const assertion=expect(stopMt5Bridge()).rejects.toThrow('nowy most');await vi.runAllTimersAsync();await assertion
  })
  it('keeps checking timed out requests instead of falsely declaring shutdown',async()=>{
    vi.useFakeTimers();vi.stubGlobal('window',globalThis)
    const timeout=Object.assign(new Error('temporary timeout'),{name:'TimeoutError'})
    vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(json(runtime)).mockResolvedValueOnce(json({accepted:true,instance:'instance-a'})).mockRejectedValue(timeout))
    const assertion=expect(stopMt5Bridge()).rejects.toThrow('Most nadal działa');await vi.runAllTimersAsync();await assertion
  })
})
