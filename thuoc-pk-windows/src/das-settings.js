const byId = (id) => document.getElementById(id)
const message = byId('message')
let config, busy = false, demo = false
const units = { years: 'năm', months: 'tháng', days: 'ngày' }
const statusCopy = {
  waiting: ['Đang tìm cửa sổ khám', 'Ứng dụng sẽ tự kết nối khi CIS được mở.'],
  'not-found': ['Đang chờ ứng dụng khám', 'Mở CISV3115YD và chọn hồ sơ cần khám.'],
  connected: ['Đã kết nối', 'Tự điền tuổi, cân nặng và chiều cao nếu có.'],
  ok: ['Đã đọc được thông tin', 'Sẵn sàng tự điền thông tin từ hồ sơ đang mở.'],
  settling: ['Đang nhận thông tin', 'Chờ các giá trị trong hồ sơ ổn định.'],
  'needs-unit': ['Cần chọn đơn vị tuổi', 'CIS chỉ ghi số tuổi. Chọn năm, tháng hoặc ngày bên dưới.'],
  unreadable: ['Chưa đọc đủ thông tin', 'Chọn một hồ sơ và mở phần sinh hiệu trong CIS.'],
  ambiguous: ['Có nhiều nguồn thông tin', 'Chỉ mở một hồ sơ khám để tránh lấy nhầm dữ liệu.'],
  invalid: ['Cần kiểm tra thông tin', 'Cân nặng hoặc tuổi trong hồ sơ chưa hợp lệ.'],
  disabled: ['Đã tắt tự điền', 'Bạn vẫn có thể nhập trực tiếp trong Tra cứu.'],
  paused: ['Đã tạm dừng', 'Bạn đang sửa thông tin bằng tay. Bấm tìm lại để tiếp tục.'],
  'reader-error': ['Đang kết nối lại', 'Đang khởi động lại bộ đọc bằng cách đọc khác.'],
  'reader-failed': ['Chưa kết nối được CIS', 'Bấm Tìm lại kết nối để thử lại sau khi kiểm tra CIS.'],
  'windows-only': ['Sẵn sàng cho bản Windows', 'Bản xem trước giúp kiểm tra giao diện ngay trên máy này.'],
}
const failureCopy = {
  'runtime-unavailable': 'Windows chưa tải được .NET Framework 3.5. Bật thành phần này trong Windows rồi tìm lại kết nối.',
  'provider-unavailable': 'Windows chưa tải được thành phần đọc cửa sổ. Cài lại bản Tra cứu mới nhất rồi tìm lại kết nối.',
  'config-unreadable': 'Không đọc hoặc lưu được thiết lập. Kiểm tra quyền ghi thư mục dữ liệu Tra cứu rồi thử lại.',
  'powershell-missing': 'Không tìm thấy Windows PowerShell trên máy này.',
  'launch-denied': 'Windows đang chặn khởi động bộ đọc. Kiểm tra quyền chạy Tra cứu và phần mềm bảo vệ máy.',
  'script-blocked': 'Chính sách PowerShell đang chặn bộ đọc. Nhờ người quản lý máy kiểm tra chính sách cho phép chạy bộ đọc Tra cứu.',
  'reader-timeout': 'CIS không trả lời bộ đọc trong thời gian cho phép. Mở lại hồ sơ và để CIS cùng mức quyền với Tra cứu rồi tìm lại kết nối.',
  'reader-exited': 'Bộ đọc đã dừng trước khi trả thông tin. Mở lại CIS rồi tìm lại kết nối.',
  'reader-protocol': 'Bộ đọc trả thông tin không hợp lệ. Cài lại bản Tra cứu mới nhất rồi thử lại.',
  'launch-failed': 'Chưa khởi động được bộ đọc trên máy này. Tìm lại kết nối hoặc cài lại Tra cứu.',
}
function render(state, diagnostic = {}) {
  if (demo) return
  const [title, description] = statusCopy[state.status] || statusCopy.waiting
  byId('status-title').textContent = title
  byId('status-description').textContent = state.status === 'reader-failed' ? failureCopy[state.reason] || description : state.status === 'reader-error' && state.attempt ? `${description} (${state.attempt}/${state.maxAttempts})` : description
  byId('connection-status').className = `status-line ${['ok', 'connected'].includes(state.status) ? 'connected' : ['needs-unit', 'ambiguous', 'invalid', 'reader-failed'].includes(state.status) ? 'attention' : ''}`
  const detected = diagnostic.detected || {}
  byId('step-process').classList.toggle('done', diagnostic.processFound === true || state.status === 'connected')
  byId('step-fields').classList.toggle('done', detected.weight && detected.age && detected.identity || state.status === 'connected')
  byId('step-ready').classList.toggle('done', state.status === 'connected')
  const reading = ['connected', 'ok'].includes(state.status) ? state : diagnostic.status === 'ok' ? diagnostic : null
  byId('reading-weight').textContent = reading ? String(reading.weightKg).replace('.', ',') : '—'
  byId('reading-height').textContent = Number.isFinite(reading?.heightCm) ? String(reading.heightCm).replace('.', ',') : '—'
  byId('reading-age').textContent = reading ? String(reading.age).replace('.', ',') : '—'
  byId('reading-unit').textContent = reading ? units[reading.ageUnit] : ''
  byId('reading-label').textContent = reading ? 'Từ cửa sổ CIS đang mở' : 'Chưa có dữ liệu'
  if (state.status === 'needs-unit') byId('unit').setAttribute('aria-invalid', 'true')
  else byId('unit').removeAttribute('aria-invalid')
}
function readConfig() {
  const result = { ...config, enabled: byId('enabled').checked, ageUnit: byId('unit').value }
  for (const field of ['weight', 'height', 'age', 'encounter', 'patient']) result[field] = byId(field).value.split(',').map((value) => value.trim()).filter(Boolean)
  return result
}
async function save(reconnect = false) {
  if (busy || !config) return
  busy = true
  byId('connect').disabled = true
  message.textContent = ''
  if (reconnect) byId('enabled').checked = true
  try {
    const result = await window.dasSettings.save(readConfig())
    if (!result.ok) { message.textContent = result.message || 'Chưa lưu được lựa chọn.'; return }
    demo = false
    byId('demo').textContent = 'Xem minh họa'
    message.textContent = reconnect ? 'Đã bắt đầu tìm lại kết nối.' : 'Đã lưu lựa chọn.'
    await refresh()
  } catch (_) { message.textContent = 'Chưa lưu được lựa chọn. Hãy thử lại.' }
  finally { busy = false; byId('connect').disabled = false }
}
async function refresh(initial = false) {
  const result = await window.dasSettings.get()
  if (!result) { message.textContent = 'Mở khóa Tra cứu để thay đổi kết nối.'; return }
  if (initial) {
    config = result.config
    byId('enabled').checked = config.enabled
    byId('unit').value = config.ageUnit
    for (const field of ['weight', 'height', 'age', 'encounter', 'patient']) byId(field).value = config[field].join(', ')
    byId('platform-note').hidden = result.platform === 'win32'
    byId('demo').hidden = result.platform === 'win32'
  }
  render(result.state, result.diagnostic)
}
byId('form').addEventListener('submit', (event) => { event.preventDefault(); save() })
byId('connect').addEventListener('click', () => save(true))
byId('enabled').addEventListener('change', () => save())
byId('demo').addEventListener('click', () => {
  demo = !demo
  byId('demo').textContent = demo ? 'Kết thúc minh họa' : 'Xem minh họa'
  if (!demo) { refresh(); return }
  byId('status-title').textContent = 'Minh họa giao diện'
  byId('status-description').textContent = 'Số liệu giả · Không kết nối hồ sơ bệnh nhân.'
  byId('connection-status').className = 'status-line connected'
  byId('reading-weight').textContent = '12,5'
  byId('reading-height').textContent = '82'
  byId('reading-age').textContent = '18'
  byId('reading-unit').textContent = 'tháng'
  byId('reading-label').textContent = 'DỮ LIỆU MINH HỌA'
  for (const id of ['step-process', 'step-fields', 'step-ready']) byId(id).classList.add('done')
})
refresh(true).catch(() => { message.textContent = 'Không tải được trạng thái kết nối.' })
setInterval(() => { if (!busy) refresh().catch(() => {}) }, 750)
