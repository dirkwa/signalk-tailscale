import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { federation } from '@module-federation/vite'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readFileSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))

// Inline the plugin's own version so the webapp header can show it without a
// settings/health roundtrip.
const pkgVersion = (
  JSON.parse(readFileSync(resolve(here, 'package.json'), 'utf-8')) as { version: string }
).version

export default defineConfig({
  plugins: [
    react(),
    federation({
      name: 'signalk-tailscale',
      filename: 'remoteEntry.js',
      exposes: {
        './AppPanel': resolve(here, 'webapp/src/AppPanel.tsx')
      },
      shared: {
        // import: false prevents bundling a second React copy that breaks useState.
        react: { singleton: true, requiredVersion: '^19.0.0', import: false },
        'react-dom': { singleton: true, requiredVersion: '^19.0.0', import: false },
        // react-dom/client is a distinct share key. Without an explicit entry MF
        // derives a host-only stub (inheriting react-dom's import:false) and
        // throws "Shared module 'react-dom/client' must be provided by host" on
        // admin builds that only register `react-dom`. Bundle a small fallback
        // (import: 'react-dom/client') so it resolves regardless — same approach
        // as the jsx-runtime shares below.
        'react-dom/client': {
          singleton: true,
          requiredVersion: '^19.0.0',
          import: 'react-dom/client'
        },
        'react/jsx-runtime': {
          singleton: true,
          requiredVersion: '^19.0.0',
          import: 'react/jsx-runtime'
        },
        'react/jsx-dev-runtime': {
          singleton: true,
          requiredVersion: '^19.0.0',
          import: 'react/jsx-dev-runtime'
        }
      },
      dts: false
    })
  ],
  define: {
    __PLUGIN_VERSION__: JSON.stringify(pkgVersion)
  },
  base: '/signalk-tailscale/',
  root: resolve(here, 'webapp'),
  build: {
    outDir: resolve(here, 'public'),
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
    modulePreload: false
  },
  server: {
    port: 5173,
    proxy: {
      '/plugins': process.env.SIGNALK_DEV_URL ?? 'http://127.0.0.1:3000',
      '/admin': process.env.SIGNALK_DEV_URL ?? 'http://127.0.0.1:3000'
    }
  }
})
