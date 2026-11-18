import { app, Menu, BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { COMMANDS, type MenuName } from '@shared/keymap'

export function buildMenu(send: (action: string) => void): void {
  const items = (menu: MenuName): MenuItemConstructorOptions[] => {
    const out: MenuItemConstructorOptions[] = []
    for (const c of COMMANDS.filter((x) => x.menu === menu)) {
      if (c.separatorBefore && out.length) out.push({ type: 'separator' })
      out.push({ label: c.label, accelerator: c.accelerator, click: () => send(c.id) })
    }
    return out
  }

  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => send('go.settings') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    { label: 'File', submenu: [...items('File'), { type: 'separator' }, { role: 'close' }] },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'selectAll' },
        ...items('Edit')
      ]
    },
    {
      label: 'View',
      submenu: [
        ...items('View'),
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : ([{ type: 'separator' }, { role: 'reload', accelerator: 'Alt+Shift+CmdOrCtrl+R' }, { role: 'toggleDevTools' }] as MenuItemConstructorOptions[]))
      ]
    },
    { label: 'Go', submenu: items('Go') },
    { label: 'Study', submenu: items('Study') },
    { label: 'AI', submenu: items('AI') },
    {
      role: 'window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }, { label: 'Main Window', accelerator: 'Alt+CmdOrCtrl+0', click: () => BrowserWindow.getAllWindows()[0]?.show() }]
    },
    { role: 'help', submenu: items('Help') }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
