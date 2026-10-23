// Run with Electron. Exercises the production sandboxed preload against the
// actual React page, using synthetic measurements and no DAS/patient access.
const { app, BrowserWindow, ipcMain } = require('electron')
const { strict: assert } = require('assert')
const fs = require('fs')
const path = require('path')
const os = require('os')
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'das-smoke-'))
app.setPath('userData', directory)
app.disableHardwareAcceleration()
let window
let timer
const toggles = []
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
ipcMain.handle('das-state', () => ({ status: 'disabled' }))
ipcMain.handle('das-settings-open', () => {})
ipcMain.handle('das-toggle', (_event, resume) => { toggles.push(resume) })
const read = () => window.webContents.executeJavaScript(`({
  weight: document.querySelector('input[aria-label="Cân nặng kg, bắt buộc"]').value,
  age: document.querySelector('.age-wrap input').value,
  height: document.querySelector('.patient-panel input[aria-label$="cm, tùy chọn"]').value,
  scales: document.querySelectorAll('.sd-scale').length,
  unit: document.querySelector('select[aria-label="Đơn vị tuổi"]').value,
  summary: document.querySelector('.patient-summary')?.textContent || '',
  alert: document.querySelector('.input-alert')?.textContent || '',
  status: document.querySelector('[role="status"]')?.textContent || ''
})`)
async function send(state) {
  window.webContents.send('das-state-update', state)
  await wait(250)
  return read()
}
app.whenReady().then(async () => {
  timer = setTimeout(() => { console.error('Renderer smoke test timed out'); app.exit(1) }, 45000)
  window = new BrowserWindow({ width: 440, height: 850, show: false, webPreferences: { preload: path.join(__dirname, '../src/preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
  await window.loadURL('https://thuoc-pk.vercel.app/')
  await window.webContents.insertCSS(['cis-ui.css', 'das-theme.css'].map((file) => fs.readFileSync(path.join(__dirname, '../src', file), 'utf8')).join('\n'))
  for (let count = 0; count < 40; count++) {
    if (await window.webContents.executeJavaScript(`Boolean(document.querySelector('.patient-panel [role="status"]'))`)) break
    await wait(100)
  }
  let result = await send({ status: 'connected', weightKg: 12.5, heightCm: 82, age: 18, ageUnit: 'months', revision: 1 })
  assert.equal(result.weight, '12.5'); assert.equal(result.age, '18'); assert.equal(result.unit, 'months')
  assert.match(result.summary, /12.5 kg/); assert.match(result.summary, /18 tháng/)
  assert.equal(result.height, '82'); assert.match(result.summary, /82 cm/); assert.equal(result.scales, 4)
  result = await send({ status: 'connected', weightKg: 12.5, heightCm: 83, age: 18, ageUnit: 'months', revision: 2 })
  assert.equal(result.height, '83'); assert.match(result.summary, /83 cm/)
  result = await send({ status: 'connected', weightKg: 8, heightCm: null, age: 210, ageUnit: 'days', revision: 3 })
  assert.equal(result.age, '210'); assert.match(result.summary, /210 ngày/)
  assert.equal(result.height, ''); assert.equal(result.scales, 1)
  result = await send({ status: 'connected', weightKg: 3.2, heightCm: 50, age: 0, ageUnit: 'years', revision: 4 })
  assert.equal(result.age, '0'); assert.match(result.summary, /3.2 kg/)
  await window.webContents.executeJavaScript(`document.querySelector('#cis-connection-bar .cis-copy').textContent = 'CIS · Dữ liệu minh họa'`)
  await wait(100)
  const image = await window.webContents.capturePage()
  fs.mkdirSync(path.join(__dirname, '../docs'), { recursive: true })
  fs.writeFileSync(path.join(__dirname, '../docs/das-theme-preview.png'), image.resize({ width: 440 }).toPNG())
  result = await send({ status: 'ambiguous' })
  assert.equal(result.weight, ''); assert.equal(result.age, ''); assert.equal(result.summary, '')
  assert.equal(result.height, '')
  result = await send({ status: 'connected', weightKg: 20, heightCm: 115, age: 6, ageUnit: 'years', revision: 5 })
  assert.match(result.summary, /20 kg/)
  // Real trusted keyboard input must pause automatic replacement.
  await window.webContents.executeJavaScript(`document.querySelector('.patient-panel input[aria-label$="cm, tùy chọn"]').focus(); document.querySelector('.patient-panel input[aria-label$="cm, tùy chọn"]').select()`)
  window.webContents.sendInputEvent({ type: 'char', keyCode: '116' })
  await wait(100)
  result = await send({ status: 'connected', weightKg: 30, heightCm: 130, age: 10, ageUnit: 'years', revision: 6 })
  assert.equal(result.height, '116'); assert.equal(result.age, '6'); assert.equal(result.weight, '20'); assert.match(result.status, /tạm dừng/)
  await send({ status: 'disabled' })
  result = await send({ status: 'reader-failed', reason: 'reader-timeout' })
  assert.match(result.status, /Chưa kết nối được/)
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('#cis-connection-bar button:last-child').textContent`), 'Kết nối lại')
  await window.webContents.executeJavaScript(`document.querySelector('#cis-connection-bar button:last-child').click()`)
  await wait(100); assert.equal(toggles.at(-1), true)
  console.log('PASS: React state, optional height/SD, age units, source loss, manual pause and reconnect after a terminal reader error; screenshot saved.')
  clearTimeout(timer)
  app.exit(0)
}).catch((error) => { console.error(error); clearTimeout(timer); app.exit(1) })
