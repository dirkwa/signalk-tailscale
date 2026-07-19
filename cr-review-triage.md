# CodeRabbit review triage — signalk-tailscale (round 1)

17 findings. Fixed the valid ones; skipped a few with reasons below.

## Fixed

- **proxy.ts (security)**: strip `cookie` and `authorization` before forwarding
  to the shim. SignalK already authorized the request (admin-only routes) and
  the shim is loopback-only with no auth — forwarding the caller's session
  cookie / bearer token leaks credentials for no benefit.
- **index.ts (external mode)**: create the ShimClient and set `containerAddress`
  only AFTER `waitForReady` succeeds, so a failed external connect doesn't leave
  the proxy pointing at an unreachable upstream.
- **index.ts (update routes)**: `/api/update/{check,apply}` now 409 in
  external-server mode instead of trying container operations.
- **useStatus.ts**: the one-shot fetch can no longer overwrite a newer SSE
  snapshot (receivedSseSnapshot guard).
- **ConnectCard.tsx**: clear the QR immediately on any authUrl change so a stale
  QR can't linger.
- **HttpsHint.tsx**: a non-cert `serve.lastError` no longer shadows a genuine
  cert Health message (only HTTPS/cert-related serveErr is used here).
- **Dashboard.tsx**: guard `navigator.clipboard` (undefined in insecure http
  contexts) and degrade to the selectable link.
- **shim-client.ts**: cap the health-fetch timeout and retry sleep by the time
  remaining, so `waitForReady` never overshoots its deadline.
- **webapp/index.html**: settle each admin-CSS `<link>` promise after a 5s
  timeout so a stalled stylesheet never blocks app bootstrap.
- **SettingsPanel.tsx**: seed the route input from advertised routes exactly
  once (ref-gated), so the user can clear the field to remove all routes.
- **proxy.test.ts**: use a used `req` param instead of `_req`.

## Skipped (with reason)

- **index.ts savePluginOptions reject-on-failure / startup-generation
  cancellation / re-resolve-after-recreate** (3 findings) — these patterns are
  copied verbatim from the production signalk-backup plugin. Diverging here
  would make the two plugins inconsistent for no concrete bug; the
  generation-cancellation concern (concurrent start/stop) is a latent
  theoretical race that the reference has lived with in production. Kept for
  parity; revisit in the shared skeleton if ever addressed there.
- **signalk-ci.yml: use `build:all` as test-command** — the reusable workflow
  runs `build-command: npm run build` separately from `test-command: npm test`;
  using build:all as the test command would double-build (lint+build+test twice).
  Matches signalk-backup's CI. Skipped.
- **publish.yml: tag == package.json version guard + canonical-semver
  leading-zero rejection** — the publish workflow mirrors signalk-backup-server's
  (tight tag glob + semver regex). The extra guards are reasonable but diverge
  from the established release flow; left for consistency. Low risk (Dirk drives
  releases manually).

## Round 2 (11 findings)

Fixed:
- api.ts `unwrap`: handle non-JSON response bodies (proxy 502/503 HTML) with a
  clear status error instead of an opaque JSON-parse throw.
- index.html: favicon resolves through `/signalk-tailscale/` base path (was
  `/icon.svg`, which 404s inside the admin).
- HttpsHint: only claim "reachable over http now" when `serve.httpUrl` exists.
- App.tsx: auto-advance Connect→Dashboard the first time we observe Running
  (only while still on Connect, so manual navigation isn't overridden).
- SettingsPanel: mark the route input initialized on user edit, so a delayed
  advertised-routes snapshot can't clobber typed input.
- docs/security.md: scope the loopback-binding guarantee to managed-container
  mode (external-URL shims aren't bound by signalk-container).
- package.json: lint + format `vite.config.ts` too.

Skipped (same rationale as round 1):
- index.ts startup-generation cancellation + savePluginOptions reject-on-failure
  — verbatim from the production signalk-backup skeleton; kept for parity.
- SHA-pin the reusable plugin-ci workflow + add a permissions block, and cover
  `-alpha.` in the prerelease classification — SHA-pinning is against project
  policy (version tags); the prerelease handling matches signalk-backup-server.
  The `-alpha.` gap is real but the tight tag glob + manual release flow make it
  low-risk.
