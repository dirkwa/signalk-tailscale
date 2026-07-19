// `imageTag: "auto"` (the default) tracks the `:latest` published
// signalk-tailscale-server image on ghcr.io — so a new server release reaches
// boats without a plugin bump. signalk-container pulls `:latest` on
// ensureRunning/recreate; the update service compares image digests to detect a
// newer `:latest`. Pin `imageTag` to a concrete version (e.g. "0.1.1") in
// plugin config to opt out of latest-tracking. See AGENTS.md.
export const AUTO_TAG = 'latest'

export function resolveImageTag(tag: string): string {
  return tag === 'auto' ? AUTO_TAG : tag
}
