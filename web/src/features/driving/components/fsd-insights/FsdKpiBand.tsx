import { CalendarCheck, Gauge, Route, Trophy } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import { Grid } from '@/components/layout';
import { useUnits } from '@/hooks/useUnits';
import { formatDayKey } from '@/lib/dateFormat';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import type { FsdInsights } from '@/types/fsd';

import { FsdSectionBody } from './FsdSectionBody';
import type { FsdSectionState } from './types';

const KPI_COLUMNS = { default: 1, sm: 2, xl: 4 } as const;

interface FsdKpiBandProps {
  insights: FsdInsights | undefined;
  state: FsdSectionState;
}

/**
 * Executive KPI band: supervised self-driving distance, its share of observed
 * driving, active days, and the best single day.
 *
 * Every value is converted from canonical SI meters at this render boundary.
 * A missing denominator renders an em dash plus the reason, never a zero.
 */
export function FsdKpiBand({ insights, state }: FsdKpiBandProps) {
  const { t } = useTranslation();
  const { unitPrefs, formatDistance } = useUnits();
  const totals = insights?.totals;
  const quality = insights?.quality;
  const best = totals?.best_day ?? null;
  // `null` means the self-driving counter never reported a derivable distance
  // in this window. Rendering `?? 0` here would turn "the car never told us"
  // into "the car never drove itself".
  const fsdMeasured = totals?.fsd_distance_m != null;

  return (
    <section aria-label={t('fsd.kpi.section', 'Supervised self-driving summary')} data-testid="fsd-kpis">
      <FsdSectionBody state={state} className="min-h-28">
        <Grid cols={KPI_COLUMNS} gap={4}>
          <MetricCard
            icon={<Route className="h-5 w-5" aria-hidden="true" />}
            color="cyan"
            wrapLabel
            label={t('fsd.kpi.distance', 'Supervised self-driving distance')}
            value={fsdMeasured ? formatDistance(totals?.fsd_distance_m, { precision: 1 }) : '—'}
            subtitle={
              fsdMeasured
                ? t('fsd.kpi.distanceHint', 'Reported counter change')
                : t(
                    'fsd.kpi.distanceUnavailable',
                    'Self-driving counter not reported in this period',
                  )
            }
          />
          <MetricCard
            icon={<Gauge className="h-5 w-5" aria-hidden="true" />}
            color="purple"
            wrapLabel
            label={t('fsd.kpi.share', 'Share of observed driving')}
            value={
              totals?.fsd_share_pct != null
                ? t('fsd.kpi.sharePct', '{{value}}%', { value: fmtNumber(totals.fsd_share_pct, 1) })
                : '—'
            }
            subtitle={
              totals?.fsd_share_pct != null
                ? t('fsd.kpi.shareHint', 'of {{distance}} observed driving', {
                    distance: formatDistance(totals.driving_distance_m ?? null, { precision: 1 }),
                  })
                : !fsdMeasured
                  ? t(
                      'fsd.kpi.shareNoFsd',
                      'Needs the self-driving counter, which was not reported',
                    )
                  : quality?.driving_denominator_available &&
                      !quality.share_basis_available
                    ? t(
                        'fsd.kpi.shareUnaligned',
                        'Counter spans do not align for a trustworthy share',
                      )
                  : t('fsd.kpi.shareUnavailable', 'Observed-driving counter not reported')
            }
          />
          <MetricCard
            icon={<CalendarCheck className="h-5 w-5" aria-hidden="true" />}
            color="green"
            wrapLabel
            label={t('fsd.kpi.activeDays', 'Days with self-driving distance')}
            value={totals && fsdMeasured ? fmtInt(totals.active_days) : '—'}
            subtitle={
              totals && fsdMeasured
                ? t('fsd.kpi.activeDaysHint', 'of {{days}} measured days', {
                    days: totals.measured_days,
                  })
                : totals
                  ? t('fsd.kpi.activeDaysUnavailable', 'No day could be measured')
                  : t('fsd.kpi.noPeriod', 'No period loaded yet')
            }
          />
          <MetricCard
            icon={<Trophy className="h-5 w-5" aria-hidden="true" />}
            color="amber"
            wrapLabel
            label={t('fsd.kpi.bestDay', 'Best day')}
            value={best ? formatDistance(best.fsd_distance_m, { precision: 1 }) : '—'}
            subtitle={
              best
                ? formatDayKey(best.date, { locale: unitPrefs.locale, style: 'long' })
                : fsdMeasured
                  ? t('fsd.kpi.bestDayNone', 'No day accumulated distance yet')
                  : t('fsd.kpi.bestDayUnavailable', 'Nothing measured in this period')
            }
          />
        </Grid>
      </FsdSectionBody>
    </section>
  );
}
