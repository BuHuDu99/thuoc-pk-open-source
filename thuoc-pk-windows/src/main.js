const { app, BrowserWindow, Menu, Tray, dialog, globalShortcut, ipcMain, nativeImage, session, shell, screen } = require('electron')
const { autoUpdater } = require('electron-updater')
const { createHash, timingSafeEqual } = require('crypto')
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')
const { DASBridge } = require('./das-bridge')
const { describeUpdateError } = require('./update-errors')
const { POPUP_OPTIONS, performWindowAction, registerTaskbarControls } = require('./popup-window')

// Dùng thư mục ứng dụng mới để bản "Tra cứu" không bị một tiến trình
// "Thuốc PK" cũ giữ khóa khi nâng cấp hoặc khi thử trong máy ảo.
app.setPath('userData', path.join(app.getPath('appData'), 'TraCuu'))

// Electron 22 can open a fully white renderer inside older Windows/virtual
// display drivers. Force software rendering before Chromium starts so the
// lock screen remains visible on Windows 7 and in virtual machines.
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu')

const APP_URL = 'https://thuoc-pk.vercel.app/'
const ALLOWED_ORIGIN = new URL(APP_URL).origin
const UPDATE_FEED_URL = `${ALLOWED_ORIGIN}/updates/windows/`
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
const DEFAULT_WIDTH = 440
const DEFAULT_HEIGHT = 760
const MIN_WIDTH = 380
const MIN_HEIGHT = 560
const PASSCODE_HASH = Buffer.from(process.env.TRACUU_PASSCODE_SHA256 || '', 'hex')
const MAX_UNLOCK_ATTEMPTS = 5
const UNLOCK_DELAY_MS = 30_000
const DAS_THEME_CSS = ['cis-ui.css', 'das-theme.css'].map((file) => fs.readFileSync(path.join(__dirname, file), 'utf8')).join('\n')

let mainWindow = null
let tray = null
let dasSettingsWindow = null
let dasBridge = null
let isQuitting = false
let isPinned = true
let isUnlocked = false
let failedUnlockAttempts = 0
let unlockBlockedUntil = 0
let updateState = 'idle'
let updateVersion = ''
let manualUpdateCheck = false

const statePath = () => path.join(app.getPath('userData'), 'window-state.json')
const logPath = () => path.join(app.getPath('userData'), 'startup.log')

function writeLog(message) {
  try {
    fs.mkdirSync(path.dirname(logPath()), { recursive: true })
    fs.appendFileSync(logPath(), `${new Date().toISOString()} ${message}\n`, 'utf8')
  } catch (_) {
    // Nhật ký chẩn đoán không được phép cản trở việc khởi động.
  }
}

function readWindowState() {
  try {
    const state = JSON.parse(fs.readFileSync(statePath(), 'utf8'))
    if ([state.x, state.y, state.width, state.height].every(Number.isFinite)) return state
  } catch (_) {
    // Khởi động với vị trí mặc định khi chưa có hoặc tệp trạng thái bị lỗi.
  }
  return null
}

function clampBoundsToDisplay(bounds) {
  const { workArea } = screen.getDisplayMatching(bounds)
  const width = Math.min(Math.max(bounds.width, MIN_WIDTH), workArea.width)
  const height = Math.min(Math.max(bounds.height, MIN_HEIGHT), workArea.height)

  return {
    width,
    height,
    x: Math.min(Math.max(bounds.x, workArea.x), workArea.x + workArea.width - width),
    y: Math.min(Math.max(bounds.y, workArea.y), workArea.y + workArea.height - height),
  }
}

function initialBounds() {
  const saved = readWindowState()
  if (saved) return clampBoundsToDisplay(saved)

  const { workArea } = screen.getPrimaryDisplay()
  const inset = 12
  const width = Math.min(DEFAULT_WIDTH, Math.max(MIN_WIDTH, workArea.width - inset * 2))
  const height = Math.min(DEFAULT_HEIGHT, Math.max(MIN_HEIGHT, workArea.height - inset * 2))
  return {
    width,
    height,
    x: workArea.x + Math.max(0, workArea.width - width - inset),
    y: workArea.y + inset,
  }
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) return
  try {
    fs.mkdirSync(path.dirname(statePath()), { recursive: true })
    fs.writeFileSync(statePath(), JSON.stringify(mainWindow.getBounds()))
  } catch (_) {
    // Việc ghi nhớ vị trí là tiện ích phụ, không làm gián đoạn ứng dụng.
  }
}

