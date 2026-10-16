import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'
import { createLyricsMiddleware } from './server/lyrics-proxy.mjs'
// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    uni(),
    { name: 'wuyu-domestic-lyrics', configureServer(server) { server.middlewares.use(createLyricsMiddleware()) } },
  ],
})
