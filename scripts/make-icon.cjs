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
  // Windows .ico: PNG-compressed entries at 16–256px.
  const sizes = [16, 24, 32, 48, 64, 128, 256]
  const pngs = sizes.map((sz) => {
    const out = join(set, `ico_${sz}.png`)
    execFileSync('sips', ['-z', String(sz), String(sz), join(root, 'build/icon.png'), '--out', out], { stdio: 'ignore' })
    return readFileSync(out)
  })
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(sizes.length, 4)
  const dir = Buffer.alloc(16 * sizes.length)
  let offset = 6 + dir.length
  sizes.forEach((sz, i) => {
    const b = i * 16
    dir.writeUInt8(sz >= 256 ? 0 : sz, b)
    dir.writeUInt8(sz >= 256 ? 0 : sz, b + 1)
    dir.writeUInt8(0, b + 2)
    dir.writeUInt8(0, b + 3)
    dir.writeUInt16LE(1, b + 4)
    dir.writeUInt16LE(32, b + 6)
    dir.writeUInt32LE(pngs[i].length, b + 8)
    dir.writeUInt32LE(offset, b + 12)
    offset += pngs[i].length
  })
  writeFileSync(join(root, 'build/icon.ico'), Buffer.concat([header, dir, ...pngs]))
  rmSync(set, { recursive: true, force: true })
  console.log('wrote build/icon.icns, build/icon.ico, build/icon.png, resources/icon.png')
  app.quit()
})
