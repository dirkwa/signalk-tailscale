// Typed client for the signalk-tailscale-server REST shim. The plugin talks to
// the container over loopback (or the shared user network); the browser never
// does — it goes through the plugin's reverse proxy. Uses global fetch (Node
// >=22 in the SignalK host process; no ARM64/undici constraint here — that only
// bit the container's node:24 base, which is why the SERVER avoids fetch, not
// this plugin).

import type { StatusSnapshot, DesiredConfig } from './types.js'

interface Envelope<T> {
  success: boolean
  data?: T
  error?: { code: string; message: string; details?: unknown }
  timestamp: string
}

export class ShimClient {
  constructor(private readonly base: string) {}

  private url(path: string): string {
    return this.base.replace(/\/$/, '') + path
  }

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(this.url(path), init)
    const body = (await res.json()) as Envelope<T>
    if (!res.ok || !body.success) {
      const msg = body.error?.message ?? `HTTP ${res.status}`
      throw new Error(`${path}: ${msg}`)
    }
    return body.data as T
  }

  /** Poll GET /api/health until it returns 200 or the timeout elapses. */
  async waitForReady(timeoutMs: number, intervalMs = 1000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    let lastErr: unknown
    while (Date.now() < deadline) {
      try {
        const res = await fetch(this.url('/api/health'), {
          signal: AbortSignal.timeout(Math.min(5000, intervalMs * 4))
        })
        if (res.ok) return
        lastErr = new Error(`health returned ${res.status}`)
      } catch (err) {
        lastErr = err
      }
      await new Promise((r) => setTimeout(r, intervalMs))
    }
    throw new Error(
      `signalk-tailscale-server not ready after ${timeoutMs}ms: ${
        lastErr instanceof Error ? lastErr.message : String(lastErr)
      }`
    )
  }

  getStatus(): Promise<StatusSnapshot> {
    return this.json<StatusSnapshot>('/api/status')
  }

  getConfig(): Promise<DesiredConfig> {
    return this.json<DesiredConfig>('/api/config')
  }

  postConfig(config: DesiredConfig): Promise<DesiredConfig> {
    return this.json<DesiredConfig>('/api/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(config)
    })
  }

  login(): Promise<{ hostname: string }> {
    return this.json<{ hostname: string }>('/api/login', { method: 'POST' })
  }

  logout(): Promise<{ loggedOut: true }> {
    return this.json<{ loggedOut: true }>('/api/logout', { method: 'POST' })
  }
}
