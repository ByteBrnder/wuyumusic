<template>
  <scroll-view class="measured-lyrics" tabindex="0" aria-label="歌词" scroll-y :scroll-top="targetTop" :scroll-with-animation="animate" @scroll="onScroll" @touchstart="beginTouch" @touchmove="browse" @touchend="endTouch" @touchcancel="endTouch" @wheel="browse" @keydown="browseKey">
    <view :style="{ height: padding + 'px' }"></view>
    <button v-for="(line, index) in lines" :key="index" class="measured-lyric-row" :class="{ current: index === activeIndex }" :aria-current="index === activeIndex ? 'true' : undefined" :aria-label="line.time === null ? line.text : '跳转到歌词：' + line.text" @tap="line.time !== null && $emit('seek', line)">{{ line.text || '♪' }}</button>
    <view :style="{ height: padding + 'px' }"></view>
  </scroll-view>
</template>
<script setup>
import { getCurrentInstance, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { centeredLyricTop } from '../utils/library-core.js'
const props = defineProps({ lines: { type: Array, default: () => [] }, activeIndex: { type: Number, default: -1 }, follow: { type: Boolean, default: true }, visible: { type: Boolean, default: true } })
const emit = defineEmits(['seek', 'update:follow'])
const instance = getCurrentInstance()
const targetTop = ref(0), padding = ref(100), animate = ref(true)
let actualTop = 0, generation = 0, disposed = false
let geometry = null, touching = false, reduced = false, programmaticUntil = 0
function beginTouch() { touching = true; animate.value = false; targetTop.value = actualTop; ++generation }
function endTouch() { touching = false; if (props.follow) center() }
function browse() { ++generation; animate.value = false; targetTop.value = actualTop; programmaticUntil = 0; emit('update:follow', false) }
function browseKey(event) { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) browse() }
function onScroll(event) {
  actualTop = Number(event.detail.scrollTop) || 0
  if (props.follow && !touching && Date.now() > programmaticUntil && Math.abs(actualTop - targetTop.value) > 3) browse()
}
function invalidate() { geometry = null; center() }
async function scrollToCurrent(request) {
  if (request !== generation || disposed || !props.follow || !props.visible || touching || !geometry) return
  const row = geometry.rows[props.activeIndex]
  const desired = row ? centeredLyricTop(row.top, row.height, geometry.height) : 0
  // A manual scroll can leave the requested value unchanged; send a fresh command.
  if (Math.abs(targetTop.value - desired) < 1 && Math.abs(actualTop - desired) > 1) {
    targetTop.value = actualTop
    await nextTick()
    if (request !== generation || disposed || !props.follow || !props.visible) return
  }
  animate.value = !reduced
  programmaticUntil = Date.now() + 1000
  targetTop.value = desired
}
async function center() {
  const request = ++generation
  await nextTick()
  if (!props.follow || !props.visible || disposed) return
  if (geometry) { scrollToCurrent(request); return }
  const query = uni.createSelectorQuery().in(instance.proxy)
  query.select('.measured-lyrics').boundingClientRect()
  query.selectAll('.measured-lyric-row').boundingClientRect()
  query.exec(async result => {
    if (request !== generation || disposed || !props.follow || !props.visible) return
    const [viewport, rows] = result || []
    if (!viewport?.height) return
    const desiredPadding = viewport.height / 2
    if (Math.abs(padding.value - desiredPadding) > 1) { padding.value = desiredPadding; await nextTick(); if (!disposed) center(); return }
    if (!rows?.length) return
    // Relative row positions are stable even while the native scroller is animating.
    geometry = { height: viewport.height, rows: rows.map(row => ({ top: row.top - rows[0].top + padding.value, height: row.height })) }
    scrollToCurrent(request)
  })
}
watch(() => [props.activeIndex, props.follow], center, { flush: 'post' })
watch(() => [props.lines, props.visible], invalidate, { flush: 'post' })
onMounted(() => {
  // #ifdef H5
  reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; animate.value = !reduced
  // #endif
  center(); uni.onWindowResize(invalidate)
})
onUnmounted(() => { disposed = true; ++generation; uni.offWindowResize(invalidate) })
</script>
<style>
.measured-lyrics{flex:1;height:0;min-height:0;mask-image:linear-gradient(transparent,#000 12%,#000 85%,transparent)}
.measured-lyric-row{display:block;width:100%;box-sizing:border-box;min-height:52px;margin:0;padding:12px 10px;border:0;border-radius:16px;background:transparent;color:#64776b;font-size:16px;font-weight:400;line-height:1.75;white-space:normal;overflow-wrap:anywhere;text-align:center;transition:color .2s ease,background-color .2s ease}.measured-lyric-row::after{border:0}
.measured-lyric-row{font-weight:500}
.measured-lyric-row.current{background:#dfede4a8;color:#345e41}
@media(prefers-reduced-motion:reduce){.measured-lyric-row{transition:none}}
</style>
