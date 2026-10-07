import { ListTree } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  GlassPanel,
  Heading,
  MetricLabel,
  MetricValue,
  PanelTitle,
  Text,
} from '@/components/ui';
import { fmtInt } from '@/lib/numberFormat';
import type { ArrivalReliabilityResult } from '../../lib/arrivalReliability';
import { ArrivalReliabilitySectionBody } from './ArrivalReliabilitySectionBody';
import {
  arrivalEvidenceBandLabel,
  arrivalIndex,
} from './labels';
import type {
  ArrivalReliabilityQueryState,
  DurationFormatter,
} from './types';

interface ArrivalReliabilityRouteDirectoryProps {
  analysis: ArrivalReliabilityResult;
  state: ArrivalReliabilityQueryState;
  locale: string;
  formatDuration: DurationFormatter;
}

function RouteMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <MetricLabel>{label}</MetricLabel>
      <MetricValue className="mt-0.5">{value}</MetricValue>
    </div>
  );
}

export function ArrivalReliabilityRouteDirectory({
  analysis,
  state,
  locale,
  formatDuration,
}: ArrivalReliabilityRouteDirectoryProps) {
  const { t } = useTranslation();

  return (
    <section data-testid="arrival-route-directory">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <ListTree className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t(
            'arrivalReliability.directory.title',
            'Route evidence directory',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'arrivalReliability.directory.subtitle',
            'Supported directional routes ordered by sample count, with timing and support kept separate.',
          )}
        </Text>
        <ArrivalReliabilitySectionBody analysis={analysis} state={state}>
          <div className="space-y-3">
            {analysis.routes.map((route, index) => (
              <article
                key={route.key}
                className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <Text as="p" variant="label">
                      {t(
                        'arrivalReliability.directory.rank',
                        'Evidence rank {{rank}}',
                        { rank: fmtInt(index + 1) },
                      )}
                    </Text>
                    <Heading level="sub" className="mt-1">
                      {route.label}
                    </Heading>
                  </div>
                  <Text as="p" variant="caption">
                    {t(
                      'arrivalReliability.directory.supportBand',
                      '{{band}} · support {{index}}',
                      {
                        band: arrivalEvidenceBandLabel(
                          t,
                          route.support.band,
                        ),
                        index: arrivalIndex(route.support.index, locale),
                      },
                    )}
                  </Text>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
                  <RouteMetric
                    label={t(
                      'arrivalReliability.directory.samples',
                      'Samples',
                    )}
                    value={fmtInt(route.samples)}
                  />
                  <RouteMetric
                    label={t(
                      'arrivalReliability.directory.activeDays',
                      'Active local days',
                    )}
                    value={fmtInt(route.activeLocalDays)}
                  />
                  <RouteMetric
                    label={t('arrivalReliability.directory.p50', 'Observed p50')}
                    value={formatDuration(route.p50DurationS, {
                      precision: 1,
                    })}
                  />
                  <RouteMetric
                    label={t('arrivalReliability.directory.p90', 'Observed p90')}
                    value={formatDuration(route.p90DurationS, {
                      precision: 1,
                    })}
                  />
                  <RouteMetric
                    label={t(
                      'arrivalReliability.directory.spread',
                      'Scaled MAD',
                    )}
                    value={formatDuration(route.robustSpreadS, {
                      precision: 1,
                    })}
                  />
                  <RouteMetric
                    label={t(
                      'arrivalReliability.directory.buffer',
                      'Observed p90 buffer',
                    )}
                    value={formatDuration(route.p90BufferS, {
                      precision: 1,
                    })}
                  />
                  <RouteMetric
                    label={t(
                      'arrivalReliability.directory.consistency',
                      'Timing consistency',
                    )}
                    value={arrivalIndex(
                      route.timingConsistencyIndex,
                      locale,
                    )}
                  />
                  <RouteMetric
                    label={t(
                      'arrivalReliability.directory.support',
                      'Route support',
                    )}
                    value={arrivalIndex(route.support.index, locale)}
                  />
                </div>
              </article>
            ))}
          </div>
        </ArrivalReliabilitySectionBody>
      </GlassPanel>
    </section>
  );
}
