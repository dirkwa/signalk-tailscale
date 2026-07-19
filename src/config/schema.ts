import { Type, Static } from '@sinclair/typebox'

// Tiny schema — most behaviour is hard-enabled (zero-config product). The
// subnet-router fields (advertiseRoutes/acceptRoutes) are the only real
// opt-ins and are surfaced through the webapp SettingsPanel, not RJSF chrome.
export const ConfigSchema = Type.Object({
  managedContainer: Type.Boolean({
    default: true,
    title: 'Manage Tailscale container via signalk-container',
    description:
      'When enabled (default), the plugin pulls and runs ghcr.io/dirkwa/signalk-tailscale-server. ' +
      'Disable to point at an external signalk-tailscale-server instance via "External URL".'
  }),
  imageTag: Type.String({
    default: 'auto',
    title: 'Container image tag',
    description:
      '"auto" (default) tracks the signalk-tailscale-server version this plugin release was tested against. ' +
      'Pin to a specific version (e.g. "0.1.0") or use a floating tag (e.g. "latest") to override.'
  }),
  externalUrl: Type.String({
    default: '',
    title: 'External signalk-tailscale-server URL',
    description:
      'Used only when managedContainer is disabled. e.g. http://192.168.1.50:3020. ' +
      'Leave blank when managing the container.'
  }),
  deviceHostname: Type.String({
    default: '',
    title: 'Tailscale device hostname',
    description:
      'Name this boat shows as in your tailnet. Leave blank to use signalk-<host>. ' +
      'Changing it renames the device on the next reconcile.'
  }),
  enableServe: Type.Boolean({
    default: true,
    title: 'Expose SignalK over Tailscale',
    description:
      'When enabled (default), the plugin runs `tailscale serve` so your SignalK server is ' +
      'reachable at http(s)://<device>.<tailnet>.ts.net from any device on your tailnet ' +
      '(http when SignalK SSL is off — the default; https when SSL is on).'
  }),
  advertiseRoutes: Type.Array(Type.String(), {
    default: [],
    title: 'Advertised subnet routes (advanced)',
    description:
      'CIDRs of the boat LAN to expose as a subnet router, e.g. 192.168.0.0/24. ' +
      'Empty by default. Routes must be approved in the Tailscale admin console after advertising.'
  }),
  acceptRoutes: Type.Boolean({
    default: false,
    title: 'Accept routes from other devices (advanced)',
    description:
      'When enabled, this node accepts subnet routes advertised by other devices in your tailnet.'
  })
})

export type Config = Static<typeof ConfigSchema>

// SignalK uses schema `default` only to seed the form, not the runtime config —
// spread these in start(). See AGENTS.md gotchas.
export const SCHEMA_DEFAULTS: Config = {
  managedContainer: true,
  imageTag: 'auto',
  externalUrl: '',
  deviceHostname: '',
  enableServe: true,
  advertiseRoutes: [],
  acceptRoutes: false
}
