import { CalendarRange } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge, Text } from '@/components/ui';
import { fmtPercent } from '@/lib/numberFormat';

import { ChargeAdvisorSection } from './ChargeAdvisorSection';
import type { ChargeAdvisorComponentProps } from './types';

export function ChargeAdvisorWeekdayProfile({ analysis, state }: ChargeAdvisorComponentProps) {
  const { t } = useTranslation();
  const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <ChargeAdvisorSection
      title={t('chargeAdvisor.weekday.title', 'Weekday use distribution')}
      subtitle={t(
        'chargeAdvisor.weekday.subtitle',
        'Exact local calendar denominators include zero-driving occurrences.',
      )}
      icon={<CalendarRange className="h-4 w-4 text-cyan-300" aria-hidden="true" />}
      state={state}
      dependency="drive"
      dataTestId="charge-advisor-weekday"
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
        {analysis.weekdayProfiles.map((profile) => (
          <article
            key={profile.weekday}
            className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
          >
            <Text variant="caption">{t(
              `chargeAdvisor.day.${profile.weekday}`,
              labels[profile.weekday] ?? 'Day',
            )}</Text>
            <Text className="mt-1 text-lg font-semibold text-cyan-300">
              {profile.medianPct == null ? '—' : fmtPercent(profile.medianPct, 1)}
            </Text>
            <Text variant="caption">{t('chargeAdvisor.weekday.median', 'Calendar-day median drop')}</Text>
            <div className="mt-3 space-y-1">
              <Text variant="caption">
                {t('chargeAdvisor.weekday.mean', 'Calendar-day mean {{value}}', {
                  value: profile.meanPct == null ? '—' : fmtPercent(profile.meanPct, 1),
                })}
              </Text>
              <Text variant="caption">
                {t('chargeAdvisor.weekday.p75', 'Calendar-day p75 {{value}}', {
                  value: profile.p75Pct == null ? '—' : fmtPercent(profile.p75Pct, 1),
                })}
              </Text>
              <Text variant="caption">
                {t('chargeAdvisor.weekday.p90', 'Calendar-day p90 {{value}}', {
                  value: profile.p90Pct == null ? '—' : fmtPercent(profile.p90Pct, 1),
                })}
              </Text>
              <Text variant="caption">
                {t('chargeAdvisor.weekday.occurrences', '{{count}} calendar occurrences', {
                  count: profile.calendarOccurrences,
                })}
              </Text>
              <Text variant="caption">
                {t('chargeAdvisor.weekday.drivingDays', '{{count}} driving days', {
                  count: profile.drivingDays,
                })}
              </Text>
              <Text variant="caption">
                {t('chargeAdvisor.weekday.activeWeeks', '{{count}} active weeks', {
                  count: profile.activeWeeks,
                })}
              </Text>
              <Badge variant={
                profile.support.band === 'strong'
                  ? 'success'
                  : profile.support.band === 'moderate'
                    ? 'info'
                    : profile.support.band === 'thin'
                      ? 'warning'
                      : 'neutral'
              }>
                {fmtPercent(profile.driveDayShare * 100, 0)} {t('chargeAdvisor.weekday.share', 'active')} · {t(
                  `chargeAdvisor.support.band.${profile.support.band}`,
                  profile.support.band === 'strong'
                    ? 'strong'
                    : profile.support.band === 'moderate'
                      ? 'moderate'
                      : profile.support.band === 'thin'
                        ? 'thin'
                        : 'none',
                )}
              </Badge>
            </div>
          </article>
        ))}
      </div>
    </ChargeAdvisorSection>
  );
}
