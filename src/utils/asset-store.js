import { bytesFromDataUrl } from './metadata.js'

let database
const urls = new Map()
function openDb() {
  // #ifdef H5
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open('wuyu-files', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('assets')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => { database = null; reject(request.error) }
  })
  return database
  // #endif
}

async function transaction(mode, action) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('assets', mode)
    const request = action(tx.objectStore('assets'))
    tx.oncomplete = () => resolve(request.result)
    tx.onerror = () => reject(tx.error || request.error)
    tx.onabort = () => reject(tx.error || new Error('文件保存中断'))
  })
}

export function dataUrl(bytes, mime = 'application/octet-stream') {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  return `data:${mime};base64,${uni.arrayBufferToBase64(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength))}`
}

export async function putAsset(key, source, mime = 'application/octet-stream') {
  // #ifdef H5
  const blob = source instanceof Blob ? source : new Blob([source], { type: mime })
  await transaction('readwrite', store => store.put(blob, key))
  return `idb:${key}`
  // #endif
  // #ifdef APP-PLUS
  const path = `_doc/wuyu-assets/${key.replace(/[^a-zA-Z0-9._-]/g, '_')}`
  writeNativeBytes(path, source)
  return path
  // #endif
}

export async function assetUrl(key) {
  if (!key) return ''
  // #ifdef H5
  if (key.startsWith('idb:')) {
    if (urls.has(key)) return urls.get(key)
    const blob = await transaction('readonly', store => store.get(key.slice(4)))
    if (!blob) throw new Error('本地文件已丢失，请重新导入歌曲')
    const url = URL.createObjectURL(blob)
    urls.set(key, url)
    return url
  }
  if (key.startsWith('blob:')) throw new Error('旧版临时文件已失效，请重新导入歌曲')
  // #endif
  // #ifdef APP-PLUS
  if (key.startsWith('_doc/')) {
    await new Promise((resolve, reject) => plus.io.resolveLocalFileSystemURL(key, resolve, () => reject(new Error('本地文件已丢失，请重新导入歌曲'))))
    return plus.io.convertLocalFileSystemURL(key)
  }
  // #endif
  return key
}

export async function deleteAsset(key) {
  if (!key) return
  // #ifdef H5
  if (key.startsWith('idb:')) {
    await transaction('readwrite', store => store.delete(key.slice(4)))
    if (urls.has(key)) URL.revokeObjectURL(urls.get(key))
    urls.delete(key)
  }
  // #endif
  // #ifdef APP-PLUS
  if (key.startsWith('_doc/wuyu-assets/') || key.startsWith('_doc/imported/')) {
    await new Promise((resolve, reject) => plus.io.resolveLocalFileSystemURL(key, entry => entry.remove(resolve, reject), resolve))
  }
  // #endif
}

export function readLocal(path, text = false) {
  return new Promise((resolve, reject) => {
    // #ifdef APP-PLUS
    plus.io.resolveLocalFileSystemURL(path, entry => entry.file(file => {
      const reader = new plus.io.FileReader()
      reader.onload = event => resolve(event.target.result)
      reader.onerror = () => reject(new Error('文件读取失败，请检查文件是否仍存在'))
      if (text) reader.readAsText(file, 'UTF-8')
      else reader.readAsDataURL(file)
    }, reject), reject)
    // #endif
  })
}

export async function exportAsset(key) {
  // #ifdef H5
  let blob
  if (key.startsWith('idb:')) blob = await transaction('readonly', store => store.get(key.slice(4)))
  else if (key.startsWith('/static/demo/')) {
    const response = await fetch(key)
    if (!response.ok) throw new Error('演示文件读取失败')
    blob = await response.blob()
  }
  if (!blob) throw new Error('文件已失效，无法完整备份，请重新导入')
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
  // #endif
  // #ifdef APP-PLUS
  return readLocal(key)
  // #endif
}

export async function importAsset(key, value) {
  const mime = value.match(/^data:([^;,]+)/)?.[1] || 'application/octet-stream'
  return putAsset(key, bytesFromDataUrl(value), mime)
}

