// #ifdef APP-PLUS
import { getDeviceStatus, openDeviceSettings } from '@/uni_modules/wuyu-media-session'
// #endif

export function readDeviceState() {
  // #ifdef APP-PLUS
  if (plus.os.name === 'Android') {
    try { return JSON.parse(getDeviceStatus()) } catch { return { available: false, message: '请使用包含最新原生模块的安装包' } }
  }
  // #endif
  return { available: false, message: '系统后台运行诊断仅在安卓安装包中提供' }
}

export function openSystemSettings(kind) {
  // #ifdef APP-PLUS
  if (plus.os.name === 'Android') {
    try { const message = openDeviceSettings(kind); if (message) uni.showToast({ title: message, icon: 'none' }); return } catch {}
  }
  // #endif
  uni.showToast({ title: '请在手机系统设置中管理此应用', icon: 'none' })
}
