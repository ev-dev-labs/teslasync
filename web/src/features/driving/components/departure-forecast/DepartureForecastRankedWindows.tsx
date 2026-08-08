import { ListOrdered } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AlertBanner } from '@/components/feedback';
import { GlassPanel, Badge, PanelTitle, Text } from '@/components/ui';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import type { DepartureForecast } from '../../lib/departureForecast';
import { DepartureForecastSectionBody } from './DepartureForecastSectionBody';
import {
  departureDateTime,
  relativeDepartureLabel,
} from './labels';
import type { DepartureForecastQueryState } from './types';

interface DepartureForecastRankedWindowsProps {
  forecast: DepartureForecast;
  state: DepartureForecastQueryState;
  locale: string;
  timeZone: string;
}

export function DepartureForecastRankedWindows({
  forecast,
  state,
  locale,
  timeZone,
}: DepartureForecastRankedWindowsProps) {
  const { t } = useTranslation();
  const windows = forecast.rankedWindows;

  return (
    <section data-testid="departure-ranked-windows">
      <GlassPanel className="h-full p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <ListOrdered className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('departure.ranked.title', 'Strongest upcoming supported windows')}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'departure.ranked.subtitle',
            'Ranked within the next 24 local-hour slots from returned evidence; this is not a departure guarantee.',
          )}
        </Text>
        <DepartureForecastSectionBody forecast={forecast} state={state}>
          {windows.length === 0 ? (
            <div className="flex min-h-44 items-center justify-center text-center">
              <Text as="p" variant="bodySm" className="max-w-md">
                {t(
                  'departure.ranked.noSupported',
                  'No next-24-hour slot has a recorded departure in the matching weekday-hour cell.',
                )}
              </Text>
            </div>
          ) : (
            <>
              <ol className="space-y-2">
                {windows.map((slot, index) => (
                  <li
                    key={slot.startMs}
                    className="flex items-center gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
                  >
                    <Badge variant="neutral">
                      {t('departure.ranked.rank', '#{{rank}}', {
                        rank: index + 1,
                      })}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <Text
                        as="p"
                        variant="bodySm"
                        className="font-medium"
                      >
                        {departureDateTime(
                          slot.startMs,
                          locale,
                          timeZone,
                        )}
                      </Text>
                      <Text as="p" variant="caption">
                        {t(
                          'departure.ranked.evidence',
                          '{{relative}} · {{departures}} departures across {{occurrences}} observed cell occurrences',
                          {
                            relative: relativeDepartureLabel(
                              t,
                              slot.minutesFromNow,
                            ),
                            departures: fmtInt(
                              slot.historicalDepartures,
                            ),
                            occurrences: fmtInt(slot.cellOccurrences),
                          },
                        )}
                      </Text>
                    </div>
                    <Badge
                      variant={
                        slot.p >= 0.5
                          ? 'success'
                          : slot.p >= 0.25
                            ? 'info'
                            : 'neutral'
                      }
                    >
                      {t(
                        'departure.ranked.likelihood',
                        '{{value}}% modeled',
                        {
                          value: fmtNumber(slot.p * 100, 1, locale),
                        },
                      )}
                    </Badge>
                  </li>
                ))}
              </ol>
              {forecast.accounting.historyCapReached ? (
                <AlertBanner className="mt-3" variant="warning">
                  <Text as="p" variant="caption">
                    {t(
                      'departure.ranked.capQualifier',
                      'Ranking is qualified because the returned 1,000-row history may omit older drives.',
                    )}
                  </Text>
                </AlertBanner>
              ) : null}
            </>
          )}
        </DepartureForecastSectionBody>
      </GlassPanel>
    </section>
  );
}
