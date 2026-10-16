import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeSong, hasTimedLyrics, rankLyrics, requestLyrics, canRetryAutomatic, neteaseRecords } from '../src/utils/lyrics-api.js'

const record = { id: 1, trackName: '爱,很简单', artistName: '陶喆', albumName: '同名专辑', duration: 269, syncedLyrics: '[00:12.50]第一句\n[00:16.20]第二句' }

test('automatic retry waits for cooldown, caps attempts, and resets for corrected song info', () => {
  const failed = { key: 'old', state: 'failed', count: 1, retryAt: 60000 }
  assert.equal(canRetryAutomatic(failed, 'old', 59999), false)
  assert.equal(canRetryAutomatic(failed, 'old', 60000), true)
  assert.equal(canRetryAutomatic({ ...failed, count: 3 }, 'old', 99999), false)
  assert.equal(canRetryAutomatic({ ...failed, state: 'unmatched' }, 'old', 99999), false)
  assert.equal(canRetryAutomatic({ ...failed, count: 3 }, 'new', 0), true)
  assert.equal(canRetryAutomatic(undefined, 'new', 0), true)
})

test('automatic matching requires title, artist and measured duration, preserving live/remix differences', () => {
  assert.equal(normalizeSong(' 爱，很简单！ '), normalizeSong('爱,很简单'))
  const query = { title: '爱，很简单', artist: '陶喆', duration: 269.5 }
  const rows = rankLyrics([
    { ...record, id: 2, artistName: '翻唱歌手' },
    { ...record, id: 3, trackName: '爱很简单 (Live)' },
    { ...record, id: 4, duration: 432 },
    record,
    { ...record, id: 5, syncedLyrics: '没有时间戳' },
    { ...record, id: 6, syncedLyrics: null },
  ], query)
  assert.equal(rows.length, 4)
  assert.equal(rows[0].id, 1)
  assert.equal(rows.filter(row => row.confident).length, 1)
  assert.equal(rankLyrics([record], { ...query, artist: '' })[0].confident, false)
  assert.equal(rankLyrics([record], { ...query, duration: 0 })[0].confident, false)
  assert.equal(hasTimedLyrics(rows[0].lyrics), true)
  assert.equal(hasTimedLyrics([{ time: null, text: '普通歌词' }]), false)
})

test('normalization also works without the optional Unicode normalization API', () => {
  const original = String.prototype.normalize
  try {
    String.prototype.normalize = undefined
    assert.equal(normalizeSong(' 爱，很简单！ '), normalizeSong('爱,很简单'))
    assert.equal(normalizeSong('Song (Live) / Artist'), 'songliveartist')
    assert.equal(normalizeSong(null), '')
  } finally { String.prototype.normalize = original }
})

test('domestic search adapts artist lists and milliseconds, fetches LRC, and caches per duration', async () => {
  let calls = 0
  const songs = [{ id: 765, name: '缓存查询', artists: [{ name: '陶喆' }], album: { name: '同名专辑' }, duration: 269000 }]
  const request = options => {
    calls++
    assert.match(options.url, /music\.163\.com/)
    if (options.method === 'POST') {
      assert.equal(options.data.s, '缓存查询 陶喆')
      options.success({ statusCode: 200, data: { code: 200, result: { songs } } })
    } else {
      assert.equal(options.data.id, 765)
      options.success({ statusCode: 200, data: { code: 200, lrc: { lyric: record.syncedLyrics } } })
    }
  }
  const query = { title: '缓存查询', artist: '陶喆', duration: 269 }
  const first = await requestLyrics(query, request)
  assert.equal(first[0].provider, '网易云音乐')
  assert.equal(first[0].confident, true)
  assert.equal(first[0].lyrics[0].time, 12.5)
  await requestLyrics(query, request)
  assert.equal(calls, 2)
  const result = await requestLyrics({ ...query, duration: 432 }, request)
  assert.equal(calls, 4)
  assert.equal(result[0].difference, 163)
  assert.equal(result[0].confident, false)
  assert.equal(neteaseRecords([{ id: 1, name: '另一种格式', ar: [{ name: '歌手' }], al: { name: '专辑' }, dt: 200000 }])[0].duration, 200)
})

test('search distinguishes no songs and untimed lyrics from a network failure', async () => {
  assert.deepEqual(await requestLyrics({ title: '没有歌曲' }, options => options.success({ statusCode: 200, data: { code: 200, result: { songCount: 0 } } })), [])
  const result = await requestLyrics({ title: '纯音乐' }, options => options.success({ statusCode: 200, data: options.method === 'POST' ? { code: 200, result: { songs: [{ id: 99, name: '纯音乐', artists: [], duration: 1000 }] } } : { code: 200, nolyric: true } }))
  assert.deepEqual(result, [])
})

test('older engines need no Promise.allSettled and unrelated songs are not downloaded', async () => {
  const original = Promise.allSettled
  let lyricCalls = 0
  try {
    Promise.allSettled = undefined
    const result = await requestLyrics({ title: '兼容查询', artist: '歌手', duration: 100 }, options => {
      if (options.method === 'POST') options.success({ statusCode: 200, data: { code: 200, result: { songs: [
        { id: 801, name: '兼容查询', artists: [{ name: '歌手' }], duration: 100000 },
        { id: 802, name: '完全不同的歌', artists: [{ name: '歌手' }], duration: 100000 },
      ] } } })
      else { lyricCalls++; options.success({ statusCode: 200, data: { code: 200, lrc: { lyric: '[00:01]歌词' } } }) }
    })
    assert.equal(result.length, 1)
    assert.equal(result[0].id, 801)
    assert.equal(lyricCalls, 1)
  } finally { Promise.allSettled = original }
})

test('native transport failure retries the alternate domestic host only once', async () => {
  const urls = []
  const result = await requestLyrics({ title: '备用地址' }, options => {
    urls.push(options.url)
    if (urls.length === 1) options.fail({ errMsg: 'network error' })
    else options.success({ statusCode: 200, data: { code: 200, result: { songCount: 0 } } })
  })
  assert.deepEqual(result, [])
  assert.equal(urls.length, 2)
  assert.match(urls[0], /^https:\/\/music\.163\.com\//)
  assert.match(urls[1], /^https:\/\/interface3\.music\.163\.com\//)
})

test('search handles service errors, malformed responses, timeouts and global rate limiting', async () => {
  await assert.rejects(requestLyrics({ title: '坏响应' }, options => options.success({ statusCode: 200, data: {} })), /数据不正确/)
  await assert.rejects(requestLyrics({ title: '服务故障' }, options => options.success({ statusCode: 503 })), /暂时不可用/)
  await assert.rejects(requestLyrics({ title: '超时' }, options => options.fail({ errMsg: 'request:fail timeout' })), /超时/)
  await assert.rejects(requestLyrics({ title: '离线' }, options => options.fail({ errMsg: 'network error' })), /检查网络/)
  await assert.rejects(requestLyrics({ title: '' }), /填写歌名/)
  await assert.rejects(requestLyrics({ title: '限流' }, options => options.success({ statusCode: 429, header: { 'Retry-After': '120' } })), /请求过多/)
  let calls = 0
  await assert.rejects(requestLyrics({ title: '限流期间' }, () => { calls++ }), /秒后重试/)
  assert.equal(calls, 0)
})
