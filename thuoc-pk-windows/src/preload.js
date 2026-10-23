const { contextBridge, ipcRenderer } = require('electron')

if (window.location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('appLock', { unlock: (passcode) => ipcRenderer.invoke('unlock-app', passcode) })
  if (window.location.pathname.endsWith('/das-settings.html')) {
    contextBridge.exposeInMainWorld('dasSettings', {
      get: () => ipcRenderer.invoke('das-config'),
      save: (config) => ipcRenderer.invoke('das-save', config),
      inspect: () => ipcRenderer.invoke('das-inspect'),
    })
  }
}

if (window.location.origin === 'https://thuoc-pk.vercel.app' && window === window.top) {
  let currentState = { status: 'disabled' }
  let imported = false
  let revision = null
  let pending = 0
  let localPause = false
  let bar, statusText, toggle
  const messages = {
    disabled: 'CIS · Tự điền đang tắt', 'windows-only': 'CIS · Kết nối trên Windows',
    waiting: 'CIS · Đang tìm ứng dụng khám', 'not-found': 'CIS · Chờ mở hồ sơ khám',
    ambiguous: 'CIS · Cần chọn một hồ sơ', unreadable: 'CIS · Chưa đọc đủ thông tin',
    invalid: 'CIS · Kiểm tra tuổi và cân nặng', settling: 'CIS · Đang nhận dữ liệu',
    'reader-error': 'CIS · Đang kết nối lại', 'reader-failed': 'CIS · Chưa kết nối được', 'needs-unit': 'CIS · Chọn đơn vị tuổi',
    connected: 'CIS · Đã kết nối', paused: 'CIS · Đã tạm dừng',
    'page-changed': 'CIS · Cần tải lại Tra cứu',
  }
  function fields() {
    const weight = document.querySelectorAll('input[aria-label="Cân nặng kg, bắt buộc"]')
    const age = document.querySelectorAll('.patient-panel .age-wrap input')
    const unit = document.querySelectorAll('select[aria-label="Đơn vị tuổi"]')
    const height = document.querySelectorAll('.patient-panel input[aria-label$="cm, tùy chọn"]')
    if (weight.length !== 1 || age.length !== 1 || unit.length !== 1) return null
    return { weight: weight[0], age: age[0], unit: unit[0], height: height.length === 1 ? height[0] : null }
  }
  function setValue(element, value) {
    const prototype = element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value)
    element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
  }
  function clearImported() {
    if (!imported) return
    const target = fields()
    if (target) {
      setValue(target.weight, '')
      setValue(target.age, '')
      if (target.height) setValue(target.height, '')
    }
    imported = false
    revision = null
  }
  function renderStatus(status) {
    if (!bar) return
    statusText.textContent = messages[status] || messages.invalid
    bar.dataset.status = status
    toggle.textContent = ['reader-error', 'reader-failed'].includes(status) ? 'Kết nối lại' : localPause || status === 'paused' ? 'Tiếp tục' : 'Dừng'
    toggle.hidden = status === 'disabled' || status === 'windows-only'
  }
  async function applyState(state) {
    currentState = state
    const operation = ++pending
    if (!statusText) return
    if (state.status === 'disabled') localPause = false
    if (localPause) { renderStatus('paused'); return }
    renderStatus(state.status)
    if (state.status !== 'connected') { clearImported(); return }
    if (revision === state.revision && imported) return
    const target = fields()
    if (!target) { renderStatus('page-changed'); return }
    // Clear first: React converts an existing age when its unit is changed.
    setValue(target.weight, '')
    setValue(target.age, '')
    if (target.height) setValue(target.height, '')
    setValue(target.unit, state.ageUnit)
    await new Promise((resolve) => requestAnimationFrame(resolve))
    if (operation !== pending || localPause) return
    const next = fields()
    if (!next || next.unit.value !== state.ageUnit) { clearImported(); renderStatus('page-changed'); return }
    setValue(next.age, String(state.age))
    setValue(next.weight, String(state.weightKg))
    if (next.height) setValue(next.height, Number.isFinite(state.heightCm) && state.heightCm >= 20 && state.heightCm <= 250 ? String(state.heightCm) : '')
    imported = true
    revision = state.revision
  }
  function mount() {
    const panel = document.querySelector('.patient-panel')
    if (!panel || bar) return
    bar = document.createElement('div')
    bar.id = 'cis-connection-bar'
    bar.setAttribute('role', 'status')
    const dot = document.createElement('span')
    dot.className = 'cis-dot'
    dot.setAttribute('aria-hidden', 'true')
    statusText = document.createElement('span')
    statusText.className = 'cis-copy'
    const settings = document.createElement('button')
    settings.textContent = 'Thiết lập'
    settings.title = 'Kết nối với ứng dụng khám CISV3115YD'
    settings.addEventListener('click', () => ipcRenderer.invoke('das-settings-open'))
    toggle = document.createElement('button')
    toggle.addEventListener('click', () => {
      const resume = localPause || ['paused', 'reader-error', 'reader-failed'].includes(currentState.status)
      localPause = !resume
      pending += 1
      if (!resume) { imported = false; revision = null; renderStatus('paused') }
      ipcRenderer.invoke('das-toggle', resume)
    })
    bar.append(dot)
    bar.append(statusText, settings, toggle)
    panel.prepend(bar)
    applyState(currentState)
  }
  function manualEdit(event) {
    if (!event.isTrusted || localPause || ['disabled', 'windows-only', 'paused'].includes(currentState.status)) return
    const target = fields()
    if (!target || ![target.weight, target.age, target.unit, target.height].includes(event.target)) return
    localPause = true
    imported = false
    revision = null
    pending += 1
    renderStatus('paused')
    ipcRenderer.invoke('das-toggle', false)
  }
  // Support the currently published page as well as the React SD component.
  // Read its computed score only; the clinical calculations stay in the page.
  function renderSdScales() {
    document.querySelectorAll('.anthropometry-metrics > div').forEach((metric) => {
      let scale = metric.querySelector('.sd-scale')
      if (scale && !scale.classList.contains('sd-legacy')) return
      const score = metric.querySelector('.metric-score i')
      const match = score?.textContent.trim().match(/^(?:z\s*)?(?:←\s*)?([+-]?\d+(?:\.\d+)?)(?:\s*SD(?:\s*→)?)?$/)
      const value = match ? Number(match[1]) : NaN
      if (!Number.isFinite(value)) {
        scale?.remove()
        metric.querySelector('.sd-value')?.remove()
        return
      }
      const label = metric.querySelector(':scope > span')?.textContent || 'Chỉ số'
      const text = `${value < -2 ? '← ' : ''}${value > 0 ? '+' : ''}${value.toFixed(2)} SD${value > 2 ? ' →' : ''}`
      // Leave React-owned text nodes intact so later patient edits still update.
      score.dataset.sdLegacy = 'true'
      let valueLabel = metric.querySelector('.sd-value')
      if (!valueLabel) {
        valueLabel = document.createElement('span')
        valueLabel.className = 'sd-value'
        score.after(valueLabel)
      }
      if (valueLabel.textContent !== text) valueLabel.textContent = text
      if (scale?.dataset.sdValue === `${label}:${value}`) return
      if (!scale) {
        scale = document.createElement('div')
        scale.className = 'sd-scale sd-legacy'
        metric.querySelector('.metric-score').after(scale)
      }
      scale.dataset.sdValue = `${label}:${value}`
      scale.setAttribute('role', 'img')
      scale.setAttribute('aria-label', `${label}: ${text}. Thang từ −2 SD đến +2 SD; 0 ở giữa.`)
      const track = document.createElement('div')
      track.className = 'sd-track'
      track.setAttribute('aria-hidden', 'true')
      for (let tick = -2; tick <= 2; tick++) {
        const mark = document.createElement('span')
        mark.className = `sd-tick${tick === 0 ? ' sd-zero' : ''}`
        mark.style.left = `${(tick + 2) / 4 * 100}%`
        const caption = document.createElement('span')
        caption.className = 'sd-tick-label'
        caption.textContent = `${tick > 0 ? '+' : tick < 0 ? '−' : ''}${Math.abs(tick)}`
        mark.append(caption)
        track.append(mark)
      }
      const marker = document.createElement('span')
      marker.className = `sd-marker${value < -2 ? ' sd-below' : value > 2 ? ' sd-above' : ''}`
      marker.style.left = `${(Math.max(-2, Math.min(2, value)) + 2) / 4 * 100}%`
      track.append(marker)
      scale.replaceChildren(track)
    })
  }
  document.addEventListener('input', manualEdit, true)
  document.addEventListener('change', manualEdit, true)
  ipcRenderer.on('das-state-update', (_event, state) => applyState(state))
  window.addEventListener('DOMContentLoaded', () => {
    const observer = new MutationObserver(() => { mount(); renderSdScales() })
    observer.observe(document.documentElement, { childList: true, characterData: true, subtree: true })
    mount()
    renderSdScales()
    ipcRenderer.invoke('das-state').then(applyState)
  })
}
