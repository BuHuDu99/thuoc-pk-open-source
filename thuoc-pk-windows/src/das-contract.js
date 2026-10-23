const DEFAULT_CONFIG = {
  enabled: true,
  ageUnit: 'auto',
  weight: ['weight', 'das_patvitalsign_weight', 'das_patdisease_weight', 'cannang', 'Cân nặng'],
  height: ['height', 'das_patvitalsign_height', 'das_patdisease_height', 'chieucao', 'Chieu cao', 'Chiều cao', 'Chiều dài', 'C.Cao'],
  age: ['tuoi', 'age', 'Tuổi', 'Tuổi/Tháng'],
  encounter: ['exid', 'excd', 'Mã lượt khám', 'Mã phiếu khám'],
  patient: ['patcd', 'das_patient_patcd', 'Mã BN', 'Mã bệnh nhân', 'Mã KH'],
}
const UNITS = ['auto', 'years', 'months', 'days']
const FIELDS = ['weight', 'height', 'age', 'encounter', 'patient']
const aliasCache = new WeakMap()
const normalizeLabel = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/[^a-z0-9]/g, '')

function validateConfig(value) {
  if (!value || typeof value.enabled !== 'boolean' || !UNITS.includes(value.ageUnit)) throw new Error('Chọn cách đọc đơn vị tuổi.')
  const result = { enabled: value.enabled, ageUnit: value.ageUnit }
  for (const field of FIELDS) {
    const names = value[field] === undefined && ['patient', 'height'].includes(field) ? DEFAULT_CONFIG[field] : value[field]
    if (!Array.isArray(names) || !names.length || names.length > 12 || names.some((id) => typeof id !== 'string' || !normalizeLabel(id) || id.length > 100)) throw new Error('Tên trường kết nối chưa hợp lệ.')
    result[field] = [...new Set(names.map((id) => id.trim()))]
  }
  const seen = new Set()
  for (const names of Object.values(result).filter(Array.isArray)) {
    for (const name of new Set(names.map(normalizeLabel))) {
      if (seen.has(name)) throw new Error('Một tên trường không thể dùng cho hai loại thông tin.')
      seen.add(name)
    }
  }
  return result
}

function numberFromDAS(raw, suffix) {
  if (typeof raw !== 'string' || raw.length > 100) return null
  const text = raw.trim().toLowerCase().replace(/\s+/g, ' ')
  const match = new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*(?:${suffix})?$`, 'u').exec(text)
  return match ? Number(match[1].replace(',', '.')) : null
}

function parseAge(raw, configuredUnit) {
  if (typeof raw !== 'string' || raw.length > 100) return null
  const text = raw.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ')
  const units = { years: 'nam|tuoi|years?', months: 'thang|months?', days: 'ngay|days?' }
  for (const [ageUnit, suffix] of Object.entries(units)) {
    const match = new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*(?:${suffix})$`).exec(text)
    if (match) return { age: Number(match[1].replace(',', '.')), ageUnit }
  }
  // Years + months can be represented exactly in months. Do not approximate
  // mixed months + days or derive age from a year-of-birth field.
  const combined = /^(\d+)\s*(?:nam|years?)\s*(\d+)\s*(?:thang|months?)$/.exec(text)
  if (combined && Number(combined[2]) < 12) return { age: Number(combined[1]) * 12 + Number(combined[2]), ageUnit: 'months' }
  const bare = numberFromDAS(raw, '(?!)')
  if (bare !== null && configuredUnit !== 'auto') return { age: bare, ageUnit: configuredUnit }
  return null
}

function parseHeight(raw) {
  if (typeof raw !== 'string' || raw.length > 100) return null
  const match = /^(\d+(?:[.,]\d+)?)\s*(cm|m)?$/i.exec(raw.trim())
  if (!match) return null
  const value = Number(match[1].replace(',', '.')) * (match[2]?.toLowerCase() === 'm' ? 100 : 1)
  // Match the receiving application's optional height field, in centimetres.
  // A bare decimal such as 1.2 is never guessed to mean metres.
  return Number.isFinite(value) && value >= 20 && value <= 250 ? Math.round(value * 1000) / 1000 : null
}

