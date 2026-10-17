import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { ref, computed, reactive } from 'vue'
import * as core from '../src/utils/library-core.js'
import * as visual from '../src/utils/visual-settings.js'

// Exercise the actual controller with local storage/audio boundaries replaced.
const raw = await readFile(new URL('../src/utils/use-music.js', import.meta.url), 'utf8')
const source = raw.replace(/\/\/ #ifdef APP-PLUS[\s\S]*?\/\/ #endif/g, '')
  .replace(/^import .*$/gm, '').replace('export function useMusic', 'function useMusic')

function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
async function until(predicate) {
  for (let i = 0; i < 150; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)) }
  assert.fail('workflow did not settle')
}
async function setup(options = {}) {
  const assets = new Map(), storage = new Map(), toasts = [], events = {}, callbacks = {}, deleted = []
  storage.set('wuyu-lyrics-settings-v1', { automatic: options.automatic === true })
  const audio = { stop() { callbacks.onStop?.() }, play() { callbacks.onPlay?.() }, pause() { callbacks.onPause?.() }, seek() {} }
  for (const name of ['onPlay', 'onPause', 'onStop', 'onCanplay', 'onTimeUpdate', 'onEnded', 'onError']) audio[name] = fn => { callbacks[name] = fn }
  let selection = [], written = ''
  const uni = {
    getStorageSync: key => storage.get(key), setStorageSync: (key, value) => { if (options.failStorage?.(key)) throw new Error('storage failure'); storage.set(key, JSON.parse(JSON.stringify(value))) },
    showToast: ({ title }) => toasts.push(title), showModal: ({ success }) => success({ confirm: true }),
    createInnerAudioContext: () => audio, onNetworkStatusChange() {}, $emit: name => events[name]?.(),
  }
  const deps = {
    ...core, ...visual, ref, computed, reactive, uni,
    onMounted() {}, onHide() {}, onShow() {}, setLyricsParser() {},
    window: { location: { search: '' }, addEventListener() {} }, demoTracks: [],
    setInterval: () => 0, clearInterval() {}, setTimeout, clearTimeout,
    createSystemControls: () => ({ update() {}, position() {} }), readDeviceState: () => ({}), openSystemSettings() {},
    LYRICS_SETTINGS_KEY: 'wuyu-lyrics-settings-v1', LYRICS_PROVIDER: '', hasTimedLyrics: lines => lines.some(line => line.time !== null),
    canRetryAutomatic: () => false, requestLyrics: options.lyrics || (async () => []), readAudioDuration: async () => 120, lyricsRetryAt: () => 0,
    pickWebFiles: async () => selection,
    fingerprint: options.fingerprint || (async file => file.hash), fingerprintAsset: async key => assets.get(key)?.hash || key,
    putAsset: async (key, data) => { const path = `idb:${key}`; assets.set(path, data); return path },
    assetUrl: async key => { if (!key) return ''; if (!assets.has(key)) throw new Error('missing'); return `blob:${key}` },
    deleteAsset: async key => { deleted.push(key); assets.delete(key) },
    audioMetadataSource: async key => assets.get(key),
    readEmbeddedAudioMetadata: options.metadata || (async () => ({ title: '标签歌名', artist: '标签歌手', lyrics: [{ time: 1, text: '歌词' }] })),
    exportAsset: async key => { if (!assets.has(key)) throw new Error('missing'); return 'data:audio/mpeg;base64,AAAA' },
    importAsset: async (key, data) => { const path = `idb:${key}`; assets.set(path, { data }); return path },
    createBackupWriter: async () => ({ write: async text => { written += text }, close: async () => {}, abort: async () => {} }),
  }
  const music = new Function(...Object.keys(deps), source + '\nreturn useMusic()')(...Object.values(deps))
  await music.initialize()
  return { music, assets, storage, deleted, toasts, events, select(files) { selection = files }, backup: () => JSON.parse(written) }
}
const song = (hash, name = `${hash}.mp3`) => ({ name, size: 100, hash })

