import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const { version } = JSON.parse(await readFile('package.json', 'utf8'))
const config = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8'))
if (config.version !== version || !config.bundle.createUpdaterArtifacts || !config.plugins.updater.pubkey) throw new Error('Release configuration mismatch')
const folder = 'src-tauri/target/release/bundle/nsis'
const installers = (await readdir(folder)).filter(file => file.endsWith('_x64-setup.exe') && file.includes(`_${version}_`))
if (installers.length !== 1) throw new Error('Expected exactly one installer for this version')
const installer = installers[0]
const signature = (await readFile(join(folder, `${installer}.sig`), 'utf8')).trim()
if (!signature) throw new Error('Missing updater signature')
const manifest = {
  version, notes: await readFile('docs/current-release.md', 'utf8'), pub_date: new Date().toISOString(),
  platforms: { 'windows-x86_64': { signature, url: `https://github.com/haic1989-code/CRT-TERMINAL/releases/download/v${version}/${encodeURIComponent(installer)}` } },
}
await mkdir('.smartflow-runtime/release', { recursive: true })
await writeFile('.smartflow-runtime/release/latest.json', `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Prepared signed update manifest for ${version}`)
