import {
  BatteryCharging,
  BatteryMedium,
  Database,
  Gauge,
  Route,
  TrendingDown,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import { AlertBanner } from '@/components/feedback';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { fmtInt } from '@/lib/numberFormat';
import type { RangeBufferResult } from '../../lib/rangeBuffer';
import { rangeBufferPercent } from './labels';
import { RangeBufferSectionBody } from './RangeBufferSectionBody';
import type {
  RangeBufferDistanceFormatter,
  RangeBufferQueryState,
} from './types';

interface RangeBufferDriveContextProps {
  result: RangeBufferResult;
  state: RangeBufferQueryState;
  locale: string;
  formatDistance: RangeBufferDistanceFormatter;
}

export function RangeBufferDriveContext({
  result,
  state,
  locale,
  formatDistance,
}: RangeBufferDriveContextProps) {
  const { t } = useTranslation();
  const context = result.driveContext;

  return (
    <section data-testid="range-buffer-drive-context">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <Gauge
            className="h-4 w-4 text-cyan-300"
            aria-hidden="true"
          />
          {t(
            'rangeBuffer.context.title',
            'Drive-use context and field coverage',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'rangeBuffer.context.subtitle',
            'Start SoC, drive-associated SoC drop, and positive SI distance are secondary coverage fields; they do not decide arrival inclusion.',
          )}
        </Text>
        <RangeBufferSectionBody result={result} state={state}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <MetricCard
              label={t(
                'rangeBuffer.context.startCoverage',
                'Valid start SoC',
              )}
              value={fmtInt(context.startSocRows)}
              subtitle={t(
                'rangeBuffer.context.ofIncluded',
                'of {{count}} included arrivals',
                { count: result.accounting.includedRows },
              )}
              icon={<Database className="h-5 w-5" />}
              color="cyan"
            />
            <MetricCard
              label={t(
                'rangeBuffer.context.medianStart',
                'Median start SoC',
              )}
              value={rangeBufferPercent(
                context.medianStartPct,
                locale,
              )}
              subtitle={t(
                'rangeBuffer.context.validStartsOnly',
                'valid start-SoC rows only',
              )}
              icon={<BatteryCharging className="h-5 w-5" />}
              color="blue"
            />
            <MetricCard
              label={t(
                'rangeBuffer.context.medianDrop',
                'Median drive-associated drop',
              )}
              value={rangeBufferPercent(
                context.medianDropPct,
                locale,
              )}
              subtitle={t(
                'rangeBuffer.context.nonnegativeOnly',
                'nonnegative start-to-end rows',
              )}
              icon={<TrendingDown className="h-5 w-5" />}
              color="green"
            />
            <MetricCard
              label={t(
                'rangeBuffer.context.p90Drop',
                'Observed p90 drop',
              )}
              value={rangeBufferPercent(
                context.p90DropPct,
                locale,
              )}
              subtitle={t(
                'rangeBuffer.context.depletionRows',
                '{{count}} depletion-eligible rows',
                { count: context.depletionRows },
              )}
              icon={<BatteryMedium className="h-5 w-5" />}
              color="amber"
            />
            <MetricCard
              label={t(
                'rangeBuffer.context.distanceCoverage',
                'Positive distance',
              )}
              value={fmtInt(context.distanceRows)}
              subtitle={t(
                'rangeBuffer.context.ofIncluded',
                'of {{count}} included arrivals',
                { count: result.accounting.includedRows },
              )}
              icon={<Route className="h-5 w-5" />}
              color="purple"
            />
            <MetricCard
              label={t(
                'rangeBuffer.context.medianDistance',
                'Median drive distance',
              )}
              value={formatDistance(context.medianDistanceM, {
                precision: 1,
              })}
              subtitle={t(
                'rangeBuffer.context.distanceRowsOnly',
                'positive finite distance rows',
              )}
              icon={<Route className="h-5 w-5" />}
              color="cyan"
            />
          </div>
          <AlertBanner className="mt-4" variant="info">
            <Text as="p" variant="caption">
              {t(
                'rangeBuffer.context.exclusions',
                '{{invalidStart}} included rows lack usable start SoC; {{increasing}} rows ended above their valid start SoC and are excluded only from depletion summaries.',
                {
                  invalidStart: context.invalidStartSocRows,
                  increasing: context.increasingSocRows,
                },
              )}
            </Text>
          </AlertBanner>
        </RangeBufferSectionBody>
      </GlassPanel>
    </section>
  );
}