function isAllowedUrl(rawUrl) {
  try {
    return new URL(rawUrl).origin === ALLOWED_ORIGIN
  } catch (_) {
    return false
  }
}

function showOfflinePage(errorDescription = '') {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const offlinePath = path.join(__dirname, 'offline.html')
  const query = new URLSearchParams({ reason: errorDescription }).toString()
  writeLog(`Không tải được website: ${errorDescription || 'không rõ nguyên nhân'}`)
  mainWindow.loadURL(`${pathToFileURL(offlinePath).href}?${query}`).catch((error) => writeLog(`Không tải được trang ngoại tuyến: ${error.message}`))
  ensureWindowVisible()
}

function loadLockScreen() {
  if (!mainWindow || mainWindow.isDestroyed()) return Promise.resolve()
  const lockPath = path.join(__dirname, 'lock.html')
  return mainWindow.loadFile(lockPath).catch((error) => {
    writeLog(`Không tải được màn hình khóa: ${error.message}`)
    showOfflinePage('Không thể mở màn hình khóa.')
  })
}

function loadApplication() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (!isUnlocked) {
    loadLockScreen()
    return
  }
  writeLog(`Đang tải ${APP_URL}`)
  mainWindow.loadURL(APP_URL).catch((error) => showOfflinePage(error.message))
}

function lockApplication() {
  dasBridge?.stop()
  dasSettingsWindow?.close()
  isUnlocked = false
  failedUnlockAttempts = 0
  unlockBlockedUntil = 0
  writeLog('Ứng dụng đã được khóa.')
  mainWindow.hide()
  loadLockScreen().then(ensureWindowVisible)
  rebuildTrayMenu()
}

function lockWhileHidden() {
  dasBridge?.stop()
  dasSettingsWindow?.close()
  isUnlocked = false
  failedUnlockAttempts = 0
  unlockBlockedUntil = 0
  writeLog('Ứng dụng đã được khóa khi ẩn hoặc đóng cửa sổ.')
  loadLockScreen()
  rebuildTrayMenu()
}

function ensureWindowVisible() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const visibleBounds = clampBoundsToDisplay(mainWindow.getBounds())
  mainWindow.setBounds(visibleBounds)
  if (!mainWindow.isVisible()) mainWindow.show()
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
}

function toggleWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isVisible()) {
    lockWhileHidden()
    mainWindow.hide()
  } else {
    if (isUnlocked) lockWhileHidden()
    ensureWindowVisible()
  }
}

function handleSecondInstance(_event, argv = []) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const command = argv.find((arg) => /^--popup-(minimize|maximize|close|quit)$/.test(arg))
  if (command && performWindowAction(mainWindow, command.slice('--popup-'.length), () => app.quit())) return
  lockApplication()
}

function updateMenuLabel() {
  if (updateState === 'checking') return 'Đang kiểm tra cập nhật…'
  if (updateState === 'downloading') return updateVersion ? `Đang tải bản ${updateVersion}…` : 'Đang tải bản cập nhật…'
  if (updateState === 'ready') return updateVersion ? `Cài bản ${updateVersion}…` : 'Cài bản cập nhật…'
  return 'Kiểm tra cập nhật'
}

function showUpdateReadyDialog() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  ensureWindowVisible()
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Cập nhật Tra cứu',
    message: `Phiên bản ${updateVersion || 'mới'} đã tải xong.`,
    detail: 'Khởi động lại ứng dụng để hoàn tất cập nhật.',
    buttons: ['Khởi động lại và cập nhật', 'Để sau'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  }).then(({ response }) => {
    if (response === 0) {
      isQuitting = true
      autoUpdater.quitAndInstall(false, true)
    }
  }).catch((error) => writeLog(`Không mở được thông báo cập nhật: ${error.message}`))
}

