const { spawn } = require('child_process')
const path = require('path')
if (process.platform !== 'darwin') throw new Error('Bản xem thử này dành cho macOS.')
const root = path.resolve(__dirname, '..')
const web = path.resolve(root, '../duoc-tra-cuu')
const vite = spawn(process.execPath, [path.join(web, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '0'], {
  cwd: web, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1' },
})
let desktop, output = '', stopping = false
function stop(code = 0) {
  if (stopping) return
  stopping = true
  desktop?.kill('SIGTERM')
  vite.kill('SIGTERM')
  process.exitCode = code
}
const timeout = setTimeout(() => { console.error('Không mở được bản xem thử.'); stop(1) }, 30000)
vite.stdout.on('data', (chunk) => {
  output += chunk.toString()
  const url = output.match(/http:\/\/127\.0\.0\.1:\d+\//)?.[0]
  if (!url || desktop || stopping) return
  clearTimeout(timeout)
  desktop = spawn(require('electron'), [path.join(__dirname, 'preview-mac.js')], {
    cwd: root, stdio: 'inherit', env: { ...process.env, CIS_PREVIEW_URL: url },
  })
  desktop.on('error', (error) => { console.error(error.message); stop(1) })
  desktop.on('exit', (code) => stop(code || 0))
})
vite.stderr.on('data', (chunk) => process.stderr.write(chunk))
vite.on('error', (error) => { clearTimeout(timeout); console.error(error.message); stop(1) })
vite.on('exit', (code) => { clearTimeout(timeout); if (!stopping) stop(code || 1) })
process.on('SIGINT', () => { clearTimeout(timeout); stop() })
process.on('SIGTERM', () => { clearTimeout(timeout); stop() })
