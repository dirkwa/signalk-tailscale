import { networkInterfaces } from 'node:os'
import { hostname } from 'node:os'

/** A SignalK listening endpoint: scheme (http/https) + port. */
export interface SignalKEndpoint {
  scheme: string
  port: number
}

/**
 * Compute the ordered list of serve-target candidates the shim will probe (in
 * order) to find a working SignalK endpoint. The shim validates each with
 * `GET <candidate>/signalk` and requires a SignalK hello, so wrong guesses are
 * rejected rather than silently serving the wrong thing.
 *
 * SignalK can listen on any HTTP port and/or HTTPS port (see
 * signalk-server/src/ports.ts): plain HTTP on `settings.port`, and — when
 * `ssl:true` — HTTPS on `settings.sslport`. The plugin passes those as
 * `endpoints` (HTTP first); we build a candidate per (host × endpoint).
 *
 * Order is host-major (prefer loopback → gateway → LAN → hostname), then the
 * endpoints in the given order (HTTP before HTTPS), verified on rootless
 * podman/pasta in the Phase 0 spike (host.containers.internal reaches the host):
 *   host 1. 127.0.0.1               — wins under shared-netns (container:<self-id>)
 *   host 2. host.containers.internal — bare-metal + installer host-net (podman
 *           host-gateway → host IP; podman also aliases host.docker.internal)
 *   host 3. host.docker.internal    — docker deployments
 *   host 4. each non-internal IPv4  — host LAN IPs / SK-container IPs (bridge)
 *   host 5. <HOST_HOSTNAME>         — last resort via name resolution
 *
 * @param endpoints SignalK's endpoints in preference order (HTTP first).
 * @param hostName override for tests; defaults to os.hostname().
 * @param ifaces override for tests; defaults to os.networkInterfaces().
 */
export function computeTargetCandidates(
  endpoints: SignalKEndpoint[],
  hostName: string = hostname(),
  ifaces: ReturnType<typeof networkInterfaces> = networkInterfaces()
): string[] {
  const hosts: string[] = ['127.0.0.1', 'host.containers.internal', 'host.docker.internal']
  for (const ip of nonInternalIpv4s(ifaces)) hosts.push(ip)
  if (hostName) hosts.push(hostName)

  const candidates: string[] = []
  for (const host of hosts) {
    for (const ep of endpoints) {
      candidates.push(`${ep.scheme}://${host}:${ep.port}`)
    }
  }

  // De-dup while preserving order (a host IP could recur; loopback etc.).
  return [...new Set(candidates)]
}

/**
 * Non-internal IPv4 addresses, filtered of container-bridge networks
 * (10.88.x podman, 172.17.x docker) that would never reach the real host
 * SignalK. Everything else (LAN, other private ranges) is kept — the probe
 * validates reachability anyway.
 */
export function nonInternalIpv4s(
  ifaces: ReturnType<typeof networkInterfaces> = networkInterfaces()
): string[] {
  const out: string[] = []
  for (const addrs of Object.values(ifaces)) {
    if (!addrs) continue
    for (const a of addrs) {
      // Node types family as 'IPv4' | 'IPv6' on current @types/node; older
      // runtimes emitted the number 4. Compare via a widened view so both
      // shapes are handled without a string-vs-number type clash.
      const family = a.family as string | number
      if (family !== 'IPv4' && family !== 4) continue
      if (a.internal) continue
      if (isContainerBridge(a.address)) continue
      out.push(a.address)
    }
  }
  return out
}

/** 10.88.0.0/16 (podman default) and 172.17.0.0/16 (docker default) bridges. */
function isContainerBridge(ip: string): boolean {
  return ip.startsWith('10.88.') || ip.startsWith('172.17.')
}

/** True for RFC1918 private IPv4 ranges (10/8, 172.16/12, 192.168/16). */
function isRfc1918(ip: string): boolean {
  if (ip.startsWith('10.')) return true
  if (ip.startsWith('192.168.')) return true
  const m = /^172\.(\d+)\./.exec(ip)
  if (m && m[1]) {
    const second = Number(m[1])
    return second >= 16 && second <= 31
  }
  return false
}

/**
 * Suggest boat-LAN subnet-router CIDRs from the host's RFC1918 IPv4 interfaces,
 * filtered of container bridges (10.88.x/172.17.x). Assumes a /24 for each
 * distinct third octet — the common home/boat-LAN case — and de-dups. Used by
 * the SettingsPanel to pre-fill the subnet-router field; the user can edit.
 */
export function suggestSubnetRoutes(
  ifaces: ReturnType<typeof networkInterfaces> = networkInterfaces()
): string[] {
  const cidrs = new Set<string>()
  for (const ip of nonInternalIpv4s(ifaces)) {
    if (!isRfc1918(ip)) continue
    const parts = ip.split('.')
    if (parts.length !== 4) continue
    cidrs.add(`${parts[0]}.${parts[1]}.${parts[2]}.0/24`)
  }
  return [...cidrs]
}
