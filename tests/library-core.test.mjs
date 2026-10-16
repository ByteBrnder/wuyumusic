import test from 'node:test'
import assert from 'node:assert/strict'
import { parseLyrics, lyricAt, adjacentId, enqueueNext, validateBackup, trackRecord, filenameInfo, centeredLyricTop, virtualRange, swipePlayerView } from '../src/utils/library-core.js'

test('LRC supports multiple stamps, fractions, metadata, and file offset', () => {
  assert.deepEqual(parseLyrics('[ar:歌手]\n[offset:500]\n[00:01.25][00:03.5]海风\n[00:05]晚安'), [
    { time: 1.75, text: '海风' }, { time: 4, text: '海风' }, { time: 5.5, text: '晚安' },
  ])
  assert.deepEqual(parseLyrics('[ti:歌曲]\n第一句\n第二句'), [{ time: null, text: '第一句' }, { time: null, text: '第二句' }])
})

test('LRC timestamps also parse when the WebView has no String.matchAll', () => {
  const original = String.prototype.matchAll
  try {
    String.prototype.matchAll = undefined
    assert.deepEqual(parseLyrics('[00:01.50][00:03]歌词'), [{ time: 1.5, text: '歌词' }, { time: 3, text: '歌词' }])
  } finally { String.prototype.matchAll = original }
})
test('lyric offset is consistent with playback position and untimed text', () => {
  const lines = parseLyrics('[00:01]甲\n[00:04]乙')
  assert.equal(lyricAt(lines, 4, .5), 0)
  assert.equal(lyricAt(lines, 4.5, .5), 1)
  assert.equal(lyricAt([{ time: null, text: '甲' }], 10), -1)
})
test('queue wraps, single repeat only affects automatic end, shuffle excludes current', () => {
  assert.equal(adjacentId([], '', 1), '')
  assert.equal(adjacentId(['a', 'b'], 'b', 1), 'a')
  assert.equal(adjacentId(['a', 'b'], 'a', -1), 'b')
  assert.equal(adjacentId(['a', 'b'], 'a', 1, 'single', true), 'a')
  assert.equal(adjacentId(['a', 'b'], 'a', 1, 'single', false), 'b')
  assert.equal(adjacentId(['a', 'b', 'c'], 'b', 1, 'shuffle', false, () => 0), 'a')
  assert.equal(adjacentId(['a'], 'a', 1, 'shuffle'), 'a')
})
test('play next reorders without duplicating or mutating queue', () => {
  const queue = ['a', 'b', 'c']
  assert.deepEqual(enqueueNext(queue, 'a', 'c'), ['a', 'c', 'b'])
  assert.deepEqual(enqueueNext(queue, 'a', 'd'), ['a', 'd', 'b', 'c'])
  assert.deepEqual(enqueueNext(queue, 'a', 'a'), queue)
  assert.deepEqual(queue, ['a', 'b', 'c'])
})
test('saved metadata does not contain temporary object URLs', () => {
  assert.deepEqual(trackRecord({ id: 'a', audioKey: 'idb:a', uri: 'blob:temporary', cover: 'blob:cover' }), { id: 'a', audioKey: 'idb:a' })
})
test('backup rejects malformed format, missing audio, duplicate IDs and dangling playlists', () => {
  const record = { id: 'a', title: '歌曲', lyrics: [{ time: 0, text: '歌词' }], audioData: 'data:audio/wav;base64,YQ==', coverData: '' }
  const backup = { format: 'wuyu-backup', version: 1, tracks: [record], playlists: [{ name: '收藏', trackIds: ['a'] }] }
  assert.equal(validateBackup(backup), backup)
  assert.throws(() => validateBackup({ ...backup, version: 99 }))
  assert.throws(() => validateBackup({ ...backup, tracks: [record, record] }))
  assert.throws(() => validateBackup({ ...backup, tracks: [{ ...record, audioData: '' }] }))
  assert.throws(() => validateBackup({ ...backup, playlists: [{ name: '坏歌单', trackIds: ['missing'] }] }))
  assert.throws(() => validateBackup({ ...backup, tracks: [{ ...record, lyrics: [{ time: -1, text: '歌词' }] }] }))
})

test('file name suggestions distinguish common conventions and leave ambiguous names intact', () => {
  assert.deepEqual(filenameInfo('爱，很简单--陶喆.mp3'), { title: '爱，很简单', artist: '陶喆' })
  assert.deepEqual(filenameInfo('歌手 - 歌名.flac'), { title: '歌名', artist: '歌手' })
  assert.deepEqual(filenameInfo('安和桥宋冬野.mp3'), { title: '安和桥宋冬野', artist: '' })
  assert.deepEqual(filenameInfo('一首带-连字符的歌.mp3'), { title: '一首带-连字符的歌', artist: '' })
})

test('lyric centering accounts for multiline height and never scrolls before the start', () => {
  assert.equal(centeredLyricTop(100, 80, 200), 40)
  assert.equal(centeredLyricTop(100, 160, 200), 80)
  assert.equal(centeredLyricTop(0, 40, 200), 0)
})

test('player swipes switch in the expected direction without treating vertical scrolling or taps as swipes', () => {
  assert.equal(swipePlayerView('cover', -120, 15, 250), 'lyrics')
  assert.equal(swipePlayerView('lyrics', 120, -15, 250), 'cover')
  assert.equal(swipePlayerView('cover', 120, 0, 250), 'cover')
  assert.equal(swipePlayerView('lyrics', -120, 0, 250), 'lyrics')
  assert.equal(swipePlayerView('cover', -30, 0, 100), 'cover')
  assert.equal(swipePlayerView('cover', -80, 100, 250), 'cover')
  assert.equal(swipePlayerView('cover', -120, 0, 1500), 'cover')
  assert.equal(swipePlayerView('cover', -120, 0, 250, true), 'cover')
})

test('large library virtual range remains bounded and preserves the full scroll height', () => {
  const count = 10000, rowHeight = 72
  const range = virtualRange(count, 72000, 200, 600)
  assert.ok(range.start < range.end)
  assert.ok(range.end - range.start <= 22)
  const before = range.start * rowHeight, visible = (range.end - range.start) * rowHeight, after = (count - range.end) * rowHeight
  assert.equal(before + visible + after, count * rowHeight)
  assert.deepEqual(virtualRange(0, 0, 0, 600), { start: 0, end: 0 })
  assert.equal(virtualRange(count, 99999999, 0, 600).end, count)
})
