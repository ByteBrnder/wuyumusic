<template>
  <view class="particle-cover-block" :class="{ 'particle-scene-hidden': !visible }">
    <view class="particle-art" :class="{ 'particles-ready': enabled && imageReady }">
      <image v-if="cover" class="particle-original" :src="cover" mode="aspectFill" />
      <view v-else class="particle-empty">♫</view>
      <view :id="hostId" class="particle-canvas" :class="{ active: enabled && imageReady }" :asset-state="assetState" :change:asset-state="particles.updateAssets" :motion-state="motionState" :change:motion-state="particles.updateMotion"></view>
    </view>
    <view v-show="!immersive" class="particle-toolbar">
      <view class="particle-caption" :class="{ 'particle-notice': visualError || reducedMotion }"><text class="particle-shape">{{ enabled ? shape : '专辑封面' }}</text><text class="particle-status" role="status">{{ !cover ? '导入封面后开启粒子空间' : !enabled ? '静态封面' : visualError ? status : reducedMotion ? '系统已开启减少动态效果，可手动变换和旋转' : !playing ? '拖动旋转 · 播放后随音乐流动' : status }}</text></view>
      <view class="particle-actions">
      <button class="particle-toggle" hover-class="particle-pressed" :hover-start-time="0" :hover-stay-time="100" :disabled="!cover || !enabled" @tap="command('next')">变换图案</button>
      <button class="particle-toggle" hover-class="particle-pressed" :hover-start-time="0" :hover-stay-time="100" :disabled="!cover || !enabled" @tap="command('cover')">聚合封面</button>
      <button class="particle-toggle" :disabled="!cover" @tap="$emit('immersive')">沉浸</button>
      </view>
      <view class="particle-tools-foot"><text class="particle-hint">拖动旋转 · 双指缩放</text><button class="particle-settings-link" @tap="openOptions">视觉设置</button></view>
    </view>

    <view v-if="optionsOpen" class="particle-options-backdrop" @tap.self="optionsOpen = false">
      <scroll-view class="particle-options-panel" scroll-y role="dialog" aria-label="视觉空间设置">
        <view class="particle-options-head"><text>视觉空间</text><button class="particle-toggle" @tap="optionsOpen = false">完成</button></view>
        <!-- #ifdef APP-PLUS -->
        <text v-if="wallpaperMessage" class="particle-option-label" role="status">{{ wallpaperMessage }}</text>
        <!-- #endif -->
        <button class="particle-toggle display-entry" @tap="optionsOpen = false; $emit('display')">进入锁屏展示</button>
        <text class="particle-option-label">应用内时钟与粒子展示，不替代系统锁屏。</text>
        <text class="particle-option-label">画质 · {{ selectedQuality.label }} · 上限 {{ selectedQuality.points }} 颗</text>
        <view class="particle-options-row particle-quality-options"><button v-for="item in qualityOptions" :key="item.value" class="particle-toggle" :class="{ selected: quality === item.value }" @tap="quality = item.value; saveOptions()"><text>{{ item.label }}</text><text class="particle-quality-count">{{ item.points }} 颗</text></button></view>
        <text class="particle-option-label">各档为粒子数量上限，可按流畅度手动切换。</text>
        <text class="particle-option-label">呼吸强度 · {{ motionIntensity }}%</text>
        <slider :value="motionIntensity" :min="0" :max="100" :step="5" activeColor="#6b9f7c" :block-size="18" aria-label="呼吸强度" @change="motionIntensity = Number($event.detail.value); saveOptions()" />
        <text class="particle-option-label">低频扩张，缓慢回落；建筑保持轮廓，锁屏展示更柔和。</text>
        <view class="particle-options-row"><text>自动变换图案</text><switch :checked="autoChange" color="#6b9f7c" @change="autoChange = $event.detail.value; saveOptions()" /></view>
        <text class="particle-option-label">变化间隔约 {{ interval }} 秒</text><slider :value="interval" :min="6" :max="30" :step="2" activeColor="#6b9f7c" :block-size="18" @change="interval = Number($event.detail.value); saveOptions()" />
        <view class="particle-options-row"><text>只展示收藏（{{ favoriteCount }}）</text><switch :checked="favoriteOnly" :disabled="!favoriteCount" color="#6b9f7c" @change="favoriteOnly = $event.detail.value; saveOptions()" /></view>
        <view class="particle-text-settings">
          <text class="particle-text-label">自定义粒子文字</text>
          <textarea v-model="textDraft" class="particle-text-input" :maxlength="240" placeholder="每行一句，例如：&#10;雾屿音乐&#10;今天也要开心" aria-label="自定义粒子文字，每行一句" @input="textError = ''" />
          <view class="particle-options-row wrap"><button v-for="font in textFonts" :key="font.id" class="particle-toggle" :class="{ selected: textFont === font.id }" @tap="textFont = font.id; saveOptions()">{{ font.label }}</button></view>
          <view class="particle-options-row wrap"><button class="particle-toggle" :class="{ selected: textLayout === 'stack' }" @tap="textLayout = 'stack'; saveOptions()">分行排版</button><button class="particle-toggle" :class="{ selected: textLayout === 'line' }" @tap="textLayout = 'line'; saveOptions()">单行排版</button></view>
          <view class="particle-text-preview" :style="{ fontFamily: previewFont }" aria-label="文字排版预览"><text v-for="(row, index) in previewRows" :key="index">{{ row }}</text></view>
          <text class="particle-option-label">最多 8 句，每句 12 个字。保存后随机展示，并同步系统粒子壁纸。</text>
          <text v-if="textError" class="particle-option-label" role="status">{{ textError }}</text>
          <view class="particle-options-row wrap">
            <button class="particle-toggle selected" hover-class="particle-pressed" :disabled="!textDraft.trim()" @tap="applyCustomText">保存并展示</button>
            <button v-if="customTexts.length" class="particle-toggle" @tap="clearCustomText">清除自定义</button>
          </view>
        </view>
        <view class="particle-options-row wrap"><button class="particle-toggle" :disabled="!imageReady" @tap="command('favorite')">{{ shapeFavorite ? '取消收藏当前图案' : '收藏当前图案' }}</button><button class="particle-toggle" :disabled="!imageReady" @tap="optionsOpen = false; command('text')">雾屿音乐</button><button class="particle-toggle" @tap="optionsOpen = false; command('reset')">视角归位</button><button class="particle-toggle" :disabled="!cover" @tap="enabled = !enabled">{{ enabled ? '使用静态封面' : '启用流动封面' }}</button></view>
        <text class="particle-option-label">粒子缓存 {{ (cacheBytes / 1024).toFixed(0) }} KB · 不包含歌曲和歌单</text><button class="particle-toggle" @tap="cacheError = ''; command('clear-cache')">清理粒子缓存</button><text v-if="cacheError" class="particle-option-label">{{ cacheError }}</text>
      </scroll-view>
    </view>
  </view>
