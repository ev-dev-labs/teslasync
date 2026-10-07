import { SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge, Text } from '@/components/ui';
import { fmtPercent } from '@/lib/numberFormat';

import { ChargeAdvisorSection } from './ChargeAdvisorSection';
import type { ChargeAdvisorComponentProps } from './types';

export function ChargeAdvisorReserveSensitivity({ analysis, state }: ChargeAdvisorComponentProps) {
  const { t } = useTranslation();

  return (
    <ChargeAdvisorSection
      title={t('chargeAdvisor.sensitivity.title', 'Reserve-floor sensitivity')}
      subtitle={t(
        'chargeAdvisor.sensitivity.subtitle',
        'The reserve is a user planning threshold, not a battery operating limit.',
      )}
      icon={<SlidersHorizontal className="h-4 w-4 text-cyan-300" aria-hidden="true" />}
      state={state}
      dependency="drive"
      dataTestId="charge-advisor-sensitivity"
    >
      <div className="grid gap-2 sm:grid-cols-3">
        {analysis.reserveSensitivity.map((item) => (
          <article
            key={item.floorPct}
            className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <Text className="font-semibold">{fmtPercent(item.floorPct, 0)}</Text>
              {item.floorPct === analysis.reserveFloorPct && (
                <Badge variant="info">{t('chargeAdvisor.sensitivity.selected', 'Selected')}</Badge>
              )}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div>
                <Text variant="caption">{t('chargeAdvisor.sensitivity.mean', 'Mean path')}</Text>
                <Text className="font-semibold">
                  {item.meanDaysToCross == null ? '—' : t(
                    'chargeAdvisor.sensitivity.days',
                    '{{count}} days',
                    { count: item.meanDaysToCross },
                  )}
                </Text>
              </div>
              <div>
                <Text variant="caption">{t('chargeAdvisor.sensitivity.p75', 'Calendar-day p75')}</Text>
                <Text className="font-semibold">
                  {item.p75DaysToCross == null ? '—' : t(
                    'chargeAdvisor.sensitivity.days',
                    '{{count}} days',
                    { count: item.p75DaysToCross },
                  )}
                </Text>
              </div>
            </div>
          </article>
        ))}
      </div>
      <Text as="p" variant="caption" className="mt-4">
        {t(
          'chargeAdvisor.sensitivity.note',
          'Days-to-cross starts at tomorrow and is calculated from the same seven-day historical-use scenarios.',
        )}
      </Text>
    </ChargeAdvisorSection>
  );
}
