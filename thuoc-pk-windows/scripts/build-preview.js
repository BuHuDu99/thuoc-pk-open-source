const fs = require('fs')
const path = require('path')
const { DEFAULT_CONFIG } = require('../src/das-contract')
const root = path.join(__dirname, '..')
const source = (file) => fs.readFileSync(path.join(root, 'src', file), 'utf8')
let html = source('das-settings.html')
html = html.replace("style-src 'self'; script-src 'self'", "style-src 'unsafe-inline'; script-src 'unsafe-inline'")
for (const file of ['cis-ui.css', 'das-settings.css']) html = html.replace(`<link rel="stylesheet" href="${file}" />`, `<style>${source(file)}</style>`)
const mock = `
const previewConfig = ${JSON.stringify(DEFAULT_CONFIG)};
window.dasSettings = {
  get: async () => ({config: previewConfig, platform: 'darwin', state: {status: previewConfig.enabled ? 'windows-only' : 'disabled'}, diagnostic: {detected: {}}}),
  save: async (value) => {Object.assign(previewConfig, value); return {ok: true}}
};
`
html = html.replace('<script src="das-settings.js"></script>', `<script>${mock}${source('das-settings.js')}</script>`)
html = html.replace('<title>Kết nối ứng dụng khám</title>', '<title>Minh họa giao diện CIS · Dữ liệu giả</title>')
html = html.replace('Đang xem trên macOS. Bạn có thể xem giao diện minh họa tại đây; đọc hồ sơ CIS cần chạy bản Windows.', 'Bản xem trước giao diện · Dữ liệu giả. Chọn “Xem minh họa” để xem tuổi, cân nặng và chiều cao mẫu.')
fs.mkdirSync(path.join(root, 'docs'), { recursive: true })
fs.writeFileSync(path.join(root, 'docs', 'cis-preview.html'), html)
console.log('Preview regenerated from the exact CSS and markup shipped in the desktop app.')
