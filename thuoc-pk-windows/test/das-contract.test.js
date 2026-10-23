const test = require('node:test')
const assert = require('node:assert/strict')
const { DEFAULT_CONFIG, validateConfig, parseSnapshot, resolveSnapshot, parseAge, parseHeight, createStabilityGate, diagnoseSnapshot } = require('../src/das-contract')
const fixture = require('./fixtures/cis-accessibility.json')
const copy = () => JSON.parse(JSON.stringify(fixture))
const config = validateConfig(DEFAULT_CONFIG)

test('recognizes the real CIS process and resolves Vietnamese labels automatically', () => {
  const result = resolveSnapshot(copy(), config)
  assert.equal(result.status, 'ok'); assert.equal(result.weightKg, 12.5)
  assert.equal(result.age, 18); assert.equal(result.ageUnit, 'months')
  assert.equal(result.heightCm, 82)
  assert.equal(result.identityKind, 'patient')
  assert.equal(resolveSnapshot({ ...copy(), processName: 'DAS115YD' }, config).status, 'invalid')
  const normalized = copy(); normalized.records[0].id = ''; normalized.records[0].name = 'CAN NANG :'
  assert.equal(resolveSnapshot(normalized, config).weightKg, 12.5)
})

test('explicit age units override a bare-number fallback; newborn zero and combined years/months are exact', () => {
  assert.deepEqual(parseAge('18 tháng', 'years'), { age: 18, ageUnit: 'months' })
  assert.deepEqual(parseAge('0 ngày', 'auto'), { age: 0, ageUnit: 'days' })
  assert.deepEqual(parseAge('2 năm 3 tháng', 'auto'), { age: 27, ageUnit: 'months' })
  assert.equal(parseAge('2 năm 12 tháng', 'auto'), null)
  assert.equal(parseAge('2 tháng 3 ngày', 'auto'), null)
  const raw = copy(); raw.records[1].value = '18'
  assert.equal(resolveSnapshot(raw, config).status, 'needs-unit')
  assert.equal(resolveSnapshot(raw, { ...config, ageUnit: 'months' }).ageUnit, 'months')
})

test('rejects missing, unrelated, malformed and out-of-range measurements', () => {
  for (const value of ['', '0', '-12', '301', '12,500.2', '12 kg 5', 'Infinity', '12 lb', '1e2']) {
    const raw = copy(); raw.records[0].value = value
    assert.notEqual(resolveSnapshot(raw, config).status, 'ok', value)
  }
  for (const value of ['', '-1', '1561 tháng', 'NaN', '0x12']) {
    const raw = copy(); raw.records[1].value = value
    assert.notEqual(resolveSnapshot(raw, config).status, 'ok', value)
  }
  const raw = copy(); raw.records[0].id = 'birthweight'; raw.records[0].name = 'Cân nặng lúc sinh'
  assert.equal(resolveSnapshot(raw, config).status, 'unreadable')
})

test('supports a labelled text node and MSAA fallback without mixing providers', () => {
  const raw = copy(); raw.records[0].id = ''; raw.records[0].name = 'Cân nặng: 12,5 kg'; raw.records[0].value = ''
  // Native readers extract a value from that same node; no spatial neighbour.
  raw.records[0].value = '12,5 kg'
  assert.equal(resolveSnapshot(raw, config).weightKg, 12.5)
  const fallback = copy(); fallback.records = fallback.records.slice(0, 3).map((r) => ({ ...r, id: '', provider: 'msaa' }))
  assert.equal(resolveSnapshot(fallback, config).provider, 'msaa')
  fallback.records[0].provider = 'uia'
  assert.equal(resolveSnapshot(fallback, config).status, 'unreadable')
})

test('never chooses silently among duplicate rows or complete forms', () => {
  const raw = copy(); raw.records.push({ ...raw.records[0], node: 'other-row' })
  assert.equal(resolveSnapshot(raw, config).status, 'ambiguous')
  const multiple = copy(); multiple.records.push(...multiple.records.slice(0, 3).map((r) => ({ ...r, scope: 'another-form', node: `${r.node}.copy` })))
  assert.equal(resolveSnapshot(multiple, config).status, 'ambiguous')
  const partial = copy(); partial.records.push({ ...partial.records[0], scope: 'incomplete-form', node: 'partial' })
  assert.equal(resolveSnapshot(partial, config).status, 'ambiguous')
})

test('requires a valid identity, prefers encounter ID and keeps identifiers out of diagnostics', () => {
  const raw = copy(); raw.records[2].value = '0'
  assert.equal(resolveSnapshot(raw, config).status, 'unreadable')
  const encounter = copy(); encounter.records.push({ id: 'exid', name: '', value: 'TEST-VISIT-009', node: '4.7', scope: '8192', provider: 'uia' })
  assert.equal(resolveSnapshot(encounter, config).identityKind, 'encounter')
  assert.ok(!JSON.stringify(diagnoseSnapshot(encounter, config)).includes('TEST-'))
  const old = { enabled: false, ageUnit: 'years', weight: ['weight'], age: ['tuoi'], encounter: ['exid'] }
  assert.deepEqual(validateConfig(old).patient, DEFAULT_CONFIG.patient)
})

