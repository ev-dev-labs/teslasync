import { useState, useMemo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Clock, Hash } from 'lucide-react'
import { Input, Button } from '@/components/ui'
import { ToolCard } from '../ToolCard'
import { getRelativeTime } from '../helpers'
import { formatDateTime } from '@/lib/dateFormat'

export function TimestampTool() {
  const { t } = useTranslation()
  const [unix, setUnix] = useState('')
  const [iso, setIso] = useState('')
  const [now, setNow] = useState<Date>(new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const fromUnix = useMemo(() => {
    if (!unix) return null
    const ms = unix.length > 10 ? parseInt(unix, 10) : parseInt(unix, 10) * 1000
    const d = new Date(ms)
    return isNaN(d.getTime()) ? null : d
  }, [unix])

  const fromIso = useMemo(() => {
    if (!iso) return null
    const d = new Date(iso)
    return isNaN(d.getTime()) ? null : d
  }, [iso])

  return (
    <ToolCard icon={Clock} color="green" title={t('Timestamp')} description={t('Timestamp Desc')}>
      <div className="space-y-3">
        <div className="flex items-center gap-2 rounded bg-black/20 px-3 py-2">
          <Clock className="h-4 w-4 text-neon-green" />
          <div className="text-sm">
            <span className="font-mono text-white">{Math.floor(now.getTime() / 1000)}</span>
            <span className="mx-2 text-white/30">|</span>
            <span className="font-mono text-white/70">{now.toISOString()}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => { setUnix(String(Math.floor(Date.now() / 1000))); setIso(new Date().toISOString()) }}>
            {t('Now')}
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Input
              label={t('Unix Timestamp')}
              placeholder="1700000000"
              value={unix}
              onChange={(e) => setUnix(e.target.value)}
              icon={<Hash className="h-4 w-4" />}
            />
            {fromUnix && (
              <div className="mt-1 space-y-0.5">
                <p className="text-xs text-white/60">{t('Iso')}: <span className="font-mono text-cyan-300">{fromUnix.toISOString()}</span></p>
                <p className="text-xs text-white/60">{t('Local')}: <span className="font-mono text-cyan-300">{formatDateTime(fromUnix)}</span></p>
                <p className="text-xs text-white/60">{t('Relative')}: <span className="font-mono text-cyan-300">{getRelativeTime(fromUnix)}</span></p>
              </div>
            )}
          </div>
          <div>
            <Input
              label={t('Iso Timestamp')}
              placeholder="2024-01-01T00:00:00Z"
              value={iso}
              onChange={(e) => setIso(e.target.value)}
              icon={<Clock className="h-4 w-4" />}
            />
            {fromIso && (
              <div className="mt-1 space-y-0.5">
                <p className="text-xs text-white/60">{t('Unix')}: <span className="font-mono text-cyan-300">{Math.floor(fromIso.getTime() / 1000)}</span></p>
                <p className="text-xs text-white/60">{t('Local')}: <span className="font-mono text-cyan-300">{formatDateTime(fromIso)}</span></p>
                <p className="text-xs text-white/60">{t('Relative')}: <span className="font-mono text-cyan-300">{getRelativeTime(fromIso)}</span></p>
              </div>
            )}
          </div>
        </div>
      </div>
    </ToolCard>
  )
}
