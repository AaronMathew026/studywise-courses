// Rasterise build/icon.svg with Electron and build build/icon.icns + resources/icon.png.
// Run: npm run icons
const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync, mkdirSync, rmSync } = require('node:fs')
const { join } = require('node:path')
const { execFileSync } = require('node:child_process')

const root = join(__dirname, '..')
app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const svg = readFileSync(join(root, 'build/icon.svg'), 'utf8')
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true } })
  win.webContents.setFrameRate(1)
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`))
  await new Promise((r) => setTimeout(r, 600))
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 })
  const png = img.resize({ width: 1024, height: 1024 }).toPNG()
  mkdirSync(join(root, 'resources'), { recursive: true })
  writeFileSync(join(root, 'build/icon.png'), png)
  writeFileSync(join(root, 'resources/icon.png'), png)
  const set = join(root, 'build/icon.iconset')
  rmSync(set, { recursive: true, force: true })
  mkdirSync(set)
  for (const s of [16, 32, 128, 256, 512]) {
    execFileSync('sips', ['-z', String(s), String(s), join(root, 'build/icon.png'), '--out', join(set, `icon_${s}x${s}.png`)], { stdio: 'ignore' })
    execFileSync('sips', ['-z', String(s * 2), String(s * 2), join(root, 'build/icon.png'), '--out', join(set, `icon_${s}x${s}@2x.png`)], { stdio: 'ignore' })
  }
  execFileSync('iconutil', ['-c', 'icns', set, '-o', join(root, 'build/icon.icns')])
  rmSync(set, { recursive: true, force: true })
  console.log('wrote build/icon.icns, build/icon.png, resources/icon.png')
  app.quit()
})
