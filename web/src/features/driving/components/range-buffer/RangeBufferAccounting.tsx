import {
  BatteryWarning,
  CalendarX2,
  CircleSlash2,
  Database,
  MapPinned,
  Route,
  TimerOff,
  TriangleAlert,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import { AlertBanner } from '@/components/feedback';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { fmtInt } from '@/lib/numberFormat';
import type { RangeBufferResult } from '../../lib/rangeBuffer';
import { RangeBufferSectionBody } from './RangeBufferSectionBody';
import type { RangeBufferQueryState } from './types';

interface RangeBufferAccountingProps {
  result: RangeBufferResult;
  state: RangeBufferQueryState;
}

export function RangeBufferAccounting({
  result,
  state,
}: RangeBufferAccountingProps) {
  const { t } = useTranslation();
  const accounting = result.accounting;

  return (
    <section data-testid="range-buffer-accounting">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <Database
            className="h-4 w-4 text-cyan-300"
            aria-hidden="true"
          />
          {t(
            'rangeBuffer.accounting.title',
            'Row accounting and secondary coverage',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'rangeBuffer.accounting.subtitle',
            'Every returned row enters exactly one primary category; optional context fields are counted separately.',
          )}
        </Text>
        <RangeBufferSectionBody
          result={result}
          state={state}
          requirement="none"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label={t('rangeBuffer.accounting.returned', 'Returned')}
              value={fmtInt(accounting.returnedRows)}
              subtitle={t(
                'rangeBuffer.accounting.cap',
                '{{limit}}-row request cap',
                { limit: accounting.historyLimit },
              )}
              icon={<Database className="h-5 w-5" />}
              color="cyan"
            />
            <MetricCard
              label={t('rangeBuffer.accounting.included', 'Included')}
              value={fmtInt(accounting.includedRows)}
              subtitle={t(
                'rangeBuffer.accounting.validArrival',
                'valid completed arrival evidence',
              )}
              icon={<BatteryWarning className="h-5 w-5" />}
              color="green"
            />
            <MetricCard
              label={t('rangeBuffer.accounting.incomplete', 'Incomplete')}
              value={fmtInt(accounting.incompleteRows)}
              subtitle={t(
                'rangeBuffer.accounting.noEnd',
                'no completion timestamp',
              )}
              icon={<TimerOff className="h-5 w-5" />}
              color="amber"
            />
            <MetricCard
              label={t(
                'rangeBuffer.accounting.invalidTime',
                'Invalid time or order',
              )}
              value={fmtInt(
                accounting.invalidTimestampOrOrderRows,
              )}
              subtitle={t(
                'rangeBuffer.accounting.badTime',
                'unparseable or end before start',
              )}
              icon={<CalendarX2 className="h-5 w-5" />}
              color="red"
            />
            <MetricCard
              label={t('rangeBuffer.accounting.future', 'Future-dated')}
              value={fmtInt(accounting.futureRows)}
              subtitle={t(
                'rangeBuffer.accounting.afterClock',
                'completion after frozen analysis clock',
              )}
              icon={<TriangleAlert className="h-5 w-5" />}
              color="red"
            />
            <MetricCard
              label={t(
                'rangeBuffer.accounting.invalidArrival',
                'Invalid arrival SoC',
              )}
              value={fmtInt(accounting.invalidArrivalRows)}
              subtitle={t(
                'rangeBuffer.accounting.outOfRange',
                'missing, non-finite, or outside 0-100',
              )}
              icon={<CircleSlash2 className="h-5 w-5" />}
              color="amber"
            />
            <MetricCard
              label={t(
                'rangeBuffer.accounting.distance',
                'Positive distance',
              )}
              value={fmtInt(result.driveContext.distanceRows)}
              subtitle={t(
                'rangeBuffer.accounting.secondary',
                'secondary context coverage',
              )}
              icon={<Route className="h-5 w-5" />}
              color="purple"
            />
            <MetricCard
              label={t(
                'rangeBuffer.accounting.locatable',
                'Locatable endpoint',
              )}
              value={fmtInt(
                result.destinationCoverage.locatableRows,
              )}
              subtitle={t(
                'rangeBuffer.accounting.secondary',
                'secondary context coverage',
              )}
              icon={<MapPinned className="h-5 w-5" />}
              color="blue"
            />
          </div>
          <AlertBanner className="mt-4" variant="info">
            <Text as="p" variant="caption">
              {t(
                'rangeBuffer.accounting.invariant',
                '{{returned}} returned = {{included}} included + {{incomplete}} incomplete + {{invalidTime}} invalid time/order + {{future}} future-dated + {{invalidArrival}} invalid arrival SoC.',
                {
                  returned: accounting.returnedRows,
                  included: accounting.includedRows,
                  incomplete: accounting.incompleteRows,
                  invalidTime:
                    accounting.invalidTimestampOrOrderRows,
                  future: accounting.futureRows,
                  invalidArrival: accounting.invalidArrivalRows,
                },
              )}
            </Text>
          </AlertBanner>
        </RangeBufferSectionBody>
      </GlassPanel>
    </section>
  );
}
