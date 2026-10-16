import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const PREFIX = '/api/lyrics/netease/'

function respond(response, status, body, retryAfter) {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  if (retryAfter) response.setHeader('Retry-After', retryAfter)
  response.end(JSON.stringify(body))
}

function readBody(request) {
  return new Promise((resolveBody, reject) => {
    let text = '', bytes = 0
    request.on('data', chunk => { bytes += chunk.length; if (bytes <= 4096) text += chunk.toString('utf8') })
    request.on('end', () => bytes > 4096 ? reject(Object.assign(new Error('请求过大'), { status: 413 })) : resolveBody(text))
    request.on('error', reject)
  })
}

export function createLyricsMiddleware(fetcher = fetch) {
  const cache = new Map()
  return async (request, response, next) => {
    const url = new URL(request.originalUrl || request.url, 'http://localhost')
    if (!url.pathname.startsWith(PREFIX)) { if (next) return next(); respond(response, 404, { message: '接口不存在' }); return }
    try {
      const action = url.pathname.slice(PREFIX.length)
      let params, method, path
      if (action === 'search' && request.method === 'POST') {
        const form = new URLSearchParams(await readBody(request))
        const term = (form.get('s') || '').trim()
        if (!term || term.length > 300) { respond(response, 400, { message: '歌名不能为空或过长' }); return }
        params = new URLSearchParams({ s: term, type: '1', limit: '12', offset: '0' })
        method = 'POST'; path = '/api/search/get/web'
      } else if (action === 'lyric' && request.method === 'GET') {
        const id = url.searchParams.get('id') || ''
        if (!/^[1-9][0-9]{0,15}$/.test(id)) { respond(response, 400, { message: '歌曲编号不正确' }); return }
        params = new URLSearchParams({ id, lv: '-1', tv: '-1' })
        method = 'GET'; path = '/api/song/lyric'
      } else { respond(response, 404, { message: '接口或请求方式不支持' }); return }
      const key = action + ':' + params.toString()
      const saved = cache.get(key)
      if (saved && saved.expires > Date.now()) { respond(response, 200, saved.body); return }
      let upstream
      for (const host of ['https://music.163.com', 'https://interface3.music.163.com']) {
        try {
          upstream = await fetcher(host + path + (method === 'GET' ? '?' + params : ''), {
            method, headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://music.163.com/', 'User-Agent': 'WuyuMusic/1.0' },
            body: method === 'POST' ? params.toString() : undefined, signal: AbortSignal.timeout(3500), redirect: 'error',
          })
          // Do not switch hosts to work around rate limits or access restrictions.
          if (upstream.status < 500) break
        } catch (error) { if (host.includes('interface3')) throw error }
      }
      if (!upstream) throw new Error('国内歌词服务连接失败')
      if (upstream.status === 429) { respond(response, 429, { message: '歌词服务繁忙' }, upstream.headers.get('retry-after') || '60'); return }
      if (!upstream.ok) { respond(response, upstream.status >= 500 ? 502 : upstream.status, { message: '国内歌词服务暂时不可用' }); return }
      const body = await upstream.json()
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('歌词服务响应无效')
      if (body.code === 200) {
        cache.set(key, { body, expires: Date.now() + 5 * 60000 })
        if (cache.size > 100) cache.delete(cache.keys().next().value)
      }
      respond(response, 200, body)
    } catch (error) { respond(response, error.status || 502, { message: '国内歌词服务连接失败，请稍后重试' }) }
  }
}

export function createH5Server() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/build/h5')
  const lyrics = createLyricsMiddleware()
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' }
  return createServer(async (request, response) => {
    if (request.url.startsWith('/api/')) { await lyrics(request, response); return }
    if (!['GET', 'HEAD'].includes(request.method)) { respond(response, 405, { message: '请求方式不支持' }); return }
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
      const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname))
      if (!file.startsWith(root + sep)) { respond(response, 403, { message: '路径不可访问' }); return }
      const info = await stat(file)
      if (!info.isFile()) throw new Error('Not a file')
      response.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream')
      response.setHeader('Content-Length', info.size)
      if (request.method === 'HEAD') response.end()
      else createReadStream(file).on('error', () => response.destroy()).pipe(response)
    } catch { respond(response, 404, { message: '文件不存在，请先运行 npm run build:h5' }) }
  })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4175)
  createH5Server().listen(port, '127.0.0.1', () => console.log(`雾屿网页与歌词代理：http://127.0.0.1:${port}`))
}
