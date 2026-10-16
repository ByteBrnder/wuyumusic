<template>
  <view class="listening-display" @tap="reveal">
    <view class="display-top"><text>雾屿 · 锁屏展示</text><button hover-class="display-pressed" aria-label="退出锁屏展示" @tap.stop="$emit('close')"><image src="/static/icons/down.svg" mode="aspectFit" /></button></view>
    <view class="display-clock"><text class="display-time">{{ clock }}</text><text class="display-date">{{ date }}</text></view>
    <view class="display-bottom">
      <view class="display-song"><text>{{ title }}</text><text class="display-artist">{{ artist || '未知歌手' }}</text></view>
      <view class="display-controls" :class="{ shown: controlsVisible }" :aria-hidden="!controlsVisible">
        <button :disabled="!controlsVisible" aria-label="上一首" @tap.stop="interact('previous')"><image src="/static/icons/previous.svg" /></button>
        <button class="display-play" :disabled="!controlsVisible || loading" :loading="loading" :aria-label="playing ? '暂停' : '播放'" @tap.stop="interact('toggle')"><image v-if="!loading" :src="playing ? '/static/icons/pause.svg' : '/static/icons/play.svg'" /></button>
        <button :disabled="!controlsVisible" aria-label="下一首" @tap.stop="interact('next')"><image src="/static/icons/next.svg" /></button>
      </view>
      <button class="display-awake" :class="{ selected: keepAwake }" @tap.stop="toggleAwake">{{ keepAwake ? '屏幕常亮已开启' : '保持屏幕常亮' }}</button>
      <text class="display-note">应用内展示 · {{ controlsVisible ? '稍后自动隐藏控制' : '轻点唤出播放控制' }}</text>
      <text v-if="notice" class="display-note" role="status">{{ notice }}</text>
    </view>
  </view>
</template>
<script setup>
import { onMounted, onUnmounted, ref, watch } from 'vue'
const props = defineProps({ title: String, artist: String, playing: Boolean, loading: Boolean, active: Boolean })
const emit = defineEmits(['close', 'previous', 'next', 'toggle'])
const clock = ref(''), date = ref(''), controlsVisible = ref(true), keepAwake = ref(false), notice = ref('')
let timer, hideTimer, disposed = false
// #ifdef H5
let wakeLock, awakeRequest = 0
// #endif
function updateClock() {
  const now = new Date(), pad = value => String(value).padStart(2, '0')
  clock.value = `${pad(now.getHours())}:${pad(now.getMinutes())}`
  date.value = `${now.getMonth() + 1}月${now.getDate()}日  星期${'日一二三四五六'[now.getDay()]}`
}
function reveal() { controlsVisible.value = true; clearTimeout(hideTimer); hideTimer = setTimeout(() => { controlsVisible.value = false }, 4500) }
function interact(action) { reveal(); emit(action) }
async function applyAwake(value) {
  // #ifdef H5
  const request = ++awakeRequest
  if (!value) { const previous = wakeLock; wakeLock = null; try { await previous?.release() } catch {} return }
  if (wakeLock || document.hidden) return
  try {
    if (!navigator.wakeLock?.request) throw new Error('Wake lock unavailable')
    const lock = await navigator.wakeLock.request('screen')
    if (disposed || request !== awakeRequest || !keepAwake.value || !props.active) { await lock.release(); return }
    wakeLock = lock
    lock.addEventListener('release', () => {
      if (wakeLock !== lock) return
      wakeLock = null
      if (!disposed && !document.hidden && props.active) { keepAwake.value = false; notice.value = '常亮已被系统暂停，可重新开启' }
    })
  } catch { if (!disposed && request === awakeRequest) { keepAwake.value = false; notice.value = '浏览器未允许常亮，请使用系统显示设置' } }
  return
  // #endif
  // #ifndef H5
  uni.setKeepScreenOn({ keepScreenOn: value, fail: () => { if (!disposed) { keepAwake.value = false; notice.value = '当前设备无法保持常亮，请使用系统显示设置' } } })
  // #endif
}
// #ifdef H5
function visibilityChanged() { if (keepAwake.value) applyAwake(!document.hidden && props.active) }
// #endif
function toggleAwake() { notice.value = ''; keepAwake.value = !keepAwake.value; applyAwake(keepAwake.value) }
watch(() => props.active, active => {
  clearInterval(timer); clearTimeout(hideTimer)
  if (active) { updateClock(); timer = setInterval(updateClock, 1000); reveal() }
  if (keepAwake.value) applyAwake(active)
}, { immediate: true })
defineExpose({ reveal })
onMounted(() => {
  updateClock()
  // #ifdef H5
  document.addEventListener('visibilitychange', visibilityChanged)
  // #endif
})
onUnmounted(() => {
  disposed = true; clearInterval(timer); clearTimeout(hideTimer); applyAwake(false)
  // #ifdef H5
  document.removeEventListener('visibilitychange', visibilityChanged)
  // #endif
})
</script>
<style scoped>
.listening-display{position:absolute;inset:0;z-index:6;pointer-events:none;display:flex;flex-direction:column;color:#365348;padding:calc(18px + max(var(--status-bar-height, 0px), env(safe-area-inset-top))) 24px calc(24px + env(safe-area-inset-bottom));box-sizing:border-box;background:linear-gradient(180deg,#f1f6f133,transparent 28%,transparent 68%,#f1f6f1c9)}
.display-top{display:flex;justify-content:space-between;align-items:center;font-size:11px;letter-spacing:2px;color:#698477}.display-top button,.display-controls button,.display-awake{pointer-events:auto;margin:0;border:1px solid #ffffffc9;background:#ffffff87;backdrop-filter:blur(18px);color:#4d705c}.display-top button{width:44px;height:44px;display:flex;align-items:center;justify-content:center;padding:0;border-radius:50%}.display-top image{width:22px;height:22px}.display-clock{text-align:center;display:flex;flex-direction:column;gap:6px;margin-top:18px}.display-time{font-size:clamp(56px,18vw,88px);font-weight:250;letter-spacing:-4px;font-variant-numeric:tabular-nums;line-height:1.1}.display-date{font-size:12px;letter-spacing:2px;color:#70887a}.display-bottom{margin-top:auto;display:flex;flex-direction:column;align-items:center;gap:12px}.display-song{display:flex;flex-direction:column;gap:6px;text-align:center;max-width:100%;font-size:21px;font-weight:550;line-height:1.4}.display-song>text{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.display-song .display-artist{font-size:12px;font-weight:400;color:#6c8376}.display-controls{display:flex;gap:24px;align-items:center;opacity:0;transform:translateY(6px);transition:opacity .3s,transform .3s;pointer-events:none}.display-controls.shown{opacity:1;transform:none}.display-controls button{width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;padding:0}.display-controls:not(.shown) button{pointer-events:none}.display-controls image{width:22px;height:22px}.display-controls .display-play{width:58px;height:58px;background:#d0e8d8c9}.display-awake{min-height:36px;line-height:36px;padding:0 16px;font-size:11px;border-radius:20px}.display-awake.selected{background:#daece0}.display-note{font-size:10px;letter-spacing:.5px;color:#7c9185}.display-pressed,.display-controls button:active{transform:scale(.94)}button::after{border:0}button:focus-visible{outline:2px solid #80a78b;outline-offset:3px}@media(max-height:640px){.display-clock{margin-top:6px}.display-time{font-size:52px}.display-bottom{gap:6px}.display-song{font-size:18px}.display-controls .display-play{width:48px;height:48px}}@media(prefers-reduced-motion:reduce){.display-controls{transition:none;transform:none}}
</style>
