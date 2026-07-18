import { ServerAPI } from '@signalk/server-api'

export type TailscaleServerAPI = ServerAPI

// =============================================================================
// signalk-container API mirror
// =============================================================================
//
// Hand-rolled to keep this plugin loosely coupled to signalk-container (only a
// runtime requires-dependency, no compile-time import). Source of truth:
//   https://github.com/dirkwa/signalk-container — src/types.ts, src/updates/types.ts
// Last synced against signalk-container: v1.6.0 (VolumeSpec + onVolumeIssue).
// Kept identical to the signalk-backup mirror so both plugins track the same API.

export type ContainerState = 'running' | 'stopped' | 'missing' | 'no-runtime'

export interface ContainerRuntimeInfo {
  runtime: 'podman' | 'docker'
  version: string
  isPodmanDockerShim: boolean
}

export interface ContainerResourceLimits {
  cpus?: number | null
  cpuShares?: number | null
  cpusetCpus?: string | null
  memory?: string | null
  memorySwap?: string | null
  memoryReservation?: string | null
  pidsLimit?: number | null
  oomScoreAdj?: number | null
}

export interface VolumeSpec {
  source: string
  ifMissing?: 'create' | 'skip' | 'abort'
}

export interface VolumeIssue {
  containerPath: string
  source: string
  action: 'skipped' | 'aborted' | 'recovered'
  reason: string
}

export interface EnsureRunningOptions {
  onVolumeIssue?: (issue: VolumeIssue) => void | Promise<void>
}

export interface ContainerConfig {
  image: string
  tag: string
  ports?: Record<string, string>
  volumes?: Record<string, string | VolumeSpec>
  env?: Record<string, string>
  restart?: 'no' | 'unless-stopped' | 'always'
  command?: string[]
  networkMode?: string
  resources?: ContainerResourceLimits
  signalkDataMount?: string
  signalkConfigRootMount?: string
  signalkAccessiblePorts?: number[]
}

export interface ContainerInfo {
  name: string
  image: string
  state: ContainerState
}

export interface UpdateResourcesResult {
  method: 'live' | 'recreated'
  warnings?: string[]
}

export type UpdateReason =
  | 'newer-version'
  | 'digest-drift'
  | 'older-than-pinned'
  | 'up-to-date'
  | 'offline'
  | 'unknown'
  | 'error'

export type UpdateTagKind = 'semver' | 'floating' | 'unknown'

export interface UpdateCheckResult {
  pluginId: string
  containerName: string
  runningTag: string
  tagKind: UpdateTagKind
  currentVersion: string | null
  latestVersion: string | null
  updateAvailable: boolean
  reason: UpdateReason
  error?: string
  checkedAt: string
  lastSuccessfulCheckAt: string | null
  fromCache: boolean
}

export interface VersionSource {
  fetch: (...args: unknown[]) => Promise<unknown>
}

export interface UpdateRegistration {
  pluginId: string
  containerName: string
  image: string
  currentTag: () => string
  versionSource: VersionSource
  currentVersion?: () => Promise<string | null>
  checkInterval?: string
}

export interface UpdateServiceApi {
  register: (reg: UpdateRegistration) => void
  unregister: (pluginId: string) => void
  checkOne: (pluginId: string) => Promise<UpdateCheckResult>
  checkAll: () => Promise<UpdateCheckResult[]>
  getLastResult: (pluginId: string) => UpdateCheckResult | null
  sources: {
    githubReleases: (
      repo: string,
      options?: { allowPrerelease?: boolean; tagPrefix?: string }
    ) => VersionSource
    dockerHubTags: (image: string, options?: { filter?: (tag: string) => boolean }) => VersionSource
  }
}

export interface ContainerManagerApi {
  getRuntime: () => ContainerRuntimeInfo | null
  pullImage: (image: string, onProgress?: (msg: string) => void) => Promise<void>
  imageExists: (image: string) => Promise<boolean>
  getImageDigest: (imageOrContainer: string) => Promise<string | null>
  ensureRunning: (
    name: string,
    config: ContainerConfig,
    options?: EnsureRunningOptions
  ) => Promise<void>
  recreate?: (
    name: string,
    config: ContainerConfig,
    options?: EnsureRunningOptions
  ) => Promise<void>
  start: (name: string) => Promise<void>
  stop: (name: string) => Promise<void>
  remove: (name: string) => Promise<void>
  getState: (name: string) => Promise<ContainerState>
  listContainers: () => Promise<ContainerInfo[]>
  updateResources: (name: string, limits: ContainerResourceLimits) => Promise<UpdateResourcesResult>
  getResources: (name: string) => ContainerResourceLimits
  resolveContainerAddress: (name: string, port: number) => Promise<string | null>
  resolveHostPath?: (absPath: string) => Promise<{ source: string; subPath: string } | null>
  updates: UpdateServiceApi
}

declare global {
  var __signalk_containerManager: ContainerManagerApi | undefined
}

// =============================================================================
// signalk-tailscale-server REST contract (mirrors the server's types)
// =============================================================================

export type TailscaleBackendState =
  'NoState' | 'NeedsMachineAuth' | 'NeedsLogin' | 'Stopped' | 'Starting' | 'Running'

/** Flattened status snapshot returned by GET /api/status. */
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

/** Desired-config payload pushed to POST /api/config. */
export interface DesiredConfig {
  deviceHostname: string
  enableServe: boolean
  serveTargetCandidates: string[]
  advertiseRoutes: string[]
  acceptRoutes: boolean
}

/** GET /status (plugin-local readiness for admin/webapp badges). */
export interface PluginStatus {
  container: {
    state: string
    image: string
    managed: boolean
  }
  ready: boolean
}
