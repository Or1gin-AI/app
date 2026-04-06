import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'

function createWindow(): void {
  const isMac = process.platform === 'darwin'

  const mainWindow = new BrowserWindow({
    width: 800,
    height: 540,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    frame: isMac ? true : false,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    ...(isMac ? {} : {
      titleBarOverlay: {
        color: 'rgba(0,0,0,0)',
        symbolColor: '#6b6560',
        height: 36
      }
    }),
    trafficLightPosition: isMac ? { x: 16, y: 11 } : undefined,
    backgroundColor: '#faf8f5',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.originai.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
