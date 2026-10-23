const { test } = require('node:test')
const assert = require('node:assert/strict')
const { describeUpdateError } = require('../src/update-errors')

test('missing published manifest and installers are server failures, not Internet failures', () => {
  const missingManifest = describeUpdateError({ code: 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND', message: 'Cannot find channel latest.yml update info: HttpError: 404 Not Found' })
  assert.equal(missingManifest.kind, 'missing-manifest')
  assert.match(missingManifest.detail, /latest.yml.*404/)
  for (const error of [
    { statusCode: 404, message: 'Not Found' },
    { code: 'HTTP_ERROR_404', message: 'Not Found' },
    new Error('Cannot download "https://example.test/setup.exe", status 404: Not Found'),
  ]) assert.equal(describeUpdateError(error).kind, 'missing-file')
})

test('certificate errors, proxy access and actual connectivity failures remain distinct', () => {
  for (const code of ['CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_CERT_AUTHORITY_INVALID', 'ERR_SSL_PROTOCOL_ERROR']) {
    assert.equal(describeUpdateError({ code }).kind, 'certificate')
  }
  for (const error of [{ statusCode: 403 }, new Error('net::ERR_TUNNEL_CONNECTION_FAILED')]) assert.equal(describeUpdateError(error).kind, 'access')
  for (const error of [{ code: 'ENOTFOUND' }, { code: 'ECONNREFUSED' }, new Error('net::ERR_INTERNET_DISCONNECTED'), new Error('net::ERR_TIMED_OUT')]) {
    assert.equal(describeUpdateError(error).kind, 'network')
  }
})

test('invalid release, storage and missing ZIP update configuration do not claim network loss', () => {
  for (const code of ['ERR_UPDATER_INVALID_UPDATE_INFO', 'ERR_UPDATER_NO_FILES_PROVIDED', 'ERR_UPDATER_CHECKSUM_MISMATCH']) assert.equal(describeUpdateError({ code }).kind, 'invalid-release')
  assert.equal(describeUpdateError({ code: 'ENOENT', message: "ENOENT: open 'C:\\app\\resources\\app-update.yml'" }).kind, 'installation')
  assert.equal(describeUpdateError({ code: 'ENOSPC' }).kind, 'storage')
  for (const statusCode of [429, 500, 503]) assert.equal(describeUpdateError({ statusCode }).kind, 'server')
  const unknown = describeUpdateError(new Error('Unexpected secret diagnostic value'))
  assert.equal(unknown.kind, 'unknown')
  assert.doesNotMatch(unknown.detail, /Unexpected secret/)
})
