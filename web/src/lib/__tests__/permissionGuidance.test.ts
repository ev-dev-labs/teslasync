import { describe, it, expect } from 'vitest'

import {
  ACCESS_BLOCK_KINDS,
  accessGuidanceFor,
  classifyAccessBlock,
  explainAccessBlock,
} from '../permissionGuidance'
import { ApiError } from '../resilience'
import { OPERATIONAL_MODE_READ_ONLY_CODE } from '../operationalMode'

/** HELP-10. */

describe('classifyAccessBlock', () => {
  it('maps 401 to unauthenticated and 403 to forbidden', () => {
    expect(classifyAccessBlock({ error: new ApiError('x', 401) })).toBe('unauthenticated')
    expect(classifyAccessBlock({ error: new ApiError('x', 403) })).toBe('forbidden')
  })

  it('maps a PERMISSION_DENIED code to forbidden even without a 403 status', () => {
    expect(
      classifyAccessBlock({ error: new ApiError('x', 400, 'PERMISSION_DENIED') }),
    ).toBe('forbidden')
  })

  it('recognises the explicit open-mode server code', () => {
    expect(classifyAccessBlock({ error: new ApiError('x', 501, 'AUTH_MODE_OPEN') })).toBe(
      'open_mode',
    )
  })

  it('recognises the read-only operational-mode code', () => {
    expect(
      classifyAccessBlock({
        error: new ApiError('x', 409, OPERATIONAL_MODE_READ_ONLY_CODE),
      }),
    ).toBe('read_only')
  })

  it('prefers the explicit server code over the SPA’s cached deployment belief', () => {
    expect(
      classifyAccessBlock({
        error: new ApiError('x', 501, 'AUTH_MODE_OPEN'),
        authModeOpen: false,
        featureDisabled: true,
      }),
    ).toBe('open_mode')
  })

  it('resolves a 501 to open_mode on an install with no identity provider', () => {
    expect(
      classifyAccessBlock({ error: new ApiError('x', 501), authModeOpen: true }),
    ).toBe('open_mode')
  })

  it('resolves a 501 to feature_disabled on an authenticated install', () => {
    expect(
      classifyAccessBlock({ error: new ApiError('x', 501), authModeOpen: false }),
    ).toBe('feature_disabled')
  })

  it('falls back to deployment state when there is no error', () => {
    expect(classifyAccessBlock({ featureDisabled: true })).toBe('feature_disabled')
    expect(classifyAccessBlock({ authModeOpen: true })).toBe('open_mode')
  })

  it('returns null when nothing indicates a block', () => {
    expect(classifyAccessBlock({})).toBeNull()
    expect(classifyAccessBlock({ error: new ApiError('x', 500) })).toBeNull()
    expect(classifyAccessBlock(undefined as never)).toBeNull()
  })
})

describe('accessGuidanceFor', () => {
  it('is total over the kind union', () => {
    for (const kind of ACCESS_BLOCK_KINDS) {
      const guidance = accessGuidanceFor(kind)
      expect(guidance.kind).toBe(kind)
      expect(guidance.titleFallback.length).toBeGreaterThan(0)
      expect(guidance.explanationFallback.length).toBeGreaterThan(30)
      expect(guidance.grantedByFallback.length).toBeGreaterThan(0)
    }
  })

  it('gives concrete request-access steps for every kind', () => {
    for (const kind of ACCESS_BLOCK_KINDS) {
      const steps = accessGuidanceFor(kind).steps
      expect(steps.length, `${kind} steps`).toBeGreaterThan(0)
      for (const step of steps) {
        expect(step.fallback.length).toBeGreaterThan(20)
      }
    }
  })

  it('marks only the kinds a retry can fix as retryable', () => {
    expect(accessGuidanceFor('unauthenticated').retryable).toBe(true)
    expect(accessGuidanceFor('read_only').retryable).toBe(true)
    expect(accessGuidanceFor('forbidden').retryable).toBe(false)
    expect(accessGuidanceFor('open_mode').retryable).toBe(false)
    expect(accessGuidanceFor('feature_disabled').retryable).toBe(false)
  })

  it('states plainly that a forbidden resource exists and is not missing', () => {
    expect(accessGuidanceFor('forbidden').explanationFallback).toMatch(/not missing/i)
  })

  it('names who can grant access for a forbidden resource', () => {
    expect(accessGuidanceFor('forbidden').grantedByFallback.toLowerCase()).toContain(
      'administrator',
    )
  })
})

describe('explainAccessBlock', () => {
  it('classifies and explains in one step', () => {
    expect(explainAccessBlock({ error: new ApiError('x', 403) })?.kind).toBe('forbidden')
  })

  it('returns null when there is no block', () => {
    expect(explainAccessBlock({})).toBeNull()
  })
})
