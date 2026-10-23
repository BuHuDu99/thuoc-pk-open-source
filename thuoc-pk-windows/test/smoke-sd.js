// Actual React screens with synthetic measurements; never starts or reads CIS.
const { app, BrowserWindow, ipcMain } = require('electron')
const { strict: assert } = require('assert')
const fs = require('fs')
const path = require('path')
const os = require('os')
const http = require('http')
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'sd-smoke-')))
app.disableHardwareAcceleration()
app.on('window-all-closed', () => {})
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const css = ['cis-ui.css', 'das-theme.css'].map((file) => fs.readFileSync(path.join(__dirname, '../src', file), 'utf8')).join('\n')
ipcMain.handle('das-state', () => ({ status: 'disabled' }))
ipcMain.handle('das-toggle', () => {})
ipcMain.handle('das-settings-open', () => {})
let server, timer
async function fill(window, selector, value) {
  await window.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    const prototype = element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, ${JSON.stringify(value)});
    element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', {bubbles:true}));
  })()`)
  await wait(80)
}
async function snapshot(window) {
  return window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.anthropometry-metrics > div')).map(metric => {
    const scale = metric.querySelector('.sd-scale');
    const marker = scale?.querySelector('.sd-marker');
    return {
      label: metric.querySelector(':scope > span').textContent,
      score: (metric.querySelector('.sd-value') || metric.querySelector('.metric-score i'))?.textContent || '',
      count: metric.querySelectorAll('.sd-scale').length,
      ticks: Array.from(scale?.querySelectorAll('.sd-tick-label') || []).map(tick => tick.textContent),
      position: marker ? parseFloat(marker.style.left) : null,
      below: marker?.classList.contains('sd-below'), above: marker?.classList.contains('sd-above'),
      accessible: scale?.getAttribute('aria-label'),
    };
  })`)
}
async function verify(window, count) {
  const metrics = await snapshot(window)
  assert.equal(metrics.filter((metric) => metric.count).length, count)
  for (const metric of metrics) {
    assert.equal(metric.count, metric.score ? 1 : 0, metric.label)
    if (!metric.count) continue
    assert.deepEqual(metric.ticks, ['−2', '−1', '0', '+1', '+2'])
    assert.match(metric.accessible, /−2 SD đến \+2 SD/)
    const value = Number(metric.score.match(/[+-]?\d+\.\d+/)[0])
    const expected = (Math.max(-2, Math.min(2, value)) + 2) * 25
    assert.ok(Math.abs(metric.position - expected) < 0.14, `${metric.label}: ${metric.position} / ${expected}`)
    if (value < -2) assert.ok(metric.below && metric.score.startsWith('← '))
    if (value > 2) assert.ok(metric.above && metric.score.endsWith(' →'))
  }
  return metrics
}
async function exercise(url, legacy) {
  const window = new BrowserWindow({ width: 440, height: 850, show: false, webPreferences: {
    preload: path.join(__dirname, '../src/preload.js'), sandbox: true, contextIsolation: true,
    nodeIntegration: false, backgroundThrottling: false,
  } })
  await window.loadURL(url)
  await window.webContents.insertCSS(css)
  for (let i = 0; i < 50; i++) {
    if (await window.webContents.executeJavaScript(`Boolean(document.querySelector('.age-wrap input'))`)) break
    await wait(100)
  }
  const weight = 'input[aria-label="Cân nặng kg, bắt buộc"]'
  const height = '.patient-panel input[aria-label$="cm, tùy chọn"]'
  await fill(window, 'select[aria-label="Đơn vị tuổi"]', 'months')
  await fill(window, '.age-wrap input', '18')
  await fill(window, weight, '12.5')
  await verify(window, 1) // No height: only weight/age can be scored.
  await fill(window, height, '82')
  await verify(window, 4)
  assert.equal(await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.anthropometry-note')).some(node => getComputedStyle(node).display !== 'none')`), false)
  if (legacy) {
    await window.webContents.executeJavaScript(`document.querySelector('#cis-connection-bar .cis-copy').textContent = 'CIS · Dữ liệu minh họa'`)
    const image = await window.webContents.capturePage()
    fs.writeFileSync(path.join(__dirname, '../docs/sd-scale-preview.png'), image.resize({ width: 440 }).toPNG())
    // Verify exact landmarks and overflow without modifying any clinical formula.
    for (const value of [-3, -2, -1, 0, 1, 2, 3]) {
      await window.webContents.executeJavaScript(`(() => {
        document.querySelector('#sd-fixture')?.remove();
        const metric = document.createElement('div'); metric.id = 'sd-fixture';
        metric.innerHTML = '<span>Minh họa</span><div class="metric-score"><i>z ${value.toFixed(2)}</i></div>';
        document.querySelector('.anthropometry-metrics').append(metric);
      })()`)
      await wait(40)
      const fixtures = await snapshot(window)
      const fixture = fixtures.find((metric) => metric.label === 'Minh họa')
      assert.equal(fixture.position, (Math.max(-2, Math.min(2, value)) + 2) * 25)
      assert.equal(fixture.below, value < -2); assert.equal(fixture.above, value > 2)
    }
    await window.webContents.executeJavaScript(`document.querySelector('#sd-fixture').remove()`)
  }
  await fill(window, weight, '3')
  assert.ok((await verify(window, 4)).some((metric) => metric.below))
  await fill(window, weight, '25')
  assert.ok((await verify(window, 4)).some((metric) => metric.above))
  await fill(window, height, '')
  await verify(window, 1)
  await fill(window, '.age-wrap input', '300')
  await verify(window, 0) // Adult outside the pediatric reference.
  await fill(window, '.age-wrap input', '18')
  await fill(window, weight, '12.5')
  await fill(window, height, '82')
  await window.webContents.executeJavaScript(`document.querySelector('.sex-toggle button:last-child').click(); document.querySelector('.reference-toggle button:last-child').click()`)
  await wait(80)
  await verify(window, 4)
  window.setSize(380, 850)
  await wait(100)
  assert.equal(await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.sd-scale')).some(scale => {
    const bounds = scale.getBoundingClientRect();
    return Array.from(scale.querySelectorAll('.sd-tick-label')).some(label => {
      const rect = label.getBoundingClientRect(); return rect.left < bounds.left || rect.right > bounds.right;
    });
  })`), false, 'SD labels fit a narrow window')
  await fill(window, weight, '')
  assert.equal((await snapshot(window)).length, 0)
  window.destroy()
}
fs.mkdirSync(path.join(__dirname, '../docs'), { recursive: true })
app.whenReady().then(async () => {
  timer = setTimeout(() => { console.error('SD smoke test timed out'); app.exit(1) }, 60000)
  await exercise('https://thuoc-pk.vercel.app/', true)
  const root = path.resolve(__dirname, '../../duoc-tra-cuu/dist')
  server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname
    const file = path.join(root, pathname === '/' ? 'index.html' : pathname)
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404).end(); return }
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream')
    fs.createReadStream(file).pipe(res)
  }).listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  await exercise(`http://127.0.0.1:${server.address().port}/`, false)
  console.log('PASS: deployed page compatibility and local React; four SD scales, changes, missing/out-of-range data, ±2 endpoints, overflow arrows, narrow layout; preview saved.')
  clearTimeout(timer); server.close(); app.exit(0)
}).catch((error) => { console.error(error); clearTimeout(timer); server?.close(); app.exit(1) })