function measurements(raw, config) {
  const weightKg = numberFromDAS(raw.weight, 'kg')
  const parsed = parseAge(raw.age, config.ageUnit)
  if (!parsed) return { status: config.ageUnit === 'auto' && numberFromDAS(raw.age, '(?!)') !== null ? 'needs-unit' : 'invalid' }
  const maxAge = { years: 130, months: 1560, days: 47482 }[parsed.ageUnit]
  if (weightKg === null || weightKg < 0.1 || weightKg > 300 || parsed.age < 0 || parsed.age > maxAge) return { status: 'invalid' }
  return { status: 'ok', weightKg, ...parsed, heightCm: parseHeight(raw.height) }
}

function splitLabel(record, config) {
  let aliases = aliasCache.get(config)
  if (!aliases) {
    aliases = new Map()
    for (const field of FIELDS) for (const name of config[field] || DEFAULT_CONFIG[field]) aliases.set(normalizeLabel(name), field)
    aliasCache.set(config, aliases)
  }
  for (const text of [record.id, record.name, record.label]) {
    const field = text && aliases.get(normalizeLabel(text))
    if (field) return { field, value: record.value }
  }
  // A single labelled node only; never match a nearby number or a substring.
  const match = /^([^:：]{1,60})[:：]\s*(.{1,100})$/.exec(record.name || '')
  const field = match && aliases.get(normalizeLabel(match[1]))
  return field ? { field, value: record.value || match[2] } : null
}

function resolveSnapshot(raw, config) {
  if (!raw || raw.status !== 'scan') return { status: raw?.status || 'unreadable' }
  if (!['CISV3115YD'].includes(raw.processName) || !Number.isInteger(raw.processId) || raw.processId <= 0 || typeof raw.window !== 'string' || !/^\d{1,20}$/.test(raw.window) || !Array.isArray(raw.records) || raw.records.length > 3000) return { status: 'invalid' }
  let withoutHeight = null
  for (const provider of ['uia', 'msaa']) {
    const records = raw.records.filter((r) => r && r.provider === provider && r.visible !== false)
    const groups = new Map()
    const add = (scope, row) => {
      if (!groups.has(scope)) groups.set(scope, { weight: [], height: [], age: [], encounter: [], patient: [] })
      groups.get(scope)[row.field].push(row)
    }
    for (const record of records) {
      if (typeof record.node !== 'string' || record.node.length > 400 || typeof record.value !== 'string' || !record.value.trim() || record.value.length > 100) continue
      const parsed = splitLabel(record, config)
      if (!parsed) continue
      const row = { ...parsed, node: record.node }
      add('__root__', row)
      if (record.scope && record.scope !== '__root__') add(record.scope, row)
    }
    function candidate(group) {
      // Never silently choose among multiple rows or let a second identity
      // disappear when preferring a more precise identifier.
      const identity = group.encounter.length ? group.encounter : group.patient
      if (group.weight.length > 1 || group.age.length > 1 || identity.length > 1) return { status: 'ambiguous' }
      if (group.weight.length !== 1 || group.age.length !== 1 || identity.length !== 1) return { status: 'unreadable' }
      const [weight, age, key] = [group.weight[0], group.age[0], identity[0]]
      if (new Set([weight.node, age.node, key.node]).size !== 3) return { status: 'ambiguous' }
      const id = key.value.trim()
      if (!id || id.length > 100 || ['0', '-1', 'null', '--'].includes(id.toLowerCase())) return { status: 'unreadable' }
      const height = group.height.length === 1 && ![weight.node, age.node, key.node].includes(group.height[0].node) ? group.height[0].value : null
      const values = measurements({ weight: weight.value, age: age.value, height }, config)
      if (values.status !== 'ok') return values
      const identityKind = group.encounter.length ? 'encounter' : 'patient'
      return { ...values, context: `${raw.processId}:${raw.window}:${identityKind}:${id}`, provider, identityKind }
    }
    // Prefer a single self-contained form; several complete visible forms are
    // ambiguous even when their measurements happen to have the same values.
    const complete = [...groups].filter(([scope, group]) => scope !== '__root__' && group.weight.length && group.age.length && (group.encounter.length || group.patient.length))
    if (complete.length > 1) return withoutHeight || { status: 'ambiguous' }
    const all = groups.get('__root__')
    if (complete.length && (all.weight.length !== complete[0][1].weight.length || all.age.length !== complete[0][1].age.length)) return withoutHeight || { status: 'ambiguous' }
    const result = candidate(complete.length ? complete[0][1] : groups.get('__root__') || { weight: [], height: [], age: [], encounter: [], patient: [] })
    if (result.status === 'ok') {
      // Prefer an entire tuple with height only when the two providers agree
      // on the patient/visit and required measurements. Never splice fields.
      if (withoutHeight && ['context', 'weightKg', 'age', 'ageUnit'].some((field) => result[field] !== withoutHeight[field])) return { status: 'ambiguous' }
      if (result.heightCm !== null) return result
      if (!withoutHeight) withoutHeight = result
    } else if (result.status !== 'unreadable') return withoutHeight || result
  }
  return withoutHeight || { status: 'unreadable' }
}

