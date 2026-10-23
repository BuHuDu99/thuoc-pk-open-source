// Run with Electron 22. Checks the published Windows feed, without installing
// anything or starting CIS. Version 1.2.0 is a fixture for an existing client.
const { app } = require('electron')
const { NsisUpdater } = require('electron-updater')
const { ElectronHttpExecutor } = require('electron-updater/out/electronHttpExecutor')
const fs = require('fs')
const os = require('os')
const path = require('path')
const assert = require('assert/strict')
const targetVersion = require('../package.json').version
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tracuu-update-feed-'))
app.setPath('userData', directory)
app.disableHardwareAcceleration()
const timer = setTimeout(() => { console.error('Update feed check timed out'); app.exit(1) }, 45000)
app.whenReady().then(async () => {
  for (const version of ['1.2.0', '1.4.5', targetVersion]) {
  const updater = new NsisUpdater(undefined, {
    version, name: 'Tra cứu', isPackaged: true,
    userDataPath: directory, whenReady: () => app.whenReady(),
  })
  updater.httpExecutor = new ElectronHttpExecutor(() => {})
  updater._testOnlyOptions = { platform: 'win32' }
  updater.autoDownload = false
  updater.logger = null
  updater.setFeedURL({ provider: 'generic', url: process.env.TRACUU_TEST_FEED || 'https://thuoc-pk.vercel.app/updates/windows/' })
  const result = await updater.checkForUpdates()
  assert.equal(result.isUpdateAvailable, version !== targetVersion)
  assert.equal(result.updateInfo.version, targetVersion)
  assert.ok(!result.downloadPromise)
  if (version === targetVersion) continue
  const provider = updater.updateInfoAndProvider.provider
  const files = provider.resolveFiles(result.updateInfo)
  assert.ok(files[0].url.href.endsWith(`/updates/windows/TraCuu-Setup-${targetVersion}.exe`))
  assert.ok(result.updateInfo.packages.ia32 && result.updateInfo.packages.x64)
  console.log(`PASS: Windows client ${version} receives ${targetVersion}; installer and x86/x64 packages resolved without installing.`)
  }
  console.log(`PASS: ${targetVersion} is up to date; Electron 22 + electron-updater 6.6.2; no download or installation executed.`)
  clearTimeout(timer); app.exit(0)
}).catch((error) => { console.error(error.message); clearTimeout(timer); app.exit(1) })
