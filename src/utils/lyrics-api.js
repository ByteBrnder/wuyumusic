import { parseLyrics } from './library-core.js'

export const LYRICS_SETTINGS_KEY = 'wuyu-lyrics-settings-v1'
export const LYRICS_PROVIDER = '网易云音乐'
const cache = new Map()
let pending = Promise.resolve(), blockedUntil = 0
export function lyricsRetryAt() { return blockedUntil }
export function canRetryAutomatic(attempt, key, now = Date.now()) {
  return !attempt || attempt.key !== key || (attempt.state === 'failed' && attempt.count < 3 && attempt.retryAt <= now)
}

export function normalizeSong(value = '') {
  let text = String(value == null ? '' : value)
  if (typeof text.normalize === 'function') text = text.normalize('NFKC')
  // Explicit ranges avoid Unicode property escapes unsupported by older Android WebViews.
  return text.toLowerCase().replace(/[\s\u0021-\u002f\u003a-\u0040\u005b-\u0060\u007b-\u007e\u2000-\u206f\u20a0-\u20cf\u2100-\u214f\u2190-\u2bff\u3000-\u303f\ufe10-\ufe1f\ufe30-\ufe4f\uff01-\uff0f\uff1a-\uff20\uff3b-\uff40\uff5b-\uff65]/g, '')
}

export function hasTimedLyrics(lyrics = []) {
  return lyrics.some(line => Number.isFinite(line.time) && line.text.trim())
}

function rankRecords(records, query) {
  const title = normalizeSong(query.title), artist = normalizeSong(query.artist)
  const album = normalizeSong(query.album)
  const duration = Number(query.duration) || 0
  return records.filter(row => row && Number.isFinite(row.id) && typeof row.trackName === 'string' && typeof row.artistName === 'string')
    .map(row => {
      const difference = duration > 0 && Number(row.duration) > 0 ? Math.abs(duration - Number(row.duration)) : null
      const exactTitle = title !== '' && title === normalizeSong(row.trackName)
      const exactArtist = artist !== '' && artist === normalizeSong(row.artistName)
      const exactAlbum = album !== '' && album === normalizeSong(row.albumName)
      return { id: row.id, provider: row.provider || LYRICS_PROVIDER, title: row.trackName, artist: row.artistName, album: typeof row.albumName === 'string' ? row.albumName : '', duration: Number(row.duration) || 0, lyrics: typeof row.syncedLyrics === 'string' ? parseLyrics(row.syncedLyrics) : [], difference,
        confident: exactTitle && exactArtist && difference !== null && difference <= 2,
        score: (exactTitle ? 100 : 0) + (exactArtist ? 70 : 0) + (exactAlbum ? 10 : 0) + (difference === null ? 0 : Math.max(0, 40 - difference)) }
    })
    .sort((a, b) => b.score - a.score || a.id - b.id)
    .filter((row, index, rows) => rows.findIndex(item => item.id === row.id) === index)
    .slice(0, 20)
}

export function rankLyrics(records, query) {
  return rankRecords(records, query).filter(row => hasTimedLyrics(row.lyrics))
}

export function neteaseRecords(songs) {
  return songs.filter(song => song && Number.isFinite(song.id) && typeof song.name === 'string').map(song => ({
    id: song.id, provider: LYRICS_PROVIDER, trackName: song.name,
    artistName: (song.artists || song.ar || []).map(artist => artist.name).filter(Boolean).join(' / '),
    albumName: (song.album || song.al)?.name || '', duration: (Number(song.duration ?? song.dt) || 0) / 1000,
  }))
}

function endpoint(path, fallback = false) {
  // #ifdef H5
  if (typeof window !== 'undefined') return '/api/lyrics/netease/' + path
  // #endif
  const host = fallback ? 'https://interface3.music.163.com' : 'https://music.163.com'
  return host + (path === 'search' ? '/api/search/get/web' : '/api/song/lyric')
}

