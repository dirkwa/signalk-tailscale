# signalk-tailscale

Zero-config boat VPN for SignalK. Reach your SignalK server (and optionally your
whole boat LAN) from home or your phone — no port forwarding, no dynamic DNS, no
fighting marina-WiFi or LTE carrier-grade NAT. Powered by
[Tailscale](https://tailscale.com).

Install → open the webapp → scan the QR / click the login link → your boat
appears in your tailnet → open `http://signalk-<boat>.tailXXXX.ts.net` from any
device on your Tailscale account.

## How it works

The plugin runs a companion container
([`ghcr.io/dirkwa/signalk-tailscale-server`](https://github.com/dirkwa/signalk-tailscale-server))
via [signalk-container](https://github.com/dirkwa/signalk-container). That
container runs `tailscaled` in **userspace-networking mode** (no special
capabilities, no `/dev/net/tun` — so it works everywhere signalk-container runs:
rootless podman, docker, the universal installer, Windows/WSL2) and uses
`tailscale serve` to expose your SignalK server over the tailnet.

The plugin's webapp is the whole UI. It talks to the container through a
reverse proxy on the SignalK origin, so it inherits SignalK's admin auth — and
because the Tailscale login link lets whoever opens it claim your boat into
_their_ tailnet, those routes are **admin-only**.

## Setup

1. Install this plugin from the SignalK appstore (it pulls the container
   automatically; **signalk-container must be installed and enabled**).
2. Open the **Tailscale** webapp from the SignalK admin.
3. On the **Connect** tab, scan the QR with your phone or click the login link.
   Sign in with Google / Apple / Microsoft / GitHub (a tailnet is created for
   new accounts).
4. Install the Tailscale app on your phone or laptop (same account) and open the
   URL shown on the **Dashboard**.

That's it — with a default SignalK install you can now reach and log in to your
boat from anywhere. Use the `.ts.net` **hostname** (e.g.
`http://signalk-myboat.tailXXXX.ts.net`), not the raw `100.x` Tailscale IP —
`tailscale serve` answers by hostname, so the bare IP returns "404 page not
found".

### HTTPS and login

Which URL you use depends on whether your SignalK server has SSL enabled
(**Server → Settings → "Use HTTPS"** in the admin):

- **SSL off (the default) — nothing extra to do.** Open the `http://…ts.net`
  URL and log in. It just works: the traffic is already encrypted end-to-end by
  Tailscale (WireGuard), and login/sessions work over the http URL.
- **SSL on** — your SignalK redirects all http to https, so you must use the
  `https://…ts.net` URL, which needs Tailscale's MagicDNS HTTPS certificates
  enabled **once** for your tailnet: open
  <https://login.tailscale.com/admin/dns> and click **Enable HTTPS** (this is a
  tailnet-wide account setting a node can't toggle for you). The Dashboard's
  HTTPS hint links you straight there. Within a minute the `https://…ts.net` URL
  works and you can log in.
  - Why: with SSL on, SignalK marks its session cookie `Secure`, so the browser
    only keeps it over `https`. The `http` URL will show the login page but
    login "does nothing" until you switch to the `https` URL.

> **Tip for the simplest setup:** if you don't otherwise need SignalK's own
> HTTPS on the boat LAN, leave SSL off — Tailscale provides the encryption, and
> everything is zero-config.

### Optional: reach the whole boat LAN

On the **Settings** tab, advertise your boat-LAN CIDR (a suggestion is
pre-filled) to turn the boat into a Tailscale subnet router, then approve the
route in the Tailscale admin console. Now every device on the boat LAN is
reachable from your tailnet.

## Backups & node identity (important)

The Tailscale node key lives under `plugin-config-data/signalk-tailscale/` and is
therefore included in [signalk-backup](https://github.com/dirkwa/signalk-backup)
archives. This is intentional: restoring a backup onto **replacement hardware**
resurrects your boat's VPN identity automatically. But restoring onto a **second
machine while the original is still online** creates two nodes sharing one key,
which Tailscale rejects — log out on one before restoring onto the other. (Not
handled automatically in v1.)

Disabling the plugin drops the VPN but keeps the node key, so re-enabling
reconnects without a new login. **Logging out** (Settings → Danger zone) is the
only thing that removes the boat from your tailnet.

## Configuration

Most behaviour is hard-enabled (zero-config). Plugin config exposes:

- **managedContainer** (default on) — run the companion container. Disable to
  point at an external `signalk-tailscale-server` via **externalUrl**.
- **imageTag** — `auto` (default) tracks the `:latest` server image; pin a
  concrete version (e.g. `0.1.2`) to opt out of latest-tracking.
- **deviceHostname** — the name your boat shows as (default `signalk-<host>`).
- **enableServe** (default on) — expose SignalK over the tailnet.
- **advertiseRoutes / acceptRoutes** — subnet-router opt-ins (also in the webapp).

## Development

```bash
npm install
npm run dev        # vite dev server for the webapp (point SIGNALK_DEV_URL at a server)
npm run build:all  # lint + build (plugin + webapp) + test
```

## License

Apache-2.0