export async function fingerprint(source) {
  // #ifdef H5
  const bytes = source instanceof Blob ? await source.arrayBuffer() : source
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  // #endif
  // #ifdef APP-PLUS
  const invoke = plus.android.invoke
  const digest = invoke('java.security.MessageDigest', 'getInstance', 'SHA-256')
  const input = plus.android.newObject('java.io.FileInputStream', plus.io.convertLocalFileSystemURL(source))
  try {
    const channel = invoke(input, 'getChannel')
    const buffer = invoke('java.nio.ByteBuffer', 'allocate', 65536)
    let chunks = 0
    while (true) {
      const value = invoke(channel, 'read', buffer)
      const length = typeof value === 'string' && /^-?\d+$/.test(value) ? Number(value) : value
      if (length === -1) break
      if (!Number.isInteger(length) || length <= 0 || length > 65536) {
        throw new Error('读取歌曲文件失败，无法计算去重指纹，请重新选择本地文件')
      }
      // Keep the audio buffer on the Java side to avoid NativeJS byte-array conversion.
      invoke(buffer, 'flip')
      invoke(digest, 'update', buffer)
      invoke(buffer, 'clear')
      if (++chunks % 16 === 0) await new Promise(resolve => setTimeout(resolve, 0))
    }
    const result = bytesFromDataUrl(invoke('android.util.Base64', 'encodeToString', invoke(digest, 'digest'), 2))
    return Array.from(result, byte => byte.toString(16).padStart(2, '0')).join('')
  } finally { invoke(input, 'close') }
  // #endif
}

export async function fingerprintAsset(key) {
  // #ifdef H5
  return fingerprint(bytesFromDataUrl(await exportAsset(key)))
  // #endif
  // #ifdef APP-PLUS
  return fingerprint(key)
  // #endif
}

export function writeNativeBytes(path, bytes) {
  // #ifdef APP-PLUS
  const invoke = plus.android.invoke
  const file = plus.android.newObject('java.io.File', plus.io.convertLocalFileSystemURL(path))
  invoke(invoke(file, 'getParentFile'), 'mkdirs')
  const output = plus.android.newObject('java.io.FileOutputStream', file)
  try {
    const encoded = dataUrl(bytes).split(',')[1]
    invoke(output, 'write', invoke('android.util.Base64', 'decode', encoded, 2))
    invoke(output, 'flush')
  } finally { invoke(output, 'close') }
  // #endif
}

export async function audioMetadataSource(key) {
  // #ifdef H5
  if (key.startsWith('idb:')) {
    const blob = await transaction('readonly', store => store.get(key.slice(4)))
    if (!blob) throw new Error('歌曲副本已丢失，请重新导入')
    return blob
  }
  if (key.startsWith('/static/demo/')) {
    const response = await fetch(key)
    if (!response.ok) throw new Error('演示音频读取失败')
    return response.blob()
  }
  throw new Error('无法读取本地歌曲副本，请重新导入')
  // #endif
  // #ifdef APP-PLUS
  return nativeMetadataSource(key)
  // #endif
}

export function nativeMetadataSource(path) {
  // #ifdef APP-PLUS
  const invoke = plus.android.invoke
  const absolute = plus.io.convertLocalFileSystemURL(path)
  const file = plus.android.newObject('java.io.File', absolute)
  return {
    size: Number(invoke(file, 'length')),
    readCover() {
      const retriever = plus.android.newObject('android.media.MediaMetadataRetriever')
      try {
        invoke(retriever, 'setDataSource', absolute)
        const picture = invoke(retriever, 'getEmbeddedPicture')
        if (!picture) return null
        const data = bytesFromDataUrl(invoke('android.util.Base64', 'encodeToString', picture, 2))
        if (!data.length) return null
        const mime = data[0] === 0x89 && data[1] === 0x50 ? 'image/png'
          : data[0] === 0x52 && data[8] === 0x57 ? 'image/webp' : 'image/jpeg'
        return { coverData: data, coverMime: mime }
      } finally { invoke(retriever, 'release') }
    },
    slice(start, end) {
      return { async arrayBuffer() {
        const input = plus.android.newObject('java.io.RandomAccessFile', absolute, 'r')
        try {
          const length = end - start
          if (!length) return new ArrayBuffer(0)
          const channel = invoke(input, 'getChannel')
          invoke(channel, 'position', start)
          const buffer = invoke('java.nio.ByteBuffer', 'allocate', length)
          let remaining = length
          while (remaining > 0) {
            const value = invoke(channel, 'read', buffer)
            const read = typeof value === 'string' && /^-?\d+$/.test(value) ? Number(value) : value
            if (!Number.isInteger(read) || read <= 0 || read > remaining) throw new Error('歌曲标签读取不完整')
            remaining -= read
          }
          const bytes = invoke(buffer, 'array')
          return bytesFromDataUrl(invoke('android.util.Base64', 'encodeToString', bytes, 2)).buffer
        } finally { invoke(input, 'close') }
      } }
    },
  }
  // #endif
}
