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
  piece. Ordered serve-target candidates (127.0.0.1 → host.containers.internal →
  host.docker.internal → host LAN IPs → hostname) the shim probes in order.
  `suggestSubnetRoutes` for the SettingsPanel. Container bridges (10.88/172.17)
  are filtered out.
- [src/shim-client.ts](src/shim-client.ts) — typed client for the container's
  REST API (health/status/config/login/logout).
- [src/proxy.ts](src/proxy.ts) — `/plugins/signalk-tailscale/api/*` → shim.
  Copied from signalk-backup; streams both directions.
- [src/types.ts](src/types.ts) — signalk-container API mirror (kept identical to
  signalk-backup's) + the shim REST contract types.
- [src/config/](src/config/) — TypeBox schema (tiny, hard-enabled defaults) +
  `image-tag.ts` (`TAILSCALE_SERVER_VERSION` = what `auto` resolves to; bump it
  when a new server image ships).
- [webapp/](webapp/) — Vite Module Federation, exposes `./AppPanel`. Views:
  ConnectCard (login link + QR), Dashboard (URLs + peer count + HttpsHint),
  SettingsPanel (subnet router + updates + logout danger zone). Status is live
  via the shim's SSE stream (`useStatus`).

## Conventions (shared with signalk-backup)

- prettier: no semi, single quotes, no trailing comma, width 100.
- eslint is `strictTypeChecked`. `argsIgnorePattern`/`varsIgnorePattern` is `^$`
  (NOT `^_`) — don't "fix" unused params to `_props`.
- Async React event handlers must be sync wrappers (`() => { void (async () => …)() }`)
  to satisfy `no-misused-promises` / `no-confusing-void-expression`.
- `build:all` = lint + build (plugin tsc + webapp typecheck + vite) + vitest.
- Tests mock the container/CLI; no real Tailscale needed.

## Gotchas verified on real hardware

- NO explicit `extraHosts` in the container config — signalk-container auto-maps
  `host.containers.internal` and *skips* it under the `container:<self-id>`
  shared-netns strategy where Docker would reject an explicit entry. An explicit
  entry breaks container creation in exactly that case.
- Config flows to the shim via `POST /api/config`, NOT container env — env
  changes are drift-detected by signalk-container and would recreate (churn) the
  container on every settings edit.
- Plugin routes are admin-only by SignalK's default (PR #2498) — do NOT use
  `router.access()`, which would loosen that. The AuthURL is sensitive.
