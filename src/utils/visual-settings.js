export const VISUAL_SETTINGS_KEY = 'wuyu-particle-options-v1'
export const PARTICLE_QUALITY = {
  power: { label: '省电', points: 1000, fps: 24, ratio: 1 },
  balanced: { label: '均衡', points: 2000, fps: 30, ratio: 1.5 },
  fine: { label: '精细', points: 4900, fps: 60, ratio: 3 },
}

export function normalizeTexts(value) {
  const entries = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/\r?\n/) : []
  return [...new Set(entries.filter(item => typeof item === 'string').map(item => Array.from(item.replace(/\s+/g, ' ').trim()).slice(0, 12).join('')).filter(Boolean))].slice(0, 8)
}

export function normalizeVisualSettings(value = {}) {
  const saved = value && typeof value === 'object' ? value : {}
  return {
    quality: saved.qualityVersion === 2 && ['power', 'balanced', 'fine'].includes(saved.quality) ? saved.quality : 'fine',
    qualityVersion: 2,
    motionIntensity: Number.isFinite(saved.motionIntensity) ? Math.max(0, Math.min(100, saved.motionIntensity)) : 80,
    interval: Number.isFinite(saved.interval) ? Math.max(6, Math.min(30, saved.interval)) : 12,
    autoChange: saved.autoChange !== false, favoriteOnly: saved.favoriteOnly === true, enabled: saved.enabled !== false,
    customTexts: normalizeTexts(saved.customTexts ?? saved.customText),
    textFont: ['sans', 'serif', 'mono'].includes(saved.textFont) ? saved.textFont : 'sans',
    textLayout: ['stack', 'line'].includes(saved.textLayout) ? saved.textLayout : 'stack',
  }
}

export function textRows(text, layout = 'stack') {
  const letters = Array.from(text).slice(0, 12), width = layout === 'line' ? 12 : 4, rows = []
  for (let index = 0; index < letters.length; index += width) rows.push(letters.slice(index, index + width).join(''))
  return rows
}

export function normalizeBackupSettings(value) {
  if (!value || typeof value !== 'object') return null
  return { visual: normalizeVisualSettings(value.visual), automaticLyrics: value.automaticLyrics !== false,
    playbackMode: ['list', 'single', 'shuffle'].includes(value.playbackMode) ? value.playbackMode : 'list' }
}