test('import commits audio, cover and lyrics together after metadata, with stage progress and deduplication', async () => {
  const gate = deferred(), ctx = await setup({ metadata: () => gate.promise })
  ctx.select([song('one'), song('one'), song('two')])
  const importing = ctx.music.importSong()
  await until(() => ctx.music.importStatus.value.includes('读取内嵌封面与歌词'))
  assert.equal(ctx.music.tracks.value.length, 0)
  assert.equal(ctx.music.importBusy.value, true)
  assert.ok(ctx.music.importFilePercent.value > 0 && ctx.music.importFilePercent.value < 100)
  gate.resolve({ title: '读取完成', coverData: new Uint8Array([1, 2, 3]), coverMime: 'image/png', lyrics: [{ time: 1, text: '同步歌词' }] })
  await importing
  assert.equal(ctx.music.tracks.value.length, 2)
  assert.equal(ctx.music.importPercent.value, 100)
  assert.ok(ctx.music.tracks.value.every(track => track.uri && track.cover && !track.metadataPending && track.lyrics.length))
  assert.equal(ctx.music.tracks.value[0].title, '读取完成')
  assert.equal(ctx.music.metadataStatus.value, '')
})

test('cancelling during hashing commits no file and leaves all songs retryable', async () => {
  const gate = deferred(), ctx = await setup({ fingerprint: () => gate.promise })
  ctx.select([song('one'), song('two')])
  const importing = ctx.music.importSong()
  await until(() => ctx.music.importBusy.value)
  ctx.music.cancelImport(); gate.resolve('one'); await importing
  assert.equal(ctx.music.tracks.value.length, 0)
  assert.equal(ctx.music.failures.value.length, 2)
  assert.equal(ctx.assets.size, 0)
  assert.ok(ctx.music.importPercent.value < 100)
})

test('metadata failure preserves playable song and a retryable error', async () => {
  const ctx = await setup({ metadata: async () => { throw new Error('bad tag') } })
  ctx.select([song('one')]); await ctx.music.importSong()
  await until(() => ctx.music.tracks.value[0]?.metadataError)
  assert.equal(ctx.music.tracks.value[0].metadataError, 'bad tag')
  assert.ok(ctx.assets.has(ctx.music.tracks.value[0].audioKey))
})

test('cancellation during metadata parsing commits nothing and remains retryable', async () => {
  const gate = deferred(), ctx = await setup({ metadata: () => gate.promise })
  ctx.select([song('one')]); const importing = ctx.music.importSong()
  await until(() => ctx.music.importStatus.value.includes('读取内嵌封面与歌词'))
  ctx.music.cancelImport()
  gate.resolve({ coverData: new Uint8Array([1]), lyrics: [{ time: 1, text: '歌词' }] })
  await importing
  assert.equal(ctx.music.tracks.value.length, 0)
  assert.equal(ctx.assets.size, 0)
  assert.equal(ctx.music.failures.value.length, 1)
  assert.ok(ctx.music.importPercent.value < 100)
})

test('relink preserves song identity, playlists, favorite and lyrics', async () => {
  const ctx = await setup()
  ctx.select([song('one')]); await ctx.music.importSong(); await until(() => !ctx.music.tracks.value[0]?.metadataPending)
  const original = ctx.music.tracks.value[0], id = original.id, oldKey = original.audioKey
  ctx.music.toggleFavorite(original)
  ctx.music.menuTrack.value = original; ctx.music.sheet.value = 'add-playlist'; ctx.music.playlistName.value = '收藏'; ctx.music.createPlaylist()
  ctx.select([song('two')]); await ctx.music.relinkTrack(ctx.music.tracks.value[0]); await until(() => !ctx.music.tracks.value[0]?.metadataPending)
  const result = ctx.music.tracks.value[0]
  assert.equal(result.id, id); assert.equal(result.favorite, true); assert.deepEqual(result.lyrics, original.lyrics)
  assert.deepEqual(ctx.music.playlists.value[0].trackIds, [id]); assert.notEqual(result.audioKey, oldKey)
  assert.ok(!ctx.assets.has(oldKey)); assert.ok(ctx.assets.has(result.audioKey))
})

test('backup contains settings, and post-commit settings failure does not delete restored audio', async () => {
  const ctx = await setup(); ctx.select([song('one')]); await ctx.music.importSong(); await until(() => !ctx.music.tracks.value[0]?.metadataPending)
  ctx.storage.set(visual.VISUAL_SETTINGS_KEY, { customTexts: ['晚安'], textFont: 'serif' })
  await ctx.music.exportBackup(); const backup = ctx.backup()
  assert.deepEqual(backup.settings.visual.customTexts, ['晚安'])
  assert.equal(backup.settings.visual.textFont, 'serif')
  const target = await setup({ failStorage: key => key === visual.VISUAL_SETTINGS_KEY })
  await target.music.onWebBackup({ target: { files: [{ text: async () => JSON.stringify(backup) }] } })
  assert.equal(target.music.tracks.value.length, 1)
  assert.ok(target.assets.has(target.music.tracks.value[0].audioKey))
})

