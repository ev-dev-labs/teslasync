import { CalendarDays } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import type { DepartureForecast } from '../../lib/departureForecast';
import { DepartureForecastSectionBody } from './DepartureForecastSectionBody';
import {
  departureLocalHour,
  departureWeekdayLabel,
} from './labels';
import type { DepartureForecastQueryState } from './types';

interface DepartureForecastWeekdayRoutinesProps {
  forecast: DepartureForecast;
  state: DepartureForecastQueryState;
  locale: string;
  timeZone: string;
}

export function DepartureForecastWeekdayRoutines({
  forecast,
  state,
  locale,
  timeZone,
}: DepartureForecastWeekdayRoutinesProps) {
  const { t } = useTranslation();

  return (
    <section data-testid="departure-weekday-routines">
      <GlassPanel className="h-full p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <CalendarDays
            className="h-4 w-4 text-cyan-300"
            aria-hidden="true"
          />
          {t('departure.weekdays.title', 'Weekday peaks and routine support')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'departure.weekdays.subtitle',
            'Supported peak cells in {{timeZone}} from qualifying returned drive starts; unsupported days remain explicit.',
            { timeZone },
          )}
        </Text>
        <DepartureForecastSectionBody forecast={forecast} state={state}>
          <ul className="grid gap-2 sm:grid-cols-2">
            {forecast.weekdayProfiles.map((profile) => (
              <li
                key={profile.weekday}
                className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <Text as="p" variant="bodySm" className="font-medium">
                    {departureWeekdayLabel(t, profile.weekday)}
                  </Text>
                  <Badge variant={profile.supported ? 'info' : 'neutral'}>
                    {profile.supported
                      ? t('departure.weekdays.supported', 'Supported')
                      : t(
                          'departure.weekdays.unsupported',
                          'Unsupported',
                        )}
                  </Badge>
                </div>
                {profile.supported &&
                profile.hour != null &&
                profile.p != null ? (
                  <div className="mt-2 space-y-1">
                    <Text as="p" variant="bodySm">
                      {t(
                        'departure.weekdays.peak',
                        '{{time}} · {{likelihood}}% modeled likelihood',
                        {
                          time: departureLocalHour(
                            profile.hour,
                            locale,
                          ),
                          likelihood: fmtNumber(
                            profile.p * 100,
                            1,
                            locale,
                          ),
                        },
                      )}
                    </Text>
                    <Text as="p" variant="caption">
                      {t(
                        'departure.weekdays.support',
                        '{{departures}} peak-cell departures · {{activeDays}} active local days · {{concentration}}% of this weekday’s events',
                        {
                          departures: fmtInt(profile.departures),
                          activeDays: fmtInt(profile.activeDays),
                          concentration: fmtNumber(
                            (profile.concentration ?? 0) * 100,
                            0,
                            locale,
                          ),
                        },
                      )}
                    </Text>
                  </div>
                ) : (
                  <Text as="p" variant="caption" className="mt-2">
                    {t(
                      'departure.weekdays.unsupportedHint',
                      'No qualifying departure was recorded on this weekday; no prior-only routine is shown.',
                    )}
                  </Text>
                )}
              </li>
            ))}
          </ul>
        </DepartureForecastSectionBody>
      </GlassPanel>
    </section>
  );
}
