import { computed, onMounted, reactive, ref } from 'vue'
import { onHide, onShow } from '@dcloudio/uni-app'
import { readEmbeddedAudioMetadata, setLyricsParser } from './metadata.js'
import { LIBRARY_KEY, SESSION_KEY, MODE_LABELS, MODES, uid, parseLyrics, lyricAt, adjacentId, enqueueNext, trackRecord, errorText, validateBackup, filenameInfo } from './library-core.js'
import { putAsset, assetUrl, deleteAsset, importAsset, exportAsset, readLocal, fingerprint, fingerprintAsset, nativeMetadataSource, audioMetadataSource } from './asset-store.js'
import { pickDocuments, copyDocument } from './android-files.js'
import { createSystemControls } from './system-controls.js'
import { pickWebFiles } from './web-files.js'
import { LYRICS_SETTINGS_KEY, LYRICS_PROVIDER, hasTimedLyrics, requestLyrics, readAudioDuration, lyricsRetryAt, canRetryAutomatic } from './lyrics-api.js'
import { VISUAL_SETTINGS_KEY, normalizeVisualSettings, normalizeBackupSettings } from './visual-settings.js'
import { readDeviceState, openSystemSettings } from './device-state.js'
import { createBackupWriter } from './backup-writer.js'
// #ifdef H5
import { demoTracks } from './demo.js'
// #endif

