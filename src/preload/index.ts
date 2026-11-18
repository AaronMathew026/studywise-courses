import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { CHANNELS } from '@shared/channels'

// window.studywise.<domain>.<method>(input) → Promise<output>
const api: Record<string, Record<string, (input?: unknown) => Promise<unknown>>> = {}
for (const ch of CHANNELS) {
  const [domain, method] = ch.split('.')
  api[domain] ??= {}
  api[domain][method] = async (input?: unknown) => {
    const res = (await ipcRenderer.invoke(`sw:${ch}`, input)) as { ok: boolean; data?: unknown; error?: string }
    if (!res.ok) throw new Error(res.error ?? 'Unknown error')
    return res.data
  }
}

contextBridge.exposeInMainWorld('studywise', {
  ...api,
  on: (cb: (ev: unknown) => void) => {
    const listener = (_e: unknown, ev: unknown) => cb(ev)
    ipcRenderer.on('sw:event', listener)
    return () => ipcRenderer.removeListener('sw:event', listener)
  },
  pathForFile: (file: File) => webUtils.getPathForFile(file)
})
