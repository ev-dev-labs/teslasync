import { useState, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Timer } from 'lucide-react'
import { Input, Button, Badge } from '@/components/ui'
import { ToolCard } from '../ToolCard'
import { describeCron, getNextCronRuns } from '../helpers'
import { formatDateTime } from '@/lib/dateFormat'

const CRON_FIELD_COUNT = 5
const NEXT_RUN_COUNT = 5

export function CronParserTool() {
  const { t } = useTranslation()
  const [expr, setExpr] = useState('')

  const trimmed = expr.trim()
  const parts = useMemo(() => (trimmed === '' ? [] : trimmed.split(/\s+/)), [trimmed])
  const isValid = parts.length === CRON_FIELD_COUNT
  const description = useMemo(() => (isValid ? describeCron(parts) : ''), [isValid, parts])
  const nextRuns = useMemo(
    () => (isValid ? getNextCronRuns(parts, NEXT_RUN_COUNT) : []),
    [isValid, parts],
  )

  const presets = useMemo(
    () => [
      { label: t('Every Minute'), value: '* * * * *' },
      { label: t('Every Hour'), value: '0 * * * *' },
      { label: t('Every Day'), value: '0 0 * * *' },
      { label: t('Every Week'), value: '0 0 * * 0' },
      { label: t('Every Month'), value: '0 0 1 * *' },
    ],
    [t],
  )

  const applyPreset = useCallback((value: string) => setExpr(value), [])

  return (
    <ToolCard icon={Timer} color="green" title={t('Cron Parser')} description={t('Cron Parser Desc')}>
      <div className="space-y-3">
        <Input
          label={t('Cron Expression')}
          placeholder="*/5 * * * *"
          value={expr}
          onChange={(e) => setExpr(e.target.value)}
          icon={<Timer className="h-4 w-4" />}
        />
        <div className="flex flex-wrap gap-1">
          {presets.map((p) => (
            <Button key={p.value} variant="ghost" size="sm" onClick={() => applyPreset(p.value)}>
              {p.label}
            </Button>
          ))}
        </div>

        {trimmed === '' && (
          <p className="text-xs text-[var(--text-secondary)]">
            {t('Enter a cron expression or pick a preset to preview its schedule')}
          </p>
        )}

        {trimmed !== '' && !isValid && (
          <div role="alert" className="rounded bg-[var(--surface-overlay)] px-3 py-2">
            <p className="text-sm text-amber-300">
              {t('Enter all 5 cron fields: minute, hour, day, month, weekday')}
            </p>
          </div>
        )}

        {isValid && (
          <>
            <div className="rounded bg-[var(--surface-overlay)] px-3 py-2">
              <span className="text-xs text-[var(--text-secondary)]">{t('Description')}</span>
              <p className="text-sm text-emerald-300">{description || '—'}</p>
            </div>
            <div className="space-y-1">
              <span className="text-xs text-[var(--text-secondary)]">{t('Next Runs')}</span>
              {nextRuns.length > 0 ? (
                nextRuns.map((d, i) => (
                  <div key={i} className="flex items-center gap-2 rounded bg-[var(--surface-overlay)] px-3 py-1">
                    <Badge variant="info" size="sm">{i + 1}</Badge>
                    <span className="text-xs font-mono text-[var(--text-secondary)]">{formatDateTime(d)}</span>
                  </div>
                ))
              ) : (
                <p className="text-xs text-[var(--text-secondary)]">
                  {t('No upcoming runs in the next year')}
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </ToolCard>
  )
}
