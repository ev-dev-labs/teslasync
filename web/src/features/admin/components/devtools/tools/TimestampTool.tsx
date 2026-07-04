import { useState, useMemo, useEffect, useCallback } from 'react'
import type { ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Clock, Hash } from 'lucide-react'
import { Input, Button } from '@/components/ui'
import { ToolCard } from '../ToolCard'
import { getRelativeTime } from '../helpers'
import { formatDateTime } from '@/lib/dateFormat'

/** Result of parsing a user-entered field: a valid Date, or an invalid flag. */
type Parsed = { date: Date | null; invalid: boolean }

/**
 * Parse a Unix-timestamp string into a Date, or null when it isn't a
 * well-formed integer.
 *
 * `parseInt` is deliberately avoided here: it silently accepts trailing
 * garbage ("170abc" → 170) and — combined with the seconds-vs-milliseconds
 * length heuristic — untrimmed leading whitespace (" 1700000000") would tip a
 * 10-digit seconds value into the milliseconds branch and render a
 * confidently-wrong 1970 date. Trimming plus a strict integer test keeps the
 * heuristic honest and lets the caller surface malformed input as an error
 * instead of a plausible-looking lie.
 */
function parseUnix(raw: string): Date | null {
  const trimmed = raw.trim()
  if (!/^-?\d+$/.test(trimmed)) return null
  const value = Number(trimmed)
  if (!Number.isFinite(value)) return null
  // 11+ digits ⇒ the value is already in milliseconds; 10 or fewer ⇒ seconds.
  const digits = trimmed.replace('-', '').length
  const date = new Date(digits > 10 ? value : value * 1000)
  return Number.isNaN(date.getTime()) ? null : date
}

/** Parse an ISO-8601 string into a Date, or null when unparseable. */
function parseIso(raw: string): Date | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const date = new Date(trimmed)
  return Number.isNaN(date.getTime()) ? null : date
}

/** A single `label: value` conversion row, shared by both columns. */
function ConversionRow({ label, value }: { label: string; value: string }) {
  return (
    <p className="text-xs text-[var(--text-secondary)]">
      {label}: <span className="font-mono text-cyan-300">{value}</span>
    </p>
  )
}

export function TimestampTool() {
  const { t } = useTranslation()
  const [unix, setUnix] = useState('')
  const [iso, setIso] = useState('')
  const [now, setNow] = useState<Date>(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const fromUnix = useMemo<Parsed>(() => {
    if (!unix.trim()) return { date: null, invalid: false }
    const date = parseUnix(unix)
    return { date, invalid: date === null }
  }, [unix])

  const fromIso = useMemo<Parsed>(() => {
    if (!iso.trim()) return { date: null, invalid: false }
    const date = parseIso(iso)
    return { date, invalid: date === null }
  }, [iso])

  const handleUnixChange = useCallback((e: ChangeEvent<HTMLInputElement>) => setUnix(e.target.value), [])
  const handleIsoChange = useCallback((e: ChangeEvent<HTMLInputElement>) => setIso(e.target.value), [])
  const handleNow = useCallback(() => {
    const d = new Date()
    setUnix(String(Math.floor(d.getTime() / 1000)))
    setIso(d.toISOString())
  }, [])

  const nowUnix = Math.floor(now.getTime() / 1000)
  const nowIso = now.toISOString()

  const isoLabel = t('devtools.utils.timestampIso', 'ISO')
  const localLabel = t('devtools.utils.timestampLocal', 'Local')
  const relativeLabel = t('devtools.utils.timestampRelative', 'Relative')
  const unixLabel = t('devtools.utils.timestampUnix', 'Unix')

  return (
    <ToolCard
      icon={Clock}
      color="green"
      title={t('devtools.utils.timestamp', 'Timestamp')}
      description={t('devtools.utils.timestampDesc', 'Convert between Unix and ISO 8601 timestamps')}
    >
      <div className="space-y-3">
        <div
          className="flex items-center gap-2 rounded bg-[var(--surface-overlay)] px-3 py-2"
          role="group"
          aria-label={t('devtools.utils.timestampCurrent', 'Current time')}
        >
          <Clock className="h-4 w-4 text-neon-green" aria-hidden="true" />
          <div className="text-sm">
            <span className="font-mono text-[var(--text-primary)]">{nowUnix}</span>
            <span className="mx-2 text-[var(--text-muted)]" aria-hidden="true">|</span>
            <span className="font-mono text-[var(--text-secondary)]">{nowIso}</span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleNow}
            title={t('devtools.utils.timestampUseNow', 'Fill inputs with the current time')}
          >
            {t('devtools.utils.timestampNow', 'Now')}
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Input
              label={t('devtools.utils.timestampUnixLabel', 'Unix Timestamp')}
              placeholder="1700000000"
              value={unix}
              onChange={handleUnixChange}
              icon={<Hash className="h-4 w-4" aria-hidden="true" />}
              inputMode="numeric"
            />
            {fromUnix.date && (
              <div className="mt-1 space-y-0.5">
                <ConversionRow label={isoLabel} value={fromUnix.date.toISOString()} />
                <ConversionRow label={localLabel} value={formatDateTime(fromUnix.date)} />
                <ConversionRow label={relativeLabel} value={getRelativeTime(fromUnix.date)} />
              </div>
            )}
            {fromUnix.invalid && (
              <p role="alert" className="mt-1 text-xs text-rose-300">
                {t('devtools.utils.timestampInvalidUnix', 'Enter a valid Unix timestamp')}
              </p>
            )}
          </div>
          <div>
            <Input
              label={t('devtools.utils.timestampIsoLabel', 'ISO Timestamp')}
              placeholder="2024-01-01T00:00:00Z"
              value={iso}
              onChange={handleIsoChange}
              icon={<Clock className="h-4 w-4" aria-hidden="true" />}
            />
            {fromIso.date && (
              <div className="mt-1 space-y-0.5">
                <ConversionRow label={unixLabel} value={String(Math.floor(fromIso.date.getTime() / 1000))} />
                <ConversionRow label={localLabel} value={formatDateTime(fromIso.date)} />
                <ConversionRow label={relativeLabel} value={getRelativeTime(fromIso.date)} />
              </div>
            )}
            {fromIso.invalid && (
              <p role="alert" className="mt-1 text-xs text-rose-300">
                {t('devtools.utils.timestampInvalidIso', 'Enter a valid ISO 8601 timestamp')}
              </p>
            )}
          </div>
        </div>
      </div>
    </ToolCard>
  )
}
