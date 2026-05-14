/**
 * useAiUsage — TanStack Query bindings for the F3 AI usage handler
 * (`/ai/usage/today`, `/ai/usage/by-feature`, `/ai/usage/recent`).
 *
 * Phase-50 / 0004 — F3 AI Call Log + Usage Card.
 *
 * The `__usage__` feature ID is special-cased server-side to gate
 * only on `ai_mode != 'off'` (no per-feature toggle). These hooks
 * therefore stay safe to call even when no AI feature is enabled —
 * the response will be all-zeros / empty when nothing has been
 * audited yet, and a 403 when AI is fully off.
 *
 * Snake_case query parameters are used because the Go handler reads
 * `since=` and `limit=` from `r.URL.Query()` directly. snake_case
 * also matches the rest of the API hook conventions in this folder.
 */

import { useQuery } from '@tanstack/react-query'
import { request } from '../client'
import { INTERVALS } from '@/lib/constants'

// ----------------------------------------------------------------------------
// Response types — mirror Go DTOs in internal/api/ai_usage_handler.go and
// internal/database/ai_call_log_repo.go.
// ----------------------------------------------------------------------------

/** Aggregate of the calling user's AI calls today (UTC day bucket). */
export interface AiUsageToday {
  user_subject: string
  call_count: number
  input_tokens: number
  output_tokens: number
  cost_micro_cents: number
  error_count: number
  /** Average latency in milliseconds across all calls in the bucket. */
  avg_latency_ms: number
}

/** One feature row returned by /ai/usage/by-feature. */
export interface AiUsageFeatureRow {
  feature_id: string
  call_count: number
  input_tokens: number
  output_tokens: number
  cost_micro_cents: number
  error_count: number
  avg_latency_ms: number
}

export interface AiUsageByFeatureResponse {
  /** ISO-8601 UTC timestamp marking the inclusive lower bound. */
  since: string
  rows: AiUsageFeatureRow[]
}

/** One call row returned by /ai/usage/recent. */
export interface AiUsageRecentRow {
  id: number
  feature_id: string
  provider: string
  model: string
  input_tokens: number
  output_tokens: number
  cost_micro_cents: number
  latency_ms: number
  finish_reason: string
  request_hash: string
  redacted_digest: string
  error: string
  /** ISO-8601 UTC timestamp. */
  started_at: string
  /** ISO-8601 UTC timestamp. */
  finished_at: string
}

export interface AiUsageRecentResponse {
  limit: number
  rows: AiUsageRecentRow[]
}

// ----------------------------------------------------------------------------
// Query keys — namespaced under ['ai', 'usage'] so cache busts after a
// chat / summary / etc. can be done with a single invalidation.
// ----------------------------------------------------------------------------

export const aiUsageKeys = {
  all: ['ai', 'usage'] as const,
  today: () => ['ai', 'usage', 'today'] as const,
  byFeature: (since?: string) => ['ai', 'usage', 'by-feature', since ?? ''] as const,
  recent: (limit?: number) => ['ai', 'usage', 'recent', limit ?? 0] as const,
}

// ----------------------------------------------------------------------------
// Hooks
// ----------------------------------------------------------------------------

/**
 * Aggregate today's AI usage for the calling user. Returns an
 * all-zeros payload when no calls have been audited yet (the
 * decorator + repo both treat absence as zeroes).
 */
export function useAiUsageToday() {
  return useQuery({
    queryKey: aiUsageKeys.today(),
    queryFn: ({ signal }) => request<AiUsageToday>('/ai/usage/today', { signal }),
    refetchInterval: INTERVALS.STANDARD,
  })
}

/**
 * Per-feature aggregate since the given ISO-8601 timestamp. When
 * `since` is omitted the server defaults to the last 7 days.
 */
export function useAiUsageByFeature(since?: string) {
  const path = since
    ? `/ai/usage/by-feature?since=${encodeURIComponent(since)}`
    : '/ai/usage/by-feature'
  return useQuery({
    queryKey: aiUsageKeys.byFeature(since),
    queryFn: ({ signal }) => request<AiUsageByFeatureResponse>(path, { signal }),
    refetchInterval: INTERVALS.STANDARD,
  })
}

/**
 * Most recent AI calls (newest first), capped server-side at 500
 * via `AICallRecentMax` and defaulted to 50.
 */
export function useAiUsageRecent(limit?: number) {
  const path = limit != null ? `/ai/usage/recent?limit=${limit}` : '/ai/usage/recent'
  return useQuery({
    queryKey: aiUsageKeys.recent(limit),
    queryFn: ({ signal }) => request<AiUsageRecentResponse>(path, { signal }),
    refetchInterval: INTERVALS.STANDARD,
  })
}
