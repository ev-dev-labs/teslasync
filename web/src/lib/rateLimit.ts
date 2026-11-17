import { broadcast, subscribe } from './broadcast'
import { retryAfterSeconds } from './retryAfter'

export interface RateLimitPolicy {
  bucket: string
  scope: string
  methods: string
  source: 'teslasync' | 'tesla' | 'unknown'
  enforcement: 'process' | 'upstream' | 'shared' | 'unknown'
}

export interface RateLimitNotice extends RateLimitPolicy {
  expiresAt: number
  retryAfterSec: number
  requestMethod: string
  generation?: number
}

interface Quota extends RateLimitPolicy {
  requestMethod: string
  expiresAt: number
  recoveryUntil: number
  nextReadAt: number
  strikes: number
  remaining?: number
  limit?: number
  resetAt?: number
}

const MAX_QUOTAS = 256
const MAX_WAITING_READS = 32
const MAX_READ_WAIT_MS = 5_000
const RECOVERY_MS = 30_000
const quotas = new Map<string, Quota>()
const peerCooldowns = new Map<string, number>()
let contextKey = ''
let generation = 0
let waitingReads = 0
let unsubscribe: (() => void) | undefined

export function isSafeRead(method: string): boolean {
  return ['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())
}

function boundedSet<T>(map: Map<string, T>, key: string, value: T): void {
  if (!map.has(key) && map.size >= MAX_QUOTAS) map.delete(map.keys().next().value!)
  map.set(key, value)
}

function rememberQuota(quota: Quota): void {
  const now = Date.now()
  for (const [key, existing] of quotas) {
    if (existing.expiresAt <= now && existing.recoveryUntil <= now &&
        (quotas.size >= MAX_QUOTAS || existing.source === 'unknown')) quotas.delete(key)
  }
  if (!quotas.has(quota.bucket) && quotas.size >= MAX_QUOTAS) {
    const advisory = [...quotas].find(([, existing]) => existing.expiresAt <= now)
    if (advisory) quotas.delete(advisory[0])
    else if (quota.expiresAt <= now) return
  }
  // Advisory learning is capped; live server deadlines are never evicted.
  quotas.set(quota.bucket, quota)
}

function emit(quota: Quota, requestMethod = 'GET'): RateLimitNotice {
  const notice = noticeFor(quota, requestMethod)
  if (typeof document !== 'undefined') {
    document.dispatchEvent(new CustomEvent('teslasync:rate-limited', { detail: notice }))
  }
  return notice
}

function noticeFor(quota: Quota, requestMethod: string): RateLimitNotice {
  return {
    bucket: quota.bucket, scope: quota.scope, methods: quota.methods,
    source: quota.source, enforcement: quota.enforcement,
    expiresAt: quota.expiresAt,
    retryAfterSec: Math.max(0, Math.ceil((quota.expiresAt - Date.now()) / 1000)),
    requestMethod, generation,
  }
}

function listen(): void {
  unsubscribe ??= subscribe((message) => {
    if (message.type === 'auth.logout') {
      resetRateLimits()
      return
    }
    if (message.type !== 'rateLimit.cooldown' ||
        !/^[a-f0-9]{32}$/.test(message.bucket) ||
        !Number.isFinite(message.expiresAt) ||
        message.expiresAt <= Date.now() ||
        message.expiresAt > Date.now() + 7 * 86_400_000) return
    // Only opaque server-issued buckets cross tabs. A peer can affect requests
    // only after this tab independently learns the same identity-bound bucket.
    boundedSet(peerCooldowns, message.bucket, Math.max(
      peerCooldowns.get(message.bucket) ?? 0, message.expiresAt,
    ))
    const quota = quotas.get(message.bucket)
    if (quota && message.expiresAt > quota.expiresAt) {
      quota.expiresAt = message.expiresAt
      quota.recoveryUntil = quota.expiresAt + RECOVERY_MS
      quota.strikes = Math.min(4, quota.strikes + 1)
      emit(quota, quota.requestMethod)
    }
  })
}

/** Credentials stay in memory and never enter a broadcast or persistent cache. */
export function rateLimitContext(url: string, headers?: HeadersInit): number {
  const origin = new URL(url, typeof window === 'undefined' ? 'http://localhost' : window.location.href).origin
  const key = `${origin}\x00${new Headers(headers).get('Authorization') ?? ''}`
  if (key !== contextKey) {
    resetRateLimits()
    contextKey = key
  }
  listen()
  return generation
}

export function isRateLimitContextCurrent(context: number): boolean {
  return context === generation
}

function matches(quota: RateLimitPolicy, path: string, method: string): boolean {
  if (quota.methods !== '*' && quota.methods !== method &&
      !(quota.methods === 'WRITE' && !isSafeRead(method))) return false
  const parts = path.split(/[?#]/, 1)[0].split('/')
  return quota.scope.split(' ').some((scope) => {
    const pattern = scope.split('/')
    for (let i = 0; i < pattern.length; i++) {
      if (pattern[i] === '*') return true
      if (parts[i] == null) return false
      if (/^\{[^/{}]+\}$/.test(pattern[i])) {
        if (parts[i] === '') return false
      } else if (pattern[i] !== parts[i]) return false
    }
    return parts.length === pattern.length
  })
}

export function rateLimitFor(path: string, method = 'GET'): RateLimitNotice | undefined {
  let latest: Quota | undefined
  for (const quota of quotas.values()) {
    if (quota.expiresAt > Date.now() && matches(quota, path, method.toUpperCase()) &&
        (!latest || quota.expiresAt > latest.expiresAt)) latest = quota
  }
  return latest ? noticeFor(latest, method.toUpperCase()) : undefined
}

export function activeRateLimitNotices(): RateLimitNotice[] {
  return [...quotas.values()].filter((quota) => quota.expiresAt > Date.now())
    .map((quota) => noticeFor(quota, quota.requestMethod))
}

function headerPolicy(headers: Headers): RateLimitPolicy | undefined {
  const bucket = headers.get('X-RateLimit-Bucket') ?? ''
  const scope = headers.get('X-RateLimit-Scope') ?? ''
  const methods = headers.get('X-RateLimit-Methods') ?? ''
  const source = headers.get('X-RateLimit-Source')
  const enforcement = headers.get('X-RateLimit-Enforcement')
  if (!/^[a-f0-9]{32}$/.test(bucket) || scope.length > 1024 ||
      /[?#\\\r\n\t]/.test(scope) || !scope.split(' ').every((entry) => entry.startsWith('/') &&
        !entry.split('/').some((part, index, parts) => part.includes('*') && (part !== '*' || index !== parts.length - 1))) ||
      !/^(?:\*|WRITE|GET|HEAD|OPTIONS|POST|PUT|PATCH|DELETE)$/.test(methods) ||
      !['teslasync', 'tesla'].includes(source ?? '') ||
      !['process', 'upstream', 'shared'].includes(enforcement ?? '')) return undefined
  return { bucket, scope, methods, source, enforcement } as RateLimitPolicy
}

function finiteHeader(headers: Headers, name: string): number | undefined {
  const value = headers.get(name)
  if (value == null || !/^\d+$/.test(value)) return undefined
  const n = Number(value)
  return Number.isSafeInteger(n) ? n : undefined
}

function clearRecoveredQuotas(path: string, method: string): void {
  for (const quota of quotas.values()) {
    if (quota.expiresAt <= 0 || quota.expiresAt > Date.now() || !matches(quota, path, method)) continue
    quota.expiresAt = 0
    quota.strikes = Math.max(0, quota.strikes - 1)
    if (typeof document !== 'undefined') {
      document.dispatchEvent(new CustomEvent('teslasync:rate-limit-cleared', { detail: { bucket: quota.bucket } }))
    }
  }
}

export function observeRateLimit(
  response: Response,
  path: string,
  method: string,
  context: number,
): RateLimitNotice | undefined {
  if (!isRateLimitContextCurrent(context)) return undefined
  method = method.toUpperCase()
  if (response.ok) clearRecoveredQuotas(path, method)
  const advertised = headerPolicy(response.headers)
  const policy = advertised && matches(advertised, path, method) ? advertised : undefined
  const limited = response.status === 429
  const authoritative = policy && (!limited || response.headers.get('X-RateLimit-Limited') === 'true')
  if (!authoritative && !limited) return undefined
  const fallback: RateLimitPolicy = {
    bucket: `${method} ${path.split(/[?#]/, 1)[0]}`,
    scope: path.split(/[?#]/, 1)[0], methods: method, source: 'unknown', enforcement: 'unknown',
  }
  const chosen = authoritative ? policy : fallback
  const quota: Quota = quotas.get(chosen.bucket) ?? {
    ...chosen, requestMethod: method, expiresAt: 0, recoveryUntil: 0, nextReadAt: 0, strikes: 0,
  }
  const peerExpiry = peerCooldowns.get(quota.bucket) ?? 0
  let learnedPeer = false
  if (peerExpiry > Math.max(quota.expiresAt, Date.now())) {
    quota.expiresAt = peerExpiry
    quota.recoveryUntil = peerExpiry + RECOVERY_MS
    learnedPeer = true
  }
  if (peerExpiry <= Date.now()) peerCooldowns.delete(quota.bucket)
  if (limited) {
    quota.requestMethod = method
    quota.strikes = Math.min(4, quota.strikes + 1)
    const seconds = retryAfterSeconds(response.headers.get('Retry-After'), response.headers.get('Date'))
    quota.expiresAt = Math.max(quota.expiresAt, Date.now() + seconds * 1000)
    quota.recoveryUntil = quota.expiresAt + RECOVERY_MS * quota.strikes
    rememberQuota(quota)
    if (authoritative) broadcast({ type: 'rateLimit.cooldown', bucket: quota.bucket, expiresAt: quota.expiresAt })
    return emit(quota, method)
  }
  rememberQuota(quota)
  if (learnedPeer) emit(quota, method)
  if (response.ok) {
    const limit = finiteHeader(response.headers, 'X-RateLimit-Limit')
    const remaining = finiteHeader(response.headers, 'X-RateLimit-Remaining')
    const reset = finiteHeader(response.headers, 'X-RateLimit-Reset')
    const date = Date.parse(response.headers.get('Date') ?? '')
    const resetAt = reset == null ? undefined
      : Date.now() + Math.max(0, reset * 1000 - (Number.isFinite(date) ? date : Date.now()))
    if (limit && remaining != null && remaining <= limit && resetAt != null &&
        Number.isSafeInteger(resetAt) && resetAt >= (quota.resetAt ?? 0) - 1000) {
      const sameWindow = quota.resetAt != null && Math.abs(resetAt - quota.resetAt) <= 1000
      quota.limit = limit
      quota.remaining = sameWindow ? Math.min(remaining, quota.remaining ?? remaining) : remaining
      quota.resetAt = resetAt
    }
  }
  return undefined
}

/** Only reads wait, and only for a bounded recovery/pacing slot. Writes never queue. */
export function reserveRateLimitRead(
  path: string, method: string, priority?: RequestPriority,
): { waitMs: number; release: () => void; deferred?: RateLimitNotice } {
  const now = Date.now()
  method = method.toUpperCase()
  const applicable = [...quotas.values()].filter((quota) => matches(quota, path, method))
  const idle = { waitMs: 0, release: () => undefined }
  if (!isSafeRead(method) || priority === 'high' || applicable.length === 0) return idle
  let startAt = now
  let latest: Quota | undefined
  const planned: { quota: Quota; spacing: number }[] = []
  for (const quota of applicable) {
    let spacing = 0
    if (quota.recoveryUntil > now) spacing = 150 * Math.max(1, quota.strikes) + Math.random() * 350
    if (quota.limit && quota.remaining != null && quota.remaining / quota.limit <= 0.2 &&
        quota.resetAt != null && quota.resetAt > now) {
      spacing = Math.max(spacing, Math.min(MAX_READ_WAIT_MS, (quota.resetAt - now) / Math.max(1, quota.remaining)))
    }
    if (spacing === 0) continue
    startAt = Math.max(startAt, quota.nextReadAt)
    planned.push({ quota, spacing })
    latest = quota
  }
  const waitMs = Math.ceil(startAt - now)
  if (waitMs > MAX_READ_WAIT_MS || (waitMs > 0 && waitingReads >= MAX_WAITING_READS)) {
    return {
      ...idle,
      deferred: latest ? { ...noticeFor(latest, method), expiresAt: now + Math.min(waitMs, MAX_READ_WAIT_MS),
        retryAfterSec: Math.ceil(Math.min(waitMs, MAX_READ_WAIT_MS) / 1000) } : undefined,
    }
  }
  for (const { quota, spacing } of planned) quota.nextReadAt = startAt + spacing
  if (waitMs === 0) return idle
  waitingReads++
  const reservedGeneration = generation
  let released = false
  return {
    waitMs,
    release: () => {
      if (!released && reservedGeneration === generation) waitingReads = Math.max(0, waitingReads - 1)
      released = true
    },
  }
}

export function resetRateLimits(): void {
  const hadContext = contextKey !== ''
  quotas.clear()
  peerCooldowns.clear()
  contextKey = ''
  generation++
  waitingReads = 0
  unsubscribe?.()
  unsubscribe = undefined
  if (hadContext && typeof document !== 'undefined') document.dispatchEvent(new Event('teslasync:rate-limits-reset'))
}
