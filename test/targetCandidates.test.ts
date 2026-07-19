import { describe, it, expect } from 'vitest'
import {
  computeTargetCandidates,
  nonInternalIpv4s,
  suggestSubnetRoutes
} from '../src/targetCandidates.js'
import type { networkInterfaces } from 'node:os'

type Ifaces = ReturnType<typeof networkInterfaces>

// Minimal NetworkInterfaceInfo-shaped fixtures for the four deployment cases.
type IfaceInfo = NonNullable<Ifaces[string]>[number]
const iface = (address: string, internal = false): IfaceInfo => ({
  address,
  netmask: '255.255.255.0',
  family: 'IPv4',
  mac: '00:00:00:00:00:00',
  internal,
  cidr: `${address}/24`
})

const http = (port: number) => [{ scheme: 'http', port }]

describe('computeTargetCandidates', () => {
  it('always leads with 127.0.0.1, host.containers.internal, host.docker.internal', () => {
    const c = computeTargetCandidates(http(3000), 'boat', { lo: [iface('127.0.0.1', true)] })
    expect(c[0]).toBe('http://127.0.0.1:3000')
    expect(c[1]).toBe('http://host.containers.internal:3000')
    expect(c[2]).toBe('http://host.docker.internal:3000')
  })

  it('bare-metal / installer: includes the host LAN IP and hostname', () => {
    const c = computeTargetCandidates(http(3000), 'myboat', {
      eth0: [iface('192.168.0.10')],
      lo: [iface('127.0.0.1', true)]
    })
    expect(c).toContain('http://192.168.0.10:3000')
    expect(c).toContain('http://myboat:3000')
  })

  it('bridge deployment: keeps the SK-container IP (reachable on the shared net), drops container bridges', () => {
    const c = computeTargetCandidates(http(3000), 'boat', {
      eth0: [iface('10.88.0.5')], // podman bridge — dropped
      docker0: [iface('172.17.0.1')], // docker bridge — dropped
      sk0: [iface('172.20.0.3')] // shared user net — kept
    })
    expect(c).not.toContain('http://10.88.0.5:3000')
    expect(c).not.toContain('http://172.17.0.1:3000')
    expect(c).toContain('http://172.20.0.3:3000')
  })

  it('respects a non-default SignalK port', () => {
    const c = computeTargetCandidates(http(8375), 'boat', { lo: [iface('127.0.0.1', true)] })
    expect(c[0]).toBe('http://127.0.0.1:8375')
  })

  it('handles an HTTP+HTTPS deployment (ssl:true, port:80, sslport:443) — http first per host', () => {
    const c = computeTargetCandidates(
      [
        { scheme: 'http', port: 80 },
        { scheme: 'https', port: 443 }
      ],
      'boat',
      { lo: [iface('127.0.0.1', true)] }
    )
    // Host-major, endpoints per host in order → http then https for 127.0.0.1.
    expect(c[0]).toBe('http://127.0.0.1:80')
    expect(c[1]).toBe('https://127.0.0.1:443')
    expect(c[2]).toBe('http://host.containers.internal:80')
    expect(c[3]).toBe('https://host.containers.internal:443')
    // Both schemes reach the host-gateway alias.
    expect(c).toContain('http://host.containers.internal:80')
    expect(c).toContain('https://host.containers.internal:443')
  })

  it('de-dups repeated addresses', () => {
    const c = computeTargetCandidates(http(3000), 'boat', {
      eth0: [iface('192.168.0.10')],
      eth1: [iface('192.168.0.10')]
    })
    expect(c.filter((x) => x === 'http://192.168.0.10:3000')).toHaveLength(1)
  })
})

describe('nonInternalIpv4s', () => {
  it('excludes loopback, IPv6, and container bridges', () => {
    const ips = nonInternalIpv4s({
      lo: [iface('127.0.0.1', true)],
      eth0: [iface('192.168.0.10')],
      podman: [iface('10.88.0.1')]
    })
    expect(ips).toEqual(['192.168.0.10'])
  })
})

describe('suggestSubnetRoutes', () => {
  it('suggests a /24 for each RFC1918 third-octet, filtering container nets', () => {
    const s = suggestSubnetRoutes({
      eth0: [iface('192.168.0.10')],
      wlan0: [iface('10.0.5.20')],
      podman: [iface('10.88.0.1')],
      docker0: [iface('172.17.0.1')]
    })
    expect(s).toContain('192.168.0.0/24')
    expect(s).toContain('10.0.5.0/24')
    expect(s).not.toContain('10.88.0.0/24')
    expect(s).not.toContain('172.17.0.0/24')
  })

  it('ignores public IPs', () => {
    const s = suggestSubnetRoutes({ eth0: [iface('8.8.8.8')] })
    expect(s).toHaveLength(0)
  })
})