function checkForUpdates(isManual = false) {
  if (!app.isPackaged || process.platform !== 'win32') {
    if (isManual && mainWindow && !mainWindow.isDestroyed()) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Cập nhật Tra cứu',
        message: 'Kiểm tra cập nhật chỉ hoạt động trên bản cài đặt Windows.',
        buttons: ['Đóng'],
        noLink: true,
      })
    }
    return
  }

  manualUpdateCheck = isManual
  updateState = 'checking'
  rebuildTrayMenu()
  writeLog(`Kiểm tra cập nhật${isManual ? ' theo yêu cầu người dùng' : ' tự động'}.`)
  autoUpdater.checkForUpdates().catch((error) => {
    updateState = 'idle'
    rebuildTrayMenu()
    writeLog(`Kiểm tra cập nhật thất bại: ${error.message}`)
  })
}

function configureAutoUpdater() {
  if (!app.isPackaged || process.platform !== 'win32') return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowDowngrade = false
  autoUpdater.allowPrerelease = false
  autoUpdater.logger = {
    info: (message) => writeLog(`[Updater] ${message}`),
    warn: (message) => writeLog(`[Updater cảnh báo] ${message}`),
    error: (message) => writeLog(`[Updater lỗi] ${message}`),
    debug: (message) => writeLog(`[Updater] ${message}`),
  }
  autoUpdater.setFeedURL({ provider: 'generic', url: UPDATE_FEED_URL })

  autoUpdater.on('update-available', (info) => {
    updateVersion = info.version || ''
    updateState = 'downloading'
    rebuildTrayMenu()
    writeLog(`Có phiên bản mới ${updateVersion}; bắt đầu tải.`)
  })

  autoUpdater.on('update-not-available', () => {
    updateState = 'idle'
    rebuildTrayMenu()
    writeLog('Ứng dụng đang ở phiên bản mới nhất.')
    if (manualUpdateCheck && mainWindow && !mainWindow.isDestroyed()) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Cập nhật Tra cứu',
        message: `Bạn đang dùng phiên bản mới nhất (${app.getVersion()}).`,
        buttons: ['Đóng'],
        noLink: true,
      })
    }
    manualUpdateCheck = false
  })

  autoUpdater.on('download-progress', (progress) => {
    const percent = Number.isFinite(progress.percent) ? Math.round(progress.percent) : 0
    updateState = 'downloading'
    tray?.setToolTip(`Tra cứu · Đang tải cập nhật ${percent}%`)
  })

  autoUpdater.on('update-downloaded', (info) => {
    updateVersion = info.version || updateVersion
    updateState = 'ready'
    manualUpdateCheck = false
    tray?.setToolTip('Tra cứu · Bản cập nhật đã sẵn sàng')
    rebuildTrayMenu()
    writeLog(`Đã tải xong phiên bản ${updateVersion}.`)
    showUpdateReadyDialog()
  })

  autoUpdater.on('error', (error) => {
    const description = describeUpdateError(error)
    const shouldNotify = manualUpdateCheck
    manualUpdateCheck = false
    updateState = 'idle'
    tray?.setToolTip('Tra cứu · Ctrl+Alt+T để mở/ẩn')
    rebuildTrayMenu()
    writeLog(`Cập nhật thất bại: ${error.message}`)
    if (shouldNotify && mainWindow && !mainWindow.isDestroyed()) {
      dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Cập nhật Tra cứu',
        message: description.message,
        detail: description.detail,
        buttons: ['Đóng'],
        noLink: true,
      })
    }
  })

  setTimeout(() => checkForUpdates(false), 10_000).unref()
  setInterval(() => checkForUpdates(false), UPDATE_CHECK_INTERVAL_MS).unref()
}

function rebuildTrayMenu() {
  if (!tray) return
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Mở / ẩn Tra cứu', click: toggleWindow },
    { label: 'Làm mới dữ liệu', click: loadApplication },
    { label: 'Khóa ngay', enabled: isUnlocked, click: lockApplication },
    { label: 'Kết nối ứng dụng khám CIS…', enabled: isUnlocked, click: openDASSettings },
    {
      label: updateMenuLabel(),
      enabled: updateState !== 'checking' && updateState !== 'downloading',
      click: () => updateState === 'ready' ? showUpdateReadyDialog() : checkForUpdates(true),
    },
    {
      label: 'Luôn nổi trên cùng',
      type: 'checkbox',
      checked: isPinned,
      click: (item) => {
        isPinned = item.checked
        mainWindow.setAlwaysOnTop(isPinned, 'floating')
        rebuildTrayMenu()
      },
    },
    { type: 'separator' },
    {
      label: 'Thoát hoàn toàn',
      click: () => {
        isQuitting = true
        app.quit()
      },
    },
  ]))
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'icon.png')).resize({ width: 20, height: 20 })
  tray = new Tray(icon)
  tray.setToolTip('Tra cứu · Ctrl+Alt+T để mở/ẩn')
  tray.on('click', toggleWindow)
  rebuildTrayMenu()
}

