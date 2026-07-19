import { StrictMode } from 'react'
import { App } from './App'

// This standalone entry is ONLY used by `npm run dev` (index.html). The SignalK
// admin loads ./AppPanel via Module Federation, never this file.
//
// react-dom/client is loaded through a NON-analyzable dynamic import (computed
// specifier + @vite-ignore) so the Module Federation build scan never sees it
// as a dependency. Both a static import AND a plain dynamic
// `import('react-dom/client')` get registered as a shared module for the whole
// remote; the admin host provides `react-dom` but NOT the `react-dom/client`
// subpath, so the auto-generated share stub throws "must be provided by host"
// at remote init and the panel never mounts. Hiding it from the scan removes
// the share entirely.
const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('signalk-tailscale: #root element missing in index.html')

const clientSpecifier = 'react-dom' + '/client'
void import(/* @vite-ignore */ clientSpecifier).then((m: typeof import('react-dom/client')) => {
  m.createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
})
