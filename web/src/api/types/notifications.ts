// AUTO-SPLIT from web/src/api/types.ts (P2 #3).
// See @/api/types barrel for the public re-export surface.

import type { VehicleState } from './core'
import { resolveStyle, VEHICLE_STATE_ENTRIES, VEHICLE_STATES } from '@/types/fsm'
import type { BadgeVariant, VehicleState as _VehicleState } from '@/types/fsm'

// === Notification Types ===

export type {
  NotificationChannel,
  NotificationChannelKind,
  NotificationChannelBase,
  NotificationChannelDiscord,
  NotificationChannelSlack,
  NotificationChannelTelegram,
  NotificationChannelEmail,
  NotificationChannelWebhook,
  NotificationChannelNtfy,
  NotificationChannelPushover,
} from '@/types/notifications'

// Phase-46 / Prompt 37 — webhook channel test endpoint result.
//
// Mirrors `webhookTestResponse` in
// internal/api/notification_channel_handler.go. The handler returns
// the SAME shape on transport-level failures (`status_code === 0`,
// `error` populated) and HTTP-level failures (`status_code >= 400`,
// `success === false`), so the UI renders both cases uniformly.
export interface WebhookTestResult {
  success: boolean
  status_code: number
  latency_ms: number
  body_preview?: string
  truncated?: boolean
  signature?: string
  error?: string
}

// Phase-46 / Prompt 37 — request shape for the signature preview
// utility endpoint. `body` is the verbatim bytes the receiver would
// HMAC-validate; the server signs them with `secret` and returns the
// resulting `sha256=<hex>` value.
export interface WebhookSignaturePreviewRequest {
  secret: string
  body: string
}

// Phase-46 / Prompt 37 — preview-signature endpoint response. Always
// non-empty when the request validated (empty `secret` is rejected
// with 400 server-side, never echoed back as an empty signature).
export interface WebhookSignaturePreviewResult {
  signature: string
}

export interface NotificationLog {
  id: number
  channel_id: number
  alert_id: number | null
  title: string
  message: string
  status: 'pending' | 'sent' | 'failed' | 'deferred_dnd'
  severity?: string
  error: string
  created_at: string
  sent_at: string | null
  scheduled_at?: string
  latency_ms?: number
  read_at?: string | null
  archived_at?: string | null
}

// Phase-46 / Prompt 27 — server-aggregated notification "thread".
//
// A group represents repeated deliveries of the same alert rule + severity
// (the canonical key is `sha256(alert_rule_id + "|" + severity_lc)`).
// Singleton rows — anything without a derivable group_key (NULL alert_id,
// blank severity, or fully ad-hoc notifications) — are returned as
// one-row groups with `group_key = null`.
//
// `count` and `unread_count` reflect the FILTERED subset that was sent
// to /notifications/logs?grouped=true; e.g. `read=false` makes
// `count == unread_count`. The frontend should render the count chip
// without implying it's a global tally.
//
// `vehicle_ids` is `array_remove(array_agg(DISTINCT alert_rules.vehicle_id), NULL)`
// so it can be empty when every member belonged to a vehicle-less rule.
//
// Members are NOT inlined — clients fetch them on expand via
// /notifications/logs?group_key=<group_key>&view=flat.
export interface NotificationLogGroup {
  group_key: string | null
  latest: NotificationLog
  count: number
  unread_count: number
  vehicle_ids: number[]
}

// Phase-46 / Prompt 19 — Do-Not-Disturb / quiet hours window.
// Server-backed CRUD lives at /api/v1/notifications/quiet-hours.
// Times are local-clock HH:MM strings, evaluated against `timezone`
// (IANA name); `weekdays` is a 7-bit mask Sun=1..Sat=64.
// `bypass_severities` is the allow-list that escapes DND.
export interface QuietHoursWindow {
  id: number
  user_id: string
  enabled: boolean
  start_local: string
  end_local: string
  timezone: string
  weekdays: number
  bypass_severities: string[]
  created_at: string
  updated_at: string
}

// Patch payload for POST/PATCH against the quiet-hours endpoints. All
// fields optional so the same body shape works for create and partial
// update.
export interface QuietHoursWindowInput {
  enabled?: boolean
  start_local?: string
  end_local?: string
  timezone?: string
  weekdays?: number
  bypass_severities?: string[]
}

export interface NotificationStats {
  total_sent: number
  sent: number
  failed: number
  pending: number
  total_channels: number
  enabled_channels: number
}

// === Worker Health Types ===

export interface WorkerStatus {
  name: string
  host: string
  status: 'healthy' | 'unhealthy' | 'down'
  latency_ms: number
  error?: string
}

export interface WorkersHealth {
  workers: WorkerStatus[]
  total: number
  healthy_count: number
}

// === Chatbot Types ===

export interface ChatMessage {
  id: number
  session_id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

export interface ChatResponse {
  response: string
  session_id: string
}

/**
 * Per-session metadata used to render the chatbot sidebar (Phase 40 / Prompt 56).
 * `title` is null when the user hasn't renamed the session — the UI then
 * falls back to `first_message`.
 */
export interface ChatSessionInfo {
  id: string
  title: string | null
  first_message: string | null
  message_count: number
  last_message_at: string | null
  created_at: string | null
}

export type { BadgeVariant } from '@/types/fsm'
/* ── Vehicle status — single source from @/types/fsm ── */

export type VehicleStatus = _VehicleState
export const VEHICLE_STATUSES = VEHICLE_STATES as unknown as VehicleStatus[]

/** Derives a display-friendly status from live vehicle state. */
export function deriveVehicleStatus(state?: VehicleState | null): VehicleStatus {
  if (!state) return 'offline'
  if (state.is_charging) return 'charging'
  if (state.speed && state.speed > 0) return 'driving'
  const s = (state.state ?? '').toLowerCase()
  if ((VEHICLE_STATES as readonly string[]).includes(s)) return s as VehicleStatus
  return 'online'
}

/** Maps VehicleStatus → badge variant. */
export function statusVariant(status: VehicleStatus | string): BadgeVariant {
  const entry = VEHICLE_STATE_ENTRIES[status as _VehicleState]
  return entry?.variant ?? 'danger'
}

/** Maps VehicleStatus → Tailwind badge dot color class. */
export function statusDotColor(status: VehicleStatus | string): string {
  const entry = VEHICLE_STATE_ENTRIES[status as _VehicleState]
  if (!entry) return 'bg-gray-400'
  return resolveStyle(entry).badgeDot
}

// === Notification Scheduling ===

export interface NotificationSchedule {
  id: number
  channel_id: number
  title: string
  message: string
  cron_expr: string | null
  scheduled_at: string | null
  last_run_at: string | null
  next_run_at: string | null
  enabled: boolean
  created_at: string
}

// === Notification Preferences ===

export interface NotificationPreference {
  id: number
  channel_id: number
  event_type: string
  enabled: boolean
}

// === Notification Analytics ===

export interface NotificationAnalytics {
  total_sent: number
  total_failed: number
  delivery_rate: number
  avg_latency_ms: number
  active_channels: number
  period_days: number
}

export interface NotificationMetric {
  id: number
  channel_id: number
  date: string
  total_sent: number
  total_failed: number
  avg_latency_ms: number
}
