const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { DASBridge } = require('../src/das-bridge')
const fixture = require('./fixtures/cis-accessibility.json')
const clone = () => JSON.parse(JSON.stringify(fixture))
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
function harness(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cis-bridge-'))
  const states = [], children = [], launches = []
  let now = 0
  const bridge = new DASBridge({ app: { isPackaged: false, getPath: () => directory }, platform: 'win32', onState: (state) => states.push(state), now: () => now,
    launch: (...args) => {
      launches.push(args)
      const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough()
      child.kill = () => { child.killed = true; child.emit('exit', 0) }
      children.push(child); return child
    }, ...options })
  t.after(() => { bridge.stop(); fs.rmSync(directory, { recursive: true, force: true }) })
  return { bridge, states, children, launches, time: (value) => { now = value }, emit: (raw) => children.at(-1).stdout.write(JSON.stringify(raw) + '\n'), directory }
}

test('entire reader pipeline handles partial stdout, real process identity, stable values and loss of source', (t) => {
  const h = harness(t); h.bridge.start()
  const text = JSON.stringify(clone()) + '\n'
  h.children[0].stdout.write('\uFEFF' + text.slice(0, 100)); h.children[0].stdout.write(text.slice(100))
  assert.equal(h.bridge.state.status, 'settling')
  h.time(1500); h.emit(clone())
  assert.equal(h.bridge.state.status, 'connected'); assert.equal(h.bridge.state.age, 18)
  assert.equal(h.bridge.state.heightCm, 82)
  assert.ok(!JSON.stringify(h.states).includes('TEST-PATIENT'))
  assert.ok(!fs.readFileSync(h.bridge.configPath, 'utf8').includes('TEST-PATIENT'))
  h.emit({ status: 'not-found' }); assert.deepEqual(h.bridge.state, { status: 'not-found' })
  h.time(3000); h.emit(clone()); assert.equal(h.bridge.state.status, 'settling')
  h.bridge.stop(); assert.ok(h.children[0].killed)
  assert.ok(h.launches[0][1].includes('-STA'))
})

test('bare age requests a simple unit choice and resumes only after valid configuration', (t) => {
  const h = harness(t); h.bridge.start()
  const raw = clone(); raw.records[1].value = '18'
  h.emit(raw); assert.equal(h.bridge.state.status, 'needs-unit')
  h.bridge.save({ ...h.bridge.config, ageUnit: 'months' }); h.bridge.start()
  h.emit(raw); h.time(1500); h.emit(raw)
  assert.equal(h.bridge.state.status, 'connected'); assert.equal(h.bridge.state.ageUnit, 'months')
})

test('a stalled reader is killed, retries automatically and cannot restart after stop/lock', async (t) => {
  const h = harness(t, { startTimeoutMs: 20, pollTimeoutMs: 20, retryDelayMs: 20 })
  h.bridge.start(); await wait(28)
  assert.equal(h.bridge.state.status, 'reader-error'); assert.ok(h.children[0].killed)
  await wait(25); assert.equal(h.children.length, 2)
  h.bridge.stop(); await wait(50); assert.equal(h.children.length, 2)
})

test('malformed or oversized stream is rejected and inspection never exports raw identities', async (t) => {
  const h = harness(t); h.bridge.start(); h.children[0].stdout.write('{bad}\n')
  assert.equal(h.bridge.state.status, 'reader-error')
  h.bridge.start(); h.emit(clone())
  const diagnostic = await h.bridge.inspect()
  assert.equal(diagnostic.status, 'ok'); assert.ok(!JSON.stringify(diagnostic).includes('TEST-PATIENT'))
  h.children.at(-1).stdout.write('x'.repeat(524289))
  assert.equal(h.bridge.state.status, 'reader-error')
})

test('publishes height changes promptly and suppresses duplicate steady-state notifications', (t) => {
  const h = harness(t); h.bridge.start()
  h.emit(clone()); h.time(1500); h.emit(clone())
  const count = h.states.length, revision = h.bridge.state.revision
  h.time(1550); h.emit(clone()); assert.equal(h.states.length, count)
  const raw = clone(); raw.records[3].value = '83 cm'
  h.time(1600); h.emit(raw); assert.equal(h.bridge.state.status, 'settling')
  h.time(1950); h.emit(raw)
  assert.equal(h.bridge.state.heightCm, 83); assert.ok(h.bridge.state.revision > revision)
  raw.records[3].value = ''
  h.time(2000); h.emit(raw); h.time(2350); h.emit(raw)
  assert.equal(h.bridge.state.status, 'connected'); assert.equal(h.bridge.state.heightCm, null)
  assert.ok(!JSON.stringify(h.states).includes('TEST-PATIENT'))
})