let singleton
export function useMusic() {
  if (singleton) return singleton
  const tracks = ref([]), playlists = ref([]), queue = ref([]), history = []
  const currentId = ref(''), activeTab = ref('discover'), playerOpen = ref(false), playerView = ref('cover')
  const query = ref(''), libraryFilter = ref('all'), groupFilter = ref('')
  const isPlaying = ref(false), loading = ref(false), ready = ref(false), importBusy = ref(false), importStatus = ref('')
  const currentTime = ref(0), duration = ref(0), activeLyric = ref(-1), followLyrics = ref(true)
  const playbackMode = ref('list'), sleepUntil = ref(0), sleepAfterTrack = ref(false), now = ref(Date.now())
  const sheet = ref(''), menuTrack = ref(null), editor = ref(null), playlistName = ref('')
  const failures = ref([]), lastError = ref(''), backupBusy = ref(false), dragging = ref(false), dragPercent = ref(0)
  const autoLyrics = ref(true), lyricSearch = ref(null), lyricResults = ref([]), lyricBusy = ref(false), lyricMessage = ref(''), lyricSearched = ref(false)
  const autoLyricAttempts = reactive(new Map()), autoLyricPending = new Set()
  const lyricFetching = ref([]), lyricRetryable = computed(() => autoLyricAttempts.get(currentId.value)?.state === 'failed' && !!currentTrack.value?.lyricLookup)
  const backupProgress = ref(0), interruption = ref('')
  const importPercent = ref(0), importCancelled = ref(false), repairingId = ref('')
  const importFilePercent = ref(0), importElapsed = ref(0), importFileElapsed = ref(0)
  let importClockTimer, batchStartedAt = 0, fileStartedAt = 0
  const importClock = () => typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()
  function updateImportClock() {
    const at = importClock()
    importElapsed.value = Math.max(importElapsed.value, Math.floor((at - batchStartedAt) / 1000))
    importFileElapsed.value = Math.max(importFileElapsed.value, Math.floor((at - fileStartedAt) / 1000))
  }
  const appForeground = ref(true)
  const systemControlStatus = ref(''), deviceStatus = ref({}), metadataStatus = ref('')
  const selecting = ref(false), selectedIds = ref([]), relinkingId = ref(''), playlistEditName = ref('')
  const metadataQueue = [], metadataQueued = new Set()
  let metadataRunning = false, metadataTimer
  const selectedTracks = computed(() => tracks.value.filter(track => selectedIds.value.includes(track.id)))
  const restoreSettings = ref(true)
  function refreshDeviceStatus() { deviceStatus.value = readDeviceState(); refreshPlaybackState() }
  function toggleSelected(track) { selectedIds.value = selectedIds.value.includes(track.id) ? selectedIds.value.filter(id => id !== track.id) : [...selectedIds.value, track.id] }
  function endSelection() { selecting.value = false; selectedIds.value = [] }
  function selectAllTracks() { selectedIds.value = libraryTracks.value.every(track => selectedIds.value.includes(track.id)) ? [] : libraryTracks.value.map(track => track.id) }
  function batchFavorite() { if (libraryLocked()) return; const ids = new Set(selectedIds.value); try { const next = tracks.value.map(track => ids.has(track.id) ? { ...track, favorite: true } : track); persist(next); tracks.value = next; syncControls(); endSelection(); toast('已加入喜欢') } catch (error) { report(error) } }
  function renamePlaylist() {
    if (libraryLocked()) return
    const name = playlistEditName.value.trim()
    if (!name || playlists.value.some(list => list.id !== groupFilter.value && list.name === name)) { toast('请输入不重复的歌单名称'); return }
    try { const next = playlists.value.map(list => list.id === groupFilter.value ? { ...list, name } : list); persist(tracks.value, next); playlists.value = next; sheet.value = '' } catch (error) { report(error) }
  }

  let failedImports = []
  function cancelImport() { importCancelled.value = true }
  function checkImportCancelled() { if (importCancelled.value) throw Object.assign(new Error('导入已取消'), { cancelled: true }) }
  async function retryFailedImports() { const batch = [...failedImports]; if (!batch.length || importBusy.value || backupBusy.value) return; sheet.value = ''; await importBatch(batch.map(item => item.file), batch[0].native) }
  let lyricRequest = 0
  let audio, controls, initPromise, loadedId = '', playRequest = 0, lastSave = 0, forcedNext = '', fileTargetId = '', pendingSeek = 0
  let storedState = {}, timer
  let pauseReason = null
  setLyricsParser(parseLyrics)
  const currentTrack = computed(() => tracks.value.find(track => track.id === currentId.value) || null)
  const detailTrack = computed(() => tracks.value.find(track => track.id === menuTrack.value?.id) || null)
  const trackById = computed(() => new Map(tracks.value.map(track => [track.id, track])))
  const visibleTracks = computed(() => {
    const term = query.value.trim().toLowerCase()
    return tracks.value.filter(track => `${track.title} ${track.artist} ${track.album}`.toLowerCase().includes(term))
  })
  const libraryTracks = computed(() => {
    if (libraryFilter.value === 'playlists' && groupFilter.value) {
      const list = playlists.value.find(item => item.id === groupFilter.value)
      return (list?.trackIds || []).map(id => trackById.value.get(id)).filter(Boolean)
    }
    return tracks.value.filter(track => {
      if (libraryFilter.value === 'favorites') return track.favorite
      if (libraryFilter.value === 'albums' && groupFilter.value) return (track.album || '未知专辑') === groupFilter.value
      if (libraryFilter.value === 'artists' && groupFilter.value) return (track.artist || '未知歌手') === groupFilter.value
      return true
    }).slice().reverse()
  })
  const libraryGroups = computed(() => {
    if (libraryFilter.value === 'playlists') return playlists.value.map(list => ({ id: list.id, name: list.name, count: list.trackIds.length }))
    const key = libraryFilter.value === 'albums' ? 'album' : 'artist'
    const groups = new Map()
    for (const track of tracks.value) {
      const name = track[key] || (key === 'album' ? '未知专辑' : '未知歌手')
      groups.set(name, (groups.get(name) || 0) + 1)
    }
    return [...groups].map(([name, count]) => ({ id: name, name, count }))
  })
  const queueTracks = computed(() => queue.value.map(id => trackById.value.get(id)).filter(Boolean))
  const progress = computed(() => dragging.value ? dragPercent.value : duration.value > 0 ? Math.min(100, currentTime.value / duration.value * 100) : 0)
  const modeLabel = computed(() => MODE_LABELS[playbackMode.value])
  const sleepLabel = computed(() => sleepAfterTrack.value ? '本曲结束停止' : sleepUntil.value ? `${Math.max(0, Math.ceil((sleepUntil.value - now.value) / 60000))} 分钟后停止` : '定时停止')

  function toast(title) { uni.showToast({ title, icon: 'none' }) }
  function libraryLocked() { if (!backupBusy.value && !relinkingId.value) return false; toast('正在保存文件，请稍后再修改音乐库'); return true }
  function report(error) { lastError.value = errorText(error); toast(lastError.value) }
  function persist(nextTracks = tracks.value, nextLists = playlists.value) {
    uni.setStorageSync(LIBRARY_KEY, { version: 2, tracks: nextTracks.map(trackRecord), playlists: nextLists })
  }
  function saveSession() {
    try {
      uni.setStorageSync(SESSION_KEY, { currentId: currentId.value, time: currentTime.value, queue: queue.value, mode: playbackMode.value, sleepUntil: sleepUntil.value, sleepAfterTrack: sleepAfterTrack.value })
    } catch (error) { lastError.value = errorText(error) }
  }
  async function hydrate(record) {
    const track = { favorite: false, lyricOffset: 0, ...record, lyrics: Array.isArray(record.lyrics) ? record.lyrics : [], uri: '', cover: '' }
    track.lyricOffset = Number.isFinite(record.lyricOffset) ? Math.max(-60, Math.min(60, record.lyricOffset)) : 0
    try { track.uri = await assetUrl(track.audioKey); track.missing = !track.uri } catch { track.missing = true }
    try { track.cover = await assetUrl(track.coverKey) } catch { track.cover = '' }
    return track
  }
  async function restore() {
    autoLyrics.value = uni.getStorageSync(LYRICS_SETTINGS_KEY)?.automatic !== false
    const saved = uni.getStorageSync(LIBRARY_KEY)
    if (saved?.version === 2 && Array.isArray(saved.tracks)) {
      const hydrated = []
      for (let index = 0; index < saved.tracks.length; index += 40) {
        hydrated.push(...await Promise.all(saved.tracks.slice(index, index + 40).map(hydrate)))
        await new Promise(resolve => setTimeout(resolve, 0))
      }
      tracks.value = hydrated
      playlists.value = Array.isArray(saved.playlists) ? saved.playlists : []
    } else {
      const legacy = uni.getStorageSync('wuyu-local-library-v1')
      if (Array.isArray(legacy)) {
        for (const old of legacy) {
          let coverKey = old.cover || ''
          if (coverKey.startsWith('data:')) coverKey = await importAsset(`${uid()}.cover`, coverKey)
          tracks.value.push(await hydrate({ ...trackRecord(old), audioKey: old.uri, coverKey }))
        }
        persist()
      }
    }
    storedState = uni.getStorageSync(SESSION_KEY) || {}
    playbackMode.value = MODES.includes(storedState.mode) ? storedState.mode : 'list'
    queue.value = [...new Set((Array.isArray(storedState.queue) ? storedState.queue : []).filter(id => tracks.value.some(track => track.id === id)))]
    if (!queue.value.length) queue.value = tracks.value.map(track => track.id)
    if (tracks.value.some(track => track.id === storedState.currentId)) {
      currentId.value = storedState.currentId
      currentTime.value = Math.max(0, Number(storedState.time) || 0)
      duration.value = Number(currentTrack.value?.duration) || 0
      updateLyric()
    }
    sleepUntil.value = storedState.sleepUntil > Date.now() ? storedState.sleepUntil : 0
    sleepAfterTrack.value = !!storedState.sleepAfterTrack
  }

  function syncControls() {
    try { controls?.update(currentTrack.value, isPlaying.value); systemControlStatus.value = controls?.status?.() || '' } catch (error) { console.warn('系统播放控件更新失败', error) }
  }
  function updateLyric() {
    activeLyric.value = lyricAt(currentTrack.value?.lyrics || [], currentTime.value, currentTrack.value?.lyricOffset || 0)
  }
  function tick() {
    now.value = Date.now()
    if (sleepUntil.value && now.value >= sleepUntil.value) {
      sleepUntil.value = 0
      ++playRequest
      pauseAudio('定时停止已生效')
      saveSession()
      return true
    }
    return false
  }
  async function initialize() {
    if (initPromise) return initPromise
    initPromise = (async () => {
      try {
        await restore()
        // #ifdef H5
        audio = uni.createInnerAudioContext()
        // #endif
        // #ifdef APP-PLUS
        audio = uni.getBackgroundAudioManager()
        // #endif
        try { controls = createSystemControls({ play: () => startCurrent(), pause: () => pauseAudio(), interrupt: reason => { ++playRequest; pauseAudio(reason) }, previous: () => playAdjacent(-1), next: () => playAdjacent(1), seek: time => seekSeconds(time), getTime: () => currentTime.value, getDuration: () => duration.value, favorite: liked => { if (currentTrack.value && (typeof liked !== 'boolean' || currentTrack.value.favorite !== liked)) toggleFavorite() }, stop: () => { ++playRequest; pauseAudio('已停止播放'); seekSeconds(0) } }) }
        catch (error) { console.warn('系统控件初始化失败', error); lastError.value = '系统播放控件未能启动，仍可在应用内播放' }
        audio.onPlay(() => { pauseReason = null; isPlaying.value = true; interruption.value = ''; loading.value = false; lastError.value = ''; syncControls() })
        audio.onPause(() => { interruption.value = pauseReason === null ? '播放被系统暂停，点击播放可继续' : pauseReason; pauseReason = null; isPlaying.value = false; loading.value = false; saveSession(); syncControls() })
        audio.onStop(() => { isPlaying.value = false; loading.value = false; syncControls() })
        audio.onWaiting?.(() => { loading.value = true })
        audio.onPrev?.(() => playAdjacent(-1))
        audio.onNext?.(() => playAdjacent(1))
        const retryOnReconnect = result => {
          if (!result.isConnected || !autoLyrics.value) return
          const attempt = autoLyricAttempts.get(currentId.value)
          if (attempt?.state === 'failed' && Date.now() >= lyricsRetryAt()) { autoLyricAttempts.delete(currentId.value); void fetchAutomaticLyrics(currentId.value) }
        }
        uni.onNetworkStatusChange(retryOnReconnect)
        audio.onCanplay(() => {
          if (pendingSeek > 0) { const seek = pendingSeek; pendingSeek = 0; audio.seek(seek) }
          if (Number(audio.duration) > 0) duration.value = Number(audio.duration)
          if (currentTrack.value && duration.value > 0) void fetchAutomaticLyrics(currentTrack.value.id, duration.value)
          loading.value = false
        })
        audio.onTimeUpdate(() => {
          if (tick()) return
          if (!dragging.value) currentTime.value = Number(audio.currentTime) || 0
          if (Number(audio.duration) > 0) duration.value = Number(audio.duration)
          updateLyric()
          controls?.position?.(currentTime.value, duration.value)
          if (Date.now() - lastSave > 5000) { lastSave = Date.now(); saveSession() }
          if (currentTrack.value && duration.value > 0 && Math.abs((currentTrack.value.duration || 0) - duration.value) > 1) {
            currentTrack.value.duration = duration.value
            try { persist() } catch (error) { report(error) }
          }
          if (currentTrack.value && duration.value > 0) void fetchAutomaticLyrics(currentTrack.value.id, duration.value)
        })
        audio.onEnded(() => {
          if (sleepAfterTrack.value || tick()) {
            sleepAfterTrack.value = false
            isPlaying.value = false
            pauseAudio('已按设置停止播放')
            saveSession(); syncControls()
          } else playAdjacent(1, true)
        })
        audio.onError(error => {
          isPlaying.value = false; loading.value = false
          if ([10002, 10003].includes(error.errCode) && currentTrack.value) currentTrack.value.missing = true
          const messages = { 10002: '音频读取失败，请检查本地文件是否仍存在', 10003: '音频文件已失效，请重新导入', 10004: '系统无法解码此音频格式，请尝试其他文件' }
          lastError.value = messages[error.errCode] || '播放失败，请重试；若仍失败，请重新导入文件'
          syncControls()
        })
        // #ifdef H5
        if (new URLSearchParams(window.location.search).get('demo') === '1') {
          for (const demo of demoTracks) if (!tracks.value.some(track => track.id === demo.id)) {
            const { lrc, uri, cover, ...record } = demo
            tracks.value.push(await hydrate({ ...record, audioKey: uri, coverKey: cover, lyrics: parseLyrics(lrc) }))
          }
          persist()
          if (!currentId.value) { currentId.value = demoTracks[0].id; duration.value = currentTrack.value?.duration || 0 }
          for (const track of tracks.value) if (!queue.value.includes(track.id)) queue.value.push(track.id)
          playerOpen.value = true
        }
        window.addEventListener('pagehide', saveSession)
        window.addEventListener('keydown', event => {
          if (event.key === 'Escape') { if (sheet.value) sheet.value = ''; else playerOpen.value = false }
        })
        // #endif
        timer = setInterval(tick, 1000)
        ready.value = true
        tracks.value.filter(track => track.metadataPending && !track.missing).forEach(track => enqueueMetadata(track.id))
      } catch (error) { report(error); initPromise = null }
    })()
    return initPromise
  }

  async function playTrack(track, resume = false, recordHistory = true) {
    if (!track || !audio) return
    const request = ++playRequest
    if (recordHistory && currentId.value && currentId.value !== track.id) history.push(currentId.value)
    const start = resume ? currentTime.value : 0
    audio.stop()
    currentId.value = track.id
    currentTime.value = start; duration.value = Number(track.duration) || 0
    activeLyric.value = -1; followLyrics.value = true; lastError.value = ''; loading.value = true
    if (!queue.value.includes(track.id)) queue.value.push(track.id)
    try {
      const uri = await assetUrl(track.audioKey)
      if (!uri) throw new Error('音频文件已丢失，请重新导入')
      if (request !== playRequest) return
      track.uri = uri; track.missing = false
      audio.title = track.title; audio.singer = track.artist || '未知歌手'; audio.epname = track.album || ''; audio.coverImgUrl = track.cover || ''
      audio.startTime = start
      pendingSeek = start
      loadedId = track.id
      audio.src = uri
      audio.play()
      saveSession()
    } catch (error) { if (request === playRequest) { loading.value = false; track.missing = true; report(error) } }
  }
  function startCurrent() {
    if (!currentTrack.value) return
    if (loadedId !== currentId.value || lastError.value) return playTrack(currentTrack.value, true)
    audio.play()
  }
  function pauseAudio(reason = '') { pauseReason = reason; audio?.pause() }
  function togglePlayback() { if (isPlaying.value) pauseAudio(); else startCurrent() }
  function selectTrack(track) {
    if (selecting.value) { toggleSelected(track); return }
    if (track.missing) { menuTrack.value = track; sheet.value = 'details'; return }
    if (track.id === currentId.value) { playerOpen.value = true; return }
    if (activeTab.value === 'library') queue.value = libraryTracks.value.map(item => item.id)
    else if (activeTab.value === 'search') queue.value = visibleTracks.value.map(item => item.id)
    playTrack(track)
  }
  function openTrack(track) {
    if (track.id === currentId.value) { playerOpen.value = true; sheet.value = ''; return }
    menuTrack.value = track; sheet.value = 'details'
  }
  function playAdjacent(direction, ended = false) {
    if (direction < 0 && currentTime.value > 3 && !ended) { seekSeconds(0); return }
    let id
    if (direction > 0 && forcedNext) { id = forcedNext; forcedNext = '' }
    else if (direction < 0 && playbackMode.value === 'shuffle' && history.length) id = history.pop()
    else id = adjacentId(queue.value, currentId.value, direction, playbackMode.value, ended)
    playTrack(tracks.value.find(track => track.id === id), false, direction > 0)
  }
  function cycleMode() { playbackMode.value = MODES[(MODES.indexOf(playbackMode.value) + 1) % MODES.length]; saveSession(); toast(modeLabel.value) }
  function queueNext(track) { queue.value = enqueueNext(queue.value, currentId.value, track.id); if (track.id !== currentId.value) forcedNext = track.id; saveSession(); sheet.value = ''; toast('已设为下一首播放') }
  function moveQueue(index, direction) {
    const other = index + direction
    if (other < 0 || other >= queue.value.length) return
    const next = [...queue.value]; [next[index], next[other]] = [next[other], next[index]]; queue.value = next; saveSession()
  }
  function removeQueue(id) { if (id === currentId.value) return; queue.value = queue.value.filter(item => item !== id); if (forcedNext === id) forcedNext = ''; saveSession() }
  function seekSeconds(seconds) {
    currentTime.value = Math.max(0, Math.min(seconds, duration.value || seconds))
    if (loadedId === currentId.value) audio.seek(currentTime.value)
    updateLyric(); controls?.position?.(currentTime.value, duration.value); saveSession()
  }
  function previewSeek(event) { dragging.value = true; dragPercent.value = Number(event.detail.value) }
  function seekTo(event) { seekSeconds(duration.value * Number(event.detail.value) / 100); dragging.value = false }
  function seekLyric(line) { if (line.time !== null) { seekSeconds(line.time + (currentTrack.value.lyricOffset || 0)); followLyrics.value = true } }
  function adjustOffset(delta) { changeTrack(currentTrack.value, { lyricOffset: Math.max(-60, Math.min(60, (currentTrack.value.lyricOffset || 0) + delta)) }); updateLyric() }
  function setSleep(minutes) { sleepAfterTrack.value = minutes === -1; sleepUntil.value = minutes > 0 ? Date.now() + minutes * 60000 : 0; now.value = Date.now(); saveSession(); sheet.value = ''; toast(minutes ? sleepLabel.value : '已关闭定时停止') }
  function changeTrack(track, values) {
    if (libraryLocked()) return false
    if (!track) return
    const next = tracks.value.map(item => item.id === track.id ? { ...item, ...values } : item)
    try { persist(next); tracks.value = next; syncControls(); return true } catch (error) { report(error); return false }
  }
  function toggleFavorite(track = currentTrack.value) { if (track) changeTrack(track, { favorite: !track.favorite }) }
  function showTrackMenu(track) { menuTrack.value = track; sheet.value = 'track' }
  function editTrack(track) { editor.value = { id: track.id, title: track.title, artist: track.artist || '', album: track.album || '' }; sheet.value = 'edit' }
  function saveEdit() {
    if (!editor.value?.title.trim()) { toast('请填写歌名'); return }
    const track = tracks.value.find(item => item.id === editor.value.id)
    if (changeTrack(track, { title: editor.value.title.trim(), artist: editor.value.artist.trim(), album: editor.value.album.trim(), filenameGuess: false })) {
      autoLyricAttempts.delete(track.id); sheet.value = ''; toast('歌曲信息已更新'); void fetchAutomaticLyrics(track.id)
    }
  }
  function inferTrackInfo() {
    if (!editor.value) return
    const track = tracks.value.find(item => item.id === editor.value.id)
    const guess = filenameInfo(track?.name || track?.title || '')
    editor.value = { ...editor.value, title: guess.title, artist: guess.artist }
    toast('已从文件名填入，请核对后保存')
  }
  function addToPlaylist(list) {
    if (libraryLocked()) return
    const ids = selecting.value ? selectedTracks.value.map(track => track.id) : menuTrack.value ? [menuTrack.value.id] : []
    if (!ids.length) return
    const next = playlists.value.map(item => item.id === list.id ? { ...item, trackIds: [...new Set([...item.trackIds, ...ids])] } : item)
    try { persist(tracks.value, next); playlists.value = next; sheet.value = ''; endSelection(); toast('已加入歌单') } catch (error) { report(error) }
  }
  function createPlaylist() {
    if (libraryLocked()) return
    const name = playlistName.value.trim()
    if (!name) { toast('请输入歌单名称'); return }
    if (playlists.value.some(list => list.name === name)) { toast('已有同名歌单'); return }
    const list = { id: uid(), name, trackIds: sheet.value === 'add-playlist' ? (selecting.value ? selectedTracks.value.map(track => track.id) : menuTrack.value ? [menuTrack.value.id] : []) : [] }
    try { const next = [...playlists.value, list]; persist(tracks.value, next); playlists.value = next; playlistName.value = ''; sheet.value = ''; endSelection(); toast('歌单已创建') } catch (error) { report(error) }
  }
  function removeFromPlaylist(track) {
    if (libraryLocked()) return
    const next = playlists.value.map(list => list.id === groupFilter.value ? { ...list, trackIds: list.trackIds.filter(id => id !== track.id) } : list)
    try { persist(tracks.value, next); playlists.value = next; sheet.value = '' } catch (error) { report(error) }
  }
  function movePlaylistTrack(track, direction) {
    if (libraryLocked()) return
    const list = playlists.value.find(item => item.id === groupFilter.value)
    if (!list) return
    const ids = [...list.trackIds], index = ids.indexOf(track.id), other = index + direction
    if (index < 0 || other < 0 || other >= ids.length) return
    ;[ids[index], ids[other]] = [ids[other], ids[index]]
    const next = playlists.value.map(item => item.id === list.id ? { ...item, trackIds: ids } : item)
    try { persist(tracks.value, next); playlists.value = next; toast('歌单顺序已更新') } catch (error) { report(error) }
  }
  function deletePlaylist() {
    if (libraryLocked()) return
    uni.showModal({ title: '删除歌单', content: '只删除歌单，歌曲仍保留在音乐库中。', success: ({ confirm }) => {
      if (!confirm || libraryLocked()) return
      try { const next = playlists.value.filter(list => list.id !== groupFilter.value); persist(tracks.value, next); playlists.value = next; groupFilter.value = '' } catch (error) { report(error) }
    } })
  }
  function removeTrack(track) { if (track) removeTracks([track.id]) }
  function removeSelected() { removeTracks(selectedIds.value) }
  function removeTracks(ids) {
    if (libraryLocked() || !ids.length) return
    const remove = new Set(ids)
    uni.showModal({ title: `移除 ${remove.size} 首歌曲`, content: '将移出音乐库并清理应用保存的副本。手机中的原始音乐文件不会删除。', confirmText: '移除', confirmColor: '#aa6870', success: async ({ confirm }) => {
      if (!confirm || libraryLocked()) return
      const removed = tracks.value.filter(track => remove.has(track.id)), playing = isPlaying.value
      const nextTracks = tracks.value.filter(track => !remove.has(track.id))
      const nextLists = playlists.value.map(list => ({ ...list, trackIds: list.trackIds.filter(id => !remove.has(id)) }))
      try { persist(nextTracks, nextLists) } catch (error) { report(error); return }
      if (remove.has(currentId.value)) { ++playRequest; audio.stop(); loadedId = ''; currentId.value = ''; currentTime.value = 0; duration.value = 0; loading.value = false }
      tracks.value = nextTracks; playlists.value = nextLists; queue.value = queue.value.filter(id => !remove.has(id)); sheet.value = ''; endSelection()
      if (remove.has(forcedNext)) forcedNext = ''
      for (let i = history.length - 1; i >= 0; i--) if (remove.has(history[i])) history.splice(i, 1)
      if (!currentId.value) {
        const next = tracks.value.find(track => track.id === queue.value[0]) || tracks.value[0]
        if (next) { if (playing) playTrack(next); else { currentId.value = next.id; duration.value = next.duration || 0; updateLyric() } }
        else playerOpen.value = false
      }
      saveSession(); syncControls()
      const used = new Set(tracks.value.flatMap(track => [track.audioKey, track.coverKey]))
      for (const track of removed) for (const key of [track.audioKey, track.coverKey]) if (key && !used.has(key)) {
        try { await deleteAsset(key) } catch { toast('已移除，部分应用副本清理失败') }
      }
    } })
  }

  function enqueueMetadata(id) {
    if (!metadataQueued.has(id)) { metadataQueued.add(id); metadataQueue.push(id) }
    void drainMetadata()
  }
  async function drainMetadata() {
    if (metadataRunning || !metadataQueue.length) return
    if (importBusy.value || backupBusy.value || relinkingId.value || repairingId.value || isPlaying.value || !appForeground.value) {
      clearTimeout(metadataTimer); metadataTimer = setTimeout(drainMetadata, 1000); return
    }
    metadataRunning = true
    const id = metadataQueue.shift(), original = tracks.value.find(track => track.id === id)
    let createdCover = '', committed = false
    try {
      if (!original) return
      metadataStatus.value = `正在补全封面与歌词 · ${original.title}（余 ${metadataQueue.length + 1} 首）`
      const source = await audioMetadataSource(original.audioKey)
      const metadata = await readEmbeddedAudioMetadata(source)
      if (!metadata.coverData?.length && typeof source.readCover === 'function') {
        try { Object.assign(metadata, source.readCover() || {}) } catch {}
      }
      if (backupBusy.value || relinkingId.value || repairingId.value || isPlaying.value) { metadataQueue.push(id); return }
      let live = tracks.value.find(track => track.id === id)
      if (!live || live.audioKey !== original.audioKey) return
      if (!live.cover && metadata.coverData?.length) createdCover = await putAsset(`${uid()}.cover`, metadata.coverData, metadata.coverMime)
      const cover = createdCover ? await assetUrl(createdCover) : ''
      live = tracks.value.find(track => track.id === id)
      if (!live || live.audioKey !== original.audioKey) return
      if (backupBusy.value || relinkingId.value || repairingId.value || isPlaying.value) { metadataQueue.push(id); return }
      const values = { metadataPending: false, metadataError: '' }
      if (live.title === original.title && metadata.title) values.title = metadata.title
      if (live.artist === original.artist && metadata.artist) { values.artist = metadata.artist; values.filenameGuess = false }
      if (!live.album && metadata.album) values.album = metadata.album
      if (!live.coverKey && createdCover) { values.coverKey = createdCover; values.cover = cover }
      if (!live.lyrics.length && metadata.lyrics?.length) { values.lyrics = metadata.lyrics; values.lyricsRevision = uid() }
      if (!changeTrack(live, values)) throw new Error('信息保存失败，可重试补全')
      committed = !!values.coverKey; updateLyric()
      if (autoLyrics.value) void fetchAutomaticLyrics(id)
    } catch (error) {
      const live = tracks.value.find(track => track.id === id)
      if (live && live.audioKey === original?.audioKey && !backupBusy.value) changeTrack(live, { metadataPending: false, metadataError: errorText(error) })
    } finally {
      if (createdCover && !committed) { try { await deleteAsset(createdCover) } catch {} }
      if (!metadataQueue.includes(id)) metadataQueued.delete(id)
      metadataRunning = false; metadataStatus.value = ''
      if (metadataQueue.length) { clearTimeout(metadataTimer); metadataTimer = setTimeout(drainMetadata, 50) }
    }
  }

  async function importBatch(files, native = false) {
    if (!files.length || importBusy.value || libraryLocked()) return
    importBusy.value = true; failures.value = []; let added = 0, duplicates = 0
    failedImports = []; importPercent.value = 0; importCancelled.value = false
    importElapsed.value = 0; importFileElapsed.value = 0
    batchStartedAt = fileStartedAt = importClock()
    clearInterval(importClockTimer)
    importClockTimer = setInterval(updateImportClock, 250)
    try {
      if (metadataRunning) importStatus.value = '正在等待上一次信息读取完成…'
      while (metadataRunning && !importCancelled.value) { updateImportClock(); await new Promise(resolve => setTimeout(resolve, 16)) }
      for (let i = 0; i < files.length; i++) {
        if (importCancelled.value) {
          for (const file of files.slice(i)) { failedImports.push({ file, native }); failures.value.push({ name: file.name, message: '已取消，可重新导入' }) }
          break
        }
        const file = files[i], id = uid(); let audioKey = '', coverKey = '', committed = false
        updateImportClock(); fileStartedAt = importClock(); importFileElapsed.value = 0; importFilePercent.value = 0
        importStatus.value = `正在导入 ${i + 1}/${files.length} · ${file.name}`
        const advance = async (percent, stage) => {
          checkImportCancelled()
          importFilePercent.value = Math.max(importFilePercent.value, percent)
          importPercent.value = Math.max(importPercent.value, Math.floor((i + importFilePercent.value / 100) / files.length * 100))
          importStatus.value = `正在${stage} ${i + 1}/${files.length} · ${file.name}`
          updateImportClock()
          await new Promise(resolve => setTimeout(resolve, 0))
          checkImportCancelled()
        }
        try {
          let source = file, hash
          if (!native && file.size === 0) throw new Error('文件为空，无法导入')
          importStatus.value = `正在${native ? '复制并去重' : '检查重复'} ${i + 1}/${files.length} · ${file.name}`
          await new Promise(resolve => setTimeout(resolve, 0))
          if (native) {
            const copied = await copyDocument(file, { fingerprint: true, cancelled: () => importCancelled.value, onProgress: (bytes, total) => { updateImportClock(); if (total > 0) { importFilePercent.value = Math.max(importFilePercent.value, Math.floor(Math.min(1, bytes / total) * 55)); importPercent.value = Math.max(importPercent.value, Math.floor((i + importFilePercent.value / 100) / files.length * 100)) } } })
            audioKey = copied.path; hash = copied.hash; source = nativeMetadataSource(audioKey)
            if (source.size === 0) throw new Error('文件为空，无法导入')
          } else hash = await fingerprint(file)
          checkImportCancelled()
          if (tracks.value.some(track => track.hash === hash && !track.missing)) { duplicates++; continue }
          await advance(60, '读取内嵌封面与歌词')
          let metadata = {}, metadataError = ''
          try {
            metadata = await readEmbeddedAudioMetadata(source, { strict: true })
          } catch (error) { metadataError = errorText(error) }
          checkImportCancelled()
          if (native && !metadata.coverData?.length) {
            await advance(80, '读取系统封面')
            try { Object.assign(metadata, source.readCover() || {}) }
            catch (error) { metadataError = metadataError || errorText(error) }
          }
          await advance(90, '保存歌曲、封面与歌词')
          if (!native) audioKey = await putAsset(`${id}.audio`, file)
          checkImportCancelled()
          if (metadata.coverData?.length) coverKey = await putAsset(`${id}.cover`, metadata.coverData, metadata.coverMime)
          const guess = filenameInfo(file.name)
          const track = await hydrate({ id, audioKey, coverKey, hash, size: file.size || source.size || 0, name: file.name,
            title: metadata.title || guess.title, artist: metadata.artist || guess.artist, filenameGuess: !metadata.artist && !!guess.artist,
            album: metadata.album || '', lyrics: metadata.lyrics || [], duration: 0, metadataPending: false, metadataError })
          let lookupAttempt = null
          if (autoLyrics.value && !hasTimedLyrics(track.lyrics) && track.artist?.trim() && !track.filenameGuess) {
            await advance(95, '联网匹配同步歌词')
            try {
              const seconds = await readAudioDuration(track.uri)
              checkImportCancelled()
              if (!seconds) throw new Error('未能读取音频时长，可播放后手动查找歌词')
              track.duration = seconds
              const results = await requestLyrics({ title: track.title, artist: track.artist, album: track.album, duration: seconds })
              checkImportCancelled()
              const match = results.find(item => item.confident)
              if (match && autoLyrics.value) Object.assign(track, { lyrics: match.lyrics, lyricsRevision: uid(), lyricOffset: 0,
                lyricsSource: { provider: match.provider || LYRICS_PROVIDER, id: match.id, title: match.title, artist: match.artist, album: match.album, duration: match.duration }, lyricLookup: '已自动获取同步歌词' })
              else { lookupAttempt = { count: 1, state: 'unmatched' }; track.lyricLookup = '未找到确定匹配的同步歌词，可手动选择版本' }
            } catch (error) {
              checkImportCancelled()
              track.lyricLookup = errorText(error)
              lookupAttempt = { count: 1, state: 'failed', retryAt: Math.max(Date.now() + 60000, lyricsRetryAt()) }
            }
          }
          await advance(98, '完成导入')
          const next = [...tracks.value, track]
          checkImportCancelled()
          persist(next); tracks.value = next; queue.value.push(id); committed = true; added++
          if (lookupAttempt) autoLyricAttempts.set(id, { ...lookupAttempt, key: JSON.stringify([track.title, track.artist, track.lyricsRevision]) })
        } catch (error) { failures.value.push({ name: file.name, message: errorText(error) }); failedImports.push({ file, native }) }
        finally {
          if (!committed) { try { await deleteAsset(audioKey); await deleteAsset(coverKey) } catch {} }
          updateImportClock()
          if (!importCancelled.value) {
            importFilePercent.value = 100
            importPercent.value = Math.max(importPercent.value, Math.floor((i + 1) / files.length * 100))
          }
        }
      }
    } finally {
      updateImportClock(); clearInterval(importClockTimer); importClockTimer = null; importBusy.value = false
    }
    importStatus.value = ''; activeTab.value = 'library'; saveSession()
    toast(`${importCancelled.value ? '导入已取消，' : ''}已导入 ${added} 首${duplicates ? `，跳过 ${duplicates} 首重复歌曲` : ''}${failures.value.length ? `，${failures.value.length} 首待重试` : ''}，用时 ${importElapsed.value} 秒`)
    if (failures.value.length) sheet.value = 'failures'
  }
  async function repairEmbedded(track = detailTrack.value || currentTrack.value) {
    if (!track || repairingId.value || importBusy.value || libraryLocked()) return
    if (track.metadataPending) { enqueueMetadata(track.id); toast('已加入信息补全队列'); return }
    repairingId.value = track.id
    let createdCover = '', committed = false
    try {
      const source = await audioMetadataSource(track.audioKey)
      const metadata = await readEmbeddedAudioMetadata(source)
      if (!metadata.coverData?.length && typeof source.readCover === 'function') {
        try { Object.assign(metadata, source.readCover() || {}) } catch (error) { console.warn('系统封面读取失败', error) }
      }
      const live = tracks.value.find(item => item.id === track.id)
      if (!live || live.audioKey !== track.audioKey) throw new Error('歌曲已变更，请重新打开详情')
      const values = { metadataError: '' }
      if (!live.cover && metadata.coverData?.length) {
        createdCover = await putAsset(`${uid()}.cover`, metadata.coverData, metadata.coverMime)
        values.coverKey = createdCover; values.cover = await assetUrl(createdCover)
      }
      if (!live.lyrics.length && metadata.lyrics?.length) Object.assign(values, { lyrics: metadata.lyrics, lyricOffset: 0, lyricsRevision: uid(), lyricsSource: null })
      if (Object.keys(values).length === 1) { changeTrack(live, values); toast('没有可补全的内嵌信息，可手动导入封面或歌词'); return }
      const latest = tracks.value.find(item => item.id === track.id)
      if (!latest || latest.coverKey !== live.coverKey || latest.lyricsRevision !== live.lyricsRevision) throw new Error('歌曲信息已更新，请重试')
      if (!changeTrack(latest, values)) return
      committed = true
      if (createdCover && live.coverKey) { try { await deleteAsset(live.coverKey) } catch {} }
      updateLyric(); toast('已补全歌曲内嵌信息')
    } catch (error) { report(error) }
    finally { repairingId.value = ''; if (!committed && createdCover) { try { await deleteAsset(createdCover) } catch {} } }
  }
  async function relinkTrack(track = detailTrack.value || currentTrack.value) {
    if (!track || importBusy.value || libraryLocked()) return
    let file, native = false, key = '', committed = false
    try {
      // #ifdef H5
      ;[file] = await pickWebFiles('audio/*,.mp3,.m4a,.aac,.wav,.ogg,.flac')
      // #endif
      // #ifdef APP-PLUS
      ;[file] = await pickDocuments('audio/*'); native = true
      // #endif
      if (!file || importBusy.value || libraryLocked()) return
      relinkingId.value = track.id
      let hash
      if (native) { const copied = await copyDocument(file, { fingerprint: true }); key = copied.path; hash = copied.hash }
      else { hash = await fingerprint(file); key = await putAsset(`${uid()}.audio`, file) }
      if (track.hash && track.hash !== hash) {
        const confirmed = await new Promise(resolve => uni.showModal({ title: '所选文件与原歌曲不同', content: `将使用“${file.name}”替换音频，保留歌单、封面和歌词。歌词时间可能需要重新校准。`, success: result => resolve(result.confirm), fail: () => resolve(false) }))
        if (!confirmed) return
      }
      const live = tracks.value.find(item => item.id === track.id)
      if (!live || live.audioKey !== track.audioKey) throw new Error('歌曲已发生变化，请重新关联')
      const uri = await assetUrl(key)
      const replacement = { ...live, audioKey: key, uri, hash, name: file.name, size: file.size || 0, missing: false, duration: hash === live.hash ? live.duration : 0, metadataPending: true }
      const next = tracks.value.map(item => item.id === live.id ? replacement : item)
      persist(next)
      if (currentId.value === live.id) { ++playRequest; audio.stop(); loadedId = ''; currentTime.value = 0; duration.value = replacement.duration || 0 }
      tracks.value = next; committed = true; sheet.value = ''; saveSession(); syncControls()
      if (!tracks.value.some(item => item.audioKey === live.audioKey)) { try { await deleteAsset(live.audioKey) } catch {} }
      enqueueMetadata(live.id); toast('音频已重新关联，歌单和收藏已保留')
    } catch (error) { if (!errorText(error).includes('取消')) report(error) }
    finally { relinkingId.value = ''; if (key && !committed) { try { await deleteAsset(key) } catch {} } }
  }
  async function importSong() {
    if (importBusy.value || !ready.value || libraryLocked()) return
    // #ifdef H5
    const files = await pickWebFiles('audio/*,.mp3,.m4a,.aac,.wav,.ogg,.flac', true)
    if (files.length) await importBatch(files)
    // #endif
    // #ifdef APP-PLUS
    try { await importBatch(await pickDocuments('audio/*', true), true) } catch (error) { if (!errorText(error).includes('取消')) report(error) }
    // #endif
  }
  function onWebAudio(event) { const files = Array.from(event.target?.files || []); if (files.length) importBatch(files) }
  async function setCover(trackId, file, native = false) {
    const track = tracks.value.find(item => item.id === trackId)
    if (!track) throw new Error('歌曲已被移除')
    let key
    if (native) key = await copyDocument(file)
    else key = await putAsset(`${uid()}.cover`, file)
    try {
      const cover = await assetUrl(key)
      if (!changeTrack(track, { coverKey: key, cover })) throw new Error('封面保存失败')
      try { await deleteAsset(track.coverKey) } catch (error) { console.warn('旧封面清理失败', error) }
      toast('封面已更新')
    } catch (error) { await deleteAsset(key); throw error }
  }
  async function importCover() {
    if (libraryLocked()) return
    if (!currentTrack.value) return
    fileTargetId = currentId.value
    // #ifdef H5
    const target = fileTargetId
    const [file] = await pickWebFiles('image/*')
    if (file) { try { await setCover(target, file) } catch (error) { report(error) } }
    // #endif
    // #ifdef APP-PLUS
    try { const [file] = await pickDocuments('image/*'); if (file) await setCover(fileTargetId, file, true) } catch (error) { if (!errorText(error).includes('取消')) report(error) }
    // #endif
  }
  async function onWebCover(event) { const file = event.target?.files?.[0]; if (file) { try { await setCover(fileTargetId, file) } catch (error) { report(error) } } }
  function setLyrics(id, text) {
    const track = tracks.value.find(item => item.id === id)
    const lyrics = parseLyrics(text)
    if (!lyrics.length) throw new Error('没有找到可显示的歌词，请检查文件内容')
    if (changeTrack(track, { lyrics, lyricOffset: 0, lyricsSource: null, lyricsRevision: uid(), lyricLookup: '' })) { updateLyric(); toast('歌词已更新') }
  }
  function toggleAutoLyrics(event) {
    const enabled = !!event.detail.value
    try { uni.setStorageSync(LYRICS_SETTINGS_KEY, { automatic: enabled }); autoLyrics.value = enabled }
    catch (error) { report(error) }
  }
  async function fetchAutomaticLyrics(id, knownDuration = 0) {
    const track = tracks.value.find(item => item.id === id)
    if (!autoLyrics.value || backupBusy.value || importBusy.value || !track || track.metadataPending || hasTimedLyrics(track.lyrics) || !track.artist?.trim() || track.filenameGuess || track.audioKey?.startsWith('/static/demo/') || autoLyricPending.has(id)) return
    const key = JSON.stringify([track.title, track.artist, track.lyricsRevision])
    const previous = autoLyricAttempts.get(id)
    if (!canRetryAutomatic(previous, key)) return
    const count = previous?.key === key ? previous.count + 1 : 1
    autoLyricPending.add(id); lyricFetching.value = [...autoLyricPending]
    const snapshot = { title: track.title, artist: track.artist, album: track.album, lyrics: JSON.stringify(track.lyrics), revision: track.lyricsRevision }
    try {
      const seconds = knownDuration || track.duration || await readAudioDuration(track.uri)
      if (!seconds) throw new Error('未能读取音频时长，播放歌曲后可重试')
      if (!autoLyrics.value || backupBusy.value) return
      const results = await requestLyrics({ ...snapshot, duration: seconds })
      const live = tracks.value.find(item => item.id === id)
      if (!autoLyrics.value || backupBusy.value || !live || live.title !== snapshot.title || live.artist !== snapshot.artist || live.lyricsRevision !== snapshot.revision || JSON.stringify(live.lyrics) !== snapshot.lyrics) return
      const match = results.find(item => item.confident)
      if (!match) { autoLyricAttempts.set(id, { key, count, state: 'unmatched' }); changeTrack(live, { lyricLookup: results.length ? '有候选版本，请联网搜索后手动选择' : '未找到同步歌词，可修改歌名或歌手后重试' }); return }
      if (changeTrack(live, { lyrics: match.lyrics, duration: seconds, lyricOffset: 0, lyricsRevision: uid(), lyricsSource: { provider: match.provider || LYRICS_PROVIDER, id: match.id, title: match.title, artist: match.artist, album: match.album, duration: match.duration }, lyricLookup: '已自动获取同步歌词' })) {
        if (currentId.value === id) updateLyric()
        autoLyricAttempts.set(id, { key, count, state: 'saved' })
      }
    } catch (error) {
      const live = tracks.value.find(item => item.id === id)
      autoLyricAttempts.set(id, { key, count, state: 'failed', retryAt: Math.max(Date.now() + 60000, lyricsRetryAt()) })
      if (live && !backupBusy.value && !hasTimedLyrics(live.lyrics)) changeTrack(live, { lyricLookup: errorText(error) })
    } finally { autoLyricPending.delete(id); lyricFetching.value = [...autoLyricPending] }
  }
  function retryCurrentLyrics() {
    if (Date.now() < lyricsRetryAt()) { toast(`歌词服务繁忙，请 ${Math.ceil((lyricsRetryAt() - Date.now()) / 1000)} 秒后重试`); return }
    if (!currentTrack.value?.artist || currentTrack.value.filenameGuess) { openLyricSearch(); return }
    autoLyricAttempts.delete(currentId.value); void fetchAutomaticLyrics(currentId.value)
  }
  function openLyricSearch() {
    if (!currentTrack.value) return
    ++lyricRequest; lyricBusy.value = false; lyricResults.value = []; lyricMessage.value = ''; lyricSearched.value = false
    const track = currentTrack.value
    let title = track.title, artist = track.artist || ''
    if (!artist && title.includes('--')) [title, artist] = title.split('--').map(value => value.trim())
    lyricSearch.value = { trackId: track.id, title, artist, album: track.album || '', duration: track.duration || duration.value || 0 }
    sheet.value = 'lyrics-search'
  }
  async function searchOnlineLyrics() {
    if (!lyricSearch.value || lyricBusy.value) return
    if (!lyricSearch.value.title.trim()) { lyricMessage.value = '请填写歌名'; return }
    const request = ++lyricRequest, query = { ...lyricSearch.value }
    lyricBusy.value = true; lyricMessage.value = ''; lyricResults.value = []; lyricSearched.value = true
    try {
      const results = await requestLyrics(query)
      if (request !== lyricRequest) return
      lyricResults.value = results
      if (!results.length) lyricMessage.value = '没有找到带时间戳的歌词，试试简化歌名或更正歌手，也可以导入本地 LRC。'
    } catch (error) { if (request === lyricRequest) lyricMessage.value = errorText(error) }
    finally { if (request === lyricRequest) lyricBusy.value = false }
  }
  async function applyOnlineLyrics(candidate) {
    if (!lyricSearch.value || libraryLocked()) return
    const id = lyricSearch.value.trackId
    const track = tracks.value.find(item => item.id === id)
    if (!track) { lyricMessage.value = '歌曲已被移除，请关闭面板后重试'; return }
    const revision = track.lyricsRevision, lyrics = JSON.stringify(track.lyrics)
    const request = lyricRequest
    if (track.lyrics.length || !candidate.confident) {
      const confirmed = await new Promise(resolve => uni.showModal({ title: '使用这个歌词版本？', content: `${candidate.title} · ${candidate.artist}（${formatTime(candidate.duration)}）。${candidate.difference !== null && candidate.difference > 2 ? '与音频时长不一致，可能需要校准。' : ''}${track.lyrics.length ? '将替换当前歌词。' : ''}`, success: result => resolve(result.confirm), fail: () => resolve(false) }))
      if (!confirmed) return
    }
    const live = tracks.value.find(item => item.id === id)
    if (request !== lyricRequest || !live || live.lyricsRevision !== revision || JSON.stringify(live.lyrics) !== lyrics) { lyricMessage.value = '歌曲或歌词已发生变化，请重新搜索后选择'; return }
    if (changeTrack(live, { lyrics: candidate.lyrics, lyricOffset: 0, lyricsRevision: uid(), lyricsSource: { provider: candidate.provider || LYRICS_PROVIDER, id: candidate.id, title: candidate.title, artist: candidate.artist, album: candidate.album, duration: candidate.duration }, lyricLookup: '已保存同步歌词' })) {
      if (currentId.value === id) { updateLyric(); followLyrics.value = true; playerView.value = 'lyrics' }
      sheet.value = ''; toast('同步歌词已保存，可离线使用')
    }
  }
  async function importLyrics() {
    if (libraryLocked()) return
    if (!currentTrack.value) return
    fileTargetId = currentId.value
    // #ifdef H5
    const target = fileTargetId
    const [file] = await pickWebFiles('.lrc,.txt,text/plain')
    if (file) { try { setLyrics(target, await file.text()) } catch (error) { report(error) } }
    // #endif
    // #ifdef APP-PLUS
    let path
    try { const [file] = await pickDocuments('*/*'); if (file) { path = await copyDocument(file); setLyrics(fileTargetId, await readLocal(path, true)) } }
    catch (error) { if (!errorText(error).includes('取消')) report(error) }
    finally { if (path) await deleteAsset(path) }
    // #endif
  }
  async function onWebLyrics(event) { const file = event.target?.files?.[0]; if (file) { try { setLyrics(fileTargetId, await file.text()) } catch (error) { report(error) } } }

  async function exportBackup() {
    if (backupBusy.value || importBusy.value || relinkingId.value) return
    backupBusy.value = true; backupProgress.value = 0
    let writer
    try {
      writer = await createBackupWriter()
      const snapshot = tracks.value.map(trackRecord)
      const lists = playlists.value.map(list => ({ ...list, trackIds: [...list.trackIds] }))
      await writer.write('{"format":"wuyu-backup","version":1,"tracks":[')
      for (let i = 0; i < snapshot.length; i++) {
        importStatus.value = `正在备份 ${i + 1}/${snapshot.length}`
        const track = snapshot[i]
        const record = { ...track, hash: await fingerprintAsset(track.audioKey), audioData: await exportAsset(track.audioKey), coverData: track.coverKey ? await exportAsset(track.coverKey) : '' }
        await writer.write((i ? ',' : '') + JSON.stringify(record))
        backupProgress.value = Math.round((i + 1) / snapshot.length * 100)
        await new Promise(resolve => setTimeout(resolve, 0))
      }
      const settings = { visual: normalizeVisualSettings(uni.getStorageSync(VISUAL_SETTINGS_KEY)), automaticLyrics: autoLyrics.value, playbackMode: playbackMode.value }
      await writer.write('],"playlists":' + JSON.stringify(lists) + ',"settings":' + JSON.stringify(settings) + ',"createdAt":' + JSON.stringify(new Date().toISOString()) + '}')
      await writer.close()
      toast('备份已导出，包含音频、封面、歌词与歌单')
    } catch (error) { try { await writer?.abort() } catch {} if (!errorText(error).includes('取消')) report(error) }
    finally { backupBusy.value = false; importStatus.value = '' }
  }
  async function restoreBackup(text) {
    if (backupBusy.value || importBusy.value || relinkingId.value) return
    backupBusy.value = true; backupProgress.value = 0
    const created = []; let committed = false
    try {
      const backup = validateBackup(JSON.parse(text))
      const nextTracks = [...tracks.value], map = new Map()
      const hashes = new Map()
      for (const track of nextTracks) {
        if (track.missing) continue
        try { hashes.set(track.hash || await fingerprintAsset(track.audioKey), track) } catch {}
      }
      for (let i = 0; i < backup.tracks.length; i++) {
        const record = backup.tracks[i]
        importStatus.value = `正在恢复 ${i + 1}/${backup.tracks.length}`
        backupProgress.value = Math.round((i + 1) / backup.tracks.length * 100)
        if (i % 5 === 0) await new Promise(resolve => setTimeout(resolve, 0))
        const id = uid()
        const audioKey = await importAsset(`${id}.audio`, record.audioData); created.push(audioKey)
        const hash = await fingerprintAsset(audioKey)
        const existing = hashes.get(hash)
        if (existing) { map.set(record.id, existing.id); await deleteAsset(audioKey); continue }
        const coverKey = record.coverData ? await importAsset(`${id}.cover`, record.coverData) : ''; if (coverKey) created.push(coverKey)
        const { audioData, coverData, uri, cover, ...metadata } = record
        const track = await hydrate({ ...metadata, id, hash, audioKey, coverKey })
        nextTracks.push(track); hashes.set(hash, track); map.set(record.id, id)
      }
      const nextLists = playlists.value.map(list => ({ ...list, trackIds: [...list.trackIds] }))
      for (const list of backup.playlists) {
        const ids = list.trackIds.map(id => map.get(id))
        const existing = nextLists.find(item => item.name === list.name)
        if (existing) existing.trackIds = [...new Set([...existing.trackIds, ...ids])]
        else nextLists.push({ id: uid(), name: list.name, trackIds: [...new Set(ids)] })
      }
      persist(nextTracks, nextLists); tracks.value = nextTracks; playlists.value = nextLists; committed = true
      const settings = normalizeBackupSettings(backup.settings)
      if (restoreSettings.value && settings) {
        try {
          uni.setStorageSync(VISUAL_SETTINGS_KEY, settings.visual)
          uni.setStorageSync(LYRICS_SETTINGS_KEY, { automatic: settings.automaticLyrics })
          autoLyrics.value = settings.automaticLyrics; playbackMode.value = settings.playbackMode
          uni.$emit('wuyu-visual-settings')
        } catch { toast('歌曲已恢复，部分设置保存失败') }
      }
      tracks.value.filter(track => track.metadataPending).forEach(track => enqueueMetadata(track.id))
      queue.value = [...new Set([...queue.value, ...tracks.value.map(track => track.id)])]; saveSession(); sheet.value = ''; toast('备份已合并到音乐库')
    } catch (error) {
      if (!committed) for (const key of created) { try { await deleteAsset(key) } catch {} }
      report(error)
    } finally { backupBusy.value = false; importStatus.value = '' }
  }
  async function chooseBackup() {
    // #ifdef H5
    const [file] = await pickWebFiles('application/json,.json')
    if (file) { try { await restoreBackup(await file.text()) } catch (error) { report(error) } }
    // #endif
    // #ifdef APP-PLUS
    let path
    try { const [file] = await pickDocuments('application/json'); if (file) { path = await copyDocument(file); await restoreBackup(await readLocal(path, true)) } }
    catch (error) { if (!errorText(error).includes('取消')) report(error) }
    finally { if (path) await deleteAsset(path) }
    // #endif
  }
  async function onWebBackup(event) { const file = event.target?.files?.[0]; if (file) { try { await restoreBackup(await file.text()) } catch (error) { report(error) } } }
  function formatTime(seconds) { seconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0; return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` }
  function setFilter(filter) { endSelection(); libraryFilter.value = filter; groupFilter.value = '' }
  onMounted(initialize)
  onHide(() => { appForeground.value = false; saveSession() })
  function refreshPlaybackState() {
    appForeground.value = true; tick()
    if (ready.value && audio && loadedId === currentId.value) {
      if (typeof audio.paused === 'boolean') isPlaying.value = !audio.paused
      if (!dragging.value && Number.isFinite(Number(audio.currentTime))) currentTime.value = Number(audio.currentTime)
      if (Number(audio.duration) > 0) duration.value = Number(audio.duration)
      updateLyric()
    }
    if (ready.value) { syncControls(); void drainMetadata() }
  }
  onShow(refreshPlaybackState)
  singleton = { tracks, playlists, queueTracks, currentId, currentTrack, activeTab, playerOpen, playerView, query, libraryFilter, groupFilter, visibleTracks, libraryTracks, libraryGroups, isPlaying, loading, ready, importBusy, importStatus, currentTime, duration, activeLyric, followLyrics, progress, playbackMode, modeLabel, sleepLabel, sleepUntil, sleepAfterTrack, sheet, menuTrack, editor, playlistName, failures, lastError, backupBusy, importSong, onWebAudio, importCover, onWebCover, importLyrics, onWebLyrics, selectTrack, openTrack, playTrack, togglePlayback, playAdjacent, cycleMode, previewSeek, seekTo, seekLyric, adjustOffset, setSleep, showTrackMenu, queueNext, moveQueue, removeQueue, toggleFavorite, editTrack, saveEdit, addToPlaylist, createPlaylist, removeFromPlaylist, deletePlaylist, removeTrack, exportBackup, chooseBackup, onWebBackup, formatTime, setFilter, initialize, autoLyrics, toggleAutoLyrics, lyricSearch, lyricResults, lyricBusy, lyricMessage, lyricSearched, openLyricSearch, searchOnlineLyrics, applyOnlineLyrics, detailTrack, inferTrackInfo, lyricFetching, lyricRetryable, retryCurrentLyrics, backupProgress, interruption }
  Object.assign(singleton, { movePlaylistTrack, metadataStatus, selecting, selectedIds, selectedTracks, toggleSelected, endSelection, selectAllTracks, batchFavorite, removeSelected, playlistEditName, renamePlaylist, deviceStatus, refreshDeviceStatus, openSystemSettings, relinkingId, relinkTrack, restoreSettings, importPercent, importFilePercent, importFileElapsed, importElapsed, importCancelled, cancelImport, retryFailedImports, repairingId, repairEmbedded, appForeground, refreshPlaybackState, systemControlStatus })
  return singleton
}
