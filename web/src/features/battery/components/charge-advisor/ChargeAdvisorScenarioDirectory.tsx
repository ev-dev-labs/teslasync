import { CalendarDays } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/feedback';
import { Badge, Text } from '@/components/ui';
import { fmtPercent } from '@/lib/numberFormat';

import { ChargeAdvisorSection } from './ChargeAdvisorSection';
import type { ChargeAdvisorComponentProps } from './types';

export function ChargeAdvisorScenarioDirectory({ analysis, state }: ChargeAdvisorComponentProps) {
  const { t } = useTranslation();
  const days = analysis.scenarios.meanPath;

  return (
    <ChargeAdvisorSection
      title={t('chargeAdvisor.directory.title', 'Day-by-day scenario directory')}
      subtitle={t(
        'chargeAdvisor.directory.subtitle',
        'Each row keeps the local date, daily use assumption, and clamped end SoC visible.',
      )}
      icon={<CalendarDays className="h-4 w-4 text-cyan-300" aria-hidden="true" />}
      state={state}
      dependency="drive"
      dataTestId="charge-advisor-directory"
    >
      {days.length === 0 ? (
        <EmptyState /* no-action: vehicle and scenario controls in the surrounding section determine this result */
          className="py-10"
          message={t(
            'chargeAdvisor.directory.empty',
            'No seven-day scenario is available until current state and qualified use history are present.',
          )}
        />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {days.map((day) => (
            <article
              key={day.localDate}
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <Text className="font-medium">{day.localDate}</Text>
                <Badge variant="neutral">{t(
                  `chargeAdvisor.day.${day.weekday}`,
                  ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day.weekday] ?? 'Day',
                )}</Badge>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div>
                  <Text variant="caption">{t('chargeAdvisor.directory.mean', 'Mean use')}</Text>
                  <Text className="font-semibold">{fmtPercent(day.meanBurnPct, 1)}</Text>
                </div>
                <div>
                  <Text variant="caption">{t('chargeAdvisor.directory.p75', 'Calendar-day p75')}</Text>
                  <Text className="font-semibold">{fmtPercent(day.p75BurnPct, 1)}</Text>
                </div>
                <div>
                  <Text variant="caption">{t('chargeAdvisor.directory.meanEnd', 'Mean end SoC')}</Text>
                  <Text className="font-semibold text-cyan-300">{fmtPercent(day.meanEndSocPct, 0)}</Text>
                </div>
                <div>
                  <Text variant="caption">{t('chargeAdvisor.directory.p75End', 'Calendar-day p75 end SoC')}</Text>
                  <Text className="font-semibold text-amber-300">{fmtPercent(day.p75EndSocPct, 0)}</Text>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </ChargeAdvisorSection>
  );
}
