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

// A concrete semver tag (X.Y.Z, optional -prerelease) pins a specific image;
// anything else — `latest`, `edge`, a branch name — is FLOATING: the registry
// content behind it changes, so a plain image-name comparison can't detect
// drift and the locally-cached copy goes stale. index.ts pulls + digest-compares
// floating tags on startup so a server restart always picks up a newer image.
const SEMVER_TAG = /^v?[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/
export function isFloatingTag(tag: string): boolean {
  return !SEMVER_TAG.test(tag)
}
