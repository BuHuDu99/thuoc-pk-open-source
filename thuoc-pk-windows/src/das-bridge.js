const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')
const { DEFAULT_CONFIG, validateConfig, parseSnapshot, resolveSnapshot, diagnoseSnapshot, createStabilityGate } = require('./das-contract')
const REASONS = new Set(['runtime-unavailable', 'provider-unavailable', 'config-unreadable', 'powershell-missing', 'launch-denied', 'script-blocked', 'reader-exited', 'reader-timeout', 'reader-protocol', 'launch-failed'])
const emptyDiagnostic = (status, extra = {}) => ({ status, processFound: false, detected: {}, ...extra })

class DASBridge {
  constructor({ app, onState, onDiagnostic = () => {}, platform = process.platform, launch = spawn, now = Date.now, pollTimeoutMs = 10000, startTimeoutMs = 25000, phaseTimeoutMs = 10000, retryDelayMs = 2500, maxFailures = 3 }) {
    Object.assign(this, { app, onState, onDiagnostic, platform, launch, now, pollTimeoutMs, startTimeoutMs, phaseTimeoutMs, retryDelayMs, maxFailures })
    this.configPath = path.join(app.getPath('userData'), 'das-connection.json')
    this.scriptPath = app.isPackaged ? path.join(process.resourcesPath, 'das-reader.ps1') : path.join(__dirname, 'das-reader.ps1')
    this.child = null
    this.watchdog = null
    this.retry = null
    this.active = false
    this.runId = 0
    this.gate = createStabilityGate()
    this.state = { status: 'disabled' }
    this.diagnostic = { status: 'waiting', processFound: false, detected: {} }
    try { this.config = validateConfig(JSON.parse(fs.readFileSync(this.configPath, 'utf8'))) }
    catch (_) { this.config = validateConfig(DEFAULT_CONFIG) }
  }
  publish(state) {
    if (JSON.stringify(state) === JSON.stringify(this.state)) return
    this.state = state
    this.onState(state)
  }
  save(value) {
    const config = validateConfig(value)
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true })
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), { mode: 0o600 })
    this.config = config
  }
  stop() {
    this.active = false
    this.runId += 1
    const child = this.child
    this.child = null
    if (child) child.kill()
    clearTimeout(this.watchdog)
    clearTimeout(this.retry)
    this.gate.reset()
    this.diagnostic = { status: 'waiting', processFound: false, detected: {} }
    this.publish({ status: 'disabled' })
  }
  powershell(args) {
    const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    return this.launch(executable, ['-NoLogo', '-NoProfile', '-STA', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.scriptPath, ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  }
  start() {
    this.stop()
    if (!this.config.enabled) return
    if (this.platform !== 'win32') { this.publish({ status: 'windows-only' }); return }
    try { this.save(this.config) }
    catch (_) {
      const state = { status: 'reader-failed', reason: 'config-unreadable' }
      this.diagnostic = emptyDiagnostic(state.status, state)
      this.publish(state)
      return
    }
    this.active = true
    this.failureCount = 0
    this.readerMode = 'auto'
    this.startReader()
  }
  startReader() {
    if (!this.active) return
    const runId = ++this.runId
    let child, buffer = '', ended = false, phase = 'initializing', stderrTail = '', startupBlocked = false
    this.publish({ status: 'waiting' })
    const fail = (reason = 'reader-exited') => {
      if (ended || !this.active || this.runId !== runId) return
      ended = true
      this.runId += 1
      this.child = null
      clearTimeout(this.watchdog)
      if (child) child.kill()
      this.gate.reset()
      this.failureCount += 1
      reason = REASONS.has(reason) ? reason : 'reader-exited'
      const failedMode = this.readerMode
      if (phase === 'msaa') this.readerMode = 'uia'
      else if (phase === 'uia' || this.readerMode === 'auto') this.readerMode = 'msaa'
      else if (this.readerMode === 'msaa') this.readerMode = 'uia'
      else this.readerMode = 'msaa'
      const permanent = ['runtime-unavailable', 'config-unreadable', 'powershell-missing', 'launch-denied', 'script-blocked'].includes(reason) || (reason === 'provider-unavailable' && failedMode === 'auto')
      const retrying = !permanent && this.failureCount < this.maxFailures
      const state = { status: retrying ? 'reader-error' : 'reader-failed', reason, phase, attempt: this.failureCount, maxAttempts: this.maxFailures }
      this.diagnostic = emptyDiagnostic(state.status, state)
      this.publish(state)
      // Fixed codes only: no PowerShell stderr, exception messages or records.
      this.onDiagnostic({ reason, phase, attempt: this.failureCount, mode: failedMode, retrying })
      if (retrying) {
        this.retry = setTimeout(() => { this.retry = null; this.startReader() }, this.retryDelayMs * this.failureCount)
        this.retry.unref()
      }
    }
    const armWatchdog = (delay) => {
      clearTimeout(this.watchdog)
      this.watchdog = setTimeout(() => fail('reader-timeout'), delay)
      this.watchdog.unref()
    }
    try { child = this.powershell(['-ConfigPath', this.configPath, '-ReaderMode', this.readerMode]) }
    catch (error) { fail(error.code === 'ENOENT' ? 'powershell-missing' : error.code === 'EACCES' ? 'launch-denied' : 'launch-failed'); return }
    this.child = child
    armWatchdog(this.startTimeoutMs)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (data) => {
      if (this.child !== child || ended || this.runId !== runId) return
      buffer += data
      if (buffer.length > 524288) { fail('reader-protocol'); return }
      let index
      while ((index = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, index).trim().replace(/^\uFEFF/, '')
        buffer = buffer.slice(index + 1)
        if (!line) continue
        try {
          const raw = JSON.parse(line)
          if (!raw || typeof raw !== 'object') { fail('reader-protocol'); return }
          if (raw.status === 'reader-progress') {
            if (!['initializing', 'uia', 'msaa'].includes(raw.phase)) { fail('reader-protocol'); return }
            // Phase markers bound native calls; they do not replace a snapshot,
            // reset retries, or clear a previously accepted patient tuple.
            phase = raw.phase
            armWatchdog(phase === 'initializing' ? this.startTimeoutMs : this.phaseTimeoutMs)
            continue
          }
          if (raw.status === 'reader-error') { fail(raw.reason); return }
          if (!['scan', 'not-found', 'ambiguous', 'unreadable'].includes(raw.status)) { fail('reader-protocol'); return }
          phase = 'idle'
          armWatchdog(this.pollTimeoutMs)
          this.failureCount = 0
          const resolved = raw.status === 'scan' ? resolveSnapshot(raw, this.config) : raw
          this.diagnostic = diagnoseSnapshot(raw, this.config, resolved)
          const snapshot = parseSnapshot(raw, this.config, resolved)
          const ready = this.gate.observe(snapshot, this.now())
          if (ready) {
            // No patient/visit identifier or raw accessibility records leave
            // this native process or get written to diagnostics.
            this.publish({ status: 'connected', weightKg: ready.weightKg, heightCm: ready.heightCm, age: ready.age, ageUnit: ready.ageUnit, provider: ready.provider, identityKind: ready.identityKind, revision: ready.revision })
          } else {
            this.publish({ status: snapshot ? 'settling' : (['not-found', 'ambiguous', 'unreadable', 'needs-unit'].includes(resolved.status) ? resolved.status : 'invalid') })
          }
        } catch (_) { fail('reader-protocol'); return }
      }
    })
    child.stderr.on('data', (chunk) => {
      if (phase !== 'initializing' || ended) return
      // Classify invariant PowerShell security IDs in memory only. Never log
      // stderr or attach it to a state/diagnostic, including during startup.
      const text = stderrTail + chunk.toString()
      if (/PSSecurityException|AuthorizationManager check failed|Scripts?NotAllowed|NoLanguage/i.test(text)) startupBlocked = true
      stderrTail = text.slice(-128)
    })
    child.on('error', (error) => fail(error.code === 'ENOENT' ? 'powershell-missing' : error.code === 'EACCES' ? 'launch-denied' : 'launch-failed'))
    // Drain the final structured error before classifying an unexpected exit.
    child.on('close', () => fail(startupBlocked ? 'script-blocked' : 'reader-exited'))
  }
  inspect() {
    if (this.platform !== 'win32') return Promise.resolve({ status: 'windows-only', processFound: false, detected: {} })
    if (this.state.status === 'reader-failed') return Promise.resolve(this.diagnostic)
    if (this.child) return Promise.resolve(this.diagnostic)
    try { this.save(this.config) } catch (_) { return Promise.resolve({ status: 'reader-error' }) }
    return new Promise((resolve) => {
      let child
      try { child = this.powershell(['-Inspect', '-ConfigPath', this.configPath, '-ReaderMode', this.readerMode || 'auto']) }
      catch (_) { resolve(emptyDiagnostic('reader-failed', { reason: 'launch-failed' })); return }
      let output = '', done = false
      const finish = (value) => { if (done) return; done = true; clearTimeout(timer); child.kill(); resolve(value) }
      const timer = setTimeout(() => finish({ status: 'reader-error' }), this.startTimeoutMs)
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk) => { output += chunk; if (output.length > 524288) finish({ status: 'reader-error' }) })
      child.stderr.on('data', () => {})
      child.on('error', () => finish({ status: 'reader-error' }))
      // close waits for stdout to drain; exit can precede its final data.
      child.on('close', () => {
        try {
          const frames = output.trim().replace(/^\uFEFF/, '').split('\n').map((line) => JSON.parse(line)).filter((raw) => raw.status !== 'reader-progress')
          const raw = frames.at(-1)
          if (raw?.status === 'reader-error') finish(emptyDiagnostic('reader-failed', { reason: REASONS.has(raw.reason) ? raw.reason : 'reader-exited' }))
          else finish(diagnoseSnapshot(raw, this.config))
        }
        catch (_) { finish({ status: 'reader-error' }) }
      })
    })
  }
}
module.exports = { DASBridge }
