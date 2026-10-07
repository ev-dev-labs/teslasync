import { cn } from '@/lib/cn'
import { typography } from '@/lib/tokens'
import type { Severity } from './types'

export const fieldLabelCls = cn('mb-1 block', typography.role.label)
export const fieldLabelRowCls = cn('mb-1 flex items-center gap-1', typography.role.label)

// Must match alertSeverityRank in internal/api/alert_handler_rules.go.
export const SEVERITY_RANK: Record<Severity, number> = { info: 1, warn: 2, critical: 3 }

export function templateKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
}

export function valueToInput(value: number | null | undefined): string {
  return value == null ? '' : String(value)
}

export function parseOptionalNumber(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

// Invalid caps never become a wire value the backend rejects.
export function parseOptionalMaxFires(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

export function normalizeMsgTemplateForSave(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}
