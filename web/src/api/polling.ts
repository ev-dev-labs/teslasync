import { request } from '@/api/client'

export interface PollEngineStatus {
  enabled: boolean
  vehicles: Record<string, VehiclePollingStatus>
}

export interface VehiclePollingStatus {
  activity: string
  profile: string
  consec_idle: number
  last_poll_time: string
  next_poll_after: string
  battery_level: number
  last_decision: PollDecision | null
}

export interface PollDecision {
  should_poll: boolean
  next_interval_ms: number
  activity: number
  profile: string
  reasons: string[]
  cost_saved: number
  prediction: PredictionInfo | null
}

export interface PredictionInfo {
  next_state: string
  estimated_in: number
  confidence: number
  based_on: string
}

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

export const getPollingStatus = () => request<PollEngineStatus>('/polling/status')

export const getPollingDecisions = (vin: string, limit = 50) =>
  request<{ vin: string; decisions: PollDecision[] }>(
    `/polling/decisions?vin=${encodeURIComponent(vin)}&limit=${limit}`,
  )

export const getPollingSavings = () => request<CostSnapshot>('/polling/savings')

export const getPollingPredictions = (vin?: string) =>
  request<{ predictions: Record<string, PredictionInfo> | PredictionInfo | null }>(
    `/polling/predictions${vin ? `?vin=${encodeURIComponent(vin)}` : ''}`,
  )