async function fetchNetease(path, data, request, fallback = false) {
  if (Date.now() < blockedUntil) throw new Error(`歌词服务繁忙，请 ${Math.ceil((blockedUntil - Date.now()) / 1000)} 秒后重试`)
  try {
    return await new Promise((resolve, reject) => {
      const header = { 'Content-Type': 'application/x-www-form-urlencoded' }
      // #ifdef APP-PLUS
      if (typeof plus !== 'undefined') header.Referer = 'https://music.163.com/'
      // #endif
      request({ url: endpoint(path, fallback), method: path === 'search' ? 'POST' : 'GET', data, header, timeout: 8000, dataType: 'json',
        success(response) {
          if (response.statusCode === 429) {
            const headers = response.header || {}
            const retry = Number(headers['Retry-After'] || headers['retry-after']) || 60
            blockedUntil = Date.now() + Math.min(3600, Math.max(5, retry)) * 1000
            reject(new Error('歌词服务请求过多，请稍后重试')); return
          }
          if (response.statusCode !== 200) {
            const error = new Error(response.statusCode === 404 ? '网页歌词代理未配置，请通过配套服务启动网页' : '歌词服务暂时不可用，请稍后重试')
            error.retryable = response.statusCode >= 500
            reject(error); return
          }
          if (!response.data || typeof response.data !== 'object' || Array.isArray(response.data) || !Number.isFinite(response.data.code)) { reject(new Error('歌词服务返回的数据不正确')); return }
          if (response.data.code !== 200) { reject(new Error('歌词服务暂时不可用，请稍后重试')); return }
          resolve(response.data)
        },
        fail(error) {
          const failure = new Error(/timeout/i.test(error?.errMsg || '') ? '获取歌词超时，请重试' : '无法连接国内歌词服务，请检查网络后重试')
          failure.retryable = true; reject(failure)
        },
      })
    })
  } catch (error) {
    // Native requests can use the provider's alternate domestic host on transport/server errors.
    // H5 performs this fallback in its same-origin proxy instead.
    if (!fallback && error.retryable && typeof window === 'undefined') return fetchNetease(path, data, request, true)
    throw error
  }
}

export function requestLyrics(query, request = options => uni.request(options)) {
  const title = query.title?.trim()
  if (!title) return Promise.reject(new Error('请填写歌名'))
  const data = { s: [title, query.artist?.trim()].filter(Boolean).join(' '), type: 1, limit: 12, offset: 0 }
  const key = JSON.stringify([title, query.artist?.trim() || '', query.album || '', Number(query.duration) || 0])
  const cached = cache.get(key)
  if (cached && cached.expires > Date.now()) return Promise.resolve(cached.rows)
  const run = async () => {
    const cached = cache.get(key)
    if (cached && cached.expires > Date.now()) return cached.rows
    const search = await fetchNetease('search', data, request)
    if (!Array.isArray(search.result?.songs) && search.result?.songCount !== 0) throw new Error('歌词服务返回的数据不正确')
    const normalizedTitle = normalizeSong(title)
    const records = rankRecords(neteaseRecords(search.result?.songs || []), query).filter(row => {
      const candidateTitle = normalizeSong(row.title)
      return candidateTitle && (candidateTitle.includes(normalizedTitle) || normalizedTitle.includes(candidateTitle))
    }).slice(0, 6)
    const matches = []
    let failure
    // Limit lyric downloads to two concurrent requests and six likely versions.
    for (let index = 0; index < records.length; index += 2) {
      const results = await Promise.all(records.slice(index, index + 2).map(async row => {
        const result = await fetchNetease('lyric', { id: row.id, lv: -1, tv: -1 }, request)
        const lyrics = parseLyrics(typeof result.lrc?.lyric === 'string' ? result.lrc.lyric : '')
        return { ...row, lyrics }
      }).map(task => task.then(value => ({ status: 'fulfilled', value }), reason => ({ status: 'rejected', reason }))))
      for (const result of results) {
        if (result.status === 'fulfilled' && hasTimedLyrics(result.value.lyrics)) matches.push(result.value)
        else if (result.status === 'rejected') failure = result.reason
      }
      if (Date.now() < blockedUntil) break
    }
    if (!matches.length && failure) throw failure
    matches.sort((a, b) => b.score - a.score || a.id - b.id)
    cache.set(key, { rows: matches, expires: Date.now() + 5 * 60000 })
    if (cache.size > 50) cache.delete(cache.keys().next().value)
    return matches
  }
  // Batch imports share a serial request queue, including manual searches.
  const result = pending.then(run)
  pending = result.catch(() => {})
  return result
}

export async function readAudioDuration(uri) {
  // #ifdef H5
  return new Promise(resolve => {
    const audio = new Audio()
    const finish = () => {
      const seconds = Number.isFinite(audio.duration) ? audio.duration : 0
      clearTimeout(timeout); audio.onloadedmetadata = null; audio.onerror = null
      audio.removeAttribute('src'); audio.load(); resolve(seconds)
    }
    const timeout = setTimeout(finish, 8000)
    audio.preload = 'metadata'; audio.onloadedmetadata = finish; audio.onerror = finish; audio.src = uri
  })
  // #endif
  // #ifdef APP-PLUS
  if (plus.os.name !== 'Android') return 0
  const reader = plus.android.newObject('android.media.MediaMetadataRetriever')
  try {
    plus.android.invoke(reader, 'setDataSource', uri)
    return Number(plus.android.invoke(reader, 'extractMetadata', 9)) / 1000 || 0
  } catch { return 0 } finally { plus.android.invoke(reader, 'release') }
  // #endif
}
