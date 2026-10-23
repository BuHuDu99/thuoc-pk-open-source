const { app, BrowserWindow, Menu, shell } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')
const url = new URL(process.env.CIS_PREVIEW_URL)
if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error('Bản xem thử chỉ dùng trang cục bộ.')
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'tracuu-mac-preview-')))
app.disableHardwareAcceleration()
const root = path.resolve(__dirname, '..')
const styles = ['cis-ui.css', 'das-theme.css'].map((name) => path.join(root, 'src', name))
const samples = [
  { label: '18 tháng · 12,5 kg · 82 cm', weight: '12.5', age: '18', unit: 'months', height: '82' },
  { label: '6 tuổi · 20 kg · 115 cm', weight: '20', age: '6', unit: 'years', height: '115' },
  { label: 'Chưa có chiều cao · 18 tháng · 12,5 kg', weight: '12.5', age: '18', unit: 'months', height: '' },
  { label: 'Vượt thang SD · 18 tháng · 18 kg · 82 cm', weight: '18', age: '18', unit: 'months', height: '82' },
  { label: 'Xóa số liệu', weight: '', age: '', unit: 'years', height: '' },
]
let window, cssKey, timer
async function applyStyle() {
  if (!window || window.isDestroyed()) return
  const previous = cssKey
  cssKey = await window.webContents.insertCSS(styles.map((file) => fs.readFileSync(file, 'utf8')).join('\n'))
  if (previous) await window.webContents.removeInsertedCSS(previous)
}
async function fillSample(sample) {
  if (!window || window.isDestroyed()) return
  await window.webContents.executeJavaScript(`(async () => {
    const sample = ${JSON.stringify(sample)};
    const set = async (selector, value) => {
      const element = document.querySelector(selector);
      if (!element) return;
      const prototype = element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
      element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', {bubbles:true}));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    };
    await set('.age-wrap input', '');
    await set('select[aria-label="Đơn vị tuổi"]', sample.unit);
    await set('.age-wrap input', sample.age);
    await set('input[aria-label="Cân nặng kg, bắt buộc"]', sample.weight);
    await set('.patient-panel input[aria-label$="cm, tùy chọn"]', sample.height);
    window.scrollTo(0, 0);
  })()`)
}
app.whenReady().then(async () => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Tra cứu', submenu: [{ role: 'about', label: 'Tra cứu · Xem thử trên MacBook' }, { type: 'separator' }, { role: 'quit', label: 'Thoát bản xem thử' }] },
    { label: 'Dữ liệu mẫu', submenu: samples.map((sample, index) => ({ label: sample.label, accelerator: `CmdOrCtrl+${index + 1}`, click: () => fillSample(sample).catch(console.error) })) },
    { label: 'Chỉnh sửa', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'Hiển thị', submenu: [{ role: 'reload', label: 'Tải lại' }, { role: 'toggleDevTools', label: 'Công cụ giao diện' }, { role: 'resetZoom', label: 'Cỡ chữ gốc' }, { role: 'zoomIn' }, { role: 'zoomOut' }] },
  ]))
  window = new BrowserWindow({ title: 'Tra cứu · Xem thử trên MacBook · Số liệu mẫu', width: 440, height: 850, minWidth: 380, minHeight: 560, show: false, backgroundColor: '#ffffff', webPreferences: {
    sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
  } })
  window.on('page-title-updated', (event) => event.preventDefault())
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/.test(target)) shell.openExternal(target)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, target) => {
    if (new URL(target).origin !== url.origin) event.preventDefault()
  })
  window.webContents.on('did-finish-load', async () => {
    cssKey = null
    await applyStyle()
    // Wait for React's first render before applying the initial example.
    for (let count = 0; count < 60; count++) {
      if (await window.webContents.executeJavaScript(`Boolean(document.querySelector('.age-wrap input'))`)) break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    await applyStyle()
    await fillSample(samples[0])
    window.show(); window.focus(); app.focus({ steal: true })
    console.log('PREVIEW_READY: cửa sổ MacBook; menu Dữ liệu mẫu; tự cập nhật khi sửa giao diện.')
  })
  for (const file of styles) fs.watch(file, () => {
    clearTimeout(timer)
    timer = setTimeout(() => applyStyle().catch(console.error), 100)
  })
  await window.loadURL(url.href)
}).catch((error) => { console.error(error); app.exit(1) })
app.on('window-all-closed', () => app.quit())
