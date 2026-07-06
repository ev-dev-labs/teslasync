/**
 * Unit tests for the adaptive-polling API client (`@/api/polling`).
 *
 * Every export is exercised:
 *   - getPollingStatus / getPollingSavings — no-arg GETs to fixed, prefix-free
 *     paths, with pass-through of both live and disabled/zero snapshots.
 *   - getPollingDecisions — vin URL-encoding, snake_case params, and the
 *     limit-normalisation clamp (non-int / zero / negative → default 50).
 *   - getPollingPredictions — the vin / no-vin / empty-vin branches and the two
 *     distinct response shapes (VIN→prediction map vs single `prediction`).
 *   - the exported interfaces — constructed as typed fixtures so `tsc` checks
 *     their shape and the assertions pin their runtime contract.
 *
 * Network is mocked at the `@/api/client` boundary (the convention the sibling
 * hook tests use), so nothing here opens a real request. Each helper is a thin
 * wrapper, so the contract under test is: the exact path handed to `request()`,
 * no `/api/v1` double-prefix, snake_case query params, and faithful
 * pass-through of the resolved value and any rejection.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return { ...actual, request: vi.fn() }
})

import { request } from '@/api/client'
import {
  getPollingStatus,
  getPollingDecisions,
  getPollingSavings,
  getPollingPredictions,
  type PollEngineStatus,
  type VehiclePollingStatus,
  type PollDecision,
  type PredictionInfo,
  type CostSnapshot,
  type PollingDecisionsResponse,
  type PollingPredictionsMap,
  type PollingPredictionForVin,
} from './polling'

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>

// --- fixtures --------------------------------------------------------------

const prediction: PredictionInfo = {
  next_state: 'charging',
  estimated_in: 900_000_000, // nanoseconds, as the engine emits them
  confidence: 0.82,
  based_on: 'historical_charge_windows',
}

const decision: PollDecision = {
  should_poll: true,
  next_interval_ms: 60_000,
  activity: 3,
  profile: 'charging',
  reasons: ['charge_session_active', 'battery_below_limit'],
  cost_saved: 0.0004,
  prediction,
}

const vehicleStatus: VehiclePollingStatus = {
  activity: 'active',
  profile: 'charging',
  consec_idle: 0,
  last_poll_time: '2026-07-06T10:00:00Z',
  next_poll_after: '2026-07-06T10:01:00Z',
  battery_level: 72,
  last_decision: decision,
}

const engineStatus: PollEngineStatus = {
  enabled: true,
  vehicles: { '5YJ3E1EA7PF000001': vehicleStatus },
}

const savings: CostSnapshot = {
  polls_made: 120,
  polls_saved: 380,
  savings_breakdown: { idle: 200, fleet_telemetry: 150, prediction: 20, sleep: 10 },
  savings_percent: 76,
  estimated_cost: 1.2,
  estimated_cost_without_engine: 5,
  estimated_savings: 3.8,
  monthly_credit: 100,
  remaining_credit: 62.5,
  projected_month_end: 2.4,
}

beforeEach(() => {
  mockedRequest.mockReset()
})

// ---------------------------------------------------------------------------
// getPollingStatus
// ---------------------------------------------------------------------------

describe('getPollingStatus', () => {
  it('GETs the prefix-free /polling/status path with no arguments', async () => {
    mockedRequest.mockResolvedValueOnce(engineStatus)

    const res = await getPollingStatus()

    expect(mockedRequest).toHaveBeenCalledTimes(1)
    expect(mockedRequest).toHaveBeenCalledWith('/polling/status')
    // request() adds /api/v1 downstream — a prefix here would double it.
    expect(mockedRequest.mock.calls[0][0]).not.toContain('/api/v1')
    expect(res.enabled).toBe(true)
    expect(res.vehicles['5YJ3E1EA7PF000001'].activity).toBe('active')
  })

  it('passes through a disabled-engine snapshot unchanged', async () => {
    const disabled: PollEngineStatus = { enabled: false, vehicles: {} }
    mockedRequest.mockResolvedValueOnce(disabled)

    const res = await getPollingStatus()

    expect(res.enabled).toBe(false)
    expect(res.vehicles).toEqual({})
  })

  it('propagates a rejected request to the caller', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('status boom'))

    await expect(getPollingStatus()).rejects.toThrow('status boom')
  })
})

// ---------------------------------------------------------------------------
// getPollingDecisions
// ---------------------------------------------------------------------------

describe('getPollingDecisions', () => {
  it('builds the decisions URL with an encoded vin and the default limit', async () => {
    mockedRequest.mockResolvedValueOnce({ vin: 'ABC', decisions: [decision] })

    const res = await getPollingDecisions('ABC')

    expect(mockedRequest).toHaveBeenCalledWith('/polling/decisions?vin=ABC&limit=50')
    expect(res.decisions).toHaveLength(1)
    expect(res.decisions[0].profile).toBe('charging')
    expect(res.vin).toBe('ABC')
  })

  it('honours an explicit positive integer limit', async () => {
    mockedRequest.mockResolvedValueOnce({ vin: 'ABC', decisions: [] })

    await getPollingDecisions('ABC', 200)

    expect(mockedRequest.mock.calls[0][0]).toBe('/polling/decisions?vin=ABC&limit=200')
  })

  it('URL-encodes a vin containing path/query-breaking characters', async () => {
    mockedRequest.mockResolvedValueOnce({ vin: 'a/b&c', decisions: [] })

    await getPollingDecisions('a/b&c')

    // Without encoding, `/` injects a path segment and `&` a bogus param.
    expect(mockedRequest.mock.calls[0][0]).toBe('/polling/decisions?vin=a%2Fb%26c&limit=50')
  })

  it('uses snake_case query parameters, never camelCase', async () => {
    mockedRequest.mockResolvedValueOnce({ vin: 'ABC', decisions: [] })

    await getPollingDecisions('ABC', 25)

    const url = mockedRequest.mock.calls[0][0] as string
    expect(url).toContain('vin=ABC')
    expect(url).toContain('limit=25')
    expect(url).not.toMatch(/vehicleId|Limit=/)
  })

  it('clamps non-positive / non-integer limits back to the default of 50', async () => {
    for (const bad of [0, -5, 2.7, Number.NaN, Number.POSITIVE_INFINITY]) {
      mockedRequest.mockReset()
      mockedRequest.mockResolvedValueOnce({ vin: 'ABC', decisions: [] })

      await getPollingDecisions('ABC', bad)

      expect(mockedRequest.mock.calls[0][0]).toBe('/polling/decisions?vin=ABC&limit=50')
    }
  })

  it('propagates a rejection from the request layer', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('network down'))

    await expect(getPollingDecisions('ABC')).rejects.toThrow('network down')
  })
})

// ---------------------------------------------------------------------------
// getPollingSavings
// ---------------------------------------------------------------------------

describe('getPollingSavings', () => {
  it('GETs the fixed /polling/savings path with no arguments', async () => {
    mockedRequest.mockResolvedValueOnce(savings)

    const res = await getPollingSavings()

    expect(mockedRequest).toHaveBeenCalledTimes(1)
    expect(mockedRequest).toHaveBeenCalledWith('/polling/savings')
    expect(res.savings_percent).toBe(76)
    expect(res.savings_breakdown.idle).toBe(200)
  })

  it('passes through a zero-value snapshot from a disabled engine', async () => {
    const empty: CostSnapshot = {
      ...savings,
      polls_made: 0,
      savings_percent: 0,
      estimated_savings: 0,
      savings_breakdown: {},
    }
    mockedRequest.mockResolvedValueOnce(empty)

    const res = await getPollingSavings()

    expect(res.polls_made).toBe(0)
    expect(res.estimated_savings).toBe(0)
    expect(res.savings_breakdown).toEqual({})
  })

  it('propagates a rejection to the caller', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('savings failed'))

    await expect(getPollingSavings()).rejects.toThrow('savings failed')
  })
})

// ---------------------------------------------------------------------------
// getPollingPredictions
// ---------------------------------------------------------------------------

describe('getPollingPredictions', () => {
  it('omits the vin query param entirely when called with no argument', async () => {
    const map: PollingPredictionsMap = { predictions: { VIN1: prediction } }
    mockedRequest.mockResolvedValueOnce(map)

    const res = await getPollingPredictions()

    expect(mockedRequest).toHaveBeenCalledWith('/polling/predictions')
    // The map form carries `predictions` (plural), not `prediction`.
    expect('predictions' in res).toBe(true)
    if ('predictions' in res) {
      expect(res.predictions?.VIN1.next_state).toBe('charging')
    }
  })

  it('treats an empty-string vin as "all vehicles" (no query param)', async () => {
    const map: PollingPredictionsMap = { predictions: null }
    mockedRequest.mockResolvedValueOnce(map)

    await getPollingPredictions('')

    expect(mockedRequest.mock.calls[0][0]).toBe('/polling/predictions')
  })

  it('appends an encoded vin query param when a vin is provided', async () => {
    const single: PollingPredictionForVin = { vin: 'a b', prediction }
    mockedRequest.mockResolvedValueOnce(single)

    const res = await getPollingPredictions('a b')

    expect(mockedRequest.mock.calls[0][0]).toBe('/polling/predictions?vin=a%20b')
    // The single form carries `prediction` (singular) + the echoed vin — this
    // is the real backend shape the old inline type got wrong.
    expect('prediction' in res).toBe(true)
    if ('prediction' in res) {
      expect(res.vin).toBe('a b')
      expect(res.prediction?.based_on).toBe('historical_charge_windows')
    }
  })

  it('passes through a null single prediction for an unknown vin', async () => {
    const single: PollingPredictionForVin = { vin: 'GHOST', prediction: null }
    mockedRequest.mockResolvedValueOnce(single)

    const res = await getPollingPredictions('GHOST')

    expect(res).toEqual({ vin: 'GHOST', prediction: null })
  })

  it('propagates a rejection to the caller', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('pred failed'))

    await expect(getPollingPredictions('X')).rejects.toThrow('pred failed')
  })
})

// ---------------------------------------------------------------------------
// exported response shapes (interface contracts)
// ---------------------------------------------------------------------------

describe('exported response shapes', () => {
  it('PollDecision + PredictionInfo model a full decision with a prediction', () => {
    expect(decision.should_poll).toBe(true)
    expect(decision.reasons).toContain('charge_session_active')
    expect(decision.prediction?.confidence).toBeCloseTo(0.82)
  })

  it('VehiclePollingStatus + PollEngineStatus nest per-VIN state', () => {
    expect(engineStatus.enabled).toBe(true)
    expect(Object.keys(engineStatus.vehicles)).toHaveLength(1)
    expect(vehicleStatus.last_decision?.next_interval_ms).toBe(60_000)
    expect(vehicleStatus.battery_level).toBe(72)
  })

  it('CostSnapshot sums its savings breakdown', () => {
    const total = Object.values(savings.savings_breakdown).reduce((a, b) => a + b, 0)
    expect(total).toBe(380)
    expect(savings.remaining_credit).toBeLessThan(savings.monthly_credit)
  })

  it('PollingDecisionsResponse tolerates a missing vin (disabled engine)', () => {
    // Constructing this without `vin` regression-guards the optional-field fix.
    const disabled: PollingDecisionsResponse = { decisions: [] }
    expect(disabled.vin).toBeUndefined()
    expect(disabled.decisions).toEqual([])
  })
})
