import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'

// Sürüm tek yerden okunur: kökteki package.json. Derleme/geliştirme sırasında
// gömüldüğü için arayüz sürümü göstermek adına sunucuya soru sormak zorunda
// kalmaz; backend kapalıyken de doğru sürüm görünür.
const rootPkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')
)

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(rootPkg.version)
  },
  server: {
    port: 5173,
    strictPort: true,
  },
})
