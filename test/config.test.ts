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
    const schemaKeys = Object.keys(ConfigSchema.properties)
    const defaultKeys = Object.keys(SCHEMA_DEFAULTS)
    expect(new Set(defaultKeys)).toEqual(new Set(schemaKeys))
  })

  it('keeps externalUrl in properties so the admin UI renders it', () => {
    // SignalK's admin UI copies only `description` and `properties` from a
    // plugin's schema, so a field declared behind `dependencies` reaches RJSF
    // in NEITHER toggle position — 1.0.2 shipped that and the field vanished
    // entirely. Until the admin UI forwards conditional schemas, the field
    // has to be a plain property.
    expect(ConfigSchema.properties).toHaveProperty('externalUrl')
    expect(ConfigSchema).not.toHaveProperty('dependencies')
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
