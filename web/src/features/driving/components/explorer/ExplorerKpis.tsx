import { Compass, MapPin, Milestone, Radar } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { Grid } from '@/components/layout';
import { GlassPanel } from '@/components/ui';
import { fmtInt } from '@/lib/numberFormat';

import type { ExplorerSummary } from '../../lib/explorer';
import type {
  ExplorerDistanceDisplay,
  ExplorerSectionState,
} from './types';

const KPI_COLUMNS = { default: 2, xl: 4 } as const;

interface ExplorerKpisProps extends ExplorerDistanceDisplay {
  summary: ExplorerSummary;
  state: ExplorerSectionState;
}

export function ExplorerKpis({
  summary,
  state,
  formatDistance,
}: ExplorerKpisProps) {
  const { t } = useTranslation();
  const base = summary.inferredBase;
  const farthestName =
    summary.farthest?.label ??
    (summary.farthest
      ? t('explorer.kpi.farthest.unnamed', 'Unnamed destination')
      : undefined);

  return (
    <section
      aria-label={t('explorer.kpis', 'Explorer summary metrics')}
      data-testid="explorer-kpis"
    >
      <Grid cols={KPI_COLUMNS} gap={4}>
        {state.error ? (
          <GlassPanel className="col-span-full p-4 sm:p-5">
            <QueryError error={state.error} onRetry={state.onRetry} />
          </GlassPanel>
        ) : state.isLoading ? (
          Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} height={96} className="rounded-xl" />
          ))
        ) : (
          <>
            <MetricCard
              label={t(
                'explorer.kpi.destinations.label',
                'Observed destinations',
              )}
              value={fmtInt(summary.uniquePlaces)}
              subtitle={t(
                'explorer.kpi.destinations.subtitle',
                '{{count}} eligible located arrivals',
                { count: summary.eligibility.eligible },
              )}
              icon={<MapPin className="h-5 w-5" aria-hidden="true" />}
              color="cyan"
            />
            <MetricCard
              label={t(
                'explorer.kpi.radius.label',
                'P90 roaming radius',
              )}
              value={
                summary.radiusM != null
                  ? formatDistance(summary.radiusM, { precision: 0 })
                  : '—'
              }
              subtitle={
                summary.evidence.baseSufficient
                  ? t(
                      'explorer.kpi.radius.subtitle',
                      '90% of non-base arrivals are within this distance',
                    )
                  : t(
                      'explorer.kpi.radius.insufficient',
                      'Needs a repeated observed base',
                    )
              }
              icon={<Compass className="h-5 w-5" aria-hidden="true" />}
              color="green"
            />
            <MetricCard
              label={t(
                'explorer.kpi.farthest.label',
                'Farthest observed destination',
              )}
              value={
                summary.farthest != null
                  ? formatDistance(summary.farthest.distanceFromBaseM, {
                      precision: 0,
                    })
                  : '—'
              }
              subtitle={farthestName}
              icon={<Milestone className="h-5 w-5" aria-hidden="true" />}
              color="purple"
            />
            <MetricCard
              label={t(
                'explorer.kpi.base.label',
                'Inferred observed base',
              )}
              value={
                base?.label ??
                (base
                  ? t(
                      'explorer.kpi.base.unnamed',
                      'Unnamed arrival cluster',
                    )
                  : '—')
              }
              subtitle={
                base
                  ? t(
                      'explorer.kpi.base.subtitle',
                      '{{count}} arrivals; inferred, not a verified home',
                      { count: base.visits },
                    )
                  : undefined
              }
              icon={<Radar className="h-5 w-5" aria-hidden="true" />}
              color="amber"
            />
            {summary.eligibility.observed === 0 ? (
              <EmptyState
                className="col-span-full py-6"
                icon={<Compass className="h-8 w-8" aria-hidden="true" />}
                message={t(
                  'explorer.kpi.empty',
                  'No drives were returned in this observed history window.',
                )}
                actionTo={{
                  label: t('explorer.browseDrives', 'Browse drives'),
                  to: '/drives',
                }}
              />
            ) : null}
          </>
        )}
      </Grid>
    </section>
  );
}
