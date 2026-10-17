import test from 'node:test'
import assert from 'node:assert/strict'
import { CoverParticles } from '../src/utils/cover-particles.js'
import { normalizeVisualSettings } from '../src/utils/visual-settings.js'

test('new and legacy settings default to fine while new manual choices persist', () => {
  assert.equal(normalizeVisualSettings().quality, 'fine')
  assert.equal(normalizeVisualSettings({ quality: 'balanced' }).quality, 'fine')
  assert.equal(normalizeVisualSettings({ quality: 'power', qualityVersion: 2 }).quality, 'power')
  assert.equal(normalizeVisualSettings({ quality: 'balanced', qualityVersion: 2 }).quality, 'balanced')
})

test('fine keeps its full quality budget under power-save and thermal status inputs', () => {
  const renderer = Object.create(CoverParticles.prototype)
  Object.assign(renderer, { state: {}, shape: 'cover', resize() {}, schedule() {}, reportEnvelope() {} })
  renderer.update({ quality: 'fine', powerSave: true, thermal: 4 })
  assert.equal(renderer.quality.points, 4900)
  assert.equal(renderer.quality.fps, 60)
  assert.equal(renderer.quality.ratio, 3)
  renderer.state.playing = true
  assert.equal(renderer.isMoving(), true)
  renderer.update({ quality: 'balanced', powerSave: true, thermal: 4 })
  assert.equal(renderer.quality.points, 2000)
})

test('cover sampling produces a denser grid and preserves cover colors', () => {
  const renderer = Object.create(CoverParticles.prototype)
  Object.assign(renderer, { state: {}, setShape() {}, schedule() {}, draw() {}, report() {}, reportCache() {} })
  const pixels = new Uint8Array(70 * 70 * 4)
  for (let i = 0; i < pixels.length; i += 4) pixels.set([64, 128, 192, 255], i)
  renderer.applyCoverSamples(pixels)
  assert.equal(renderer.points.length, 4900)
  assert.equal(renderer.points[0].color, 'rgb(64,128,192)')
  assert.ok(renderer.points[0].highlightColor)
  assert.ok(renderer.points.every(point => point.x > 0 && point.x < 1 && point.y > 0 && point.y < 1))
})
