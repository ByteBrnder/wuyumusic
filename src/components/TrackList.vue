<template>
  <view class="track-list">
    <view v-if="virtual && range.start" :style="{ height: range.start * 72 + 'px' }"></view>
    <view v-for="(track, index) in rendered" :key="track.id" class="track-row" :class="{ playing: track.id === currentId }">
      <button class="track-main" :aria-label="`${selecting ? '选择' : '播放'} ${track.title}`" :aria-pressed="selecting ? selectedIds.includes(track.id) : undefined" @tap="$emit('select', track)">
        <text v-if="selecting" class="track-selection" :class="{ checked: selectedIds.includes(track.id) }">{{ selectedIds.includes(track.id) ? '✓' : '' }}</text><text v-else class="track-number">{{ String(index + 1 + (virtual ? range.start : 0)).padStart(2, '0') }}</text>
        <image v-if="track.cover" class="track-cover" :src="track.cover" mode="aspectFill" lazy-load />
        <view v-else class="track-cover cover-fallback">♫</view>
        <view class="track-copy"><text class="track-title">{{ track.title }}</text><text class="track-artist">{{ track.missing ? '文件失效 · 可重新关联' : track.metadataPending ? '封面与歌词待补全' : track.artist || '未知歌手' }}</text></view>
      </button>
      <image v-if="track.favorite" class="favorite-mark" src="/static/icons/heart-filled.svg" aria-label="已喜欢" />
      <button v-if="!selecting" class="more-button" :aria-label="`${track.title}的更多操作`" @tap="$emit('menu', track)"><image src="/static/icons/more.svg" mode="aspectFit" /></button>
    </view>
    <view v-if="virtual" :style="{ height: (tracks.length - range.end) * 72 + 'px' }"></view>
  </view>
</template>
<script setup>
import { computed, getCurrentInstance, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { virtualRange } from '../utils/library-core.js'
const props = defineProps({ tracks: { type: Array, default: () => [] }, selecting: { type: Boolean, default: false }, selectedIds: { type: Array, default: () => [] }, currentId: { type: String, default: '' }, scrollTop: { type: Number, default: 0 }, viewportTop: { type: Number, default: 60 }, viewportHeight: { type: Number, default: 600 } })
const instance = getCurrentInstance(), listTop = ref(0)
const virtual = computed(() => props.tracks.length > 100)
const range = computed(() => virtualRange(props.tracks.length, props.scrollTop, listTop.value, props.viewportHeight))
const rendered = computed(() => virtual.value ? props.tracks.slice(range.value.start, range.value.end) : props.tracks)
let disposed = false
async function measure() {
  await nextTick()
  if (disposed) return
  uni.createSelectorQuery().in(instance.proxy).select('.track-list').boundingClientRect(rect => {
    if (rect && !disposed) listTop.value = rect.top - props.viewportTop + props.scrollTop
  }).exec()
}
watch(() => [props.tracks, props.viewportTop, props.viewportHeight], measure, { flush: 'post' })
onMounted(() => { measure(); uni.onWindowResize(measure) })
onUnmounted(() => { disposed = true; uni.offWindowResize(measure) })
defineEmits(['select', 'menu'])
</script>
<style>
.track-main{display:flex;align-items:center;flex:1;min-width:0;text-align:left;margin:0;padding:0;background:transparent;line-height:1.5;min-height:48px}.favorite-mark{font-size:22rpx;color:#648d70;margin:0 8rpx}.track-main .track-copy{display:flex;align-items:flex-start}.track-main .track-title,.track-main .track-artist{max-width:100%;display:block}
.track-list .track-row{height:72px;min-height:72px;margin:0;box-sizing:border-box}.track-list .track-cover{width:44px;height:44px;border-radius:14px}.track-list .favorite-mark{width:18px;height:18px;flex:none;margin:0 6px}
.track-selection{width:22px;height:22px;flex:none;margin-right:10px;border:1px solid #91ae9a;border-radius:8px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;color:white;font-size:14px}.track-selection.checked{background:#628d70;border-color:#628d70}
.track-list .track-main{border:0;box-shadow:none;gap:10px;overflow:hidden}.track-list .track-main::after{border:0}.track-list .track-main .track-copy{flex:1;min-width:0;display:flex;flex-direction:column;align-items:flex-start;gap:4px}.track-list .track-main .track-title{width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;line-height:1.4;color:#33473b}.track-list .track-main .track-artist{width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:1.4;color:#7b8d81}.track-list .track-cover{flex:none}.track-list .track-number{flex:none;width:22px;font-size:11px;color:#8b9b90}.track-list .track-selection{margin-right:0}
</style>
