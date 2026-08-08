import { Clock3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge, Text } from '@/components/ui';
import { fmtInt } from '@/lib/numberFormat';

import { ChargeAdvisorSection } from './ChargeAdvisorSection';
import type { ChargeAdvisorComponentProps } from './types';

export function ChargeAdvisorChargingTiming({ analysis, state }: ChargeAdvisorComponentProps) {
  const { t } = useTranslation();
  const profile = analysis.chargingProfile;
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const hours = profile.startsByHour
    .map((count, hour) => ({ hour, count }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count || a.hour - b.hour)
    .slice(0, 8);

  return (
    <ChargeAdvisorSection
      title={t('chargeAdvisor.timing.title', 'Charging weekday and hour timing')}
      subtitle={t(
        'chargeAdvisor.timing.subtitle',
        'Start timing is descriptive routine evidence, not a departure plan.',
      )}
      icon={<Clock3 className="h-4 w-4 text-cyan-300" aria-hidden="true" />}
      state={state}
      dependency="charging"
      dataTestId="charge-advisor-charging-timing"
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <Text variant="caption">{t('chargeAdvisor.timing.weekdayTitle', 'Starts by local weekday')}</Text>
          <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-7">
            {profile.startsByWeekday.map((count, weekday) => (
              <div key={weekday} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-2 text-center">
                <Text variant="caption">{t(`chargeAdvisor.day.${weekday}`, weekdays[weekday] ?? 'Day')}</Text>
                <Text className="mt-1 font-semibold text-cyan-300">{fmtInt(count)}</Text>
              </div>
            ))}
          </div>
        </div>
        <div>
          <Text variant="caption">{t('chargeAdvisor.timing.hourTitle', 'Most common start hours')}</Text>
          {hours.length === 0 ? (
            <Text as="p" variant="bodySm" className="py-6">
              {t('chargeAdvisor.timing.empty', 'No completed charging starts are available.')}
            </Text>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              {hours.map((item) => (
                <Badge key={item.hour} variant="info">
                  {String(item.hour).padStart(2, '0')}:00 · {fmtInt(item.count)}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>
    </ChargeAdvisorSection>
  );
}
