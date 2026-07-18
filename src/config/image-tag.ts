// The signalk-tailscale-server image version that "auto" resolves to.
// Bump this when a new signalk-tailscale-server release is published to ghcr.io.
// Independent of signalk-tailscale's own package.json version — the two repos
// release on independent cadences. See AGENTS.md "Gotchas" for rationale.
export const TAILSCALE_SERVER_VERSION = '0.1.0'

export function resolveImageTag(tag: string): string {
  return tag === 'auto' ? TAILSCALE_SERVER_VERSION : tag
}
