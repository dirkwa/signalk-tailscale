import { describe, it, expect } from 'vitest'
import { SCHEMA_DEFAULTS, ConfigSchema } from '../src/config/schema.js'
import { resolveImageTag, TAILSCALE_SERVER_VERSION } from '../src/config/image-tag.js'

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
})

describe('resolveImageTag', () => {
  it('maps "auto" to the pinned server version', () => {
    expect(resolveImageTag('auto')).toBe(TAILSCALE_SERVER_VERSION)
  })

  it('passes an explicit tag through unchanged', () => {
    expect(resolveImageTag('0.2.0')).toBe('0.2.0')
    expect(resolveImageTag('latest')).toBe('latest')
  })
})
