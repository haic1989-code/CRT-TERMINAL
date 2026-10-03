import { readFileSync } from 'node:fs'

// Windows PowerShell 5.1 treats BOM-less UTF-8 as the system ANSI code page.
// Polish letters can become quote characters and prevent the script parsing.
const config = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'))
for (const source of Object.keys(config.bundle.resources)) {
  if (!source.toLowerCase().endsWith('.ps1')) continue
  const path = new URL(`../src-tauri/${source}`, import.meta.url)
  const bytes = readFileSync(path)
  if (bytes[0] !== 0xef || bytes[1] !== 0xbb || bytes[2] !== 0xbf) {
    throw new Error(`Packaged PowerShell script must use UTF-8 with BOM: ${source}`)
  }
  new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}
console.log('Packaged PowerShell encoding: UTF-8 BOM OK')
