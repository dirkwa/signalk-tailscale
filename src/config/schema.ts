import { Type, Static } from '@sinclair/typebox'
import { managedModeSchema, type WithExternalUrl } from 'signalk-container-helper/schema'

// The managed/self-hosted switch, shared with every other container plugin.
// Spliced with Type.Unsafe because the fragments are plain JSON Schema: the
// helper has no runtime dependencies and cannot depend on either TypeBox
// package (consumers are split between `typebox` 1.x and `@sinclair/typebox`).
// A bare spread compiles under 1.x and fails here.
const MODE = managedModeSchema({
  // "Tailscale" rather than the image name — this is form copy the operator
  // reads; urlTitle keeps the URL field naming the server it points at.
  productName: 'Tailscale',
  image: 'ghcr.io/dirkwa/signalk-tailscale-server',
  exampleUrl: 'http://192.168.1.50:3020',
  urlTitle: 'External signalk-tailscale-server URL'
})

// Tiny schema — most behaviour is hard-enabled (zero-config product). The
// subnet-router fields (advertiseRoutes/acceptRoutes) are the only real
// opt-ins and are surfaced through the webapp SettingsPanel, not RJSF chrome.
export const ConfigSchema = Type.Object(
  {
    managedContainer: Type.Unsafe<boolean>(MODE.managedContainer),
    imageTag: Type.String({
      default: 'auto',
      title: 'Container image tag',
      description:
        '"auto" (default) tracks the signalk-tailscale-server version this plugin release was tested against. ' +
        'Pin to a specific version (e.g. "0.1.0") or use a floating tag (e.g. "latest") to override.'
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
  },
  // `externalUrl` lives HERE rather than in the properties above, so the form
  // only shows it once the managed-container toggle is off. RJSF renders
  // anything in `properties` regardless of a dependency, so keeping it in both
  // places would leave the field — and its "traffic leaves this host" warning —
  // on screen in managed mode, where nothing leaves the host.
  { dependencies: MODE.dependencies }
)

// TypeBox derives Static<> from `properties` alone, so externalUrl would
// vanish from Config now that it lives in `dependencies`. WithExternalUrl adds
// it back — every settings.externalUrl read depends on it.
export type Config = WithExternalUrl<Static<typeof ConfigSchema>>

// SignalK uses schema `default` only to seed the form, not the runtime config —
// spread these in start(). See AGENTS.md gotchas.
export const SCHEMA_DEFAULTS: Config = {
  // managedContainer + externalUrl come from the shared fragment, so the
  // defaults cannot drift from the schema they were declared in.
  ...MODE.defaults,
  imageTag: 'auto',
  deviceHostname: '',
  enableServe: true,
  advertiseRoutes: [],
  acceptRoutes: false
}
