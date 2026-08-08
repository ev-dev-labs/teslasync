import {
  BarChart3,
  CalendarClock,
  Clock3,
  Database,
  Gauge,
  TimerReset,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import { Grid } from '@/components/layout';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import type { DepartureForecast } from '../../lib/departureForecast';
import {
  departureClock,
  departureDateTime,
  departureEvidenceBandLabel,
  relativeDepartureLabel,
} from './labels';
import type { DepartureForecastQueryState } from './types';

const KPI_COLUMNS = { default: 2, md: 3, xl: 6 } as const;

interface DepartureForecastKpiCardsProps {
  forecast: DepartureForecast;
  state: DepartureForecastQueryState;
  locale: string;
  timeZone: string;
}

export function DepartureForecastKpiCards({
  forecast,
  state,
  locale,
  timeZone,
}: DepartureForecastKpiCardsProps) {
  const { t } = useTranslation();
  const ready = state.isResolved && !state.error;
  const hasEvidence = ready && forecast.totalDepartures > 0;
  const pendingValue = state.isLoading
    ? t('departure.states.loadingShort', 'Loading…')
    : '—';
  const unresolvedSubtitle = !state.vehicleSelected
    ? t(
        'departure.states.selectVehicleKpi',
        'Select a vehicle above to load departure evidence.',
      )
    : state.isLoading
      ? t(
          'departure.states.loadingKpi',
          'Waiting for returned drive history…',
        )
      : state.error
        ? t(
            'departure.states.errorKpi',
            'Departure history is unavailable; use the status below to retry.',
          )
        : !state.isResolved
          ? t(
              'departure.states.pendingKpi',
              'Departure-history availability has not resolved.',
            )
          : null;
  const unavailable = hasEvidence ? '—' : pendingValue;
  const next = hasEvidence ? forecast.nextLikely : null;
  const peak = hasEvidence ? forecast.peak : null;
  const marker =
    hasEvidence && forecast.evidenceStrength.band !== 'thin'
      ? forecast.planningMarkerAtMs
      : null;
  const horizon = hasEvidence ? forecast.horizonLikelihood : null;
  const evidence = hasEvidence ? forecast.evidenceStrength : null;

  return (
    <Grid cols={KPI_COLUMNS} gap={3}>
      <MetricCard
        label={t(
          'departure.kpis.nextWindow',
          'Next supported departure window',
        )}
        value={
          next ? departureClock(next.startMs, locale, timeZone) : unavailable
        }
        subtitle={
          next
            ? t(
                'departure.kpis.nextWindowHint',
                '{{date}} · {{relative}}',
                {
                  date: departureDateTime(next.startMs, locale, timeZone),
                  relative: relativeDepartureLabel(t, next.minutesFromNow),
                },
              )
            : unresolvedSubtitle ??
              t(
                'departure.kpis.nextWindowUnavailable',
                'No supported slot crosses the model threshold',
              )
        }
        icon={<CalendarClock className="h-5 w-5" aria-hidden="true" />}
        color="cyan"
      />
      <MetricCard
        label={t(
          'departure.kpis.peakLikelihood',
          'Peak modeled likelihood',
        )}
        value={
          peak ? `${fmtNumber(peak.p * 100, 1, locale)}%` : unavailable
        }
        subtitle={
          peak
            ? departureDateTime(peak.startMs, locale, timeZone)
            : unresolvedSubtitle ??
              t(
                'departure.kpis.peakUnavailable',
                'No supported peak in the next 24 hours',
              )
        }
        icon={<BarChart3 className="h-5 w-5" aria-hidden="true" />}
        color="purple"
      />
      <MetricCard
        label={t(
          'departure.kpis.horizonLikelihood',
          '24h modeled likelihood',
        )}
        value={
          horizon != null
            ? `${fmtNumber(horizon * 100, 1, locale)}%`
            : unavailable
        }
        subtitle={
          unresolvedSubtitle ??
          (horizon != null
            ? t(
                'departure.kpis.horizonHint',
                'Poisson-derived estimate; not a calibrated probability',
              )
            : t(
                'departure.kpis.horizonUnavailable',
                'Unavailable without qualifying departure evidence',
              ))
        }
        icon={<Clock3 className="h-5 w-5" aria-hidden="true" />}
        color="blue"
      />
      <MetricCard
        label={t(
          'departure.kpis.planningMarker',
          'Illustrative planning marker',
        )}
        value={
          marker != null
            ? departureClock(marker, locale, timeZone)
            : unavailable
        }
        subtitle={
          unresolvedSubtitle ??
          (marker != null
            ? t(
                'departure.kpis.planningMarkerHint',
                '20 minutes before the peak boundary; never triggers the vehicle',
              )
            : t(
                'departure.kpis.planningMarkerUnavailable',
                'Needs a supported future peak and developing evidence',
              ))
        }
        icon={<TimerReset className="h-5 w-5" aria-hidden="true" />}
        color="amber"
      />
      <MetricCard
        label={t(
          'departure.kpis.includedDepartures',
          'Included departures',
        )}
        value={
          ready ? fmtInt(forecast.accounting.includedRows) : pendingValue
        }
        subtitle={
          unresolvedSubtitle ??
          t(
            'departure.kpis.includedHint',
            'Every recorded drive start is one event',
          )
        }
        icon={<Database className="h-5 w-5" aria-hidden="true" />}
        color="green"
      />
      <MetricCard
        label={t(
          'departure.kpis.evidenceStrength',
          'Evidence strength',
        )}
        value={
          evidence
            ? `${fmtNumber(evidence.value * 100, 0, locale)}%`
            : unavailable
        }
        subtitle={
          evidence
            ? t(
                'departure.kpis.evidenceHint',
                '{{band}} · {{capState}}',
                {
                  band: departureEvidenceBandLabel(t, evidence.band),
                  capState: forecast.accounting.historyCapReached
                    ? t(
                        'departure.kpis.capReached',
                        'history may be capped',
                      )
                    : t(
                        'departure.kpis.capNotReached',
                        'below the 1,000-row cap',
                      ),
                },
              )
            : unresolvedSubtitle ??
              t(
                'departure.kpis.evidenceUnavailable',
                'Support index needs qualifying departures',
              )
        }
        icon={<Gauge className="h-5 w-5" aria-hidden="true" />}
        color={
          evidence?.band === 'strong'
            ? 'green'
            : evidence?.band === 'developing'
              ? 'cyan'
              : 'blue'
        }
      />
    </Grid>
  );
}
