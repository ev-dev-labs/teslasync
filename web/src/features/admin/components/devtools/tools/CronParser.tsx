import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Timer } from 'lucide-react'
import { Input, Button, Badge } from '@/components/ui'
import { ToolCard } from '../ToolCard'
import { describeCron, getNextCronRuns } from '../helpers'
import { formatDateTime } from '@/lib/dateFormat'

export function CronParserTool() {
  const { t } = useTranslation()
  const [expr, setExpr] = useState('')

  const parts = useMemo(() => expr.trim().split(/\s+/), [expr])
  const description = useMemo(() => (parts.length === 5 ? describeCron(parts) : ''), [parts])
  const nextRuns = useMemo(() => (parts.length === 5 ? getNextCronRuns(parts, 5) : []), [parts])

  const presets = [
    { label: t('Every Minute'), value: '* * * * *' },
    { label: t('Every Hour'), value: '0 * * * *' },
    { label: t('Every Day'), value: '0 0 * * *' },
    { label: t('Every Week'), value: '0 0 * * 0' },
    { label: t('Every Month'), value: '0 0 1 * *' },
  ]

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
            <Button key={p.value} variant="ghost" size="sm" onClick={() => setExpr(p.value)}>
              {p.label}
            </Button>
          ))}
        </div>
        {description && (
          <div className="rounded bg-black/20 px-3 py-2">
            <span className="text-xs text-white/50">{t('Description')}</span>
            <p className="text-sm text-neon-green">{description}</p>
          </div>
        )}
        {nextRuns.length > 0 && (
          <div className="space-y-1">
            <span className="text-xs text-white/50">{t('Next Runs')}</span>
            {nextRuns.map((d, i) => (
              <div key={i} className="flex items-center gap-2 rounded bg-black/20 px-3 py-1">
                <Badge variant="info" size="sm">{i + 1}</Badge>
                <span className="text-xs font-mono text-white/70">{formatDateTime(d)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </ToolCard>
  )
}
