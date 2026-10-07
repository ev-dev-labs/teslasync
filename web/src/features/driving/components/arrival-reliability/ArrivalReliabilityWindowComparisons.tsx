import { Clock3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AlertBanner } from '@/components/feedback';
import {
  GlassPanel,
  Heading,
  MetricLabel,
  MetricValue,
  PanelTitle,
  Text,
} from '@/components/ui';
import { fmtInt } from '@/lib/numberFormat';
import type {
  ArrivalReliabilityResult,
  ReliabilityWindow,
} from '../../lib/arrivalReliability';
import { ArrivalReliabilitySectionBody } from './ArrivalReliabilitySectionBody';
import {
  arrivalIndex,
  arrivalLocalHour,
  arrivalPercent,
} from './labels';
import type {
  ArrivalReliabilityQueryState,
  DurationFormatter,
} from './types';

interface ArrivalReliabilityWindowComparisonsProps {
  analysis: ArrivalReliabilityResult;
  state: ArrivalReliabilityQueryState;
  locale: string;
  timeZone: string;
  formatDuration: DurationFormatter;
}

function WindowMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <MetricLabel>{label}</MetricLabel>
      <MetricValue className="mt-0.5">{value}</MetricValue>
    </div>
  );
}

export function ArrivalReliabilityWindowComparisons({
  analysis,
  state,
  locale,
  timeZone,
  formatDuration,
}: ArrivalReliabilityWindowComparisonsProps) {
  const { t } = useTranslation();
  const ranked = analysis.supportedWindows;
  const displayed =
    ranked.length <= 6
      ? ranked
      : [...ranked.slice(0, 5), ranked[ranked.length - 1]!];
  const windowLabel = (window: ReliabilityWindow) =>
    t('arrivalReliability.windows.windowValue', '{{start}}–{{end}}', {
      start: arrivalLocalHour(window.bucketStartHour, locale),
      end: arrivalLocalHour((window.bucketStartHour + 2) % 24, locale),
    });
  const rankLabel = (index: number, window: ReliabilityWindow) => {
    if (analysis.soleSupportedWindow?.routeKey === window.routeKey) {
      return t(
        'arrivalReliability.windows.soleLabel',
        'Only supported route-window',
      );
    }
    if (index === 0) {
      return t(
        'arrivalReliability.windows.highestLabel',
        'Highest observed timing consistency',
      );
    }
    if (window === ranked[ranked.length - 1]) {
      return t(
        'arrivalReliability.windows.lowestLabel',
        'Lowest observed timing consistency',
      );
    }
    return t('arrivalReliability.windows.rankLabel', 'Rank {{rank}}', {
      rank: fmtInt(index + 1),
    });
  };

  return (
    <section data-testid="arrival-window-comparisons">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <Clock3 className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t(
            'arrivalReliability.windows.title',
            'Supported route-window comparisons',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'arrivalReliability.windows.subtitle',
            'Ranked descriptive comparisons for route and vehicle-local two-hour combinations with at least three drives.',
          )}
        </Text>
        <ArrivalReliabilitySectionBody
          analysis={analysis}
          state={state}
          requirement="windows"
        >
          {analysis.soleSupportedWindow ? (
            <AlertBanner className="mb-4" variant="info">
              <Text as="p" variant="caption">
                {t(
                  'arrivalReliability.windows.soleNotice',
                  'Only one route-window is supported, so no highest-versus-lowest comparison is asserted.',
                )}
              </Text>
            </AlertBanner>
          ) : null}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {displayed.map((window, index) => (
              <article
                key={`${window.routeKey}-${window.bucketStartHour}`}
                className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4"
              >
                <Text as="p" variant="label">
                  {rankLabel(index, window)}
                </Text>
                <Heading level="sub" className="mt-1">
                  {window.routeLabel}
                </Heading>
                <Text as="p" variant="caption" className="mt-1">
                  {t(
                    'arrivalReliability.windows.localWindow',
                    '{{window}} in {{timeZone}}',
                    { window: windowLabel(window), timeZone },
                  )}
                </Text>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <WindowMetric
                    label={t(
                      'arrivalReliability.windows.consistency',
                      'Timing consistency',
                    )}
                    value={arrivalIndex(
                      window.timingConsistencyIndex,
                      locale,
                    )}
                  />
                  <WindowMetric
                    label={t(
                      'arrivalReliability.windows.allowance',
                      'Observed within-allowance share',
                    )}
                    value={arrivalPercent(
                      window.withinAllowanceShare,
                      locale,
                    )}
                  />
                  <WindowMetric
                    label={t('arrivalReliability.windows.p50', 'Observed p50')}
                    value={formatDuration(window.p50DurationS, {
                      precision: 1,
                    })}
                  />
                  <WindowMetric
                    label={t('arrivalReliability.windows.p90', 'Observed p90')}
                    value={formatDuration(window.p90DurationS, {
                      precision: 1,
                    })}
                  />
                </div>
                <Text as="p" variant="caption" className="mt-3">
                  {t(
                    'arrivalReliability.windows.support',
                    '{{count}} samples · route allowance {{allowance}}',
                    {
                      count: window.samples,
                      allowance: formatDuration(
                        window.allowanceThresholdS,
                        { precision: 1 },
                      ),
                    },
                  )}
                </Text>
              </article>
            ))}
          </div>
        </ArrivalReliabilitySectionBody>
      </GlassPanel>
    </section>
  );
}