test('visual settings migrate legacy text and reject invalid fonts and oversized input', () => {
  const saved = visual.normalizeVisualSettings({ customText: '长沙', textFont: 'url(bad)', interval: -1 })
  assert.deepEqual(saved.customTexts, ['长沙']); assert.equal(saved.textFont, 'sans'); assert.equal(saved.interval, 6)
  assert.deepEqual(visual.normalizeTexts(['晚安', ' 晚安 ', null, '😀'.repeat(14)]), ['晚安', '😀'.repeat(12)])
  assert.equal(visual.normalizeTexts(Array.from({ length: 10 }, (_, i) => String(i))).length, 8)
  assert.deepEqual(visual.textRows('雾屿音乐晚安'), ['雾屿音乐', '晚安'])
  assert.deepEqual(visual.textRows('雾屿音乐晚安', 'line'), ['雾屿音乐晚安'])
  assert.equal(visual.normalizeBackupSettings(undefined), null)
})

test('batch operations preserve playlist order and remove only managed copies', async () => {
  const ctx = await setup()
  ctx.select([song('one'), song('two'), song('three')]); await ctx.music.importSong()
  await until(() => ctx.music.tracks.value.every(track => !track.metadataPending))
  const [one, two, three] = ctx.music.tracks.value
  ctx.music.selecting.value = true; ctx.music.selectedIds.value = [two.id, one.id]
  ctx.music.batchFavorite()
  assert.deepEqual(ctx.music.tracks.value.map(track => track.favorite), [true, true, false])
  ctx.music.selecting.value = true; ctx.music.selectedIds.value = [two.id, one.id]
  ctx.music.sheet.value = 'add-playlist'; ctx.music.playlistName.value = '自选'; ctx.music.createPlaylist()
  ctx.music.setFilter('playlists'); ctx.music.groupFilter.value = ctx.music.playlists.value[0].id
  ctx.music.movePlaylistTrack(two, -1)
  assert.deepEqual(ctx.music.libraryTracks.value.map(track => track.id), [two.id, one.id])
  ctx.music.selectedIds.value = [one.id, two.id]; ctx.music.removeSelected()
  await until(() => !ctx.assets.has(one.audioKey) && !ctx.assets.has(two.audioKey))
  assert.deepEqual(ctx.music.tracks.value.map(track => track.id), [three.id])
  assert.deepEqual(ctx.music.playlists.value[0].trackIds, [])
  assert.ok(ctx.assets.has(three.audioKey))
})

test('failed library commit rolls back restore assets without changing existing songs', async () => {
  const target = await setup({ failStorage: key => key === core.LIBRARY_KEY })
  const backup = { format: 'wuyu-backup', version: 1, playlists: [], tracks: [{ id: 'song', title: '恢复测试', lyrics: [], audioData: 'data:audio/mpeg;base64,AAAA' }] }
  await target.music.onWebBackup({ target: { files: [{ text: async () => JSON.stringify(backup) }] } })
  assert.equal(target.music.tracks.value.length, 0)
  assert.equal(target.assets.size, 0)
})


test('online lyrics finish during import before committing the song', async () => {
  const gate = deferred(), ctx = await setup({ automatic: true, metadata: async () => ({ artist: '歌手', title: '歌曲', lyrics: [] }), lyrics: () => gate.promise })
  ctx.select([song('online')]); const importing = ctx.music.importSong()
  await until(() => ctx.music.importStatus.value.includes('联网匹配同步歌词'))
  assert.equal(ctx.music.tracks.value.length, 0)
  assert.equal(ctx.music.importBusy.value, true)
  assert.equal(ctx.music.importFilePercent.value, 95)
  gate.resolve([{ confident: true, lyrics: [{ time: 1, text: '网络歌词' }], id: 'matched' }])
  await importing
  assert.equal(ctx.music.tracks.value[0].lyrics[0].text, '网络歌词')
  assert.equal(ctx.music.importPercent.value, 100)
})

test('cancel during lyric lookup removes uncommitted audio and cover', async () => {
  const gate = deferred(), ctx = await setup({ automatic: true, metadata: async () => ({ artist: '歌手', lyrics: [], coverData: new Uint8Array([1]), coverMime: 'image/png' }), lyrics: () => gate.promise })
  ctx.select([song('online')]); const importing = ctx.music.importSong()
  await until(() => ctx.music.importStatus.value.includes('联网匹配同步歌词'))
  ctx.music.cancelImport(); gate.resolve([])
  await importing
  assert.equal(ctx.assets.size, 0)
  assert.equal(ctx.music.tracks.value.length, 0)
  assert.equal(ctx.music.failures.value.length, 1)
})
