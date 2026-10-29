const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { POPUP_OPTIONS, performWindowAction, registerTaskbarControls } = require('../src/popup-window')
function fixture() {
  const window = new EventEmitter(), calls = []
  let visible = false, minimized = true, maximized = false
  Object.assign(window, { isDestroyed: () => false, isVisible: () => visible, isMinimized: () => minimized, isMaximized: () => maximized,
    show: () => { visible = true; calls.push('show') }, restore: () => { minimized = false; calls.push('restore') },
    maximize: () => { maximized = true; calls.push('maximize'); window.emit('maximize') },
    unmaximize: () => { maximized = false; calls.push('unmaximize'); window.emit('unmaximize') },
    minimize: () => calls.push('minimize'), close: () => calls.push('close'), focus: () => calls.push('focus'),
    setThumbarButtons: buttons => { window.buttons = buttons; return true },
  })
  return { window, calls }
}
test('frameless popup keeps native taskbar and resizing capabilities', () => {
  assert.equal(POPUP_OPTIONS.frame, false); assert.equal(POPUP_OPTIONS.skipTaskbar, false)
  assert.equal(POPUP_OPTIONS.minimizable, true); assert.equal(POPUP_OPTIONS.maximizable, true); assert.equal(POPUP_OPTIONS.resizable, true)
})
test('taskbar actions restore hidden/minimized windows and toggle maximize without bypassing authentication', () => {
  const { window, calls } = fixture()
  performWindowAction(window, 'maximize')
  assert.deepEqual(calls, ['show', 'restore', 'maximize', 'focus'])
  performWindowAction(window, 'maximize'); assert.equal(window.isMaximized(), false)
  performWindowAction(window, 'minimize'); performWindowAction(window, 'close')
  assert.deepEqual(calls.slice(-2), ['minimize', 'close'])
  assert.equal(performWindowAction(window, 'unlock'), false)
  let quit = false; performWindowAction(window, 'quit', () => { quit = true }); assert.equal(quit, true)
})
test('Windows taskbar preview and menu expose controls; other platforms skip Windows APIs', () => {
  const { window, calls } = fixture()
  let tasks
  const app = { isPackaged: true, setJumpList: sections => { tasks = sections[0].items; return 'ok' } }
  registerTaskbarControls({ app, window, nativeImage: { createFromPath: p => p }, quit: () => {}, platform: 'darwin' })
  assert.equal(window.buttons, undefined)
  registerTaskbarControls({ app, window, nativeImage: { createFromPath: p => p }, quit: () => {}, platform: 'win32' })
  assert.equal(window.buttons.length, 3); assert.equal(tasks.length, 4)
  assert.equal(tasks[0].args, '--popup-minimize')
  window.buttons[1].click(); assert.equal(window.buttons[1].tooltip, 'Khôi phục kích thước')
  window.buttons[2].click(); assert.equal(calls.at(-1), 'close')
})
