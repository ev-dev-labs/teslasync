import type { TeslaOpaqueObject } from '@/api/types'

export type ManagementEndpointKind =
  | 'options'
  | 'specs'
  | 'warranty'
  | 'subscriptions'
  | 'upgrades'
  | 'roles'
  | 'generic'

export interface ManagementSummaryItem {
  label: 'model' | 'trim' | 'status' | 'expiry' | 'items' | 'fields' | 'roles'
  value: string
}

export type JSONObjectParseResult =
  | { ok: true; value: TeslaOpaqueObject }
  | { ok: false; reason: 'invalid' | 'object_required' | 'empty' }

const SENSITIVE_KEY_PATTERN =
  /token|secret|password|credential|authorization|cookie|api[_-]?key/i

export function isSensitiveManagementKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key)
}

export function managementErrorText(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string' &&
    error.message.trim()
  ) {
    return error.message
  }
  return fallback
}

export function parseNonEmptyJSONObject(source: string): JSONObjectParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(source) as unknown
  } catch {
    return { ok: false, reason: 'invalid' }
  }

  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'object_required' }
  }
  const value = parsed as TeslaOpaqueObject
  if (Object.keys(value).length === 0) {
    return { ok: false, reason: 'empty' }
  }
  return { ok: true, value }
}

function scalar(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim() !== '') return value
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
    if (typeof value === 'boolean') return value ? 'true' : 'false'
  }
  return null
}

function arrayLength(record: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = record[key]
    if (Array.isArray(value)) return value.length
  }
  return null
}

export function summarizeManagementData(
  data: Record<string, unknown> | null | undefined,
  kind: ManagementEndpointKind,
): ManagementSummaryItem[] {
  if (!data) return []

  const summary: ManagementSummaryItem[] = []
  if (kind === 'specs') {
    const model = scalar(data, ['model', 'car_type'])
    const trim = scalar(data, ['trim', 'trim_badging'])
    if (model) summary.push({ label: 'model', value: model })
    if (trim) summary.push({ label: 'trim', value: trim })
  }

  if (kind === 'warranty') {
    const status = scalar(data, ['status', 'warranty_status', 'active', 'in_warranty'])
    const expiry = scalar(data, [
      'warranty_expiry_date',
      'expiry_date',
      'basic_expiry_date',
    ])
    if (status) summary.push({ label: 'status', value: status })
    if (expiry) summary.push({ label: 'expiry', value: expiry })
  }

  if (kind === 'options') {
    const count = arrayLength(data, ['option_codes', 'codes', 'options'])
    if (count != null) summary.push({ label: 'items', value: String(count) })
  }

  if (kind === 'subscriptions' || kind === 'upgrades') {
    const count = arrayLength(data, [kind, 'eligible'])
    const status = scalar(data, ['eligible', 'status'])
    if (count != null) summary.push({ label: 'items', value: String(count) })
    if (status) summary.push({ label: 'status', value: status })
  }

  if (kind === 'roles') {
    const count = arrayLength(data, ['roles'])
    if (count != null) summary.push({ label: 'roles', value: String(count) })
  }

  if (summary.length === 0) {
    summary.push({ label: 'fields', value: String(Object.keys(data).length) })
  }
  return summary.slice(0, 3)
}
