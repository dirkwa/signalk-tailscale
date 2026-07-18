// All API calls hit the plugin's reverse proxy at
// /plugins/signalk-tailscale/api/*. Same origin as the SignalK admin UI, so no
// CORS dance, and we inherit SignalK's admin auth (these routes are admin-only
// by SignalK default — the AuthURL is sensitive).
const PLUGIN_BASE = '/plugins/signalk-tailscale'
const API_BASE = `${PLUGIN_BASE}/api`

export type TailscaleBackendState =
  'NoState' | 'NeedsMachineAuth' | 'NeedsLogin' | 'Stopped' | 'Starting' | 'Running'

export interface StatusSnapshot {
  backendState: TailscaleBackendState
  authUrl: string | null
  self: {
    hostName: string | null
    dnsName: string | null
    ipv4: string | null
    ipv6: string | null
    online: boolean
  }
  tailnet: {
    magicDNSSuffix: string | null
    magicDNSEnabled: boolean
  }
  peerCount: number
  peersOnline: number
  serve: {
    enabled: boolean
    target: string | null
    httpsUrl: string | null
    httpUrl: string | null
    lastError: string | null
  }
  routes: {
    advertised: string[]
    accepted: boolean
  }
  health: string[]
  versions: {
    tailscale: string | null
    server: string
  }
}

export interface PluginStatus {
  container: { state: string; image: string; managed: boolean }
  ready: boolean
}

export interface UpdateCheckResult {
  updateAvailable: boolean
  currentVersion: string | null
  latestVersion: string | null
  reason: string
  error?: string
}

interface Envelope<T> {
  success: boolean
  data?: T
  error?: { code: string; message: string }
  timestamp: string
}

async function unwrap<T>(res: Response, path: string): Promise<T> {
  let body: Envelope<T>
  try {
    body = (await res.json()) as Envelope<T>
  } catch {
    // e.g. a proxy 502/503 that returns HTML or an empty body — surface the
    // status rather than an opaque JSON-parse error.
    throw new Error(`${path}: HTTP ${res.status} returned a non-JSON response`)
  }
  if (!res.ok || !body.success) {
    throw new Error(body.error?.message ?? `${path}: HTTP ${res.status}`)
  }
  return body.data as T
}

/** Plugin-local readiness (not enveloped — plain JSON). */
export async function getPluginStatus(): Promise<PluginStatus> {
  const res = await fetch(`${PLUGIN_BASE}/status`)
  if (!res.ok) throw new Error(`/status: HTTP ${res.status}`)
  return (await res.json()) as PluginStatus
}

export async function getStatus(): Promise<StatusSnapshot> {
  const res = await fetch(`${API_BASE}/status`)
  return unwrap<StatusSnapshot>(res, '/api/status')
}

export async function kickLogin(): Promise<void> {
  const res = await fetch(`${API_BASE}/login`, { method: 'POST' })
  await unwrap<unknown>(res, '/api/login')
}

export async function logout(): Promise<void> {
  const res = await fetch(`${API_BASE}/logout`, { method: 'POST' })
  await unwrap<unknown>(res, '/api/logout')
}

export async function updateRoutes(update: {
  advertiseRoutes?: string[]
  acceptRoutes?: boolean
}): Promise<{ advertiseRoutes: string[]; acceptRoutes: boolean }> {
  const res = await fetch(`${API_BASE}/routes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(update)
  })
  return unwrap<{ advertiseRoutes: string[]; acceptRoutes: boolean }>(res, '/api/routes')
}

export async function suggestRoutes(): Promise<string[]> {
  const res = await fetch(`${API_BASE}/suggest-routes`)
  const data = await unwrap<{ suggested: string[] }>(res, '/api/suggest-routes')
  return data.suggested
}

export async function checkUpdate(): Promise<UpdateCheckResult> {
  const res = await fetch(`${API_BASE}/update/check`)
  if (!res.ok) throw new Error(`update/check: HTTP ${res.status}`)
  return (await res.json()) as UpdateCheckResult
}

export async function applyUpdate(): Promise<void> {
  const res = await fetch(`${API_BASE}/update/apply`, { method: 'POST' })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `update/apply: HTTP ${res.status}`)
  }
}

/** Subscribe to the shim's SSE status stream via the proxy. */
export function subscribeStatus(
  onSnapshot: (s: StatusSnapshot) => void,
  onError?: (err: Event) => void
): () => void {
  const es = new EventSource(`${API_BASE}/events`)
  es.onmessage = (ev) => {
    try {
      onSnapshot(JSON.parse(ev.data as string) as StatusSnapshot)
    } catch {
      // ignore malformed frames
    }
  }
  if (onError) es.onerror = onError
  return () => {
    es.close()
  }
}
