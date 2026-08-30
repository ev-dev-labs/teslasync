import { useTranslation } from 'react-i18next'
import { Gauge } from 'lucide-react'

import { Caption, HelperText, Select } from '@/components/ui'
import {
  useDataSaverPolicy,
  useLowBandwidthMode,
  type LowBandwidthMode,
} from '@/hooks/useLowBandwidthMode'
import { cn } from '@/lib/cn'

/**
 * User-facing control for low-bandwidth mode (PWA-07).
 *
 * Reusable and self-contained so any surface (the device page today, the
 * Settings screen later) can adopt it without duplicating the store wiring.
 *
 * The copy deliberately enumerates what actually changes. A vague "reduces
 * data usage" toggle trains users to distrust it; naming the four concrete
 * behaviours makes the trade-off inspectable.
 */

export interface LowBandwidthControlProps {
  className?: string
}

export function LowBandwidthControl({ className }: LowBandwidthControlProps) {
  const { t } = useTranslation()
  const { mode, enabled, source, setMode } = useLowBandwidthMode()
  const policy = useDataSaverPolicy()

  const options = [
    {
      value: 'auto',
      label: t('pwa.lowBandwidth.auto', 'Automatic (follow the network)'),
    },
    { value: 'on', label: t('pwa.lowBandwidth.on', 'Always on') },
    { value: 'off', label: t('pwa.lowBandwidth.off', 'Always off') },
  ]

  return (
    <div className={cn('space-y-2', className)} data-testid="low-bandwidth-control">
      <div className="flex items-center gap-2">
        <Gauge className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        <Caption>{t('pwa.lowBandwidth.heading', 'Low-bandwidth mode')}</Caption>
      </div>

      <Select
        label={t('pwa.lowBandwidth.label', 'Data usage on this device')}
        value={mode}
        options={options}
        size="sm"
        onChange={(event) => setMode(event.target.value as LowBandwidthMode)}
      />

      <p
        className="text-xs text-[var(--text-secondary)]"
        data-testid="low-bandwidth-status"
        data-enabled={enabled ? 'true' : 'false'}
        data-source={source}
      >
        {source === 'network'
          ? t(
              'pwa.lowBandwidth.statusNetwork',
              'Active — your browser or network reported Data Saver / a 2G-class connection.',
            )
          : source === 'user'
            ? t('pwa.lowBandwidth.statusUser', 'Active — enabled manually on this device.')
            : t('pwa.lowBandwidth.statusOff', 'Not active — the app is using full quality.')}
      </p>

      <HelperText>
        {enabled
          ? t(
              'pwa.lowBandwidth.effectsOn',
              'While active: background polling slows to a quarter of its normal rate, entrance animations are disabled, charts render at most {{points}} points, satellite/terrain basemaps fall back to the lightest raster tiles, and the service worker stops storing new images and map tiles.',
              { points: policy.chartPointBudget },
            )
          : t(
              'pwa.lowBandwidth.effectsOff',
              'When active: polling slows down, animations stop, charts render fewer points, heavy basemaps fall back to light tiles, and the service worker stops caching new images and map tiles.',
            )}
      </HelperText>
    </div>
  )
}

export default LowBandwidthControl
