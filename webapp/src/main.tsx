import { StrictMode } from 'react'
import { App } from './App'

// This standalone entry is ONLY used by `npm run dev` (index.html) — the
// SignalK admin loads ./AppPanel via Module Federation, not this file. Import
// react-dom/client dynamically so it never becomes a top-level MF shared
// module: a static `import { createRoot } from 'react-dom/client'` gets
// registered as a shared dep for the whole remote, and the admin host provides
// `react-dom` but not the `react-dom/client` subpath — so the auto-generated
// stub throws "must be provided by host" at remote init.
const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('signalk-tailscale: #root element missing in index.html')

void import('react-dom/client').then(({ createRoot }) => {
  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
})
