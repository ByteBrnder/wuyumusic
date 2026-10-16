import { normalizeTexts, textRows } from './visual-settings.js'
import { landmarkPoint, LANDMARK_VIEWS } from './particle-landmarks.js'

const envelopes = new Map()
const BUILDINGS = ['eiffel', 'pyramids', 'opera', 'tiantan', 'pearl', 'greatwall', 'taj', 'pisa', 'pantheon', 'stbasil', 'stpaul', 'colosseum']
const SHAPES = ['sphere', 'torus', 'helix', 'wave', 'fuji', 'dunes', 'ocean', ...BUILDINGS]
const TEXT_SHAPES = ['text:雾屿音乐']
const textSamples = new Map()
const QUALITY = { power: { points: 1100, fps: 24, ratio: 1 }, balanced: { points: 2200, fps: 30, ratio: 1.5 }, fine: { points: 3400, fps: 45, ratio: 2 } }
const FAVORITES_KEY = 'wuyu-particle-favorites-v1'
function sampleText(text, font = 'sans', layout = 'stack') {
  const key = JSON.stringify([text, font, layout])
  if (textSamples.has(key)) return textSamples.get(key)
  const lines = textRows(text, layout)
  const canvas = document.createElement('canvas')
  canvas.width = 640; canvas.height = Math.max(180, lines.length * 156 + 24)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  context.font = `700 ${layout === 'line' ? Math.min(128, 600 / Math.max(1, Array.from(text).length)) : 128}px ${{sans:'sans-serif',serif:'serif',mono:'monospace'}[font] || 'sans-serif'}`; context.textAlign = 'center'; context.textBaseline = 'middle'
  context.fillStyle = '#fff'
  const extent = Math.max(...lines.map(line => context.measureText(line).width), canvas.height - 24, 128)
  lines.forEach((line, index) => context.fillText(line, 320, 12 + index * 156 + 78))
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data, points = []
  for (let y = 0; y < canvas.height; y += 2) for (let x = 0; x < canvas.width; x += 2) {
    if (pixels[(y * canvas.width + x) * 4 + 3] > 100) points.push([(x - 320) / extent * 2, (y - canvas.height / 2) / extent * 2])
  }
  textSamples.set(key, points)
  if (textSamples.size > 8) textSamples.delete(textSamples.keys().next().value)
  return points
}
const towerEdges = []
const towerLevels = [[.95, .73], [.25, .38], [-.15, .24], [-.75, .095], [-1.08, .025]]
for (let level = 0; level < towerLevels.length - 1; level++) {
  const [bottom, width] = towerLevels[level], [top, nextWidth] = towerLevels[level + 1]
  for (let side = 0; side < 4; side++) {
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
    const [x, z] = corners[side], [nx, nz] = corners[(side + 1) % 4]
    towerEdges.push([[x * width, bottom, z * width], [x * nextWidth, top, z * nextWidth]])
    towerEdges.push([[x * width, bottom, z * width], [nx * width, bottom, nz * width]])
    if (level > 0) {
      towerEdges.push([[x * width, bottom, z * width], [nx * nextWidth, top, nz * nextWidth]])
      towerEdges.push([[nx * width, bottom, nz * width], [x * nextWidth, top, z * nextWidth]])
    }
  }
}
function buildingPoint(shape, index) {
  const fraction = value => value - Math.floor(value)
  const u = fraction(index * .61803398875), v = fraction(index * .41421356237)
  const azimuth = v * Math.PI * 2
  const landmark = landmarkPoint(shape, index)
  if (landmark) return landmark
  if (shape === 'taj') {
    const part = index % 20
    if (part < 8) {
      const angle = u * Math.PI * .88, radius = .39 * Math.sin(angle) * (1 + .18 * Math.cos(angle))
      return [radius * Math.cos(azimuth), -.28 - .68 * Math.cos(angle / 1.76), radius * Math.sin(azimuth)]
    }
    if (part < 13) {
      const corner = Math.floor(index / 20) % 4, x = corner % 2 ? .86 : -.86, z = corner < 2 ? -.58 : .58
      const cap = part === 12, radius = cap ? .12 * Math.sin(u * Math.PI) : .06 + (Math.floor(u * 5) % 2) * .012
      return [x + radius * Math.cos(azimuth), cap ? -.46 - .18 * u : .65 - u * 1.08, z + radius * Math.sin(azimuth)]
    }
    if (part < 18) {
      const side = Math.floor(v * 4), along = u * 2 - 1
      return [side % 2 ? (side === 1 ? .59 : -.59) : along * .59, -.19 + (index % 7) / 6 * .79, side % 2 ? along * .42 : (side === 0 ? .42 : -.42)]
    }
    return [(u * 2 - 1) * 1.05, .68, (v * 2 - 1) * .76]
  }
  if (shape === 'pisa') {
    const tier = Math.floor(u * 8), local = u * 8 - tier
    const y = .93 - u * 1.9, radius = tier === 7 ? .24 : .36
    const angle = index % 5 < 2 ? Math.floor(v * 24) * Math.PI / 12 : azimuth
    const ringRadius = index % 5 === 0 ? radius + .045 : radius
    return [Math.cos(angle) * ringRadius - u * .26, index % 5 === 0 ? .93 - (tier + 1) / 8 * 1.9 : y, Math.sin(angle) * ringRadius + (local < .12 ? .015 : 0)]
  }
  if (shape === 'pearl') {
    const part = index % 20
    if (part < 13) {
      const sphere = part < 7 ? [.24, .34] : part < 12 ? [-.56, .23] : [-.97, .095]
      const vertical = u * 2 - 1, ring = Math.sqrt(1 - vertical * vertical)
      return [Math.cos(azimuth) * ring * sphere[1], sphere[0] + vertical * sphere[1], Math.sin(azimuth) * ring * sphere[1]]
    }
    if (part < 17) {
      const radius = part === 16 ? .018 : .055
      return [radius * Math.cos(azimuth), part === 16 ? -1.25 + u * .27 : -.95 + u * 1.8, radius * Math.sin(azimuth)]
    }
    const leg = Math.floor(v * 3) * Math.PI * 2 / 3, radius = .53 * (1 - u) + .1 * u
    return [radius * Math.cos(leg) + .027 * Math.cos(azimuth), .94 - u * .69, radius * Math.sin(leg) + .027 * Math.sin(azimuth)]
  }
  if (shape === 'eiffel') {
    if (index % 5 === 0) {
      const side = index % 4, angle = u * Math.PI
      const archX = Math.cos(angle) * .57, archY = .95 - Math.sin(angle) * .54
      return side % 2 ? [side === 1 ? .5 : -.5, archY, archX] : [archX, archY, side === 0 ? .5 : -.5]
    }
    const edge = towerEdges[index % towerEdges.length]
    return edge[0].map((value, axis) => value + (edge[1][axis] - value) * u)
  }
  if (shape === 'pyramids') {
    const group = index % 3, side = Math.floor(index / 3) % 4
    const scale = [1, .7, .44][group], offsetX = [-.35, .48, .95][group], offsetZ = [0, .32, .5][group]
    const height = 1 - Math.sqrt(u), width = (1 - height) * .7 * scale
    const along = (v * 2 - 1) * width
    return [offsetX + (side % 2 ? (side === 1 ? width : -width) : along), .72 - height * 1.55 * scale, offsetZ + (side % 2 ? along : (side === 0 ? width : -width))]
  }
  // Each shell has a pointed curved ridge and two tapering cheeks.
  const part = index % 20
  if (part < 4) {
    const step = Math.floor(index / 20) % 3
    const width = 1.38 - step * .075, depth = .72 - step * .045
    const y = .77 - step * .065
    if (part < 2) return [(u * 2 - 1) * width, y, (part ? 1 : -1) * depth]
    if (part === 2) return [(v < .5 ? -1 : 1) * width, y, (u * 2 - 1) * depth]
    return [(u * 2 - 1) * width, y - .018, (v * 2 - 1) * depth]
  }
  const shell = Math.floor(index / 20) % 8
  const row = shell % 2, tier = Math.floor(shell / 2)
  const height = [1.42, 1.18, .86, .56][tier] * (row ? .82 : 1)
  const baseX = [-.72, -.2, .35, .8][tier]
  const length = [.88, .77, .64, .48][tier]
  const centerZ = row ? .33 : -.25
  const width = (row ? .24 : .29) * (1 - tier * .1)
  const along = u
  // Sample the ridge and eaves more densely so the silhouette survives low quality.
  const across = part < 7 ? 0 : part < 10 ? (v < .5 ? -1 : 1) : v * 2 - 1
  const taper = Math.pow(1 - along, .72)
  const ridgeHeight = height * Math.sin(along * Math.PI * .5)
  const cheek = Math.sqrt(Math.max(0, 1 - across * across))
  const x = baseX + length * along - .24 * Math.sin(along * Math.PI)
  const y = .55 - ridgeHeight * (.48 + .52 * cheek)
  const z = centerZ + across * width * taper
  return [x, y, z]

}
const CACHE_KEY = 'wuyu-particle-analysis-v1'
let savedAnalysis
function analysisCache() {
  if (!savedAnalysis) {
    savedAnalysis = { covers: [], audio: [] }
    try {
      const raw = localStorage.getItem(CACHE_KEY)
      const parsed = raw && raw.length < 1600000 ? JSON.parse(raw) : null
      if (parsed && Array.isArray(parsed.covers) && Array.isArray(parsed.audio)) {
        savedAnalysis = {
          covers: parsed.covers.filter(item => item && typeof item.key === 'string').slice(-3),
          audio: parsed.audio.filter(item => item && typeof item.key === 'string').slice(-3),
        }
      }
    } catch { /* Analysis caching is optional. */ }
  }
  return savedAnalysis
}
function cachedAnalysis(type, key) {
  return key ? analysisCache()[type].find(item => item.key === key)?.value : null
}
function saveAnalysis(type, key, value) {
  if (!key || key.length > 1024) return
  const cache = analysisCache()
  cache[type] = [...cache[type].filter(item => item.key !== key), { key, value }].slice(-3)
  try {
    let json = JSON.stringify(cache)
    while (json.length > 1500000 && cache.audio.length + cache.covers.length > 1) {
      if (cache.audio.length) cache.audio.shift(); else cache.covers.shift()
      json = JSON.stringify(cache)
    }
    if (json.length <= 1500000) localStorage.setItem(CACHE_KEY, json)
  } catch { /* Quota or private mode must not interrupt playback. */ }
}

