<script setup>
import { onLaunch } from '@dcloudio/uni-app'

onLaunch(() => {
  // 本地音乐不会请求联网服务。
})
</script>

<style>
page {
  min-height: 100%;
  background: #f1f5f3;
  color: #293630;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 28rpx;
}
button, input { font-family: inherit; }
button::after { border: 0; }
</style>
