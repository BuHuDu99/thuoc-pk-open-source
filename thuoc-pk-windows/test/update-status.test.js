const test = require('node:test')
const assert = require('node:assert/strict')
const { describeNoUpdate } = require('../src/update-status')
test('a newer installed build is not mislabelled as the latest published build', () => {
  const status = describeNoUpdate('1.4.8', '1.4.7')
  assert.match(status.message, /1\.4\.8/); assert.match(status.message, /1\.4\.7/)
  assert.doesNotMatch(status.message, /mới nhất/)
})
test('equal versions accurately report up to date', () => {
  assert.match(describeNoUpdate('1.4.9', '1.4.9').message, /mới nhất/)
})