function createWindow() {
  mainWindow = new BrowserWindow({
    ...POPUP_OPTIONS,
    ...initialBounds(),
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    title: 'Tra cứu',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    alwaysOnTop: true,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  })

  mainWindow.setMenu(null)
  try { registerTaskbarControls({ app, window: mainWindow, nativeImage, quit: () => app.quit(), log: writeLog }) }
  catch (_) { writeLog('Không tạo được nút taskbar; vẫn có thể dùng menu khay hệ thống.') }
  mainWindow.once('ready-to-show', ensureWindowVisible)
  mainWindow.webContents.on('did-finish-load', () => {
    const loadedUrl = mainWindow.webContents.getURL()
    writeLog(`Nội dung đã tải xong: ${loadedUrl}`)
    if (isAllowedUrl(loadedUrl)) {
      mainWindow.webContents.insertCSS(DAS_THEME_CSS).catch(() => writeLog('Không áp dụng được giao diện DAS.'))
      if (isUnlocked) dasBridge.start()
    }
    if (mainWindow.isVisible()) ensureWindowVisible()
  })
  mainWindow.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) dasBridge?.stop()
  })
  mainWindow.on('resize', saveWindowState)
  mainWindow.on('move', saveWindowState)
  mainWindow.on('close', (event) => {
    saveWindowState()
    if (!isQuitting) {
      event.preventDefault()
      lockWhileHidden()
      mainWindow.hide()
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedUrl(url) && !url.startsWith('file://')) {
      event.preventDefault()
      if (url.startsWith('https://')) shell.openExternal(url)
    }
  })

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
    if (isMainFrame && errorCode !== -3 && !validatedUrl.startsWith('file://')) showOfflinePage(errorDescription)
  })
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    writeLog(`Tiến trình hiển thị dừng: ${details.reason}`)
    showOfflinePage('Ứng dụng hiển thị đã dừng. Hãy thử tải lại.')
  })
  mainWindow.on('unresponsive', () => writeLog('Cửa sổ không phản hồi.'))

  loadLockScreen()
}

function isAppSender(event) {
  return isUnlocked && mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents &&
    event.senderFrame === mainWindow.webContents.mainFrame && isAllowedUrl(event.senderFrame.url)
}

function isSettingsSender(event) {
  return isUnlocked && dasSettingsWindow && !dasSettingsWindow.isDestroyed() && event.sender === dasSettingsWindow.webContents &&
    event.senderFrame === dasSettingsWindow.webContents.mainFrame && event.senderFrame.url === pathToFileURL(path.join(__dirname, 'das-settings.html')).href
}

function openDASSettings() {
  if (!isUnlocked) return
  if (dasSettingsWindow && !dasSettingsWindow.isDestroyed()) { dasSettingsWindow.focus(); return }
  dasSettingsWindow = new BrowserWindow({
    width: 620, height: 560, minWidth: 440, minHeight: 460,
    title: 'Kết nối ứng dụng khám CIS', parent: mainWindow, autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true },
  })
  dasSettingsWindow.setMenu(null)
  dasSettingsWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  dasSettingsWindow.webContents.on('will-navigate', (event) => event.preventDefault())
  dasSettingsWindow.on('closed', () => { dasSettingsWindow = null })
  dasSettingsWindow.loadFile(path.join(__dirname, 'das-settings.html'))
}