test('requires stable full tuples and starts over after a patient switch, measurement change or missing source', () => {
  const gate = createStabilityGate(), first = parseSnapshot(copy(), config)
  assert.equal(gate.observe(first, 0), null)
  assert.equal(gate.observe(first, 500), null)
  const accepted = gate.observe(first, 1500)
  assert.equal(accepted.weightKg, 12.5)
  const next = { ...first, context: 'another-patient' }
  assert.equal(gate.observe(next, 1600), null)
  assert.notEqual(gate.observe(next, 3100).revision, accepted.revision)
  assert.equal(gate.observe(null, 3200), null)
  assert.equal(gate.observe(next, 3300), null)
  assert.equal(gate.observe(next, 4800).context, 'another-patient')
})

test('configuration rejects conflicting, empty and oversized selectors', () => {
  assert.equal(DEFAULT_CONFIG.enabled, true); assert.equal(DEFAULT_CONFIG.ageUnit, 'auto')
  for (const patch of [{ enabled: 'true' }, { ageUnit: 'guess' }, { encounter: [] }, { weight: [''] }, { age: ['a'.repeat(101)] }, { patient: ['weight'] }, { height: ['Cân nặng'] }]) assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, ...patch }))
})

test('height accepts centimetres and explicit metres without guessing units', () => {
  for (const [raw, expected] of [['82', 82], ['82,5 cm', 82.5], ['1,20 m', 120], ['0.82m', 82], ['20 CM', 20], ['250', 250]]) assert.equal(parseHeight(raw), expected, raw)
  for (const raw of [null, '', '1.2', '0', '19', '251', '82 kg', '-82', '8e1', '82 cm 5', 'Infinity']) assert.equal(parseHeight(raw), null, String(raw))
})

test('height is optional and never borrowed from another form or an ambiguous field', () => {
  for (const value of ['', '0', '1.2', '999', 'không đo']) {
    const raw = copy(); raw.records[3].value = value
    const result = resolveSnapshot(raw, config)
    assert.equal(result.status, 'ok'); assert.equal(result.heightCm, null)
  }
  const absent = copy(); absent.records.splice(3, 1)
  assert.equal(resolveSnapshot(absent, config).heightCm, null)
  const duplicate = copy(); duplicate.records.push({ ...duplicate.records[3], node: 'other-height', value: '83' })
  assert.equal(resolveSnapshot(duplicate, config).heightCm, null)
  const outside = copy(); outside.records[3].scope = 'other-form'
  assert.equal(resolveSnapshot(outside, config).heightCm, null)
  const nativeAlias = copy(); nativeAlias.records[3].id = 'das_patvitalsign_height'; nativeAlias.records[3].name = ''
  assert.equal(resolveSnapshot(nativeAlias, config).heightCm, 82)
})

test('MSAA supplies its own full tuple with height only if required UIA values agree', () => {
  const raw = copy()
  raw.records = raw.records.filter((record) => record.provider === 'uia')
  raw.records.push(...raw.records.map((record) => ({ ...record, provider: 'msaa', node: `msaa-${record.node}` })))
  raw.records[3].value = ''
  const result = resolveSnapshot(raw, config)
  assert.equal(result.provider, 'msaa'); assert.equal(result.heightCm, 82)
  const mismatch = JSON.parse(JSON.stringify(raw)); mismatch.records[4].value = '13'
  assert.equal(resolveSnapshot(mismatch, config).status, 'ambiguous')
  const otherPatient = JSON.parse(JSON.stringify(raw)); otherPatient.records[6].value = 'TEST-OTHER'
  assert.equal(resolveSnapshot(otherPatient, config).status, 'ambiguous')
  raw.records.splice(4, 1) // Height alone from another provider cannot fill UIA.
  assert.equal(resolveSnapshot(raw, config).provider, 'uia')
  assert.equal(resolveSnapshot(raw, config).heightCm, null)
})

test('existing installed configuration gains height aliases without losing custom selectors', () => {
  const old = { ...DEFAULT_CONFIG, weight: ['custom-weight'] }; delete old.height
  const migrated = validateConfig(old)
  assert.deepEqual(migrated.height, DEFAULT_CONFIG.height)
  assert.deepEqual(migrated.weight, ['custom-weight'])
})

test('same-patient edits settle in 350ms; new identities and lost sources retain 1500ms', () => {
  const gate = createStabilityGate(), first = parseSnapshot(copy(), config)
  gate.observe(first, 0)
  assert.equal(gate.observe(first, 350), null)
  assert.equal(gate.observe(first, 1500).heightCm, 82)
  const taller = { ...first, heightCm: 83 }
  assert.equal(gate.observe(taller, 1600), null)
  assert.equal(gate.observe(taller, 1949), null)
  assert.equal(gate.observe(taller, 1950).heightCm, 83)
  const missing = { ...taller, heightCm: null }
  assert.equal(gate.observe(missing, 2000), null)
  assert.equal(gate.observe(missing, 2350).heightCm, null)
  const next = { ...first, context: 'new-patient' }
  assert.equal(gate.observe(next, 2400), null)
  assert.equal(gate.observe(next, 2750), null)
  assert.equal(gate.observe(next, 3900).context, 'new-patient')
  gate.observe(null, 4000); gate.observe(next, 4100)
  assert.equal(gate.observe(next, 4450), null)
  assert.equal(gate.observe(next, 5600).heightCm, 82)
})
