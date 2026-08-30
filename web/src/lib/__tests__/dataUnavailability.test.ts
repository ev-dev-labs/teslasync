import { describe, it, expect } from 'vitest'

import {
  INGESTION_LAG_THRESHOLD_SEC,
  UNAVAILABILITY_REASONS,
  classifyUnavailability,
  explainEvidence,
  explainUnavailability,
} from '../dataUnavailability'
import { ApiError } from '../resilience'

/**
 * HELP-04. The classifier's priority order is the interesting part: several
 * pieces of evidence are usually true at once (a sleeping car during an
 * outage, a filtered range that also predates retention), and picking the
 * wrong one sends the user to the wrong remedy.
 */

describe('classifyUnavailability — single-signal cases', () => {
  it('reports permission for a 403', () => {
    expect(classifyUnavailability({ error: new ApiError('nope', 403) })).toBe('permission')
  })

  it('reports permission for a 401', () => {
    expect(classifyUnavailability({ error: new ApiError('nope', 401) })).toBe('permission')
  })

  it('reports a service outage for a 503', () => {
    expect(classifyUnavailability({ error: new ApiError('down', 503) })).toBe('service_outage')
  })

  it('reports a service outage for a 500', () => {
    expect(classifyUnavailability({ error: new ApiError('boom', 500) })).toBe('service_outage')
  })

  it('reports retention when the request predates the horizon', () => {
    expect(classifyUnavailability({ requestedBeforeRetention: true })).toBe('retention')
  })

  it('distinguishes a sleeping vehicle from an offline one', () => {
    expect(classifyUnavailability({ vehicleState: 'asleep' })).toBe('vehicle_asleep')
    expect(classifyUnavailability({ vehicleState: 'offline' })).toBe('vehicle_offline')
  })

  it('normalises vehicle-state casing and whitespace', () => {
    expect(classifyUnavailability({ vehicleState: '  ASLEEP ' })).toBe('vehicle_asleep')
  })

  it('reports ingestion lag past the threshold, not below it', () => {
    expect(
      classifyUnavailability({ newestDataAgeSec: INGESTION_LAG_THRESHOLD_SEC + 1 }),
    ).toBe('ingestion_lag')
    expect(classifyUnavailability({ newestDataAgeSec: INGESTION_LAG_THRESHOLD_SEC })).toBeNull()
  })

  it('reports filter scope when filters are the only evidence', () => {
    expect(classifyUnavailability({ filtersActive: true })).toBe('filter_scope')
  })

  it('returns null when nothing explains the emptiness', () => {
    expect(classifyUnavailability({})).toBeNull()
    expect(classifyUnavailability({ vehicleState: 'online' })).toBeNull()
    expect(classifyUnavailability(undefined as never)).toBeNull()
  })
})

describe('classifyUnavailability — priority when signals collide', () => {
  it('permission beats every other signal', () => {
    expect(
      classifyUnavailability({
        error: new ApiError('nope', 403),
        vehicleState: 'asleep',
        requestedBeforeRetention: true,
        filtersActive: true,
      }),
    ).toBe('permission')
  })

  it('an outage beats a sleeping vehicle and a stale timestamp', () => {
    expect(
      classifyUnavailability({
        error: new ApiError('down', 503),
        vehicleState: 'asleep',
        newestDataAgeSec: 99_999,
      }),
    ).toBe('service_outage')
  })

  it('retention beats a sleeping vehicle — a policy boundary is not a wait', () => {
    expect(
      classifyUnavailability({ requestedBeforeRetention: true, vehicleState: 'asleep' }),
    ).toBe('retention')
  })

  it('a sleeping vehicle beats ingestion lag it is itself causing', () => {
    expect(
      classifyUnavailability({ vehicleState: 'asleep', newestDataAgeSec: 99_999 }),
    ).toBe('vehicle_asleep')
  })

  it('ingestion lag beats an active filter', () => {
    expect(
      classifyUnavailability({ newestDataAgeSec: 99_999, filtersActive: true }),
    ).toBe('ingestion_lag')
  })
})

describe('explainUnavailability', () => {
  it('is total over the reason union', () => {
    for (const reason of UNAVAILABILITY_REASONS) {
      const explanation = explainUnavailability(reason)
      expect(explanation.reason).toBe(reason)
      expect(explanation.titleFallback.length).toBeGreaterThan(0)
      expect(explanation.bodyFallback.length).toBeGreaterThan(0)
      expect(explanation.whatToDoFallback.length).toBeGreaterThan(0)
    }
  })

  it('maps every reason onto an existing data-state kind', () => {
    const valid = new Set(['stale', 'partial', 'unavailable', 'unsupported'])
    for (const reason of UNAVAILABILITY_REASONS) {
      expect(valid.has(explainUnavailability(reason).dataState)).toBe(true)
    }
  })

  it('marks the wait-it-out reasons as self-resolving and the rest as not', () => {
    expect(explainUnavailability('vehicle_asleep').resolvesOnItsOwn).toBe(true)
    expect(explainUnavailability('ingestion_lag').resolvesOnItsOwn).toBe(true)
    expect(explainUnavailability('service_outage').resolvesOnItsOwn).toBe(true)
    expect(explainUnavailability('permission').resolvesOnItsOwn).toBe(false)
    expect(explainUnavailability('retention').resolvesOnItsOwn).toBe(false)
    expect(explainUnavailability('filter_scope').resolvesOnItsOwn).toBe(false)
  })

  it('tells the user to do nothing when the vehicle is simply asleep', () => {
    expect(explainUnavailability('vehicle_asleep').whatToDoFallback.toLowerCase()).toContain(
      'nothing',
    )
  })
})

describe('explainEvidence', () => {
  it('classifies and explains in one step', () => {
    expect(explainEvidence({ vehicleState: 'asleep' })?.reason).toBe('vehicle_asleep')
  })

  it('returns null rather than inventing a cause', () => {
    expect(explainEvidence({})).toBeNull()
  })
})
