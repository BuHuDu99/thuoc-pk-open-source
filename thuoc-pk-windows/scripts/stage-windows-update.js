// Prepare a release locally. This does not upload or deploy anything.
const fs = require('fs')
const path = require('path')
const { createHash } = require('crypto')
const yaml = require(require.resolve('js-yaml', { paths: [path.dirname(require.resolve('electron-updater/package.json'))] }))
const root = path.resolve(__dirname, '..')

async function stageRelease(directory) {
  require('./verify-native-helper')()
  const source = path.resolve(directory)
  const manifestFile = path.join(source, 'latest.yml')
  const raw = fs.readFileSync(manifestFile, 'utf8')
  const manifest = yaml.load(raw)
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version
  if (manifest.version !== version) throw new Error(`Phiên bản latest.yml (${manifest.version}) không khớp ứng dụng (${version}).`)
  const files = new Map()
  function add(file, sha512, size) {
    if (!file || path.basename(file) !== file || /[\\/]/.test(file) || !sha512) throw new Error('Tên tệp hoặc mã kiểm tra trong latest.yml không hợp lệ.')
    const existing = files.get(file)
    if (existing && existing.sha512 !== sha512) throw new Error(`Mã kiểm tra mâu thuẫn: ${file}`)
    files.set(file, { sha512, size })
  }
  if (!manifest.files?.length) throw new Error('latest.yml thiếu bộ cài.')
  for (const item of manifest.files) add(item.url, item.sha512, item.size)
  add(manifest.path, manifest.sha512)
  for (const arch of ['ia32', 'x64']) {
    const item = manifest.packages?.[arch]
    if (!item) throw new Error(`latest.yml thiếu gói ${arch}.`)
    add(item.path, item.sha512, item.size)
  }
  for (const [file, metadata] of files) {
    const location = path.join(source, file)
    const size = fs.statSync(location).size
    if (metadata.size && metadata.size !== size) throw new Error(`Sai dung lượng: ${file}`)
    const hash = createHash('sha512')
    for await (const chunk of fs.createReadStream(location)) hash.update(chunk)
    if (hash.digest('base64') !== metadata.sha512) throw new Error(`Sai mã SHA-512: ${file}`)
  }
  const destination = path.resolve(root, '../duoc-tra-cuu/public/updates/windows')
  fs.mkdirSync(destination, { recursive: true })
  // Copy binaries first; replace the manifest only after all files are ready.
  for (const file of files.keys()) fs.copyFileSync(path.join(source, file), path.join(destination, file))
  const temporary = path.join(destination, 'latest.yml.pending')
  fs.writeFileSync(temporary, raw)
  fs.renameSync(temporary, path.join(destination, 'latest.yml'))
  console.log(`Đã chuẩn bị bản ${version}: latest.yml và ${files.size} tệp, đủ x86/x64, đúng SHA-512. Chưa phát hành lên máy chủ.`)
}

if (require.main === module) {
  const directory = process.argv[2]
  if (!directory) { console.error('Cách dùng: node scripts/stage-windows-update.js <thư-mục-chứa-latest.yml>'); process.exitCode = 1 }
  else stageRelease(directory).catch((error) => { console.error(error.message); process.exitCode = 1 })
}
module.exports = { stageRelease }