function diagnoseSnapshot(raw, config, resolved = resolveSnapshot(raw, config)) {
  const detected = { weight: false, height: false, age: false, identity: false }
  if (raw?.status === 'scan' && Array.isArray(raw.records) && raw.records.length <= 3000) {
    for (const record of raw.records) {
      if (!record || record.visible === false || !record.value) continue
      const parsed = splitLabel(record, config)
      if (parsed) detected[['encounter', 'patient'].includes(parsed.field) ? 'identity' : parsed.field] = true
    }
  }
  return {
    status: resolved.status, processFound: raw?.status === 'scan' || raw?.status === 'ambiguous', detected,
    ...(resolved.status === 'ok' ? { weightKg: resolved.weightKg, heightCm: resolved.heightCm, age: resolved.age, ageUnit: resolved.ageUnit, provider: resolved.provider } : {}),
  }
}

function parseSnapshot(raw, config, resolved = raw?.status === 'scan' ? resolveSnapshot(raw, config) : raw) {
  if (!resolved || resolved.status !== 'ok' || typeof resolved.context !== 'string' || !resolved.context || resolved.context.length > 250) return null
  const values = raw.status === 'scan' ? resolved : measurements(raw, config)
  return values.status === 'ok' ? { context: resolved.context, weightKg: values.weightKg, heightCm: values.heightCm, age: values.age, ageUnit: values.ageUnit, provider: resolved.provider || 'uia', identityKind: resolved.identityKind || 'encounter' } : null
}

function createStabilityGate() {
  let candidate = '', since = 0, samples = 0, revision = 0, acceptedContext = ''
  return {
    reset() { candidate = ''; samples = 0; acceptedContext = ''; revision += 1 },
    observe(snapshot, now = Date.now()) {
      if (!snapshot) { this.reset(); return null }
      const key = JSON.stringify(snapshot)
      if (candidate !== key) { candidate = key; since = now; samples = 1; revision += 1; return null }
      samples += 1
      const delay = snapshot.context === acceptedContext ? 350 : 1500
      if (samples < 2 || now - since < delay) return null
      acceptedContext = snapshot.context
      return { ...snapshot, revision }
    },
  }
}

module.exports = { DEFAULT_CONFIG, validateConfig, parseSnapshot, resolveSnapshot, parseAge, parseHeight, normalizeLabel, numberFromDAS, createStabilityGate, diagnoseSnapshot }
