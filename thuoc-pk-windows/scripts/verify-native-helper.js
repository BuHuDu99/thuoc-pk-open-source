const fs = require('fs')
const path = require('path')
const { createHash } = require('crypto')
function verifyNativeHelper() {
  const root = path.resolve(__dirname, '../src')
  const build = JSON.parse(fs.readFileSync(path.join(root, 'das-msaa.build.json'), 'utf8'))
  const dll = fs.readFileSync(path.join(root, 'das-msaa.dll'))
  const hash = (buffer) => createHash('sha256').update(buffer).digest('hex')
  if (build.sourceSha256 !== hash(fs.readFileSync(path.join(root, 'das-msaa.cs'))) || build.binarySha256 !== hash(dll)) throw new Error('Rebuild the native helper: source or DLL hash changed.')
  const pe = dll.readUInt32LE(0x3c), optional = pe + 24
  if (dll.readUInt32LE(pe) !== 0x4550 || dll.readUInt16LE(pe + 4) !== 0x14c || dll.readUInt16LE(optional) !== 0x10b) throw new Error('Native helper is not an AnyCPU PE32 library.')
  const count = dll.readUInt16LE(pe + 6), sections = optional + dll.readUInt16LE(pe + 20)
  function offset(rva) {
    for (let n = 0; n < count; n++) {
      const section = sections + n * 40, start = dll.readUInt32LE(section + 12)
      if (rva >= start && rva < start + Math.max(dll.readUInt32LE(section + 8), dll.readUInt32LE(section + 16))) return rva - start + dll.readUInt32LE(section + 20)
    }
    throw new Error('Native helper has an invalid CLR section.')
  }
  const cli = offset(dll.readUInt32LE(optional + 96 + 14 * 8)), flags = dll.readUInt32LE(cli + 16)
  const metadata = offset(dll.readUInt32LE(cli + 8))
  const runtime = dll.toString('ascii', metadata + 16, metadata + 16 + dll.readUInt32LE(metadata + 12)).replace(/\0+$/, '')
  if (!(flags & 1) || (flags & (2 | 0x20000)) || runtime !== 'v2.0.50727' || build.runtime !== runtime || build.platform !== 'AnyCPU') throw new Error('Native helper must target CLR 2 / .NET 3.5, IL-only, x86 and x64.')
}
if (require.main === module) { verifyNativeHelper(); console.log('PASS: native helper source/hash, CLR 2 and AnyCPU metadata match.') }
module.exports = verifyNativeHelper