</template>
<script>
import { PARTICLE_QUALITY, VISUAL_SETTINGS_KEY, normalizeVisualSettings, normalizeTexts, textRows } from '../utils/visual-settings.js'
import { readLocal } from '../utils/asset-store.js'
import { uid } from '../utils/library-core.js'
// #ifdef APP-PLUS
import { setWallpaperEnvelope, setWallpaperIntensity, setWallpaperText } from '@/uni_modules/wuyu-media-session'
// #endif
const OPTIONS_KEY = VISUAL_SETTINGS_KEY

export default {
  emits: ['scene-tap', 'display', 'immersive'],
  props: {
    immersive: { type: Boolean, default: false }, displayMode: { type: Boolean, default: false },
    cover: { type: String, default: '' }, coverKey: { type: String, default: '' }, audio: { type: String, default: '' }, audioKey: { type: String, default: '' },
    time: { type: Number, default: 0 }, playing: { type: Boolean, default: false }, visible: { type: Boolean, default: true }, size: { type: Number, default: 0 },
  },
  data() { return { hostId: `particles-${uid()}`, enabled: true, wallpaperAvailable: false, wallpaperMessage: '', motionIntensity: 80, imageReady: false, status: '正在准备流动封面…', shape: '封面', audioSource: '', coverSource: '', preparedCover: '', preparedCoverKey: '', needsAudioKey: '', coverRequest: 0, visualError: false, reducedMotion: false, sourceKey: '', request: 0, assetRevision: 0, action: '', actionId: 0, optionsOpen: false, customTexts: [], textFont: 'sans', textLayout: 'stack', textFonts: [{id:'sans',label:'黑体'},{id:'serif',label:'宋体'},{id:'mono',label:'等宽'}], textDraft: '', textError: '', quality: 'fine', qualityVersion: 2, autoChange: true, interval: 12, favoriteOnly: false, favoriteCount: 0, shapeFavorite: false, particleCount: 0, cacheBytes: 0, cacheError: '', qualityOptions: Object.entries(PARTICLE_QUALITY).map(([value, profile]) => ({ value, ...profile })) } },
  computed: {
    selectedQuality() { return PARTICLE_QUALITY[this.quality] || PARTICLE_QUALITY.fine },
    previewRows() { return textRows(normalizeTexts(this.textDraft)[0] || '雾屿音乐', this.textLayout) },
    previewFont() { return { sans: 'sans-serif', serif: 'serif', mono: 'monospace' }[this.textFont] },
    assetState() { return { id: this.hostId, cover: this.coverSource, coverKey: this.coverSource ? this.preparedCoverKey : '', audio: this.audioSource, audioKey: this.audioKey, revision: this.assetRevision } },
    motionState() { return { id: this.hostId, time: this.time, playing: this.playing, visible: this.visible, obscured: this.optionsOpen, enabled: this.enabled && !!this.cover, action: this.action, actionId: this.actionId, quality: this.quality, autoChange: this.autoChange, interval: this.interval, favoriteOnly: this.favoriteOnly, customTexts: this.customTexts, textFont: this.textFont, textLayout: this.textLayout, displayMode: this.displayMode, motionIntensity: this.motionIntensity, wallpaperAvailable: this.wallpaperAvailable } },
  },
  watch: {
    immersive(value) { if (value) { this.previousEnabled = this.enabled; this.enabled = true; this.optionsOpen = false } else this.enabled = this.previousEnabled !== false },
    audio() { this.audioSource = ''; this.sourceKey = ''; this.needsAudioKey = ''; ++this.request; ++this.assetRevision; this.prepareAudio() },
    cover() { this.prepareCover(); this.prepareAudio() },
    motionIntensity(value) {
      // #ifdef APP-PLUS
      if (this.wallpaperAvailable) { try { setWallpaperIntensity(value / 100) } catch {} }
      // #endif
    },
    enabled() { this.prepareAudio(); this.saveOptions() }, visible() { if (!this.visible) this.optionsOpen = false; this.prepareCover(); this.prepareAudio() },
  },
  mounted() {
    this.loadOptions()
    uni.$on('wuyu-visual-settings', this.loadOptions)
    // #ifdef APP-PLUS
    this.wallpaperAvailable = plus.os.name === 'Android'
    // #endif
    this.syncWallpaperText()
    this.prepareCover(); this.prepareAudio()
  },
  beforeUnmount() { ++this.request; ++this.coverRequest; uni.$off('wuyu-visual-settings', this.loadOptions) },
  methods: {
    loadOptions() {
      try { const saved = uni.getStorageSync(OPTIONS_KEY); Object.assign(this, normalizeVisualSettings(saved)); if (saved?.qualityVersion !== 2) this.saveOptions(); this.textDraft = this.customTexts.join('\n'); this.syncWallpaperText() } catch {}
    },
    syncWallpaperText() {
      // #ifdef APP-PLUS
      if (this.wallpaperAvailable) {
        try { setWallpaperText(JSON.stringify({ customTexts: this.customTexts, textFont: this.textFont, textLayout: this.textLayout })) }
        catch { this.wallpaperMessage = '系统文字同步需要重新打包最新安装包' }
      }
      // #endif
    },
    applyCustomText() {
      const rows = this.textDraft.split(/\r?\n/).map(text => text.replace(/\s+/g, ' ').trim()).filter(Boolean)
      if (!rows.length || rows.length > 8 || rows.some(text => Array.from(text).length > 12)) { this.textError = '最多 8 句，每句请输入 1–12 个字'; return }
      this.customTexts = normalizeTexts(rows); this.textDraft = this.customTexts.join('\n'); this.textError = ''
      this.saveOptions()
      if (this.cover) { this.enabled = true; this.optionsOpen = false; this.command('custom-text') }
      else this.textError = '文字已保存，导入带封面的歌曲后即可展示'
    },
    clearCustomText() { this.customTexts = []; this.textDraft = ''; this.textError = ''; this.saveOptions() },
    openOptions() { this.optionsOpen = true; this.command('cache-info') },
    saveOptions() {
      try {
        uni.setStorageSync(OPTIONS_KEY, normalizeVisualSettings(this))
        this.syncWallpaperText()
        uni.$emit('wuyu-visual-settings-saved')
      } catch { this.cacheError = '设置保存失败，本次仍可使用' }
    },
    command(action) { this.action = action; ++this.actionId },
    onParticleStatus(value) {
      // #ifdef APP-PLUS
      if (this.wallpaperAvailable && value.wallpaperEnvelope?.key === this.audioKey) {
        try { setWallpaperEnvelope(JSON.stringify(value.wallpaperEnvelope)) }
        catch { this.wallpaperMessage = '音乐律动暂未同步，壁纸仍可舒缓呼吸' }
      }
      // #endif
      if (value.sceneTap) this.$emit('scene-tap')
      if (typeof value.imageReady === 'boolean') { this.imageReady = value.imageReady; this.visualError = !value.imageReady }
      if (typeof value.reducedMotion === 'boolean') this.reducedMotion = value.reducedMotion
      if (value.status && (!this.visualError || value.imageReady === false)) this.status = value.status
      if (value.shape) this.shape = value.shape
      if (typeof value.shapeFavorite === 'boolean') this.shapeFavorite = value.shapeFavorite
      if (Number.isFinite(value.favoriteCount)) {
        this.favoriteCount = value.favoriteCount
        if (!value.favoriteCount && this.favoriteOnly) { this.favoriteOnly = false; this.saveOptions() }
      }
      if (Number.isFinite(value.particleCount)) this.particleCount = value.particleCount
      if (Number.isFinite(value.cacheBytes)) this.cacheBytes = value.cacheBytes
      if (value.cacheError) this.cacheError = value.cacheError
      if (value.needsAudio === this.audioKey) { this.needsAudioKey = value.needsAudio; this.prepareAudio() }
    },
    async prepareCover() {
      if (!this.visible || (this.coverSource && this.preparedCover === this.cover)) return
      const request = ++this.coverRequest
      this.imageReady = false; this.visualError = false; this.coverSource = ''; ++this.assetRevision
      if (!this.cover) return
      try {
        let source = this.cover
        // #ifdef APP-PLUS
        if (!source.startsWith('data:')) {
          source = await readLocal(source)
          const encoded = source.slice(source.indexOf(',') + 1)
          const mime = encoded.startsWith('iVBOR') ? 'image/png' : encoded.startsWith('R0lGOD') ? 'image/gif' : encoded.startsWith('UklGR') ? 'image/webp' : 'image/jpeg'
          source = `data:${mime};base64,${encoded}`
        }
        // #endif
        if (request !== this.coverRequest) return
        this.preparedCover = this.cover; this.preparedCoverKey = this.coverKey || this.cover; this.coverSource = source; ++this.assetRevision
      } catch {
        if (request === this.coverRequest) { this.visualError = true; this.status = '无法读取颗粒封面，请重新导入封面' }
      }
    },
    async prepareAudio() {
      if (this.needsAudioKey !== this.audioKey || !this.enabled || !this.visible || !this.cover || !this.audio || this.sourceKey === this.audioKey) return
      if (this.size > 50 * 1024 * 1024) { this.status = '大文件使用舒缓流动'; return }
      const request = ++this.request, key = this.audioKey
      this.sourceKey = key
      this.status = '正在分析音乐律动…'
      try {
        let source = this.audio
        // #ifdef APP-PLUS
        source = await readLocal(key)
        // #endif
        if (request !== this.request) return
        this.audioSource = source
        ++this.assetRevision
      } catch {
        if (request === this.request) { this.sourceKey = ''; this.status = '音频分析不可用 · 舒缓流动' }
      }
    },
  },
}
</script>
<script module="particles" lang="renderjs">
import { CoverParticles } from '../utils/cover-particles.js'
export default {
  mounted() { if (this.pendingState) this.update(this.pendingState) },
  beforeUnmount() { this.disposed = true; clearTimeout(this.mountRetry); this.renderer?.destroy() },
  methods: {
    updateAssets(value, oldValue, owner) {
      if (owner?.callMethod) this.owner = owner
      if (!value || (this.assets && value.revision < this.assets.revision)) return
      this.assets = value; this.update({ ...this.assets, ...this.motion })
    },
    updateMotion(value, oldValue, owner) { if (owner?.callMethod) this.owner = owner; this.motion = value; this.update({ ...this.assets, ...this.motion }) },
    report(value) { const owner = this.owner || this.$ownerInstance; owner?.callMethod('onParticleStatus', value) },
    update(value) {
      this.pendingState = value
      if (!value || this.disposed) return
      if (value.visible === false) { clearTimeout(this.mountRetry); this.renderer?.hide(); return }
      const host = document.getElementById(value.id)
      clearTimeout(this.mountRetry)
      if (!host || !host.clientWidth || !host.clientHeight) {
        if ((this.mountAttempts || 0) < 60) {
          this.mountAttempts = (this.mountAttempts || 0) + 1
          this.mountRetry = setTimeout(() => this.update(this.pendingState), 50)
        } else this.report({ imageReady: false, status: '粒子画布未能初始化，请重新打开播放页' })
        return
      }
      this.mountAttempts = 0
      try {
        if (!this.renderer) this.renderer = new CoverParticles(host, value => this.report(value))
        this.renderer.update(value)
      } catch (error) {
        console.warn('粒子画布初始化失败', error)
        this.report({ imageReady: false, status: '当前设备无法启动粒子画布，已显示原封面' })
      }
    },
  },
}
</script>
<style>
.particle-cover-block{position:absolute;inset:0;overflow:hidden;transition:opacity .25s ease}.particle-scene-hidden{opacity:0;pointer-events:none}.particle-art{position:absolute;inset:0;overflow:hidden;background:radial-gradient(ellipse at 50% 40%,#ffffff73,transparent 70%)}.particle-original{position:absolute;left:50%;top:43%;transform:translate(-50%,-50%);width:min(68vw,320px);height:min(68vw,320px);border-radius:24px;transition:opacity .5s ease}.particles-ready .particle-original{opacity:0}.particle-canvas{position:absolute;inset:0;opacity:0;transition:opacity .5s ease;touch-action:none}.particle-canvas.active{opacity:1}.particle-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:64px;color:#8eaf99}.particle-toolbar{position:absolute;left:20px;right:20px;bottom:100px;display:flex;align-items:center;flex-direction:column;gap:6px;pointer-events:none}.particle-caption{display:flex;align-items:center;gap:8px}.particle-shape{font-size:11px;color:#405f4b;font-weight:600}.particle-status{font-size:10px;color:#788b7d}.particle-actions{display:flex;gap:6px;pointer-events:auto}.particle-toggle{display:flex;align-items:center;justify-content:center;margin:0;min-height:44px;padding:0 12px;border-radius:18px;background:#ffffffb8;backdrop-filter:blur(15px);color:#4e715a;font-size:11px;line-height:1.4;border:1px solid #ffffffd9}.particle-toggle.selected{background:#e1eee5b8}.particle-toggle::after{border:0}.particle-toggle[disabled]{opacity:.45}.particle-hint{font-size:10px;color:#85978a;letter-spacing:.3px}@media(max-height:640px){.particle-toolbar{bottom:66px;gap:2px}.particle-hint,.particle-caption{display:none}.particle-toggle{min-height:36px}}@media(prefers-reduced-motion:reduce){.particle-original,.particle-canvas,.particle-cover-block{transition:none}}
.particle-scene-hidden{visibility:hidden}.particle-canvas:focus-visible{outline:2px solid #7ca98b;outline-offset:-4px}
.particle-caption.particle-notice{display:flex;max-width:100%;flex-wrap:wrap;justify-content:center}
.particle-actions{flex-wrap:wrap;justify-content:center;max-width:100%}
.particle-options-backdrop{position:absolute;inset:0;z-index:9;background:#e8f0e9c9;backdrop-filter:blur(18px);display:flex;align-items:center;justify-content:center;padding:14px;box-sizing:border-box}.particle-options-panel{width:100%;max-width:400px;max-height:100%;height:100%;box-sizing:border-box;padding:18px;border-radius:26px;border:1px solid #fff;background:#f8fcf9ed}.particle-options-head,.particle-options-row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px;color:#44634d;font-size:13px}.particle-options-head{font-size:20px;font-weight:600}.particle-options-row.wrap{flex-wrap:wrap;justify-content:flex-start}.particle-option-label{display:block;font-size:12px;line-height:1.6;color:#7b8e80;margin:10px 0}.particle-options-row .selected{background:#cfe5d6}

.particle-toolbar{left:24px;right:24px;bottom:18px;gap:10px}.particle-actions{gap:5px;padding:4px;border:1px solid #ffffffbd;border-radius:24px;background:#f8fcf877;backdrop-filter:blur(20px);box-shadow:0 5px 24px #46684f08}.particle-actions .particle-toggle{border:0;border-radius:19px;padding:0 15px;background:transparent;font-size:11px;color:#54715d}.particle-actions .particle-toggle:first-child{background:#e0eee4a8;color:#355e43;box-shadow:inset 0 1px 0 #ffffff9c}.particle-caption{padding:0 12px;gap:8px}.particle-shape{font-size:11px;letter-spacing:1px;font-weight:500}.particle-status{display:none}.particle-caption.particle-notice .particle-status{display:block}.particle-hint{font-size:9px;color:#8a9d8f;letter-spacing:.4px}.particle-art{background:radial-gradient(ellipse at 50% 46%,#ffffff80,transparent 68%)}
@media(max-height:640px){.particle-toolbar{bottom:10px;gap:5px}.particle-actions{padding:2px}.particle-actions .particle-toggle{min-height:34px;padding:0 13px;font-size:10px}.particle-hint{display:none}}

.particle-actions .particle-toggle{transition:transform .16s ease,background-color .16s ease,box-shadow .16s ease;transform-origin:center;-webkit-tap-highlight-color:transparent}
.particle-actions .particle-toggle.particle-pressed,.particle-actions .particle-toggle:active:not([disabled]){transform:scale(.94);background:#c8dfd0;box-shadow:inset 0 2px 5px #365c4420;color:#294e36}
.particle-actions .particle-toggle:focus-visible{outline:2px solid #7ca98b;outline-offset:2px}
@media(prefers-reduced-motion:reduce){.particle-actions .particle-toggle{transition:none}.particle-actions .particle-toggle.particle-pressed,.particle-actions .particle-toggle:active:not([disabled]){transform:none}}
.display-entry{width:100%;margin:12px 0;background:#dfede3;font-size:13px}
.particle-text-settings{margin:16px 0;padding:14px;border-radius:20px;background:#eaf3ed9c;border:1px solid #fff}.particle-text-label{display:block;margin-bottom:10px;font-size:14px;font-weight:600;color:#44634d}.particle-text-input{box-sizing:border-box;width:100%;height:46px;padding:0 14px;border-radius:14px;border:1px solid #d9e6dd;background:#ffffffc9;color:#355e43;font-size:14px}.particle-text-settings .particle-options-row{margin-bottom:0}
.particle-tools-foot{display:flex;align-items:center;gap:12px;pointer-events:auto}.particle-settings-link{margin:0;padding:0 10px;min-height:36px;line-height:36px;background:transparent;color:#567461;font-size:11px}.particle-text-input{height:96px;padding:12px 14px;margin-bottom:12px;line-height:1.6}.particle-text-preview{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:88px;padding:12px;border-radius:16px;background:#f7fbf8;color:#456b53;font-size:24px;font-weight:700;line-height:1.5;overflow-wrap:anywhere}.particle-text-preview text{max-width:100%}.particle-options-panel .particle-toggle{font-size:12px}.particle-options-panel .particle-toggle:active{background:#c8dfd0;transform:scale(.97)}
.particle-quality-options .particle-toggle{flex:1;min-width:0;flex-direction:column;gap:4px;min-height:62px;padding:8px 6px;box-sizing:border-box}.particle-quality-count{font-size:11px;opacity:.7;font-variant-numeric:tabular-nums}
</style>
