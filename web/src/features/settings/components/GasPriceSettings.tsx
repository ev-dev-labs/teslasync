import { useTranslation } from 'react-i18next'
import {
  useGasPriceStatus, usePollGasPrice,
  useToggleGasPrice, useUpdateGasPriceConfig,
} from '@/api/hooks/useSettings'
import { GlassPanel, Button, Select } from '@/components/ui'
import { FadeIn } from '@/components/motion'
import { useToast } from '@/components/feedback/Toast'
import { cn } from '@/lib/cn'
import { fmtNumber } from '@/lib/numberFormat'
import { formatDateTime } from '@/lib/dateFormat'
import { SettingField } from './SettingField'
import { Fuel, Zap, Play, Pause } from 'lucide-react'

export function GasPriceSettings() {
  const { t } = useTranslation('settings')
  const toast = useToast()
  const { data: gasPriceStatus } = useGasPriceStatus()
  const gasPollMut = usePollGasPrice()
  const gasToggleMut = useToggleGasPrice()
  const gasConfigMut = useUpdateGasPriceConfig()

  return (
    <FadeIn delay={0.12}>
      <GlassPanel className="p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500/10 text-orange-400 ring-1 ring-orange-500/20">
            <Fuel className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">{t('gas.title', 'Gas Price Auto-Poll')}</h2>
            <p className="text-xs text-[var(--text-muted)]">{t('gas.subtitle', 'Automatically fetch US average gas prices from EIA')}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <SettingField label={t('gas.autoPoll', 'Auto-Poll')}>
            <Button
              variant="ghost"
              onClick={() => {
                gasToggleMut.mutate(!gasPriceStatus?.enabled, {
                  onSuccess: () => toast.info(!gasPriceStatus?.enabled ? t('gas.enabled', 'Auto-poll enabled') : t('gas.disabled', 'Auto-poll disabled')),
                })
              }}
              className={cn(
                'flex items-center gap-3 w-full rounded-xl border p-3.5 h-auto transition-all duration-200',
                gasPriceStatus?.enabled
                  ? 'border-neon-green/40 bg-neon-green/5 text-neon-green'
                  : 'border-[var(--glass-border)] bg-[var(--surface-2)] text-[var(--text-muted)]'
              )}
            >
              {gasPriceStatus?.enabled ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
              <span className="text-sm font-medium">{gasPriceStatus?.enabled ? t('gas.running', 'Running') : t('gas.stopped', 'Stopped')}</span>
            </Button>
          </SettingField>

          <Select
            label={t('gas.pollInterval', 'Poll Interval')}
            value={gasPriceStatus?.poll_interval || '7d'}
            onChange={e => gasConfigMut.mutate(e.target.value, { onSuccess: () => toast.info(t('gas.intervalUpdated', 'Poll interval updated')) })}
            options={[
              { value: 'daily', label: t('gas.daily', 'Daily') },
              { value: '7d', label: t('gas.weekly', 'Weekly') },
              { value: '15d', label: t('gas.biweekly', 'Bi-weekly') },
              { value: '30d', label: t('gas.monthly', 'Monthly') },
            ]}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--surface-2)] p-3.5">
            <p className="text-xs font-medium uppercase tracking-wider mb-1 text-[var(--text-muted)]">{t('gas.currentPrice', 'Current Price')}</p>
            <p className="text-lg font-semibold text-[var(--text-primary)]">
              {gasPriceStatus?.current_price ? `$${fmtNumber(gasPriceStatus.current_price)}/gal` : '—'}
            </p>
          </div>
          <div className="rounded-xl border border-[var(--glass-border)] bg-[var(--surface-2)] p-3.5">
            <p className="text-xs font-medium uppercase tracking-wider mb-1 text-[var(--text-muted)]">{t('gas.lastPolled', 'Last Polled')}</p>
            <p className="text-sm text-[var(--text-primary)]">
              {gasPriceStatus?.last_poll_time && gasPriceStatus.last_poll_time !== '0001-01-01T00:00:00Z'
                ? formatDateTime(gasPriceStatus.last_poll_time)
                : t('gas.never', 'Never')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <Button variant="primary" icon={<Zap className="h-4 w-4" />} onClick={() => gasPollMut.mutate(undefined, { onSuccess: () => toast.info(t('gas.pollTriggered', 'Gas price poll triggered')) })} loading={gasPollMut.isPending}>
            {t('gas.pollNow', 'Poll Now')}
          </Button>
          <p className="text-[10px] text-[var(--text-muted)]">
            {t('gas.source', 'Source: U.S. Energy Information Administration')}
          </p>
        </div>
      </GlassPanel>
    </FadeIn>
  )
}
