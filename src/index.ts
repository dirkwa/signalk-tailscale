import { hostname } from 'node:os'
import { Plugin } from '@signalk/server-api'
import { Request, Response, IRouter } from 'express'
import { ShimClient } from './shim-client.js'
import { registerProxy } from './proxy.js'
import { computeTargetCandidates, suggestSubnetRoutes } from './targetCandidates.js'
import {
  TailscaleServerAPI,
  ContainerConfig,
  ContainerManagerApi,
  ContainerResourceLimits,
  DesiredConfig,
  VolumeIssue
} from './types.js'
import { ConfigSchema, Config, SCHEMA_DEFAULTS } from './config/schema.js'
import { resolveImageTag } from './config/image-tag.js'

const TS_IMAGE = 'ghcr.io/dirkwa/signalk-tailscale-server'
const CONTAINER_NAME = 'signalk-tailscale-server'
const PLUGIN_ID = 'signalk-tailscale'
const SK_MOUNT = '/signalk-data'
const API_PORT = 3020
const SAFE_TAG = /^[a-zA-Z0-9._-]+$/

// How often the plugin re-pushes desired config (incl. freshly-computed
// target candidates and the current SignalK port) to the shim. Cheap POST;
// keeps the shim's reconciler fed if interfaces change or SK restarts on a
// different port. The shim persists it, so this is convergence, not liveness.
const CONFIG_PUSH_INTERVAL_MS = 60_000

/**
 * Netstack has real memory overhead under subnet-router load, but the steady
 * state (serve to SignalK only) is light. 0.5 CPU / 384MB with matched swap
 * gives headroom on a Pi while staying a modest ask. Users override via
 * signalk-container's per-container resource overrides, keyed by the
 * unprefixed name `signalk-tailscale-server`.
 */
const DEFAULT_RESOURCES: ContainerResourceLimits = {
  cpus: 0.5,
  memory: '384m',
  memorySwap: '384m',
  pidsLimit: 256
}

function getContainerManager(): ContainerManagerApi | undefined {
  return globalThis.__signalk_containerManager
}

/**
 * Wait for signalk-container's API to be FULLY ready on globalThis — both the
 * manager object exposed AND runtime detection complete. signalk-container
 * publishes `__signalk_containerManager` synchronously during its own start()
 * but detects the runtime async, so there's a ~1-2s window where getRuntime()
 * returns null; this plugin loads before it alphabetically and races into that
 * window unless we wait for both signals.
 */