test('a blocked UIA call switches to MSAA, recovers measurements, and ignores events from the killed reader', async (t) => {
  const logs = []
  const h = harness(t, { phaseTimeoutMs: 15, retryDelayMs: 5, onDiagnostic: (entry) => logs.push(entry) })
  h.bridge.start()
  const old = h.children[0]
  h.emit({ status: 'reader-progress', phase: 'uia' })
  await wait(19)
  assert.equal(h.bridge.state.reason, 'reader-timeout'); assert.ok(old.killed)
  await wait(8)
  assert.equal(h.children.length, 2)
  assert.equal(h.launches[1][1].at(-1), 'msaa')
  const raw = clone(); raw.records = raw.records.filter(r => r.provider === 'uia').map(r => ({ ...r, provider: 'msaa' }))
  h.emit(raw); h.time(1500); h.emit(raw)
  assert.equal(h.bridge.state.status, 'connected'); assert.equal(h.bridge.state.heightCm, 82)
  old.stdout.write(JSON.stringify({ status: 'not-found' }) + '\n'); old.emit('close', 1)
  assert.equal(h.bridge.state.status, 'connected')
  assert.deepEqual(logs, [{ reason: 'reader-timeout', phase: 'uia', attempt: 1, mode: 'auto', retrying: true }])
})

test('a blocked MSAA call in automatic mode switches to UIA only', async (t) => {
  const h = harness(t, { phaseTimeoutMs: 15, retryDelayMs: 5 })
  h.bridge.start(); h.emit({ status: 'reader-progress', phase: 'msaa' })
  await wait(30)
  assert.equal(h.children.length, 2); assert.equal(h.launches[1][1].at(-1), 'uia')
  h.emit(clone()); h.time(1500); h.emit(clone())
  assert.equal(h.bridge.state.status, 'connected')
})

test('repeated startup exits exhaust the budget; manual reconnect starts fresh and locking cancels pending retries', async (t) => {
  const h = harness(t, { retryDelayMs: 5 })
  h.bridge.start(); h.children[0].emit('close', 1)
  await wait(8); h.emit({ status: 'reader-progress', phase: 'initializing' }); h.children[1].emit('close', 1)
  assert.equal(h.bridge.state.attempt, 2)
  await wait(13); h.children[2].emit('close', 1)
  assert.equal(h.bridge.state.status, 'reader-failed'); assert.equal(h.bridge.state.attempt, 3)
  await wait(30); assert.equal(h.children.length, 3)
  h.bridge.start(); assert.equal(h.children.length, 4); assert.equal(h.launches[3][1].at(-1), 'auto')
  h.children[3].emit('close', 1); h.bridge.stop()
  await wait(20); assert.equal(h.children.length, 4); assert.equal(h.bridge.state.status, 'disabled')
})

test('startup dependency errors are explicit and do not retry indefinitely', async (t) => {
  const h = harness(t, { retryDelayMs: 5 })
  h.bridge.start(); h.emit({ status: 'reader-error', reason: 'runtime-unavailable' })
  assert.equal(h.bridge.state.status, 'reader-failed'); assert.equal(h.bridge.state.reason, 'runtime-unavailable')
  await wait(20); assert.equal(h.children.length, 1)
  assert.equal((await h.bridge.inspect()).status, 'reader-failed')
  assert.equal(h.children.length, 1)
})

test('progress frames preserve accepted measurements and cannot reset the failed-start budget', (t) => {
  const h = harness(t); h.bridge.start()
  h.emit(clone()); h.time(1500); h.emit(clone())
  const count = h.states.length
  h.emit({ status: 'reader-progress', phase: 'uia' }); h.emit({ status: 'reader-progress', phase: 'msaa' })
  assert.equal(h.bridge.state.status, 'connected'); assert.equal(h.states.length, count)
  h.emit(clone()); assert.equal(h.states.length, count)
  h.children[0].emit('close', 1)
  assert.equal(h.bridge.state.attempt, 1)
})

test('launch failures and unrecognized errors never leak stderr or patient data', async (t) => {
  const h = harness(t, { launch: () => { throw Object.assign(new Error('TEST-PATIENT-PRIVATE'), { code: 'ENOENT' }) } })
  assert.doesNotThrow(() => h.bridge.start())
  assert.equal(h.bridge.state.status, 'reader-failed'); assert.equal(h.bridge.state.reason, 'powershell-missing')
  assert.ok(!JSON.stringify(h.states).includes('TEST-PATIENT'))
  const logs = [], second = harness(t, { retryDelayMs: 100, onDiagnostic: (value) => logs.push(value) })
  second.bridge.start(); second.children[0].stderr.write('TEST-PATIENT-PRIVATE')
  second.emit({ status: 'reader-error', reason: 'TEST-PATIENT-PRIVATE' })
  assert.ok(!JSON.stringify({ states: second.states, logs, diagnostic: second.bridge.diagnostic }).includes('TEST-PATIENT'))
})

test('PowerShell security errors are classified before bootstrap without exporting stderr', async (t) => {
  const logs = [], h = harness(t, { retryDelayMs: 5, onDiagnostic: (value) => logs.push(value) })
  h.bridge.start()
  h.children[0].stderr.write('TEST-PATIENT-PRIVATE: PSSecurityExcep')
  h.children[0].stderr.write('tion - script blocked')
  h.children[0].emit('close', 1)
  assert.equal(h.bridge.state.status, 'reader-failed'); assert.equal(h.bridge.state.reason, 'script-blocked')
  await wait(20); assert.equal(h.children.length, 1)
  assert.ok(!JSON.stringify({ states: h.states, diagnostic: h.bridge.diagnostic, logs }).includes('TEST-PATIENT'))
})
