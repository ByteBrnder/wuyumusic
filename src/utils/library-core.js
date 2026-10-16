export const LIBRARY_KEY = 'wuyu-library-v2'
export const SESSION_KEY = 'wuyu-session-v2'
export const MODES = ['list', 'single', 'shuffle']
export const MODE_LABELS = { list: '列表循环', single: '单曲循环', shuffle: '随机播放' }

export function uid() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}` }

export function filenameInfo(name = '') {
  const stem = name.replace(/\.[^.]+$/, '').trim()
  const reversed = stem.split(/\s*--\s*/)
  if (reversed.length === 2 && reversed.every(Boolean)) return { title: reversed[0], artist: reversed[1] }
  const parts = stem.split(/\s+-\s+/)
  if (parts.length === 2 && parts.every(Boolean)) return { artist: parts[0], title: parts[1] }
  return { title: stem, artist: '' }
}

export function centeredLyricTop(lineTop, lineHeight, viewportHeight) {
  return Math.max(0, lineTop + lineHeight / 2 - viewportHeight / 2)
}

export function swipePlayerView(view, dx, dy, elapsed, vertical = false) {
  if (vertical || elapsed < 0 || elapsed > 900 || Math.abs(dx) < 52 || Math.abs(dx) < Math.abs(dy) * 1.5) return view
  if (dx < 0 && view === 'cover') return 'lyrics'
  if (dx > 0 && view === 'lyrics') return 'cover'
  return view
}

export function virtualRange(count, scrollTop, listTop, viewportHeight, rowHeight = 72, overscan = 6) {
  const start = Math.max(0, Math.min(Math.max(0, count - 1), Math.floor((scrollTop - listTop) / rowHeight) - overscan))
  const end = Math.min(count, Math.max(start, Math.ceil((scrollTop - listTop + viewportHeight) / rowHeight) + overscan))
  return { start, end: Math.max(start, end) }
}

export function parseLyrics(source = '') {
  const offset = Number(source.match(/\[offset:([+-]?\d+)\]/i)?.[1] || 0) / 1000
  const lines = source.replace(/^\uFEFF/, '').split(/\r?\n/)
  const timed = []
  for (const row of lines) {
    const text = row.replace(/\[[^\]]+\]/g, '').trim()
    const stamps = /\[(\d+):(\d{2})(?:[.:](\d{1,3}))?\]/g
    let stamp
    while ((stamp = stamps.exec(row)) !== null) {
      timed.push({ time: Math.max(0, Number(stamp[1]) * 60 + Number(stamp[2]) + Number(`0.${stamp[3] || '0'}`) + offset), text })
    }
  }
  if (timed.length) return timed.sort((a, b) => a.time - b.time)
  return lines.filter(row => !/^\s*\[(ar|ti|al|by|offset|length):/i.test(row)).map(text => ({ time: null, text: text.trim() })).filter(line => line.text)
}

export function lyricAt(lines, seconds, offset = 0) {
  let found = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time !== null && lines[i].time + offset <= seconds) found = i
  }
  return found
}

export function adjacentId(queue, current, direction, mode = 'list', ended = false, random = Math.random) {
  if (!queue.length) return ''
  if (ended && mode === 'single' && queue.includes(current)) return current
  if (mode === 'shuffle' && queue.length > 1) {
    const others = queue.filter(id => id !== current)
    return others[Math.min(others.length - 1, Math.floor(random() * others.length))]
  }
  const index = queue.indexOf(current)
  return queue[((index < 0 ? (direction > 0 ? -1 : 0) : index) + direction + queue.length) % queue.length]
}

export function enqueueNext(queue, current, id) {
  if (current === id) return [...queue]
  const next = queue.filter(item => item !== id)
  next.splice(Math.max(0, next.indexOf(current) + 1), 0, id)
  return next
}

export function trackRecord(track) {
  const { uri, cover, ...record } = track
  return record
}

export function errorText(error) {
  if (error?.name === 'QuotaExceededError' || /quota|disk full|ENOSPC/i.test(error?.message || '')) return '设备存储空间不足，请清理空间后重试'
  if (error?.name === 'NotAllowedError') return '浏览器阻止了自动播放，请点击播放按钮'
  return error?.message || '操作失败，请重试'
}

export function validateBackup(value) {
  if (value?.format !== 'wuyu-backup' || value.version !== 1 || !Array.isArray(value.tracks) || !Array.isArray(value.playlists)) throw new Error('不是支持的雾屿备份文件')
  if (value.tracks.length > 10000) throw new Error('备份中的歌曲数量过多')
  const ids = new Set()
  for (const track of value.tracks) {
    if (!track || typeof track.id !== 'string' || ids.has(track.id) || typeof track.title !== 'string' || !Array.isArray(track.lyrics)) throw new Error('备份中的歌曲信息损坏')
    ids.add(track.id)
    if (typeof track.audioData !== 'string' || !/^data:[^,]*;base64,[A-Za-z0-9+/=\r\n]+$/.test(track.audioData)) throw new Error(`“${track.title}”缺少有效音频`)
    if (track.coverData && !/^data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\r\n]+$/.test(track.coverData)) throw new Error('备份中的封面损坏')
    if (track.lyrics.some(line => !line || typeof line.text !== 'string' || !(line.time === null || (Number.isFinite(line.time) && line.time >= 0)))) throw new Error('备份中的歌词损坏')
  }
  for (const list of value.playlists) {
    if (!list || typeof list.name !== 'string' || !Array.isArray(list.trackIds) || list.trackIds.some(id => !ids.has(id))) throw new Error('备份中的歌单损坏')
  }
  return value
}
