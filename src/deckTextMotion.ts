export type DeckMotionMode = 'fall' | 'rewrite'
type Glyph = { char: string; x: number; y: number; font: string; color: string; start: number; duration: number }

/** Only projects text; live React state, accessible labels and handlers stay intact. */
export function runDeckTextMotion(root: HTMLElement, canvas: HTMLCanvasElement, mode: DeckMotionMode, intensity: number, done: () => void) {
  const ctx = canvas.getContext('2d')
  if (!ctx) { done(); return () => {} }
  const hidden = [...root.querySelectorAll<HTMLElement>('[data-deck-text],.inline-params input')]
  const bounds = root.getBoundingClientRect()
  const content = root.querySelector<HTMLElement>('.deck-content')!
  const fromY = content.getBoundingClientRect().top - bounds.top - 30
  const glyphs: Glyph[] = []
  const start = performance.now()
  let time = start + 350
  const speed = Math.max(1, Math.min(5, intensity))
  const charDelay = [0, 40, 28, 19, 11, 5][speed]
  const wordDelay = [0, 160, 120, 80, 45, 25][speed]
  for (const el of hidden) {
    const style = getComputedStyle(el)
    const font = style.font || `${style.fontSize} ${style.fontFamily}`
    let inWord = false
    const add = (char: string, x: number, y: number) => {
      if (!char.trim()) { if (inWord) time += wordDelay; inWord = false; return }
      glyphs.push({ char, x, y, font, color: style.color, start: mode === 'fall' ? start + 350 + Math.random() * 1600 : time, duration: (1200 + Math.random() * 2500) / (1 + speed * .1) })
      time += charDelay; inWord = true
    }
    if (el instanceof HTMLInputElement) {
      ctx.font = font
      const r = el.getBoundingClientRect()
      for (let i = 0; i < el.value.length; i++) add(el.value[i], r.left - bounds.left + ctx.measureText(el.value.slice(0, i)).width, r.top - bounds.top + 3)
    } else {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      let node: Node | null
      while ((node = walker.nextNode())) {
        let offset = 0
        for (const char of node.textContent ?? '') {
          const range = document.createRange()
          range.setStart(node, offset); offset += char.length; range.setEnd(node, offset)
          const r = range.getBoundingClientRect()
          add(char, r.left - bounds.left, r.top - bounds.top)
        }
      }
    }
    time += wordDelay
  }
  let raf = 0, dead = false
  hidden.forEach(el => el.style.visibility = 'hidden')
  root.dataset.effectActive = ''; root.dataset.motionPhase = 'blank'
  const restore = () => {
    hidden.forEach(el => { if (el.isConnected) el.style.visibility = '' })
    delete root.dataset.effectActive
    ctx.clearRect(0, 0, canvas.width, canvas.height)
  }
  const paint = (now: number) => {
    if (dead || !root.isConnected) { restore(); return }
    const dpr = window.devicePixelRatio || 1
    if (canvas.width !== Math.round(bounds.width * dpr) || canvas.height !== Math.round(bounds.height * dpr)) {
      canvas.width = Math.round(bounds.width * dpr); canvas.height = Math.round(bounds.height * dpr)
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, bounds.width, bounds.height)
    ctx.save(); ctx.beginPath(); ctx.rect(0, Math.max(0, fromY + 18), bounds.width, bounds.height); ctx.clip()
    ctx.textBaseline = 'top'; let completed = 0, active = false
    for (const glyph of glyphs) {
      if (now < glyph.start) continue
      active = true; ctx.font = glyph.font; ctx.fillStyle = glyph.color
      const p = mode === 'rewrite' ? 1 : Math.min(1, (now - glyph.start) / glyph.duration)
      const y = mode === 'rewrite' ? glyph.y : fromY + (glyph.y - fromY) * p * p
      if (p === 1) completed++
      else for (let trail = 1; trail <= Math.min(3, speed); trail++) {
        ctx.globalAlpha = .12 / trail; ctx.fillText(glyph.char, glyph.x, y - trail * 12)
      }
      ctx.globalAlpha = 1; ctx.fillText(glyph.char, glyph.x, y)
    }
    if (mode === 'rewrite' && active && Math.floor(now / 400) % 2 === 0) {
      const next = glyphs.find(glyph => now < glyph.start)
      if (next) { ctx.font = next.font; ctx.fillStyle = next.color; ctx.fillText('▂', next.x, next.y) }
    }
    ctx.restore()
    root.dataset.motionPhase = active ? mode === 'fall' ? 'falling' : 'typing' : 'blank'
    if (completed === glyphs.length) { restore(); root.dataset.motionPhase = 'restored'; done(); return }
    raf = requestAnimationFrame(paint)
  }
  raf = requestAnimationFrame(paint)
  return () => { dead = true; cancelAnimationFrame(raf); restore(); root.dataset.motionPhase = 'restored' }
}
