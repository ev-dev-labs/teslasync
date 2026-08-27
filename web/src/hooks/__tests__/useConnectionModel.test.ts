import { describe, it, expect } from 'vitest'

import {
  TELEMETRY_STALE_AFTER_MS,
  deriveConnectionModel,
  type ConnectionInputs,
} from '../useConnectionModel'

const NOW = 1_700_000_000_000

function inputs(overrides: Partial<ConnectionInputs> = {}): ConnectionInputs {
  return {
    browserOnline: true,
    apiStatus: 'ok',
    streamStatus: 'connected',
    lastTelemetryAtMs: NOW - 1_000,
    now: NOW,
    ...overrides,
  }
}

describe('deriveConnectionModel — the four layers stay independent', () => {
  it('reports live when every layer is healthy', () => {
    const model = deriveConnectionModel(inputs())
    expect(model.overall).toBe('live')
    expect(model.reason).toBe('ok')
    expect(model.canReachApi).toBe(true)
    expect(model.isStreaming).toBe(true)
    expect(model.telemetry.status).toBe('fresh')
  })

  it('browser offline dominates every other layer', () => {
    const model = deriveConnectionModel(
      inputs({ browserOnline: false, apiStatus: 'ok', streamStatus: 'connected' }),
    )
    expect(model.overall).toBe('offline')
    expect(model.reason).toBe('browser-offline')
    expect(model.browser).toBe('offline')
    expect(model.canReachApi).toBe(false)
    expect(model.isStreaming).toBe(false)
  })

  it('distinguishes an unreachable API from an offline device', () => {
    const model = deriveConnectionModel(inputs({ apiStatus: 'offline' }))
    expect(model.browser).toBe('online')
    expect(model.overall).toBe('offline')
    expect(model.reason).toBe('api-unreachable')
    expect(model.canReachApi).toBe(false)
  })

  it('reports degraded — not offline — when only the stream is down', () => {
    const model = deriveConnectionModel(inputs({ streamStatus: 'disconnected' }))
    expect(model.overall).toBe('degraded')
    expect(model.reason).toBe('stream-down')
    // REST reads still work, which is why this must not be "offline".
    expect(model.canReachApi).toBe(true)
    expect(model.isStreaming).toBe(false)
  })

  it('reports degraded for a slow API even with a healthy stream', () => {
    const model = deriveConnectionModel(inputs({ apiStatus: 'degraded' }))
    expect(model.overall).toBe('degraded')
    expect(model.reason).toBe('api-degraded')
  })

  it('reports degraded while the stream is reconnecting', () => {
    const model = deriveConnectionModel(inputs({ streamStatus: 'reconnecting' }))
    expect(model.overall).toBe('degraded')
    expect(model.reason).toBe('stream-reconnecting')
  })

  it('reports unknown at first paint before anything is proven', () => {
    const model = deriveConnectionModel(
      inputs({ apiStatus: 'unknown', streamStatus: 'unknown', lastTelemetryAtMs: null }),
    )
    expect(model.overall).toBe('unknown')
    expect(model.telemetry.status).toBe('unknown')
  })
})

describe('telemetry freshness is reported but never drives the connection state', () => {
  it('stale telemetry on a healthy connection stays live', () => {
    const model = deriveConnectionModel(
      inputs({ lastTelemetryAtMs: NOW - TELEMETRY_STALE_AFTER_MS - 1_000 }),
    )
    // A parked, sleeping car is not a broken connection.
    expect(model.telemetry.status).toBe('stale')
    expect(model.overall).toBe('live')
  })

  it('measures the age of the last vehicle_update', () => {
    const model = deriveConnectionModel(inputs({ lastTelemetryAtMs: NOW - 45_000 }))
    expect(model.telemetry.ageMs).toBe(45_000)
    expect(model.telemetry.status).toBe('fresh')
    expect(model.telemetry.lastTelemetryAt).toBe(new Date(NOW - 45_000).toISOString())
  })

  it('uses the 2-minute cross-pod contract as the default threshold', () => {
    expect(TELEMETRY_STALE_AFTER_MS).toBe(120_000)
    const justInside = deriveConnectionModel(inputs({ lastTelemetryAtMs: NOW - 119_000 }))
    const justOutside = deriveConnectionModel(inputs({ lastTelemetryAtMs: NOW - 121_000 }))
    expect(justInside.telemetry.status).toBe('fresh')
    expect(justOutside.telemetry.status).toBe('stale')
  })

  it('treats an absent telemetry instant as unknown rather than as fresh', () => {
    const model = deriveConnectionModel(inputs({ lastTelemetryAtMs: null }))
    expect(model.telemetry.status).toBe('unknown')
    expect(model.telemetry.ageMs).toBeNull()
    expect(model.telemetry.lastTelemetryAt).toBeNull()
  })

  it('treats a non-finite telemetry instant as unknown', () => {
    expect(deriveConnectionModel(inputs({ lastTelemetryAtMs: Number.NaN })).telemetry.status)
      .toBe('unknown')
  })

  it('never reports a negative age for a clock-skewed future timestamp', () => {
    const model = deriveConnectionModel(inputs({ lastTelemetryAtMs: NOW + 10_000 }))
    expect(model.telemetry.ageMs).toBe(0)
  })

  it('does not expose an SSE heartbeat clock — telemetry has its own input', () => {
    // Regression guard for the review finding: the model must have NO way to
    // be fed `sseManager.lastMessageAt` (which heartbeats keep resetting).
    const model = deriveConnectionModel(inputs())
    expect(model.telemetry).not.toHaveProperty('lastMessageAt')
    expect(Object.keys(model.telemetry).sort()).toEqual(
      ['ageMs', 'lastTelemetryAt', 'scope', 'status'],
    )
  })

  it('labels telemetry freshness as fleet-scoped, not per-vehicle', () => {
    // A chatty second car must not be mistaken for the selected car by any
    // consumer reading this field.
    expect(deriveConnectionModel(inputs()).telemetry.scope).toBe('fleet')
    expect(deriveConnectionModel(inputs({ lastTelemetryAtMs: null })).telemetry.scope).toBe('fleet')
  })

  it('reports stale telemetry even while heartbeats keep the stream connected', () => {
    // The exact scenario the old wiring got wrong: pipe healthy (heartbeats
    // flowing → streamStatus 'connected'), but no vehicle has spoken in an
    // hour. Freshness must reflect the vehicle, not the heartbeat.
    const model = deriveConnectionModel(
      inputs({ streamStatus: 'connected', apiStatus: 'ok', lastTelemetryAtMs: NOW - 3_600_000 }),
    )
    expect(model.stream).toBe('connected')
    expect(model.isStreaming).toBe(true)
    expect(model.telemetry.status).toBe('stale')
    expect(model.telemetry.ageMs).toBe(3_600_000)
  })
})
