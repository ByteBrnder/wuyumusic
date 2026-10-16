import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createLyricsMiddleware } from '../server/lyrics-proxy.mjs'

async function serve(t, fetcher) {
  const handler = createLyricsMiddleware(fetcher)
  const server = createServer((request, response) => handler(request, response))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); server.close() })
  return `http://127.0.0.1:${server.address().port}/api/lyrics/netease/`
}

test('H5 proxy only calls fixed domestic routes and caches search responses', async t => {
  const calls = []
  const base = await serve(t, async (url, options) => {
    calls.push({ url, options })
    return new Response(JSON.stringify({ code: 200, result: { songCount: 0 } }), { status: 200 })
  })
  const options = { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ s: '才二十三 方大同', url: 'https://invalid.example/' }) }
  assert.equal((await fetch(base + 'search', options)).status, 200)
  assert.equal((await fetch(base + 'search', options)).status, 200)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://music.163.com/api/search/get/web')
  assert.equal(new URLSearchParams(calls[0].options.body).get('url'), null)
  assert.equal((await fetch(base + 'lyric?id=2619125556')).status, 200)
  assert.equal(calls[1].url, 'https://music.163.com/api/song/lyric?id=2619125556&lv=-1&tv=-1')
  assert.equal((await fetch(base + 'lyric?id=bad')).status, 400)
  assert.equal((await fetch(base + 'unknown')).status, 404)
  assert.equal(calls.length, 2)
})

test('proxy falls back for server failure but preserves rate limits without switching hosts', async t => {
  let calls = 0
  const base = await serve(t, async () => {
    calls++
    return calls === 1 ? new Response('', { status: 503 }) : new Response(JSON.stringify({ code: 200, result: { songCount: 0 } }))
  })
  assert.equal((await fetch(base + 'search', { method: 'POST', body: 's=歌曲' })).status, 200)
  assert.equal(calls, 2)
  let limitedCalls = 0
  const limited = await serve(t, async () => { limitedCalls++; return new Response('', { status: 429, headers: { 'Retry-After': '120' } }) })
  const response = await fetch(limited + 'search', { method: 'POST', body: 's=歌曲' })
  assert.equal(response.status, 429)
  assert.equal(response.headers.get('retry-after'), '120')
  assert.equal(limitedCalls, 1)
})
