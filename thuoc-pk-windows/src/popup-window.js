const path = require('path')

const POPUP_OPTIONS = { frame: false, thickFrame: true, skipTaskbar: false, resizable: true, minimizable: true, maximizable: true, fullscreenable: false }
function performWindowAction(window, action, quit) {
  if (!window || window.isDestroyed()) return false
  if (action === 'minimize') window.minimize()
  else if (action === 'maximize') {
    if (!window.isVisible()) window.show()
    if (window.isMinimized()) window.restore()
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
    window.focus()
  } else if (action === 'close') window.close()
  else if (action === 'quit') quit()
  else return false
  return true
}
function registerTaskbarControls({ app, window, nativeImage, quit, log = () => {}, platform = process.platform }) {
  if (platform !== 'win32') return
  const icon = (name) => nativeImage.createFromPath(path.join(__dirname, '../assets', `taskbar-${name}.png`))
  const perform = (action) => performWindowAction(window, action, quit)
  const refresh = () => {
    if (window.isDestroyed()) return
    const buttons = [
      { tooltip: 'Thu nhỏ', icon: icon('minimize'), click: () => perform('minimize') },
      { tooltip: window.isMaximized() ? 'Khôi phục kích thước' : 'Phóng to', icon: icon(window.isMaximized() ? 'restore' : 'maximize'), click: () => perform('maximize') },
      { tooltip: 'Đóng popup', icon: icon('close'), click: () => perform('close') },
    ]
    try {
      if (!window.setThumbarButtons(buttons)) log('Taskbar preview controls unavailable; use the taskbar menu.')
    } catch (_) { log('Taskbar preview controls unavailable; use the taskbar menu.') }
  }
  window.on('maximize', refresh)
  window.on('unmaximize', refresh)
  window.on('show', refresh)
  window.once('ready-to-show', refresh)
  refresh()
  if (app.isPackaged) {
    const labels = [['minimize', 'Thu nhỏ'], ['maximize', 'Phóng to / khôi phục'], ['close', 'Đóng popup'], ['quit', 'Thoát hoàn toàn']]
    const result = app.setJumpList([{ type: 'tasks', items: labels.map(([action, title]) => ({ type: 'task', title, description: title, program: process.execPath, args: `--popup-${action}`, iconPath: process.execPath, iconIndex: 0 })) }])
    if (result !== 'ok') log('Taskbar menu could not be registered.')
  }
}
module.exports = { POPUP_OPTIONS, performWindowAction, registerTaskbarControls }
