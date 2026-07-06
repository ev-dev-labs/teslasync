/**
 * @module api/polling
 *
 * Read-only client for the adaptive polling engine dashboard
 * (`GET /api/v1/polling/*`, see `internal/api/polling/handler.go`). The engine
 * decides how often TeslaSync polls the Tesla Fleet API per vehicle to stay
 * inside the free monthly command quota; these helpers surface its live state,
 * decision history, predictions, and the resulting cost savings.
 *
 * Every helper is a thin wrapper over {@link request}, which prepends the
 * `/api/v1` prefix and normalises snake_case ⇄ camelCase — so paths here are
 * prefix-free and query params stay snake_case, matching the Go router.
 */
import { request } from '@/api/client'

/** Top-level `GET /polling/status` payload: engine on/off plus per-VIN state. */
export interface PollEngineStatus {
  enabled: boolean
  vehicles: Record<string, VehiclePollingStatus>
}

/** Live polling state for a single vehicle, keyed by VIN in {@link PollEngineStatus}. */
export interface VehiclePollingStatus {
  activity: string
  profile: string
  consec_idle: number
  last_poll_time: string
  next_poll_after: string
  battery_level: number
  last_decision: PollDecision | null
}

/** A single scheduling decision emitted by the engine for one vehicle. */
export interface PollDecision {
  should_poll: boolean
  next_interval_ms: number
  activity: number
  profile: string
  reasons: string[]
  cost_saved: number
  prediction: PredictionInfo | null
}

/** Forward-looking state prediction attached to a {@link PollDecision}. */
export interface PredictionInfo {
  next_state: string
  estimated_in: number
  confidence: number
  based_on: string
}

/** Quota/cost accounting snapshot returned by `GET /polling/savings`. */
export interface CostSnapshot {
  polls_made: number
  polls_saved: number
  savings_breakdown: Record<string, number>
  savings_percent: number
  estimated_cost: number
  estimated_cost_without_engine: number
  estimated_savings: number
  monthly_credit: number
  remaining_credit: number
  projected_month_end: number
}

/**
 * Response shape of `GET /polling/decisions?vin=…&limit=…`.
 *
 * `vin` echoes the requested vehicle, but is absent when the engine is disabled
 * (the handler short-circuits to `{ decisions: [] }`), so it is optional.
 * `decisions` is always an array — the backend coerces a nil history to `[]` so
 * the SPA can map over it unconditionally.
 */
export interface PollingDecisionsResponse {
  vin?: string
  decisions: PollDecision[]
}

/**
 * `GET /polling/predictions` with no `vin`: a map of VIN → latest prediction for
 * every vehicle that currently has one. `predictions` is `null` when the engine
 * is disabled.
 */
export interface PollingPredictionsMap {
  predictions: Record<string, PredictionInfo> | null
}

/**
 * `GET /polling/predictions?vin=…`: the single vehicle's latest prediction. Note
 * the field is `prediction` (singular) and may be `null` when the VIN is unknown
 * or has not produced a decision yet — this differs from the map form above,
 * which is why the two are modelled as a union rather than one shape.
 */
export interface PollingPredictionForVin {
  vin: string
  prediction: PredictionInfo | null
}

/** Union of the two distinct `GET /polling/predictions` response shapes. */
export type PollingPredictionsResponse = PollingPredictionsMap | PollingPredictionForVin

/** Fetches engine on/off state and live per-vehicle polling status. */
export const getPollingStatus = () => request<PollEngineStatus>('/polling/status')

/**
 * Fetches recent scheduling decisions for one vehicle, newest first.
 *
 * `limit` is normalised to a positive integer before it hits the wire: any
 * non-integer, zero, or negative value falls back to the default of 50,
 * mirroring the backend's own clamp so the emitted URL never carries a
 * meaningless `limit=NaN` / `limit=-1`.
 */
export const getPollingDecisions = (vin: string, limit = 50) => {
  const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 50
  return request<PollingDecisionsResponse>(
    `/polling/decisions?vin=${encodeURIComponent(vin)}&limit=${safeLimit}`,
  )
}

/** Fetches the cost/quota savings snapshot for the whole fleet. */
export const getPollingSavings = () => request<CostSnapshot>('/polling/savings')

/**
 * Fetches state predictions. With no `vin` (or an empty one) the engine returns
 * a VIN → prediction map ({@link PollingPredictionsMap}); with a `vin` it
 * returns that vehicle's single prediction ({@link PollingPredictionForVin}).
 */
export const getPollingPredictions = (vin?: string) =>
  request<PollingPredictionsResponse>(
    `/polling/predictions${vin ? `?vin=${encodeURIComponent(vin)}` : ''}`,
  )