ipcMain.handle('das-state', (event) => isAppSender(event) ? dasBridge.state : { status: 'disabled' })
ipcMain.handle('das-settings-open', (event) => { if (isAppSender(event)) openDASSettings() })
ipcMain.handle('das-toggle', (event, resume) => {
  if (!isAppSender(event)) return
  if (resume === true) dasBridge.start()
  else { dasBridge.stop(); dasBridge.publish({ status: 'paused' }) }
})
ipcMain.handle('das-config', (event) => isSettingsSender(event) ? { config: dasBridge.config, state: dasBridge.state, diagnostic: dasBridge.diagnostic, platform: process.platform } : null)
ipcMain.handle('das-inspect', (event) => isSettingsSender(event) ? dasBridge.inspect() : null)
ipcMain.handle('das-save', (event, value) => {
  if (!isSettingsSender(event)) return { ok: false }
  try {
    dasBridge.save(value)
    if (mainWindow && isAllowedUrl(mainWindow.webContents.getURL())) dasBridge.start()
    return { ok: true }
  } catch (error) { return { ok: false, message: error.message } }
})

ipcMain.handle('unlock-app', (event, passcode) => {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents || isUnlocked) {
    return { ok: false, message: 'Yêu cầu không hợp lệ.' }
  }

  const currentUrl = mainWindow.webContents.getURL()
  if (!currentUrl.startsWith('file:') || !currentUrl.includes('lock.html')) {
    return { ok: false, message: 'Yêu cầu không hợp lệ.' }
  }

  const now = Date.now()
  if (now < unlockBlockedUntil) {
    return { ok: false, waitSeconds: Math.ceil((unlockBlockedUntil - now) / 1000) }
  }

  const candidateHash = createHash('sha256').update(String(passcode || '')).digest()
  if (candidateHash.length === PASSCODE_HASH.length && timingSafeEqual(candidateHash, PASSCODE_HASH)) {
    isUnlocked = true
    failedUnlockAttempts = 0
    unlockBlockedUntil = 0
    writeLog('Mở khóa thành công.')
    rebuildTrayMenu()
    setTimeout(loadApplication, 100)
    return { ok: true }
  }

  failedUnlockAttempts += 1
  if (failedUnlockAttempts >= MAX_UNLOCK_ATTEMPTS) {
    failedUnlockAttempts = 0
    unlockBlockedUntil = now + UNLOCK_DELAY_MS
    writeLog('Tạm khóa nhập mã trong 30 giây do nhập sai nhiều lần.')
    return { ok: false, waitSeconds: Math.ceil(UNLOCK_DELAY_MS / 1000) }
  }

  return { ok: false, remainingAttempts: MAX_UNLOCK_ATTEMPTS - failedUnlockAttempts }
})

const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', handleSecondInstance)
}

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return
  // A pinned taskbar menu may outlive the running application.
  if (process.argv.some((arg) => /^--popup-(close|quit)$/.test(arg))) { app.quit(); return }
  app.setAppUserModelId('vn.tracuu.popup')
  writeLog(`Khởi động ứng dụng ${app.getVersion()} trên ${process.platform} ${process.arch}.`)
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)

  dasBridge = new DASBridge({ app, onDiagnostic: ({ reason, phase, attempt, mode, retrying }) => writeLog(`CIS: reason=${reason}; phase=${phase}; attempt=${attempt}; mode=${mode}; retrying=${retrying}`), onState: (state) => {
    if (isUnlocked && mainWindow && !mainWindow.isDestroyed() && isAllowedUrl(mainWindow.webContents.getURL())) mainWindow.webContents.send('das-state-update', state)
  } })
  createWindow()
  try {
    createTray()
  } catch (error) {
    writeLog(`Không tạo được biểu tượng khay hệ thống: ${error.message}`)
  }

  configureAutoUpdater()

  const shortcutRegistered = globalShortcut.register('CommandOrControl+Alt+T', toggleWindow)
  if (!shortcutRegistered) writeLog('Phím tắt Ctrl+Alt+T đang được ứng dụng khác sử dụng.')
}).catch((error) => {
  writeLog(`Khởi động thất bại: ${error.stack || error.message}`)
  app.quit()
})

app.on('before-quit', () => {
  isQuitting = true
  dasBridge?.stop()
  saveWindowState()
})

app.on('will-quit', () => globalShortcut.unregisterAll())

app.on('window-all-closed', (event) => {
  event.preventDefault()
})