export class CoverParticles {
  constructor(host, report) {
    this.host = host
    this.report = report
    this.canvas = document.createElement('canvas')
    this.canvas.style.cssText = 'width:100%;height:100%;display:block;pointer-events:none'
    host.appendChild(this.canvas)
    this.ctx = this.canvas.getContext('2d')
    this.points = []
    this.state = {}
    this.energy = 0
    this.lowEnergy = 0
    this.highEnergy = 0
    this.bassBaseline = 0
    this.beatPulse = 0
    this.breathPhase = 0
    this.breathGain = 0
    this.phase = 0
    this.sceneTime = 0
    this.nextShapeAt = 4
    this.shape = 'cover'
    this.quality = QUALITY.balanced
    this.detailScale = 1
    this.zoom = 1
    this.pointers = new Map()
    this.velocityX = this.velocityY = 0
    this.favorites = []
    try { const saved = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]'); if (Array.isArray(saved)) this.favorites = [...new Set(saved.filter(shape => (['cover', ...SHAPES, ...TEXT_SHAPES].includes(shape) || (typeof shape === 'string' && shape.startsWith('text:') && shape.slice(5).trim() && Array.from(shape.slice(5)).length <= 12))))].slice(0, 20) } catch {}
    this.morph = 1
    this.rotationX = 0
    this.rotationY = 0
    this.pointer = null
    this.token = 0
    this.audioToken = 0
    this.reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    this.report({ reducedMotion: this.reduced })
    this.onVisibility = () => this.schedule()
    document.addEventListener('visibilitychange', this.onVisibility)
    this.bindInteraction()
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => { this.resize(); this.draw() })
      this.observer.observe(host)
    }
    this.onResize = () => { this.resize(); this.draw() }
    window.addEventListener('resize', this.onResize)
    this.resize()
  }
  resize() {
    const width = this.host.clientWidth || 280
    const height = this.host.clientHeight || width
    this.width = width; this.height = height
    this.size = Math.min(width * .86, height * .68)
    const ratio = Math.min(window.devicePixelRatio || 1, this.quality.ratio)
    this.canvas.width = Math.round(width * ratio)
    this.canvas.height = Math.round(height * ratio)
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  }
  update(state) {
    if (this.disposed) return
    const coverChanged = state.cover !== this.state.cover || state.coverKey !== this.state.coverKey
    const audioChanged = state.audio !== this.state.audio || state.audioKey !== this.state.audioKey
    const qualityChanged = state.quality !== this.state.quality || state.powerSave !== this.state.powerSave || state.thermal !== this.state.thermal
    const intervalChanged = state.interval !== this.state.interval
    const displayChanged = !!state.displayMode !== !!this.state.displayMode
    const textChanged = JSON.stringify([state.customTexts, state.textFont, state.textLayout]) !== JSON.stringify([this.state.customTexts, this.state.textFont, this.state.textLayout])
    this.state = state
    if (textChanged) {
      this.shapeBag = []
      if (this.shape.startsWith('text:')) this.setShape(this.textShapes().includes(this.shape) ? this.shape : this.textShapes()[0])
    }
    if (displayChanged) {
      if (state.displayMode) { this.previousShape = this.shape; this.setShape('cover'); this.nextShapeAt = this.sceneTime + 24; this.cameraReset = true }
      else if (this.previousShape) this.setShape(this.previousShape)
    }
    if (qualityChanged) { this.quality = state.powerSave || state.thermal >= 2 ? QUALITY.power : QUALITY[state.quality] || QUALITY.balanced; this.detailScale = 1; this.resize() }
    if (intervalChanged) this.nextShapeAt = this.sceneTime + (Number(state.interval) || 12)
    this.clockTime = state.time || 0
    this.clockAt = performance.now()
    if (coverChanged) this.loadCover(state.cover, state.coverKey)
    if (audioChanged) this.loadAudio(state.audio, state.audioKey)
    else if (this.envelopeKey === state.audioKey) this.reportEnvelope(state.audioKey)
    if (state.actionId && state.actionId !== this.actionId) {
      this.actionId = state.actionId
      if (state.action === 'cover') { this.setShape('cover'); this.cameraReset = true }
      if (state.action === 'reset') this.cameraReset = true
      if (state.action === 'favorite') {
        this.favorites = this.favorites.includes(this.shape) ? this.favorites.filter(shape => shape !== this.shape) : [...this.favorites, this.shape]
        try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(this.favorites)) } catch { this.report({ status: '图案收藏保存失败' }) }
        this.shapeBag = []
        this.reportFavorites()
      }
      if (state.action === 'cache-info') this.reportCache()
      if (state.action === 'clear-cache') {
        try {
          localStorage.removeItem(CACHE_KEY); savedAnalysis = { covers: [], audio: [] }; envelopes.clear(); textSamples.clear()
          this.reportCache()
        } catch { this.report({ cacheError: '缓存清理失败，请稍后重试' }) }
      }
      if (state.action === 'next') {
        this.changeRandomShape()
      }
      if (state.action === 'custom-text') { this.setShape(`text:${normalizeTexts(this.state.customTexts)[0] || '雾屿音乐'}`); this.cameraReset = true }
      if (state.action === 'text') { this.setShape(TEXT_SHAPES[0]); this.cameraReset = true }
    }
    this.schedule()
  }
  reportCache() {
    try { this.report({ cacheBytes: (localStorage.getItem(CACHE_KEY) || '').length * 2 }) } catch { this.report({ cacheError: '当前设备无法读取缓存占用' }) }
  }
  reportFavorites() { this.report({ favoriteCount: this.favorites.length, shapeFavorite: this.favorites.includes(this.shape) }) }
  hide() {
    this.pointer = null
    this.pointers.clear(); this.velocityX = this.velocityY = 0
    this.state.visible = false
    this.schedule()
  }
  bindInteraction() {
    this.host.setAttribute('role', 'img')
    this.host.setAttribute('aria-label', '三维封面颗粒，拖动或使用方向键旋转，Home 键归位')
    this.host.tabIndex = 0
    this.onPointerDown = event => {
      if (!this.state.enabled || !this.state.visible || (event.pointerType === 'mouse' && event.button !== 0)) return
      event.preventDefault()
      this.host.setPointerCapture?.(event.pointerId)
      this.tapStart = this.pointers.size ? null : { x: event.clientX, y: event.clientY, at: performance.now() }
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
      this.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY }
      this.velocityX = this.velocityY = 0
      if (this.pointers.size === 2) { const [a, b] = [...this.pointers.values()]; this.pinchDistance = Math.hypot(a.x - b.x, a.y - b.y); this.pinchZoom = this.zoom }
      this.cameraReset = false
      this.host.style.cursor = 'grabbing'
      this.schedule()
    }
    this.onPointerMove = event => {
      if (!this.pointers.has(event.pointerId)) return
      event.preventDefault()
      const previous = this.pointers.get(event.pointerId)
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()]
        if (this.pinchDistance > 0) this.zoom = Math.max(.6, Math.min(2.2, this.pinchZoom * Math.hypot(a.x - b.x, a.y - b.y) / this.pinchDistance))
        return
      }
      this.pointer = { id: event.pointerId, ...previous }
      this.velocityY = Math.max(-2.5, Math.min(2.5, (event.clientX - previous.x) * .06))
      this.velocityX = Math.max(-2.5, Math.min(2.5, (event.clientY - previous.y) * .06))
      this.rotationY += (event.clientX - this.pointer.x) * .008
      this.rotationX = Math.max(-1.5, Math.min(1.5, this.rotationX + (event.clientY - this.pointer.y) * .008))
      this.pointer.x = event.clientX; this.pointer.y = event.clientY
    }
    this.onPointerUp = event => {
      if (!this.pointers.has(event.pointerId)) return
      if (this.tapStart && this.pointers.size === 1 && Math.hypot(event.clientX - this.tapStart.x, event.clientY - this.tapStart.y) < 8 && performance.now() - this.tapStart.at < 350) this.report({ sceneTap: true })
      this.tapStart = null
      this.pointers.delete(event.pointerId)
      this.pointer = this.pointers.size ? { id: [...this.pointers.keys()][0], ...[...this.pointers.values()][0] } : null
      if (this.pointer) this.velocityX = this.velocityY = 0
      this.host.style.cursor = 'grab'
      this.schedule()
    }
    this.onKey = event => {
      if (!this.state.enabled || !this.state.visible) return
      const keys = { ArrowLeft: [-.15, 0], ArrowRight: [.15, 0], ArrowUp: [0, -.15], ArrowDown: [0, .15] }
      if (keys[event.key]) {
        event.preventDefault(); this.cameraReset = false
        this.rotationY += keys[event.key][0]
        this.rotationX = Math.max(-1.5, Math.min(1.5, this.rotationX + keys[event.key][1]))
        this.draw()
      } else if (event.key === 'Home') { event.preventDefault(); this.cameraReset = true; this.schedule() }
    }
    this.host.style.cursor = 'grab'
    this.onWheel = event => { if (!this.state.visible || !this.state.enabled) return; event.preventDefault(); this.zoom = Math.max(.6, Math.min(2.2, this.zoom * Math.exp(-event.deltaY * .001))); this.draw() }
    this.host.addEventListener('wheel', this.onWheel, { passive: false })
    this.host.addEventListener('pointerdown', this.onPointerDown)
    this.host.addEventListener('pointermove', this.onPointerMove)
    this.host.addEventListener('pointerup', this.onPointerUp)
    this.host.addEventListener('pointercancel', this.onPointerUp)
    this.host.addEventListener('lostpointercapture', this.onPointerUp)
    this.host.addEventListener('keydown', this.onKey)
  }
  textShapes() {
    return [...new Set([...TEXT_SHAPES, ...normalizeTexts(this.state.customTexts).map(text => `text:${text}`)])]
  }
  availableShapes() {
    const all = ['cover', ...SHAPES, ...this.textShapes()]
    const favorites = all.filter(shape => this.favorites.includes(shape))
    return this.state.favoriteOnly && favorites.length ? favorites : all
  }
  changeRandomShape() {
    const shapes = this.availableShapes(), signature = JSON.stringify(shapes)
    if (shapes.length === 1) { this.nextShapeAt = this.sceneTime + (this.state.interval || 12); if (this.shape !== shapes[0]) this.setShape(shapes[0]); return }
    if (signature !== this.shapePool || !this.shapeBag?.length) {
      this.shapePool = signature
      this.shapeBag = [...shapes]
      for (let index = this.shapeBag.length - 1; index > 0; index--) {
        const other = Math.floor(Math.random() * (index + 1))
        ;[this.shapeBag[index], this.shapeBag[other]] = [this.shapeBag[other], this.shapeBag[index]]
      }
    }
    const last = this.shapeBag.length - 1
    if (this.shapeBag[last] === this.shape) {
      const other = this.shapeBag.findIndex(shape => shape !== this.shape)
      if (other < 0) { this.shapeBag = []; this.changeRandomShape(); return }
      ;[this.shapeBag[last], this.shapeBag[other]] = [this.shapeBag[other], this.shapeBag[last]]
    }
    const shape = this.shapeBag.pop()
    this.setShape(shape)
    if (shape === 'cover' || BUILDINGS.includes(shape)) this.cameraReset = true
  }
  setShape(shape, immediate = false) {
    const names = { cover: '封面重聚', sphere: '星球', torus: '星环', helix: '双螺旋', wave: '流动曲面', eiffel: '埃菲尔铁塔', pyramids: '吉萨金字塔', opera: '悉尼歌剧院', tiantan: '北京天坛', pearl: '上海东方明珠', greatwall: '长城', taj: '泰姬陵', pisa: '比萨斜塔', pantheon: '意大利万神殿', stbasil: '圣巴西利亚大教堂', stpaul: '圣保罗大教堂', colosseum: '罗马斗兽场', fuji: '富士山', dunes: '沙丘', ocean: '海浪' }
    this.shape = shape
    this.morph = immediate ? 1 : 0
    const interval = Number(this.state.interval) || 12
    this.nextShapeAt = this.sceneTime + Math.max(6.5, interval * (.85 + Math.random() * .3))
    const text = shape.startsWith('text:') ? shape.slice(5) : ''
    const letters = text ? sampleText(text, this.state.textFont, this.state.textLayout) : null
    const count = this.points.length
    this.points.forEach((point, index) => {
      point.fromX = point.px || 0; point.fromY = point.py || 0; point.fromZ = point.pz || 0
      const scatterAngle = index * 2.3999632297
      point.scatterX = point.fromX * .35 + Math.cos(scatterAngle) * 1.25
      point.scatterY = point.fromY * .35 + Math.sin(scatterAngle * .73) * 1.25
      point.scatterZ = point.fromZ * .35 + Math.sin(scatterAngle * .31) * 1.15
      const t = (index + .5) / count, angle = index * 2.3999632297
      let x, y, z, edge = false
      if (letters?.length) {
        const letter = letters[Math.floor(((index * .61803398875) % 1) * letters.length)]
        x = letter[0]; y = letter[1]; z = point.seed * .018
      } else if (BUILDINGS.includes(shape)) {
        ;[x, y, z, edge] = buildingPoint(shape, index)
      } else if (shape === 'fuji') {
        const angle = point.x * Math.PI * 2, radius = Math.sqrt(point.y)
        const ridge = .035 * Math.cos(angle * 7) * Math.sin(radius * Math.PI)
        x = Math.cos(angle) * radius * 1.35
        z = Math.sin(angle) * radius * .85
        y = .72 - Math.pow(1 - radius, 1.55) * 1.7 + ridge
        if (radius < .12) y = -.94 + radius * .08
      } else if (shape === 'dunes') {
        x = (point.x - .5) * 2.65; z = (point.y - .5) * 1.8
        const ridge = Math.sin(x * 2.3 + z * 1.35)
        y = .2 - Math.pow((ridge + 1) * .5, 2.6) * .72 + z * .1
      } else if (shape === 'ocean') {
        x = (point.x - .5) * 2.45
        const curl = point.y * Math.PI * 1.65
        const height = .68 + Math.cos(x * 1.65) * .22
        y = .55 - Math.sin(curl) * height
        z = .2 + Math.cos(curl) * (.45 + point.y * .23)
      } else if (shape === 'sphere') {
        y = 1 - 2 * t
        const ring = Math.sqrt(1 - y * y)
        x = Math.cos(angle) * ring; z = Math.sin(angle) * ring
      } else if (shape === 'torus') {
        const a = point.x * Math.PI * 2, b = point.y * Math.PI * 2
        x = (.72 + .27 * Math.cos(b)) * Math.cos(a)
        y = .27 * Math.sin(b); z = (.72 + .27 * Math.cos(b)) * Math.sin(a)
      } else if (shape === 'helix') {
        const a = t * Math.PI * 10 + (index % 2) * Math.PI
        const thickness = .13 * Math.sin(angle)
        x = (.5 + thickness) * Math.cos(a); y = (t - .5) * 1.9; z = (.5 + thickness) * Math.sin(a)
      } else if (shape === 'wave') {
        x = (point.x - .5) * 1.9; z = (point.y - .5) * 1.9
        y = Math.sin(x * 3) * Math.cos(z * 3) * .4
      } else { x = (point.x - .5) * 1.65; y = (point.y - .5) * 1.65; z = 0 }
      // A sparse outer layer lets the same cover pixels occupy the whole scene.
      point.edge = edge
      point.ambient = shape !== 'cover' && index % (BUILDINGS.includes(shape) ? 61 : text ? 25 : 9) === 0
      if (point.ambient) {
        x = Math.sin(angle * 1.7) * 1.7
        y = Math.cos(angle * .73) * Math.min(2.1, this.height / this.size * .8)
        z = Math.sin(angle * .31) * 1.2
      }
      point.toX = x; point.toY = y; point.toZ = z
      if (immediate) { point.px = x; point.py = y; point.pz = z }
    })
    this.report({ shape: text || names[shape] })
    this.reportFavorites()
    this.schedule()
  }
  applyCoverSamples(data) {
    const count = 58
    this.points = []
    for (let y = 0; y < count; y++) for (let x = 0; x < count; x++) {
      const index = (y * count + x) * 4
      if (data[index + 3] < 30) continue
      const luminance = data[index] * .2126 + data[index + 1] * .7152 + data[index + 2] * .0722
      const shade = 1 - Math.max(0, (luminance - 120) / 135) * .38
      const contrastColor = `rgb(${Math.round(data[index] * shade)},${Math.round(data[index + 1] * shade)},${Math.round(data[index + 2] * shade)})`
      this.points.push({ contrastColor, x: (x + .5) / count, y: (y + .5) / count, color: `rgb(${data[index]},${data[index + 1]},${data[index + 2]})`, textColor: `rgb(${Math.round(data[index] * .62)},${Math.round(data[index + 1] * .68)},${Math.round(data[index + 2] * .63)})`, seed: Math.sin(x * 12.9898 + y * 78.233) * 2 })
    }
    this.sceneTime = 0; this.rotationX = 0; this.rotationY = 0
    this.setShape('cover', true)
    this.nextShapeAt = this.state.displayMode ? 24 : Number(this.state.interval) || 12
    this.report({ imageReady: true })
    this.reportCache()
    this.draw(); this.schedule()
  }
  async loadCover(url, key) {
    const token = ++this.token
    this.points = []
    if (!url) return
    const cached = cachedAnalysis('covers', key)
    if (Array.isArray(cached) && cached.length === 58 * 58 * 4 && cached.every(value => Number.isInteger(value) && value >= 0 && value <= 255)) {
      this.resize(); this.applyCoverSamples(cached); return
    }
    const image = new Image()
    image.onload = () => {
      if (token !== this.token || this.disposed) return
      try {
        this.resize()
        const sample = document.createElement('canvas')
        const count = 58
        sample.width = sample.height = count
        const context = sample.getContext('2d', { willReadFrequently: true })
        const side = Math.min(image.naturalWidth, image.naturalHeight)
        context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, count, count)
        const data = context.getImageData(0, 0, count, count).data
        this.applyCoverSamples(data)
        saveAnalysis('covers', key, Array.from(data))
      } catch { this.report({ imageReady: false, status: '封面无法采样，已显示原图' }) }
    }
    image.onerror = () => { if (token === this.token) this.report({ imageReady: false, status: '封面加载失败' }) }
    image.src = url
  }
  async loadAudio(url, key) {
    const token = ++this.audioToken
    this.audioAbort?.abort()
    this.envelope = null
    this.envelopeKey = key
    this.bassBaseline = 0; this.beatPulse = 0
    const stored = cachedAnalysis('audio', key)
    const validBand = values => Array.isArray(values) && values.length === Math.ceil(stored.duration * 40) && values.length <= 120000 && values.every(value => Number.isFinite(value) && value >= 0 && value <= 1)
    if (!envelopes.has(key) && stored?.bandsVersion === 2 && stored.rate === 40 && Number.isFinite(stored.duration) && stored.duration > 0 && validBand(stored.values) && validBand(stored.low) && validBand(stored.high)) {
      envelopes.set(key, { ...stored, values: new Float32Array(stored.values), low: new Float32Array(stored.low), high: new Float32Array(stored.high) })
      if (envelopes.size > 3) envelopes.delete(envelopes.keys().next().value)
    }
    const cached = envelopes.get(key)
    if (cached) { this.envelope = cached; this.reportEnvelope(key); this.report({ status: '随音乐流动' }); return }
    if (!url) { if (key) this.report({ needsAudio: key }); return }
    this.report({ status: '正在分析音乐律动…' })
    let context
    try {
      const OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext
      if (!OfflineContext) throw new Error('Audio decoding unavailable')
      this.audioAbort = new AbortController()
      const response = await fetch(url, { signal: this.audioAbort.signal })
      if (!response.ok) throw new Error('Audio unavailable')
      const bytes = await response.arrayBuffer()
      if (bytes.byteLength > 50 * 1024 * 1024) throw new Error('Audio too large')
      if (token !== this.audioToken || this.disposed) return
      this.report({ status: '正在解码音乐…' })
      context = new OfflineContext(1, 1, 11025)
      const decoded = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Audio decoding timed out')), 20000)
        context.decodeAudioData(bytes, value => { clearTimeout(timeout); resolve(value) }, error => { clearTimeout(timeout); reject(error) })
      })
      if (token !== this.audioToken || this.disposed) return
      this.report({ status: '正在提取音量起伏…' })
      const rate = 40, count = Math.ceil(decoded.duration * rate)
      const values = new Float32Array(count), low = new Float32Array(count), high = new Float32Array(count)
      const lowFilter = new Float64Array(decoded.numberOfChannels), highFilter = new Float64Array(decoded.numberOfChannels)
      const lowAlpha = 1 - Math.exp(-2 * Math.PI * 180 / decoded.sampleRate)
      const highAlpha = 1 - Math.exp(-2 * Math.PI * 2200 / decoded.sampleRate)
      const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i))
      for (let bin = 0; bin < count; bin++) {
        const start = Math.floor(bin * decoded.sampleRate / rate)
        const end = Math.min(decoded.length, Math.floor((bin + 1) * decoded.sampleRate / rate))
        let sum = 0, lowSum = 0, highSum = 0, samples = 0
        for (let channelIndex = 0; channelIndex < channels.length; channelIndex++) {
          const channel = channels[channelIndex]
          let bass = lowFilter[channelIndex], trebleBase = highFilter[channelIndex]
          for (let i = start; i < end; i++) {
            const sample = channel[i]
            bass += lowAlpha * (sample - bass)
            trebleBase += highAlpha * (sample - trebleBase)
            const treble = sample - trebleBase
            sum += sample * sample; lowSum += bass * bass; highSum += treble * treble; samples++
          }
          lowFilter[channelIndex] = bass; highFilter[channelIndex] = trebleBase
        }
        values[bin] = samples ? Math.sqrt(sum / samples) : 0
        low[bin] = samples ? Math.sqrt(lowSum / samples) : 0
        high[bin] = samples ? Math.sqrt(highSum / samples) : 0
        if (bin % 256 === 0) {
          await new Promise(resolve => setTimeout(resolve, 0))
          if (token !== this.audioToken || this.disposed) return
        }
      }
      for (const band of [values, low, high]) {
        const sorted = Array.from(band).sort((a, b) => a - b)
        const reference = Math.max(.0001, sorted[Math.floor(sorted.length * .95)] || 0)
        for (let i = 0; i < count; i++) band[i] = Math.min(1, band[i] / reference)
      }
      this.envelope = { values, low, high, rate, duration: decoded.duration, bandsVersion: 2 }
      this.reportEnvelope(key)
      envelopes.set(key, this.envelope)
      if (envelopes.size > 3) envelopes.delete(envelopes.keys().next().value)
      const compact = band => Array.from(band, value => Math.round(value * 1000) / 1000)
      if (values.length <= 120000) saveAnalysis('audio', key, { values: compact(values), low: compact(low), high: compact(high), rate, duration: decoded.duration, bandsVersion: 2 })
      this.reportCache()
      this.report({ status: '随音乐流动' })
    } catch {
      if (token === this.audioToken && !this.disposed) this.report({ status: '音频分析不可用 · 舒缓流动' })
    }
  }
  reportEnvelope(key) {
    if (!this.state.wallpaperAvailable || !this.envelope || this.envelope.values.length > 120000 || key === this.reportedEnvelope) return
    this.reportedEnvelope = key
    const compact = values => Array.from(values, value => Math.round(value * 1000) / 1000)
    this.report({ wallpaperEnvelope: { key, rate: this.envelope.rate, duration: this.envelope.duration,
      values: compact(this.envelope.values), low: compact(this.envelope.low) } })
  }
  isMoving() {
    return (this.state.playing && !this.reduced && !(this.state.thermal >= 3)) || this.pointer || (!this.reduced && Math.abs(this.velocityX) + Math.abs(this.velocityY) > .01) || ((!this.state.playing || this.state.thermal >= 3) && this.breathGain > .005 && !this.reduced) || this.morph < 1 || this.cameraReset
  }
  schedule() {
    if (this.disposed) return
    const moving = this.isMoving()
    if (!this.state.enabled || !this.state.visible || this.state.obscured || !moving || document.hidden || !this.points.length) {
      cancelAnimationFrame(this.frame)
      this.frame = null
      if (this.state.enabled && this.state.visible && !this.state.obscured && !document.hidden) this.draw()
      return
    }
    if (this.frame) return
    this.draw()
    this.lastFrame = 0
    const tick = now => {
      if (this.disposed) return
      if (!this.isMoving()) { this.frame = null; return }
      this.frame = requestAnimationFrame(tick)
      if (now - this.lastFrame < 1000 / this.quality.fps) return
      const frameGap = this.lastFrame ? now - this.lastFrame : 0
      this.lateFrames = frameGap > 1000 / this.quality.fps * 1.8 ? (this.lateFrames || 0) + 1 : Math.max(0, (this.lateFrames || 0) - 1)
      if (this.lateFrames > 20) { this.detailScale = Math.max(.35, this.detailScale * .8); this.lateFrames = 0; this.lastRecoveryAt = now }
      const delta = this.lastFrame ? Math.min((now - this.lastFrame) / 1000, .08) : 1 / 30
      this.lastFrame = now
      if (!this.pointer && !this.cameraReset && !this.reduced) {
        this.rotationX = Math.max(-1.5, Math.min(1.5, this.rotationX + this.velocityX * delta))
        this.rotationY += this.velocityY * delta
        this.velocityX *= Math.exp(-delta * 5); this.velocityY *= Math.exp(-delta * 5)
      }
      const time = this.clockTime + Math.min((now - this.clockAt) / 1000, 1)
      const sampleBand = band => {
        if (!this.state.playing || !this.envelope || time >= this.envelope.duration || !band) return 0
        const position = Math.max(0, time * this.envelope.rate), index = Math.floor(position)
        return (band[index] || 0) * (1 - position + index) + (band[index + 1] || 0) * (position - index)
      }
      for (const [field, band] of [['energy', this.envelope?.values], ['lowEnergy', this.envelope?.low], ['highEnergy', this.envelope?.high]]) {
        const target = sampleBand(band)
        this[field] += (target - this[field]) * (1 - Math.exp(-delta * (target > this[field] ? 16 : 5)))
      }
      this.bassBaseline += (this.lowEnergy - this.bassBaseline) * (1 - Math.exp(-delta * 1.4))
      const kick = Math.min(1, Math.max(0, this.lowEnergy - this.bassBaseline) * 3)
      this.beatPulse += (kick - this.beatPulse) * (1 - Math.exp(-delta * (kick > this.beatPulse ? 25 : 3.5)))
      const breathing = this.state.playing && !this.reduced && !(this.state.thermal >= 3) ? 1 : 0
      this.breathGain += (breathing - this.breathGain) * (1 - Math.exp(-delta * (breathing ? 4 : 6)))
      if (breathing) this.breathPhase += delta * Math.PI * 2 / 4.8
      if (this.state.playing && !this.reduced && !(this.state.thermal >= 3)) {
        this.phase += delta * (.25 + this.energy * 1.5)
        this.sceneTime += delta
        if (this.state.displayMode && !this.pointer && this.sceneTime > this.nextShapeAt) {
          const texts = this.textShapes(); if (this.shape === 'cover') this.displayTextIndex = ((this.displayTextIndex ?? -1) + 1) % texts.length
          this.setShape(this.shape === 'cover' ? texts[this.displayTextIndex] : 'cover')
          this.nextShapeAt = this.sceneTime + 24
          this.cameraReset = true
        }
        if (!this.pointer && !this.state.displayMode && this.state.autoChange !== false && this.sceneTime > this.nextShapeAt) {
          this.changeRandomShape()
        }
      }
      this.morph = Math.min(1, this.morph + delta / (this.reduced ? .01 : 2.8))
      const gathering = this.morph >= .24 || this.reduced
      const progress = this.reduced ? this.morph : gathering ? (this.morph - .24) / .76 : this.morph / .24
      const blend = progress * progress * (3 - 2 * progress)
      for (const point of this.points) {
        const direct = this.reduced || !gathering
        const fromX = direct ? point.fromX : point.scatterX
        const fromY = direct ? point.fromY : point.scatterY
        const fromZ = direct ? point.fromZ : point.scatterZ
        const toX = this.reduced || gathering ? point.toX : point.scatterX
        const toY = this.reduced || gathering ? point.toY : point.scatterY
        const toZ = this.reduced || gathering ? point.toZ : point.scatterZ
        point.px = fromX + (toX - fromX) * blend
        point.py = fromY + (toY - fromY) * blend
        point.pz = fromZ + (toZ - fromZ) * blend
      }
      if (this.cameraReset) {
        this.velocityX = this.velocityY = 0
        this.zoom += (1 - this.zoom) * (1 - Math.exp(-delta * 5))
        this.rotationX *= Math.exp(-delta * 5); this.rotationY *= Math.exp(-delta * 5)
        if (Math.abs(this.rotationX) + Math.abs(this.rotationY) + Math.abs(this.zoom - 1) < .002) { this.rotationX = this.rotationY = 0; this.zoom = 1; this.cameraReset = false }
      }
      this.draw()
    }
    this.frame = requestAnimationFrame(tick)
  }
  draw() {
    const started = performance.now()
    const context = this.ctx, size = this.size
    if (!context || !size) return
    context.clearRect(0, 0, this.width, this.height)
    const displayScale = this.state.displayMode ? .72 : 1
    const displayDrift = this.state.displayMode && !this.reduced ? Math.sin(this.phase * .025) * 5 : 0
    const isText = this.shape.startsWith('text:')
    const isBuilding = BUILDINGS.includes(this.shape)
    const view = LANDMARK_VIEWS[this.shape]
    const intensity = Math.max(0, Math.min(100, Number.isFinite(this.state.motionIntensity) ? this.state.motionIntensity : 80)) / 80
    const breath = (.5 - .5 * Math.cos(this.breathPhase))
    const response = this.reduced ? 0 : this.breathGain * intensity * (this.state.displayMode ? .65 : 1)
    const expansion = response * (.06 * breath + .12 * this.lowEnergy + .1 * this.beatPulse)
    const pulse = 1 + expansion * (isBuilding ? .55 : isText ? .7 : 1)
    const amount = this.reduced ? 0 : (.008 + this.energy * .055 + breath * .012) * response * (isBuilding ? .08 : isText ? .25 : 1)
    const yaw = this.rotationY + (view ? view[0] : this.shape === 'opera' ? -.32 : 0) + (this.shape === 'cover' ? 0 : Math.sin(this.phase * .12) * (isBuilding ? .08 : .3))
    const pitch = this.rotationX + (view ? view[1] : this.shape === 'torus' || this.shape === 'wave' ? .42 : this.shape === 'opera' ? .12 : ['fuji', 'dunes', 'ocean'].includes(this.shape) ? .25 : 0)
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cx = Math.cos(pitch), sx = Math.sin(pitch)
    const projected = []
    const budget = Math.max(600, Math.floor(this.quality.points * this.detailScale))
    const count = Math.min(this.points.length, budget)
    for (let index = 0; index < count; index++) {
      const point = this.points[Math.floor(index * this.points.length / count)]
      const field = this.phase + point.x * 5 - point.y * 4
      const x = (point.px + Math.sin(field + point.seed) * amount) * pulse
      const y = (point.py + Math.cos(field * .8 + point.seed) * amount) * pulse
      const z = (point.pz + Math.sin(field * .6 + point.seed) * amount) * pulse
      const rx = x * cy + z * sy, rz = -x * sy + z * cy
      const ry = y * cx - rz * sx, depth = y * sx + rz * cx
      const perspective = 3.5 / (3.5 + depth)
      projected.push({ point, x: this.width / 2 + rx * size * .46 * perspective * this.zoom * displayScale + displayDrift, y: this.height * (this.state.displayMode ? .48 : .43) + ry * size * .46 * perspective * this.zoom * displayScale, depth, perspective })
    }
    projected.sort((a, b) => b.depth - a.depth)
    for (const { point, x, y, depth, perspective } of projected) {
      const shimmer = this.reduced ? 0 : response * this.highEnergy * .06 * Math.sin(this.phase * 4 + point.seed * 7)
      const radius = Math.max(.55, size / (isBuilding ? 168 : 110) * perspective * ((point.edge ? .88 : .7) + response * (this.lowEnergy * .12 + breath * .13 + this.beatPulse * .1) + shimmer))
      context.globalAlpha = point.ambient ? .25 : Math.max(isBuilding ? .42 : .48, Math.min(.98, (point.edge ? .98 : .8) - depth * .22 + shimmer))
      context.fillStyle = isText ? point.textColor : this.shape === 'cover' ? point.color : point.contrastColor
      context.beginPath()
      context.arc(x, y, radius, 0, Math.PI * 2)
      context.fill()
    }
    context.globalAlpha = 1
    const cost = performance.now() - started
    this.slowFrames = cost > 1000 / this.quality.fps * .65 ? (this.slowFrames || 0) + 1 : Math.max(0, (this.slowFrames || 0) - 1)
    if (this.slowFrames > 25 && this.detailScale > .35) { this.detailScale = Math.max(.35, this.detailScale * .8); this.slowFrames = 0; this.lastRecoveryAt = started }
    if (cost < 1000 / this.quality.fps * .25 && !this.slowFrames && !this.lateFrames && this.detailScale < 1 && started - (this.lastRecoveryAt || 0) > 15000) { this.detailScale = Math.min(1, this.detailScale + .08); this.lastRecoveryAt = started }
    if (!this.lastPerformanceAt || started - this.lastPerformanceAt > 3000) { this.lastPerformanceAt = started; this.report({ particleCount: projected.length, renderMs: Math.round(cost), adaptive: this.detailScale < 1 }) }
  }
  destroy() {
    this.disposed = true
    ++this.token; ++this.audioToken
    this.audioAbort?.abort()
    cancelAnimationFrame(this.frame)
    this.observer?.disconnect()
    window.removeEventListener('resize', this.onResize)
    this.host.removeEventListener('wheel', this.onWheel)
    document.removeEventListener('visibilitychange', this.onVisibility)
    for (const [name, handler] of [['pointerdown', this.onPointerDown], ['pointermove', this.onPointerMove], ['pointerup', this.onPointerUp], ['pointercancel', this.onPointerUp], ['lostpointercapture', this.onPointerUp], ['keydown', this.onKey]]) this.host.removeEventListener(name, handler)
    this.canvas.remove()
    this.points = []; this.envelope = null
  }
}
