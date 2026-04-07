import { getApiBase } from '../lib/resilience'

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

export async function getPollingStatus(): Promise<PollEngineStatus> {
  const res = await fetch(`${getApiBase()}/api/v1/polling/status`)
  if (!res.ok) throw new Error('Failed to fetch polling status')
  return res.json()
}

export async function getPollingDecisions(vin: string, limit = 50): Promise<{ vin: string; decisions: PollDecision[] }> {
  const res = await fetch(`${getApiBase()}/api/v1/polling/decisions?vin=${encodeURIComponent(vin)}&limit=${limit}`)
  if (!res.ok) throw new Error('Failed to fetch polling decisions')
  return res.json()
}

export async function getPollingSavings(): Promise<CostSnapshot> {
  const res = await fetch(`${getApiBase()}/api/v1/polling/savings`)
  if (!res.ok) throw new Error('Failed to fetch polling savings')
  return res.json()
}

export async function getPollingPredictions(vin?: string): Promise<{ predictions: Record<string, PredictionInfo> | PredictionInfo | null }> {
  const url = vin
    ? `${getApiBase()}/api/v1/polling/predictions?vin=${encodeURIComponent(vin)}`
    : `${getApiBase()}/api/v1/polling/predictions`
  const res = await fetch(url)
  if (!res.ok) throw new Error('Failed to fetch polling predictions')
  return res.json()
}
