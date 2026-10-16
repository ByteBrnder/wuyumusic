import { uid } from './library-core.js'
import { bytesFromDataUrl } from './metadata.js'

let pending = false
let serial = 5700
export function pickDocuments(type = 'audio/*', multiple = false, createName = '') {
  return new Promise((resolve, reject) => {
    // #ifdef APP-PLUS
    if (plus.os.name !== 'Android') { reject(new Error('当前文件导入适配 Android，请使用安卓端')); return }
    if (pending) { reject(new Error('请先完成当前文件选择')); return }
    const invoke = plus.android.invoke
    const activity = plus.android.runtimeMainActivity()
    const Intent = plus.android.importClass('android.content.Intent')
    const intent = new Intent(createName ? Intent.ACTION_CREATE_DOCUMENT : Intent.ACTION_OPEN_DOCUMENT)
    intent.addCategory(Intent.CATEGORY_OPENABLE)
    intent.setType(type)
    if (multiple) intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
    if (createName) intent.putExtra(Intent.EXTRA_TITLE, createName)
    const requestCode = ++serial
    const previous = activity.onActivityResult
    const restore = () => { activity.onActivityResult = previous; pending = false }
    pending = true
    activity.onActivityResult = (request, result, data) => {
      if (request !== requestCode) { if (typeof previous === 'function') previous(request, result, data); return }
      restore()
      if (result !== -1 || !data) { reject(new Error('已取消文件选择')); return }
      try {
        const resolver = invoke(activity, 'getContentResolver')
        const clip = invoke(data, 'getClipData')
        const uris = []
        if (clip) {
          for (let i = 0; i < invoke(clip, 'getItemCount'); i++) uris.push(invoke(invoke(clip, 'getItemAt', i), 'getUri'))
        } else uris.push(invoke(data, 'getData'))
        resolve(uris.filter(Boolean).map(uri => {
          let cursor
          let name = createName || '本地歌曲'
          let size = 0
          try {
            cursor = invoke(resolver, 'query', uri, null, null, null, null)
            if (cursor && invoke(cursor, 'moveToFirst')) {
              const nameIndex = invoke(cursor, 'getColumnIndex', '_display_name')
              const sizeIndex = invoke(cursor, 'getColumnIndex', '_size')
              if (nameIndex >= 0) name = invoke(cursor, 'getString', nameIndex) || name
              if (sizeIndex >= 0) size = Number(invoke(cursor, 'getLong', sizeIndex)) || 0
            }
          } finally { if (cursor) invoke(cursor, 'close') }
          return { uri: invoke(uri, 'toString'), name, size, mime: invoke(resolver, 'getType', uri) || type }
        }))
      } catch (error) { reject(error) }
    }
    try { activity.startActivityForResult(intent, requestCode) } catch (error) { restore(); reject(error) }
    // #endif
  })
}

export async function copyDocument(document, options = {}) {
  // #ifdef APP-PLUS
  const invoke = plus.android.invoke
  const path = `_doc/imported/${uid()}_${document.name.replace(/[\\/:*?"<>|]/g, '_')}`
  let descriptor, input, output
  let success = false
  try {
    const resolver = invoke(plus.android.runtimeMainActivity(), 'getContentResolver')
    descriptor = invoke(resolver, 'openFileDescriptor', invoke('android.net.Uri', 'parse', document.uri), 'r')
    if (!descriptor) throw new Error('无法打开文件，请重新选择')
    const target = plus.android.newObject('java.io.File', plus.io.convertLocalFileSystemURL(path))
    invoke(invoke(target, 'getParentFile'), 'mkdirs')
    input = plus.android.newObject('java.io.FileInputStream', invoke(descriptor, 'getFileDescriptor'))
    output = plus.android.newObject('java.io.FileOutputStream', target)
    const source = invoke(input, 'getChannel')
    const destination = invoke(output, 'getChannel')
    const capacity = 512 * 1024
    const buffer = invoke('java.nio.ByteBuffer', 'allocate', capacity)
    const digest = options.fingerprint ? invoke('java.security.MessageDigest', 'getInstance', 'SHA-256') : null
    let chunks = 0, copiedBytes = 0
    while (true) {
      if (options.cancelled?.()) throw Object.assign(new Error('导入已取消'), { cancelled: true })
      const value = invoke(source, 'read', buffer)
      const read = typeof value === 'string' && /^-?\d+$/.test(value) ? Number(value) : value
      if (read === -1) break
      if (!Number.isInteger(read) || read <= 0 || read > capacity) throw new Error('读取文件失败')
      invoke(buffer, 'flip')
      if (digest) {
        invoke(digest, 'update', buffer)
        invoke(buffer, 'rewind')
      }
      while (invoke(buffer, 'hasRemaining')) {
        const written = invoke(destination, 'write', buffer)
        if (!Number.isInteger(written) || written <= 0) throw new Error('保存文件失败，请检查剩余空间')
      }
      invoke(buffer, 'clear')
      copiedBytes += read
      if (++chunks % 4 === 0) { options.onProgress?.(copiedBytes, document.size || 0); await new Promise(resolve => setTimeout(resolve, 0)) }
    }
    options.onProgress?.(copiedBytes, copiedBytes)
    let hash = ''
    if (digest) {
      const bytes = bytesFromDataUrl(invoke('android.util.Base64', 'encodeToString', invoke(digest, 'digest'), 2))
      hash = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
    }
    success = true
    return options.fingerprint ? { path, hash } : path
  } finally {
    for (const resource of [output, input, descriptor]) if (resource) { try { invoke(resource, 'close') } catch {} }
    if (!success) {
      const target = plus.android.newObject('java.io.File', plus.io.convertLocalFileSystemURL(path))
      invoke(target, 'delete')
    }
  }
  // #endif
}

export async function saveBackupDocument(json) {
  // #ifdef APP-PLUS
  const [document] = await pickDocuments('application/json', false, `雾屿备份-${new Date().toISOString().slice(0, 10)}.json`)
  if (!document) throw new Error('没有选择备份位置')
  const invoke = plus.android.invoke
  const resolver = invoke(plus.android.runtimeMainActivity(), 'getContentResolver')
  const output = invoke(resolver, 'openOutputStream', invoke('android.net.Uri', 'parse', document.uri), 'wt')
  if (!output) throw new Error('无法写入备份位置')
  try {
    const text = plus.android.newObject('java.lang.String', json)
    invoke(output, 'write', invoke(text, 'getBytes', 'UTF-8'))
    invoke(output, 'flush')
  } finally { invoke(output, 'close') }
  // #endif
}
