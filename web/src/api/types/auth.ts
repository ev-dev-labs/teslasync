// AUTO-SPLIT from web/src/api/types.ts (P2 #3).
// See @/api/types barrel for the public re-export surface.

// === Auth Session Info (Phase 46 / Prompt 05) ===

/**
 * Snapshot of the upstream ForwardAuth session, returned by
 * `GET /api/v1/auth/session`. The endpoint is mounted OUTSIDE the
 * /api/v1 ForwardAuth subrouter and ALWAYS responds 200 OK so the
 * SPA's polling hook never trips the hard-401 path on itself.
 *
 * `mode === 'open'` indicates the deployment has FORWARD_AUTH_HEADER
 * unset — there is no auth proxy and therefore no session to expire.
 * The {@link useSessionMonitor} hook short-circuits all expiry logic
 * in this branch.
 *
 * `expires_at` is the RFC3339 timestamp the upstream proxy reports for
 * cookie expiry; null when the proxy doesn't expose it. `expires_in`
 * is the same value pre-computed against the server clock — preferred
 * by the SPA so the countdown is immune to client clock skew.
 */
export interface SessionInfo {
  authenticated: boolean
  mode: 'open' | 'session'
  expires_at: string | null
  expires_in: number | null
  user: { sub: string; email?: string } | null
  renewable: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase-46 / Prompt 08 — In-app feedback widget
// ─────────────────────────────────────────────────────────────────────────────

export type FeedbackCategory = 'bug' | 'feature' | 'other'
export type FeedbackStatus = 'new' | 'triaged' | 'closed'

export interface FeedbackEntry {
  id: number
  created_at: string
  category: FeedbackCategory
  title: string
  body: string
  page_route: string
  user_agent: string
  app_version: string
  user_email: string
  recent_errors: unknown
  console_tail: string
  status: FeedbackStatus
  github_issue_url: string
  submitter_subject: string
  submitter_ip: string
  triaged_at: string | null
  triaged_by: string
}

export interface FeedbackSubmitInput {
  category: FeedbackCategory
  title: string
  body: string
  page_route?: string
  user_agent?: string
  app_version?: string
  user_email?: string
  recent_errors?: unknown
  console_tail?: string
}

export interface FeedbackUpdateInput {
  status?: FeedbackStatus
  github_issue_url?: string
  forward_to_github?: boolean
}

export interface FeedbackListResponse {
  items: FeedbackEntry[]
  total: number
  limit: number
  offset: number
  github_bridge_enabled: boolean
  github_repo?: string
}

// Phase-46 / Prompt 35 — per-user TOTP enrollment.
//
// Status response from GET /api/v1/auth/totp. The discriminator is
// `mode`: `'open'` means the install runs without a forward-auth
// header so per-user TOTP cannot be wired (the SPA renders an inline
// "feature requires authenticated mode" placeholder). `'session'` means
// per-user TOTP is available; `activated` then gates between
// "Enrolled" and "Not enrolled" pills.
export type TOTPStatus =
  | { mode: 'open' }
  | {
      mode: 'session'
      activated: boolean
      last_used_at?: string
      backup_codes_remaining: number
    }

// Returned by POST /api/v1/auth/totp/enroll. The plain-text backup
// codes are returned exactly once — re-enrolling generates a fresh
// set. The SPA must surface a copy/download step before the user
// closes the modal.
export interface TOTPEnrollment {
  secret: string
  otpauth_uri: string
  qr_data_uri: string
  backup_codes: string[]
  expires_at: string
}

// Returned by POST /api/v1/auth/totp/sudo. Same shape as the password
// reauth response from prompt 31 so the SPA's reauth interceptor can
// consume it without a discriminator.
export interface TOTPSudoToken {
  mode: 'session'
  sudo_token: string
  expires_at: string
}

// Returned by POST /api/v1/auth/totp/backup-codes/regenerate. Just a
// fresh set of plain-text codes — the secret itself is unchanged.
export interface TOTPBackupCodesResponse {
  backup_codes: string[]
}

// Phase-46 / Prompt 42 — Active sessions / device management.
//
// One row per TeslaSync-issued device cookie binding. Provider-agnostic:
// TeslaSync mints its OWN cookie and persists the binding here, so
// revoking a row only invalidates this app's session — the upstream
// IdP cookie/session is untouched.
//
// Keys are snake_case to mirror the rest of the API surface; the
// camelCaseKeys transformer exposes both forms for SPA consumers.
export interface ActiveSession {
  id: string
  user_agent: string
  ip: string
  created_at: string
  last_seen_at: string
  revoked_at?: string
  current: boolean
}

// GET /api/v1/auth/sessions response shape. The discriminator is
// `mode`: `'open'` means the install runs without a forward-auth
// header so per-device sessions cannot be tracked (the SPA renders
// an inline placeholder); `'session'` carries the active rows.
export type ActiveSessionsResponse =
  | { mode: 'open' }
  | { mode: 'session'; sessions: ActiveSession[] }

// DELETE /api/v1/auth/sessions/all-others response shape.
export interface RevokeAllOthersResponse {
  mode: 'session'
  revoked: number
}
