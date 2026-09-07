import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge, Caption, Text } from '@/components/ui'
import { HONESTY_KINDS, tallyHonesty, type HonestyKind } from '@/lib/fleetHonesty'

import type { PostureCategory } from './helpers'

const VARIANT: Record<HonestyKind, 'success' | 'warning' | 'info' | 'neutral'> = {
  live: 'success',
  stale: 'warning',
  guessed: 'info',
  missing: 'neutral',
}

export function FleetHonestyMeter({
  categories,
  pending,
}: {
  categories: readonly (PostureCategory | 'pending')[]
  pending: boolean
}) {
  const { t } = useTranslation()
  const counts = useMemo(() => tallyHonesty(categories), [categories])
  const labels: Record<HonestyKind, string> = {
    live: t('honesty.live', 'Live'),
    stale: t('honesty.stale', 'Stale'),
    guessed: t('honesty.guessed', 'Guessed'),
    missing: t('honesty.missing', 'Missing'),
  }

  return (
    <div className="space-y-2" data-testid="fleet-honesty-meter">
      <Caption className="font-semibold uppercase tracking-[0.1em]">
        {t('honesty.title', 'Telemetry honesty')}
      </Caption>
      <Text as="p" variant="caption">
        {t(
          'honesty.subtitle',
          'Live, stale, guessed, or missing — the same words FSD uses when it refuses to invent km.',
        )}
      </Text>
      <div className="flex flex-wrap gap-2">
        {HONESTY_KINDS.map((kind) => (
          <Badge key={kind} variant={pending ? 'neutral' : VARIANT[kind]} size="sm">
            {labels[kind]} · {pending ? '—' : counts[kind]}
          </Badge>
        ))}
      </div>
    </div>
  )
}
