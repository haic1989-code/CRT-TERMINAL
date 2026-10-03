import { isTauri } from '@tauri-apps/api/core'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { stopMt5Bridge } from './bridgeShutdown'

export type UpdateCheck = { update: Update | null; message: string; warning: boolean }
export async function checkTerminalUpdate(): Promise<UpdateCheck> {
  if (!isTauri()) return { update: null, message: 'To podgląd przeglądarkowy. Aktualizacje instaluję tylko w aplikacji Windows.', warning: false }
  try {
    const update = await check({ timeout: 8000 })
    return { update, message: update ? `Znalazłam wersję ${update.version}. Zainstaluję ją tylko po Twoim potwierdzeniu.` : 'Masz aktualną opublikowaną wersję terminalu.', warning: false }
  } catch {
    // Offline/missing release is not evidence that the current app is newest.
    return { update: null, message: 'Nie mogę teraz sprawdzić wydań. Uruchomię lokalną wersję; nie potwierdzam, że jest najnowsza.', warning: true }
  }
}
export async function installTerminalUpdate(update: Update, progress: (text: string) => void): Promise<void> {
  let downloaded = 0, total = 0
  progress(`Pobieram podpisane wydanie ${update.version}…`)
  await update.download(event => {
    if (event.event === 'Started') total = event.data.contentLength || 0
    if (event.event === 'Progress') {
      downloaded += event.data.chunkLength
      progress(total ? `Pobieram aktualizację: ${Math.min(100, Math.round(downloaded / total * 100))}%.` : `Pobieram aktualizację: ${(downloaded / 1048576).toFixed(1)} MB.`)
    }
  }, { timeout: 120000 })
  // Download validates the signature before stopping any working local service.
  progress('Podpis jest poprawny. Zamykam własny most MT5 przed instalacją…')
  await stopMt5Bridge({ allowUnavailable: true })
  progress('Instaluję aktualizację. Terminal zostanie ponownie uruchomiony.')
  await update.install()
  // On Windows, the updater starts NSIS and restarts the application itself.
}