async function waitForContainerManager(
  maxMs: number,
  intervalMs = 500
): Promise<ContainerManagerApi | undefined> {
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    const m = getContainerManager()
    if (m && m.getRuntime()) return m
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  return getContainerManager()
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Resolve the actual host:port the shim container is reachable at.
 * resolveContainerAddress is the documented, authoritative answer in every
 * deployment shape (including the in-container shared-netns path where the
 * right URL is 127.0.0.1:3020 and no host-port mapping exists). Falls through
 * to a listContainers().ports parse for the legacy bare-metal-SK port-drift
 * case. Returns null when neither can produce an address.
 */
async function resolveActualAddress(
  containers: ContainerManagerApi,
  debug?: (msg: string) => void
): Promise<string | null> {
  try {
    const apiAnswer = await containers.resolveContainerAddress(CONTAINER_NAME, API_PORT)
    if (apiAnswer) return apiAnswer
  } catch (err) {
    debug?.(`resolveContainerAddress threw: ${errMsg(err)}`)
  }

  try {
    const list = await containers.listContainers()
    const found = list.find((c) => c.name === `sk-${CONTAINER_NAME}`)
    if (found && Array.isArray((found as unknown as { ports?: string[] }).ports)) {
      const ports = (found as unknown as { ports: string[] }).ports
      const wanted = `->${API_PORT}/tcp`
      for (const entry of ports) {
        if (!entry.endsWith(wanted)) continue
        const hostPart = entry.slice(0, -wanted.length)
        if (hostPart.includes(':')) return hostPart
      }
    }
  } catch (err) {
    debug?.(`listContainers fallback threw: ${errMsg(err)}`)
  }
  return null
}

/** SignalK's own HTTP port, for computing serve-target candidates. */
function resolveSignalKPort(app: TailscaleServerAPI): number {
  const fromSettings = (app as unknown as { config?: { settings?: { port?: number } } }).config
    ?.settings?.port
  if (typeof fromSettings === 'number' && fromSettings > 0) return fromSettings
  const fromEnv = Number(process.env['PORT'])
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 3000
}

export default function (app: TailscaleServerAPI): Plugin {
  let client: ShimClient | null = null
  let currentSettings: Config | null = null
  let containerAddress: string | null = null
  let configPushTimer: NodeJS.Timeout | null = null

  const buildContainerConfig = (tag: string): ContainerConfig => ({
    image: TS_IMAGE,
    tag,
    // The whole config root is mounted so the shim's DATA_DIR (a
    // plugin-config-data subdir) is writable and rides in SignalK backups.
    signalkConfigRootMount: SK_MOUNT,
    // signalk-container picks the networking strategy per deployment and
    // exposes the chosen address via resolveContainerAddress.
    signalkAccessiblePorts: [API_PORT],
    // NO explicit extraHosts — signalk-container auto-maps
    // host.containers.internal (host-gateway on Docker, native on podman) and
    // *skips* it under the container:<self-id> shared-netns strategy, where
    // Docker would reject the combination. An explicit entry would break
    // container creation in exactly that case.
    env: {
      PORT: String(API_PORT),
      DATA_DIR: `${SK_MOUNT}/plugin-config-data/${PLUGIN_ID}`,
      SIGNALK_DATA_PATH: SK_MOUNT,
      SIGNALK_VERSION: getSignalKVersion(app),
      // Container's own hostname is a hex id; the shim derives the default
      // device name (signalk-<host>) from the real host name.
      HOST_HOSTNAME: hostname(),
      LOG_LEVEL: 'info'
    },
    resources: DEFAULT_RESOURCES,
    restart: 'unless-stopped'
  })

  /** Build the desired-config payload the shim reconciles toward. */
  const buildDesiredConfig = (settings: Config): DesiredConfig => ({
    deviceHostname: settings.deviceHostname.trim(),
    enableServe: settings.enableServe,
    serveTargetCandidates: computeTargetCandidates(resolveSignalKPort(app)),
    advertiseRoutes: settings.advertiseRoutes,
    acceptRoutes: settings.acceptRoutes
  })

  const onVolumeIssue = (issue: VolumeIssue): void => {
    if (issue.action === 'skipped') {
      app.debug(`baseline mount skipped: ${issue.containerPath} (${issue.reason})`)
    } else if (issue.action === 'recovered') {
      app.debug(`baseline mount recovered: ${issue.containerPath}`)
    } else {
      app.error(`mount aborted: ${issue.containerPath} (${issue.reason})`)
    }
  }

  /** Push desired config to the shim; logs and swallows on failure. */
  const pushConfig = async (): Promise<void> => {
    if (!client || !currentSettings) return
    try {
      await client.postConfig(buildDesiredConfig(currentSettings))
    } catch (err) {
      app.debug(`config push failed (non-fatal): ${errMsg(err)}`)
    }
  }

  const startConfigPushTimer = (): void => {
    stopConfigPushTimer()
    configPushTimer = setInterval(() => {
      void pushConfig()
    }, CONFIG_PUSH_INTERVAL_MS)
  }
  const stopConfigPushTimer = (): void => {
    if (configPushTimer) {
      clearInterval(configPushTimer)
      configPushTimer = null
    }
  }

  const plugin: Plugin = {
    id: PLUGIN_ID,
    name: 'Tailscale',
    description:
      'Zero-config boat VPN: reach your SignalK server from anywhere over Tailscale, no port forwarding',

    schema: ConfigSchema,

    start(config: Partial<Config>) {
      app.debug('Starting signalk-tailscale')
      // SignalK does not seed schema defaults into the runtime config — on
      // auto-enable (or enable-without-save) `config` is `{}`. Deep-merge so
      // every field is present.
      const merged: Config = { ...SCHEMA_DEFAULTS, ...config }
      currentSettings = merged
      void asyncStart(merged).catch((err: unknown) => {
        app.setPluginError(`Startup failed: ${errMsg(err)}`)
      })
    },

    async stop() {
      app.debug('Stopping signalk-tailscale')
      stopConfigPushTimer()
      client = null
      containerAddress = null

      const containers = getContainerManager()
      if (containers && currentSettings?.managedContainer !== false) {
        try {
          containers.updates.unregister(PLUGIN_ID)
        } catch (err) {
          app.debug(`Error unregistering update tracker: ${errMsg(err)}`)
        }
        // stop() drops the VPN (user expectation when disabling the plugin) but
        // the shim NEVER logs out on shutdown — the node key survives, so
        // re-enabling reconnects without a new login. Logout is explicit-only.
        try {
          await containers.stop(CONTAINER_NAME)
        } catch (err) {
          app.debug(`Error stopping ${CONTAINER_NAME}: ${errMsg(err)}`)
        }
      }
      app.setPluginStatus('Stopped')
    },

    registerWithRouter(router: IRouter) {
      // Lightweight readiness signal for admin/webapp badges.
      router.get('/status', async (_req: Request, res: Response) => {
        const containers = getContainerManager()
        let containerState: string = 'unknown'
        let containerImage = ''

        if (containers) {
          try {
            containerState = await containers.getState(CONTAINER_NAME)
          } catch (err) {
            app.debug(`status: getState failed: ${errMsg(err)}`)
          }
          if (containers.getRuntime()) {
            try {
              const list = await containers.listContainers()
              const found = list.find((c) => c.name === `sk-${CONTAINER_NAME}`)
              if (found) containerImage = found.image
            } catch (err) {
              app.debug(`status: listContainers failed: ${errMsg(err)}`)
            }
          }
        }
        if (!containerImage) {
          containerImage = `${TS_IMAGE}:${resolveImageTag(currentSettings?.imageTag ?? 'auto')}`
        }

        res.json({
          container: {
            state: containerState,
            image: containerImage,
            managed: currentSettings?.managedContainer !== false
          },
          ready: client !== null
        })
      })

      // Update detection — delegated to signalk-container's central service.
      router.get('/api/update/check', async (_req: Request, res: Response) => {
        const containers = getContainerManager()
        if (!containers) {
          res.status(503).json({ error: 'signalk-container not available' })
          return
        }
        try {
          const result = await containers.updates.checkOne(PLUGIN_ID)
          res.json(result)
        } catch (err) {
          res.status(500).json({ error: errMsg(err) })
        }
      })

      router.post('/api/update/apply', async (req: Request, res: Response) => {
        const containers = getContainerManager()
        if (!containers) {
          res.status(503).json({ error: 'signalk-container not available' })
          return
        }
        const body = (req.body ?? {}) as { tag?: unknown }
        if ('tag' in body && typeof body.tag !== 'string') {
          res.status(400).json({ error: 'tag must be a string' })
          return
        }
        const requestedTag =
          (typeof body.tag === 'string' ? body.tag : undefined) ??
          currentSettings?.imageTag ??
          'auto'
        if (!SAFE_TAG.test(requestedTag)) {
          res.status(400).json({ error: 'Invalid tag format' })
          return
        }
        const tag = resolveImageTag(requestedTag)

        try {
          app.setPluginStatus(`Recreating ${CONTAINER_NAME} with ${TS_IMAGE}:${tag}...`)
          if (containers.recreate) {
            await containers.recreate(CONTAINER_NAME, buildContainerConfig(tag), { onVolumeIssue })
          } else {
            // signalk-container < 1.12.0 fallback.
            await containers.pullImage(`${TS_IMAGE}:${tag}`)
            await containers.remove(CONTAINER_NAME)
            try {
              await containers.ensureRunning(CONTAINER_NAME, buildContainerConfig(tag), {
                onVolumeIssue
              })
            } catch (recreateErr) {
              const msg = `Container removed but recreation failed: ${errMsg(recreateErr)}. Click Update again to retry.`
              app.setPluginError(msg)
              res.status(500).json({ error: msg })
              return
            }
          }

          // Persist requestedTag not resolved tag: saving "auto" preserves
          // auto-tracking across upgrades.
          if (currentSettings) {
            currentSettings.imageTag = requestedTag
            await new Promise<void>((resolve) => {
              app.savePluginOptions({ ...currentSettings }, (err: NodeJS.ErrnoException | null) => {
                if (err) {
                  app.error(
                    `Failed to persist new tag: ${errMsg(err)}. Container is running with ${tag} but a plugin restart will revert.`
                  )
                }
                resolve()
              })
            })
          }

          // Re-push config after recreate (state survives, but the reconciler
          // starts fresh so re-feed candidates promptly).
          void pushConfig()

          app.setPluginStatus(`Updated to ${TS_IMAGE}:${tag}`)
          res.json({ success: true, tag })
        } catch (err) {
          app.setPluginError(`Update failed: ${errMsg(err)}`)
          res.status(500).json({ error: errMsg(err) })
        }
      })

      // Subnet-router CIDR suggestions — computed from the SignalK host's own
      // interfaces (the container sees only its netstack, so this must live in
      // the plugin). Registered BEFORE the proxy so it isn't swallowed.
      router.get('/api/suggest-routes', (_req: Request, res: Response) => {
        res.json({
          success: true,
          data: { suggested: suggestSubnetRoutes() },
          timestamp: new Date().toISOString()
        })
      })

      // Proxy /api/* to the shim. Registered LAST so the explicit
      // /api/update/{check,apply} and /api/suggest-routes above match first.
      // All proxied routes are admin-only by SignalK's default (PR #2498) —
      // exactly right, since the AuthURL lets whoever opens it claim this boat
      // into their tailnet.
      registerProxy(router, {
        getUpstreamBase: () => containerAddress,
        log: (msg) => {
          app.debug(msg)
        }
      })
    }
  }

  async function asyncStart(settings: Config): Promise<void> {
    if (!settings.managedContainer) {
      // External-server mode: skip the container, point at a user URL.
      const url = settings.externalUrl.trim()
      if (!url) {
        app.setPluginError(
          'managedContainer is disabled but externalUrl is empty. Set externalUrl in plugin config.'
        )
        return
      }
      client = new ShimClient(url)
      containerAddress = url
      try {
        await client.waitForReady(15_000)
        await pushConfig()
        startConfigPushTimer()
        app.setPluginStatus(`Connected to external signalk-tailscale-server at ${url}`)
      } catch (err) {
        app.setPluginError(`External signalk-tailscale-server unreachable: ${errMsg(err)}`)
      }
      return
    }

    const containers = await waitForContainerManager(120_000)
    if (!containers) {
      app.setPluginError(
        'signalk-container plugin not available after 120s. Install and enable it, then restart this plugin.'
      )
      return
    }
    if (!containers.getRuntime()) {
      app.setPluginError(
        'No container runtime detected (Podman or Docker). Install one and restart signalk-container.'
      )
      return
    }

    if (!SAFE_TAG.test(settings.imageTag)) {
      app.setPluginError(`Invalid imageTag "${settings.imageTag}"`)
      return
    }
    const resolvedTag = resolveImageTag(settings.imageTag)

    try {
      const desiredImage = `${TS_IMAGE}:${resolvedTag}`
      let usedRecreate = false
      if (containers.recreate) {
        try {
          const live = await containers.listContainers()
          const found = live.find((c) => c.name === `sk-${CONTAINER_NAME}`)
          if (found && found.image !== desiredImage) {
            app.setPluginStatus(`Recreating ${found.image} → ${desiredImage}...`)
            await containers.recreate(CONTAINER_NAME, buildContainerConfig(resolvedTag), {
              onVolumeIssue
            })
            usedRecreate = true
          }
        } catch (probeErr) {
          app.debug(`self-heal probe failed (non-fatal): ${errMsg(probeErr)}`)
        }
      }
      if (!usedRecreate) {
        app.setPluginStatus(`Starting ${desiredImage}...`)
        await containers.ensureRunning(CONTAINER_NAME, buildContainerConfig(resolvedTag), {
          onVolumeIssue
        })
      }

      try {
        containers.updates.register({
          pluginId: PLUGIN_ID,
          containerName: CONTAINER_NAME,
          image: TS_IMAGE,
          currentTag: () => resolveImageTag(currentSettings?.imageTag ?? settings.imageTag),
          versionSource: containers.updates.sources.githubReleases(
            'dirkwa/signalk-tailscale-server'
          )
        })
      } catch (err) {
        app.debug(`updates.register failed (non-fatal): ${errMsg(err)}`)
      }

      const addr = await resolveActualAddress(containers, (m) => {
        app.debug(m)
      })
      if (!addr) {
        throw new Error('Could not resolve container address')
      }
      containerAddress = `http://${addr}`

      // client stays null until /api/health succeeds so /status's
      // `ready: client !== null` reports a truthful upstream-reachable signal.
      const pending = new ShimClient(containerAddress)
      app.setPluginStatus('Waiting for Tailscale engine to become ready...')
      await pending.waitForReady(60_000)
      client = pending

      // Push desired config once ready, then keep it fresh on an interval.
      await pushConfig()
      startConfigPushTimer()

      app.setPluginStatus('Tailscale engine ready — open the Tailscale screen to log in')
    } catch (err) {
      app.setPluginError(`Container startup failed: ${errMsg(err)}`)
    }
  }

  return plugin
}

/**
 * Best-effort SignalK version detection, plumbed into the container as
 * SIGNALK_VERSION. Falls back to "unknown" — never throws.
 */
function getSignalKVersion(app: TailscaleServerAPI): string {
  const candidate =
    (app as unknown as { signalk?: { version?: string }; version?: string }).signalk?.version ??
    (app as unknown as { version?: string }).version
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : 'unknown'
}
