import { describe, it, expect } from 'vitest'
import { SCHEMA_DEFAULTS, ConfigSchema } from '../src/config/schema.js'
import { resolveImageTag, AUTO_TAG, isFloatingTag } from '../src/config/image-tag.js'

describe('SCHEMA_DEFAULTS', () => {
  it('hard-enables the zero-config behaviour', () => {
    expect(SCHEMA_DEFAULTS.managedContainer).toBe(true)
    expect(SCHEMA_DEFAULTS.imageTag).toBe('auto')
    expect(SCHEMA_DEFAULTS.enableServe).toBe(true)
    expect(SCHEMA_DEFAULTS.deviceHostname).toBe('')
    expect(SCHEMA_DEFAULTS.advertiseRoutes).toEqual([])
    expect(SCHEMA_DEFAULTS.acceptRoutes).toBe(false)
    expect(SCHEMA_DEFAULTS.externalUrl).toBe('')
  })

  it('covers every property declared in ConfigSchema', () => {
    // externalUrl is deliberately NOT in `properties` — it lives in
    // `dependencies` so the form only renders it when the managed-container
    // toggle is off. It still needs a default, so fold it in here rather than
    // dropping the check.
    const dep = (
      ConfigSchema as unknown as {
        dependencies: {
          managedContainer: { oneOf: { properties: Record<string, unknown> }[] }
        }
      }
    ).dependencies
    const conditionalKeys = dep.managedContainer.oneOf.flatMap((b) =>
      Object.keys(b.properties).filter((k) => k !== 'managedContainer')
    )
    const schemaKeys = [...Object.keys(ConfigSchema.properties), ...conditionalKeys]
    const defaultKeys = Object.keys(SCHEMA_DEFAULTS)
    expect(new Set(defaultKeys)).toEqual(new Set(schemaKeys))
  })

  it('renders externalUrl only when the container is not managed', () => {
    // The reported bug: the field showed with its "traffic leaves this host"
    // warning even while signalk-container managed the container.
    expect(ConfigSchema.properties).not.toHaveProperty('externalUrl')
    const dep = (
      ConfigSchema as unknown as {
        dependencies: {
          managedContainer: {
            oneOf: {
              properties: {
                managedContainer: { const: boolean }
              } & Record<string, unknown>
            }[]
          }
        }
      }
    ).dependencies
    const branches = dep.managedContainer.oneOf
    expect(branches).toHaveLength(2)
    const [managed, external] = branches
    if (!managed || !external) throw new Error('expected two oneOf branches')
    expect(managed.properties.managedContainer.const).toBe(true)
    expect(managed.properties).not.toHaveProperty('externalUrl')
    expect(external.properties.managedContainer.const).toBe(false)
    expect(external.properties).toHaveProperty('externalUrl')
  })
})

describe('resolveImageTag', () => {
  it('maps "auto" to the latest tag (tracks :latest on ghcr.io)', () => {
    expect(resolveImageTag('auto')).toBe(AUTO_TAG)
    expect(AUTO_TAG).toBe('latest')
  })

  it('passes an explicit tag through unchanged', () => {
    expect(resolveImageTag('0.2.0')).toBe('0.2.0')
    expect(resolveImageTag('latest')).toBe('latest')
  })
})

describe('isFloatingTag', () => {
  it('treats semver tags as pinned (not floating)', () => {
    expect(isFloatingTag('0.1.2')).toBe(false)
    expect(isFloatingTag('v0.1.2')).toBe(false)
    expect(isFloatingTag('1.2.3-rc.1')).toBe(false)
  })

  it('treats latest / non-semver as floating', () => {
    expect(isFloatingTag('latest')).toBe(true)
    expect(isFloatingTag('edge')).toBe(true)
    expect(isFloatingTag('main')).toBe(true)
    expect(isFloatingTag(resolveImageTag('auto'))).toBe(true)
  })
})
