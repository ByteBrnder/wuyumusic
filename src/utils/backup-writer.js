import { pickDocuments } from './android-files.js'

export async function createBackupWriter() {
  // #ifdef H5
  const parts = []
  return {
    async write(text) { parts.push(new Blob([text], { type: 'application/json' })) },
    async close() {
      const url = URL.createObjectURL(new Blob(parts, { type: 'application/json' }))
      parts.length = 0
      const link = document.createElement('a'); link.href = url; link.download = `雾屿备份-${new Date().toISOString().slice(0, 10)}.json`; link.click()
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    },
    async abort() { parts.length = 0 },
  }
  // #endif
  // #ifdef APP-PLUS
  const [document] = await pickDocuments('application/json', false, `雾屿备份-${new Date().toISOString().slice(0, 10)}.json`)
  if (!document) throw new Error('已取消文件选择')
  const invoke = plus.android.invoke
  const resolver = invoke(plus.android.runtimeMainActivity(), 'getContentResolver')
  const uri = invoke('android.net.Uri', 'parse', document.uri)
  const output = invoke(resolver, 'openOutputStream', uri, 'wt')
  if (!output) throw new Error('无法写入备份位置')
  let closed = false
  return {
    async write(text) { invoke(output, 'write', invoke(plus.android.newObject('java.lang.String', text), 'getBytes', 'UTF-8')) },
    async close() { try { invoke(output, 'flush') } finally { invoke(output, 'close'); closed = true } },
    async abort() {
      if (!closed) { try { invoke(output, 'close') } catch {} }
      try { invoke('android.provider.DocumentsContract', 'deleteDocument', resolver, uri) } catch {}
    },
  }
  // #endif
}
