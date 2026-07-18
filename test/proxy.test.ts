import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import express from 'express'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import request from 'supertest'
import { registerProxy } from '../src/proxy.js'

// A tiny upstream that echoes method + path + body, to prove the proxy forwards
// correctly and streams the response back.
interface Echo {
  method: string
  url: string
  body: string
}

let upstream: Server
let upstreamBase: string

beforeAll(async () => {
  upstream = createServer((req, res) => {
    let body = ''
    req.on('data', (c: Buffer) => {
      body += c.toString('utf8')
    })
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ method: req.method, url: req.url, body }))
    })
  })
  await new Promise<void>((resolve) => {
    upstream.listen(0, '127.0.0.1', resolve)
  })
  const port = (upstream.address() as AddressInfo).port
  upstreamBase = `http://127.0.0.1:${port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => {
    upstream.close(() => {
      resolve()
    })
  })
})

function appWith(base: string | null) {
  const app = express()
  app.use(express.json())
  // An explicit route that must win over the proxy's /api/.* catch-all.
  app.get('/api/update/check', (_req, res) => {
    res.json({ explicit: true })
  })
  registerProxy(app, { getUpstreamBase: () => base })
  return app
}

describe('registerProxy', () => {
  it('forwards GET /api/status to the upstream', async () => {
    const res = await request(appWith(upstreamBase)).get('/api/status')
    expect(res.status).toBe(200)
    const echo = res.body as Echo
    expect(echo.method).toBe('GET')
    expect(echo.url).toBe('/api/status')
  })

  it('forwards a JSON POST body (re-serialized after express.json consumed it)', async () => {
    const res = await request(appWith(upstreamBase))
      .post('/api/config')
      .send({ deviceHostname: 'boaty' })
    expect(res.status).toBe(200)
    const echo = res.body as Echo
    expect(echo.method).toBe('POST')
    expect(JSON.parse(echo.body) as unknown).toEqual({ deviceHostname: 'boaty' })
  })

  it('returns 503 when the upstream base is null (not ready)', async () => {
    const res = await request(appWith(null)).get('/api/status')
    expect(res.status).toBe(503)
    const err = res.body as { error: string }
    expect(err.error).toContain('not ready')
  })

  it('lets an explicit route registered before the proxy win', async () => {
    const res = await request(appWith(upstreamBase)).get('/api/update/check')
    expect(res.status).toBe(200)
    const body = res.body as { explicit: boolean }
    expect(body.explicit).toBe(true)
  })
})
