# Security model

## Who can reach what

- **The container's REST shim** is bound to loopback / the shared user network
  by signalk-container. No browser ever talks to it directly.
- **The webapp** reaches the shim only through the plugin's reverse proxy at
  `/plugins/signalk-tailscale/api/*`, on the SignalK origin. Those routes are
  **admin-only** by SignalK's default (server PR #2498) — this is deliberate:
  the Tailscale login AuthURL lets whoever opens it claim your boat into *their*
  tailnet, so it must not be exposed to non-admin users. Do not switch these
  routes to `router.access()`.
- **`tailscale serve`** exposes SignalK to your tailnet only — WireGuard
  encrypted, authenticated by Tailscale. **Funnel** (public internet exposure)
  is never used; if a serve config with Funnel is ever detected, the container
  resets it.

## Node identity & backups

The node key lives under `plugin-config-data/signalk-tailscale/tailscale-state/`
(mode 0700) and rides in signalk-backup archives. See the README "Backups & node
identity" section for the restore caveats:

- Restore onto **replacement** hardware → VPN resurrects (intended).
- Restore onto a **second live** machine → node-key conflict (Tailscale rejects
  duplicate keys). Log out on one first. Not auto-handled in v1.

## Login vs logout vs disable

- **Login** is interactive and admin-initiated only.
- **Disabling the plugin** drops the VPN but keeps the node key — re-enabling
  reconnects with no new login.
- **Logout** (Settings → Danger zone, with confirm) is the only action that
  removes the boat from the tailnet. Nothing in the reconcile/shutdown path ever
  logs out automatically.
