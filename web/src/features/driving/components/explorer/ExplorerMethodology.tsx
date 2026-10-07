import {
  CalendarClock,
  Database,
  Grid3X3,
  Radar,
  Route,
  Ruler,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  Badge,
  GlassPanel,
  MetricLabel,
  MetricValue,
  PanelTitle,
  Text,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import { fmtInt } from '@/lib/numberFormat';

import {
  MIN_BASE_ARRIVALS,
  MIN_BASE_CLUSTER_VISITS,
  MIN_DESTINATIONS_FOR_RANKING,
  MIN_DISCOVERIES_FOR_CADENCE,
  type ExplorerSummary,
} from '../../lib/explorer';
import { ExplorerSectionBody } from './ExplorerSectionBody';
import type { ExplorerSectionState } from './types';

interface ExplorerMethodologyProps {
  summary: ExplorerSummary;
  state: ExplorerSectionState;
  className?: string;
}

export function ExplorerMethodology({
  summary,
  state,
  className,
}: ExplorerMethodologyProps) {
  const { t } = useTranslation();
  const methods = [
    {
      icon: <Grid3X3 className="h-4 w-4" aria-hidden="true" />,
      text: t(
        'explorer.method.clustering',
        'Valid drive-end coordinates are rounded into 0.01° cells (roughly 1 km north–south). This is coarse grid clustering, not a geofence; east–west width varies by latitude and adjacent points can split at a cell edge.',
      ),
    },
    {
      icon: <Radar className="h-4 w-4" aria-hidden="true" />,
      text: t(
        'explorer.method.base',
        'The most-observed arrival cell across the returned window is the inferred observed base. It is not verified as home, work, or any saved place; ties use earliest arrival and then a stable internal cell key.',
      ),
    },
    {
      icon: <Route className="h-4 w-4" aria-hidden="true" />,
      text: t(
        'explorer.method.newRepeat',
        'When base evidence is supported, the inferred-base cell is excluded from destination behavior; otherwise every observed cluster remains a destination. A destination’s first chronological arrival is new, and later arrivals in the same cell are repeat.',
      ),
    },
    {
      icon: <Ruler className="h-4 w-4" aria-hidden="true" />,
      text: t(
        'explorer.method.distance',
        'Distances use great-circle geometry between cluster centroids. Roaming radius is the visit-weighted 90th percentile of non-base arrival distances.',
      ),
    },
    {
      icon: <CalendarClock className="h-4 w-4" aria-hidden="true" />,
      text: t(
        'explorer.method.timestamps',
        'A valid drive-end timestamp is preferred for arrival order. When it is absent or invalid, a valid drive-start timestamp is counted and disclosed as a proxy.',
      ),
    },
    {
      icon: <Database className="h-4 w-4" aria-hidden="true" />,
      text: summary.historyCapReached
        ? t(
            'explorer.method.capped',
            'The {{limit}}-row API cap was reached, so all findings describe a bounded observed window and may omit older drives.',
            { limit: fmtInt(summary.historyLimit) },
          )
        : t(
            'explorer.method.window',
            'Findings describe {{count}} rows returned in this observed window, up to the {{limit}}-row API cap.',
            {
              count: summary.eligibility.observed,
              limit: summary.historyLimit,
            },
          ),
    },
  ];

  return (
    <section
      className={className}
      aria-label={t(
        'explorer.section.method',
        'Explorer methodology and evidence thresholds',
      )}
      data-testid="explorer-methodology"
    >
      <GlassPanel className={cn('p-5 sm:p-6')}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <PanelTitle className="flex items-center gap-2">
            <Database className="h-4 w-4 text-purple-300" aria-hidden="true" />
            {t('explorer.method.title', 'Methodology & limits')}
          </PanelTitle>
          <Badge
            variant={
              summary.evidence.baseSufficient ? 'success' : 'warning'
            }
            dot
          >
            {summary.evidence.baseSufficient
              ? t('explorer.method.baseReady', 'Base evidence supported')
              : t('explorer.method.baseBuilding', 'Base evidence building')}
          </Badge>
        </div>

        <ExplorerSectionBody state={state} className="mt-4 min-h-72">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
            <ul className="space-y-3">
              {methods.map((method) => (
                <li
                  key={method.text}
                  className="flex items-start gap-2"
                >
                  <span className="mt-0.5 shrink-0 text-cyan-300">
                    {method.icon}
                  </span>
                  <Text as="span" variant="bodySm">{method.text}</Text>
                </li>
              ))}
            </ul>

            <div>
              <Text as="p" variant="label" className="mb-3">
                {t('explorer.method.minimums', 'Minimum evidence')}
              </Text>
              <div className="grid grid-cols-3 gap-2 lg:grid-cols-1">
                <div className="rounded-xl bg-[var(--surface-2)] p-3">
                  <MetricValue>
                    {fmtInt(summary.eligibility.eligible)}/{MIN_BASE_ARRIVALS}
                  </MetricValue>
                  <MetricLabel>
                    {t(
                      'explorer.method.locatedMinimum',
                      'Located arrivals for base distance',
                    )}
                  </MetricLabel>
                </div>
                <div className="rounded-xl bg-[var(--surface-2)] p-3">
                  <MetricValue>
                    {fmtInt(summary.inferredBase?.visits ?? 0)}/
                    {MIN_BASE_CLUSTER_VISITS}
                  </MetricValue>
                  <MetricLabel>
                    {t(
                      'explorer.method.baseMinimum',
                      'Arrivals in inferred-base cluster',
                    )}
                  </MetricLabel>
                </div>
                <div className="rounded-xl bg-[var(--surface-2)] p-3">
                  <MetricValue>
                    {fmtInt(summary.cadence.discoveries)}/
                    {MIN_DISCOVERIES_FOR_CADENCE}
                  </MetricValue>
                  <MetricLabel>
                    {t(
                      'explorer.method.cadenceMinimum',
                      'Discoveries for cadence',
                    )}
                  </MetricLabel>
                </div>
              </div>
              <Text as="p" variant="caption" className="mt-3">
                {t(
                  'explorer.method.rankingMinimum',
                  'Comparative rankings additionally require at least {{count}} non-base destinations.',
                  { count: MIN_DESTINATIONS_FOR_RANKING },
                )}
              </Text>
            </div>
          </div>
        </ExplorerSectionBody>
      </GlassPanel>
    </section>
  );
}
