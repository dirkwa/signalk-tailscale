# AGENTS.md

Orientation for AI coding agents. Human-facing usage lives in
[README.md](README.md); this is what an agent needs before non-trivial changes.

## What this is

A SignalK plugin that drives the
[`signalk-tailscale-server`](https://github.com/dirkwa/signalk-tailscale-server)
companion container (via signalk-container's `globalThis.__signalk_containerManager`)
to give a boat a zero-config Tailscale VPN. Same architecture as
[signalk-backup](https://github.com/dirkwa/signalk-backup) + signalk-backup-server;
that pair is the reference this one is cloned from.

Two moving parts:
- **This plugin** (Node, in the SignalK process): manages the container's
  lifecycle, pushes desired config to the container's REST shim, reverse-proxies
  the webapp's API calls, and computes deployment-specific serve-target
  candidates (which the container can't — it only sees its own netstack).
- **The container**: runs userspace `tailscaled` + `tailscale serve`. Owns all
  Tailscale state; the plugin never touches tailscaled directly.

## The one hard constraint

signalk-container grants no CapAdd / `/dev/net/tun` / sysctls, so Tailscale runs
in **userspace-networking mode everywhere**. Inbound traffic reaches SignalK only
via `tailscale serve`. Don't add TUN/cap/sysctl assumptions to the container
config.

## File layout

- [src/index.ts](src/index.ts) — plugin entry. `waitForContainerManager`,
  `buildContainerConfig` (NO explicit extraHosts — see the comment there),
  `buildDesiredConfig`, the config-push timer, `/status` + `/api/update/*` +
  `/api/suggest-routes` routes, and the proxy registered LAST. Mirrors
  signalk-backup's index.ts closely.
- [src/targetCandidates.ts](src/targetCandidates.ts) — the deployment-critical
  piece. Ordered serve-target candidates (host-major: 127.0.0.1 →
  host.containers.internal → host.docker.internal → host LAN IPs → hostname),
  each crossed with SignalK's endpoints. SignalK can listen on any HTTP port
  and/or HTTPS port — `resolveSignalKEndpoints` in index.ts mirrors
  signalk-server/src/ports.ts (`httpPort = env.PORT||settings.port||3000`,
  `sslPort = env.SSLPORT||settings.sslport||3443`; `ssl:true` → HTTPS on sslPort
  + HTTP on httpPort). HTTP is offered first (simplest for serve+probe).
  `suggestSubnetRoutes` for the SettingsPanel. Container bridges (10.88/172.17)
  are filtered out. NOTE: the shim's probe/serve currently handle plain HTTP
  upstreams; HTTPS-only SignalK (no HTTP port reachable) needs server-side
  `https+insecure://` serve support — a follow-up.
- [src/shim-client.ts](src/shim-client.ts) — typed client for the container's
  REST API (health/status/config/login/logout).
- [src/proxy.ts](src/proxy.ts) — `/plugins/signalk-tailscale/api/*` → shim.
  Copied from signalk-backup; streams both directions.
- [src/types.ts](src/types.ts) — signalk-container API mirror (kept identical to
  signalk-backup's) + the shim REST contract types.
- [src/config/](src/config/) — TypeBox schema (tiny, hard-enabled defaults) +
  `image-tag.ts` (`imageTag: "auto"` → `:latest`, so new server images reach
  boats without a plugin bump; pin a concrete version to opt out).
- [webapp/](webapp/) — Vite Module Federation, exposes `./AppPanel`. Views:
  ConnectCard (login link + QR), Dashboard (URLs + peer count + HttpsHint),
  SettingsPanel (subnet router + updates + logout danger zone). Status is live
  via the shim's SSE stream (`useStatus`).

## Workflow

- **Changes go through a pull request** — branch off latest `main`, push, open a
  PR. Do not push directly to `main` (CI + CodeRabbit run on the PR).

## Conventions (shared with signalk-backup)

- prettier: no semi, single quotes, no trailing comma, width 100.
- eslint is `strictTypeChecked`. `argsIgnorePattern`/`varsIgnorePattern` is `^$`
  (NOT `^_`) — don't "fix" unused params to `_props`.
- Async React event handlers must be sync wrappers (`() => { void (async () => …)() }`)
  to satisfy `no-misused-promises` / `no-confusing-void-expression`.
- `build:all` = lint + build (plugin tsc + webapp typecheck + vite) + vitest.
- Tests mock the container/CLI; no real Tailscale needed.

## Lifecycle (how the two parts stay in sync)

`start()` deep-merges schema defaults (SignalK doesn't seed them), then
`asyncStart()`: waits for `__signalk_containerManager` (≤120s, alphabetical load
order races it), self-heals a drifted image via `recreate()`, resolves the shim
address via `resolveContainerAddress` (+ `listContainers().ports` fallback),
health-polls until ready, then pushes desired config and arms a 60s re-push
timer. `client` stays null until health passes so `/status` reports truthfully.
`stop()` = `containers.stop()` — drops the VPN but the shim never logs out, so
re-enable reconnects with no new login. External-server mode (`managedContainer:
false`) skips the container and points at `externalUrl`.

The plugin computes serve-target candidates because only it can see the host's
interfaces — the container sees only its own netstack. It pushes them (+ hostname
/ routes / enableServe) to `POST /api/config`; the shim's reconciler probes and
configures serve.

## Security

- Plugin routes registered directly on the router are **admin-only** by SignalK's
  default (server PR #2498) — exactly right, since the Tailscale AuthURL lets
  whoever opens it claim the boat into *their* tailnet. Do NOT switch to
  `router.access()`.
- The proxy strips `cookie` + `authorization` before forwarding to the shim: the
  request is already authorized, and the loopback shim has no auth of its own, so
  forwarding SignalK session credentials would leak them for no benefit.

## Build & release

- `npm run build:all` = lint (strictTypeChecked) + build (plugin `tsc` → `plugin/`
  + webapp typecheck + `vite build` → `public/`) + vitest (16 tests).
- `npm run dev` — vite dev server for the webapp; point `SIGNALK_DEV_URL` at a
  running SignalK to proxy `/plugins` + `/admin`.
- npm publish is **OIDC trusted-publishing** (`publish.yml`, `id-token: write`,
  `npm publish --provenance`, no NPM_TOKEN) — requires the package's trusted
  publisher to be configured on npmjs.com (this repo + workflow). Push a `vX.Y.Z`
  tag to release; keep the tag == `package.json` version. `public/` and `plugin/`
  are gitignored but packed at publish time via `prepublishOnly: npm run build`
  and the `files` allowlist.
- `imageTag: "auto"` resolves to `:latest` (see
  [src/config/image-tag.ts](src/config/image-tag.ts)), so a new
  `signalk-tailscale-server` release reaches boats — no plugin bump needed.
  **Floating tags need pull-on-start** (`isFloatingTag`): a plain image-NAME
  compare can't see drift when the tag is `:latest` (name always matches), and
  the locally-cached `:latest` goes stale — so a bare server restart would keep
  running the old image. `asyncStart` therefore, for a floating tag: (1)
  `pullImage(:latest)` first (offline-tolerant — falls back to cache), then (2)
  recreates if the running container's **digest** ≠ the freshly-pulled tag's
  digest (via `getImageDigest`). Pinned semver tags keep the cheap name compare.
  Users who want a fixed version pin `imageTag` to a concrete tag.

## Gotchas verified on real hardware

- NO explicit `extraHosts` in the container config — signalk-container auto-maps
  `host.containers.internal` and *skips* it under the `container:<self-id>`
  shared-netns strategy where Docker would reject an explicit entry. An explicit
  entry breaks container creation in exactly that case.
- Config flows to the shim via `POST /api/config`, NOT container env — env
  changes are drift-detected by signalk-container and would recreate (churn) the
  container on every settings edit.
- The webapp's admin-CSS injection and favicon resolve through the
  `/signalk-tailscale/` base path (MF `base`), not the site root.
- **`@module-federation/vite` is pinned to `~1.15.x`.** 1.16+ emits an
  SSR-flavoured `remoteEntry.js` (extra `remoteEntry.ssr.js`, ~4× larger host
  bundle) that the SignalK admin's module-federation runtime can't load —
  symptom: `Could not load module signalk_tailscale` in the admin console, with
  `remoteEntry.js` served fine (200). A working `remoteEntry.js` is ~3.3 KB with
  no `*ssr*` files in `public/`. Dependabot ignores `>=1.16`; don't bump it
  until the admin host supports the newer output.
- **`main.tsx` loads `react-dom/client` via a NON-analyzable dynamic import**
  (computed specifier + `/* @vite-ignore */`), and it is NOT in the MF `shared`
  map. Verified in-browser (2.28 + 2.30 admin): the host registers `react` and
  `react-dom` as shares but **NOT the `react-dom/client` subpath**. If MF's build
  scan sees `react-dom/client` anywhere (a static import, OR a plain
  `import('react-dom/client')` — both are scanned), it registers it as a shared
  module for the remote; with no host provider the stub throws `[Module
  Federation] Shared module 'react-dom/client' must be provided by host` and the
  panel never mounts. Two dead ends that were tried and FAILED — do not repeat:
  (1) a plain dynamic `import('react-dom/client')` — still scanned, still throws;
  (2) giving `react-dom/client` a bundled share fallback (`import:
  'react-dom/client'`, singleton true or false) — ships a react-dom-client bound
  to a private react-dom → `TypeError: Cannot read properties of undefined
  (reading 'S')` double-runtime crash. The ONLY working fix is to hide the
  specifier from the scan (`const s = 'react-dom' + '/client'; import(/*
  @vite-ignore */ s)`), which drops the share entirely. `main.tsx` is dev-only
  (`npm run dev`); the admin loads `./AppPanel`, which never uses `createRoot`.
  Verified end-to-end against a real 2.30.0 admin (see the E2E note below).

## Local E2E (load the panel in a real admin)

The MF-in-real-admin failures above only surface when the panel is loaded by an
actual SignalK admin host — unit tests won't catch them (16 unit tests passed
through all three broken attempts). To reproduce/verify: run a local
`signalk-server` (a 2.30.x checkout works; a throwaway `-c` dir) with this plugin
symlinked into the config dir's `node_modules`, `npm run build:webapp`, then
drive `/admin/#/e/signalk_tailscale` with a headless browser (Playwright) and
assert the panel text renders (`SignalK Tailscale`, `Connect`/`Dashboard`/
`Settings`) with no `Module Federation` / `reading 'S'` console error.
`/api/status` returning 503 there is expected (no companion container in the
harness) — the webapp handles it gracefully. To see what shares the host
actually provides, evaluate `window.__FEDERATION__.__INSTANCES__[0]
.shareScopeMap.default` in-page after loading the panel route — that's how the
`react-dom/client`-absent-from-host fact was established.
