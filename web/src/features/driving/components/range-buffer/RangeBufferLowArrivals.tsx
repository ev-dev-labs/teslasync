import { useMemo } from 'react';
import { BatteryWarning } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  DataTable,
  GlassPanel,
  PanelTitle,
  Text,
  type Column,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/dateFormat';
import type {
  RangeBufferLowArrival,
  RangeBufferResult,
} from '../../lib/rangeBuffer';
import { rangeBufferPercent } from './labels';
import { RangeBufferSectionBody } from './RangeBufferSectionBody';
import type {
  RangeBufferDistanceFormatter,
  RangeBufferQueryState,
} from './types';

interface RangeBufferLowArrivalsProps {
  result: RangeBufferResult;
  state: RangeBufferQueryState;
  locale: string;
  timeZone: string;
  formatDistance: RangeBufferDistanceFormatter;
}

export function RangeBufferLowArrivals({
  result,
  state,
  locale,
  timeZone,
  formatDistance,
}: RangeBufferLowArrivalsProps) {
  const { t } = useTranslation();
  const columns = useMemo<Column<RangeBufferLowArrival>[]>(
    () => [
      {
        key: 'date',
        header: t('rangeBuffer.lowArrivals.date', 'Completed'),
        visibleOnMobile: true,
        render: (row) => (
          <Text variant="bodySm">
            {formatDateTime(row.endTs, {
              locale,
              tz: timeZone,
            })}
          </Text>
        ),
      },
      {
        key: 'destination',
        header: t(
          'rangeBuffer.lowArrivals.destination',
          'Destination',
        ),
        visibleOnMobile: true,
        render: (row) => (
          <Text variant="bodySm">
            {row.destinationLabel
              ?? t(
                'rangeBuffer.lowArrivals.unknownDestination',
                'Unknown endpoint',
              )}
          </Text>
        ),
      },
      {
        key: 'distance',
        header: t('rangeBuffer.lowArrivals.distance', 'Distance'),
        align: 'right',
        render: (row) => (
          <Text variant="bodySm" className="font-mono tabular-nums">
            {formatDistance(row.distanceM, { precision: 1 })}
          </Text>
        ),
      },
      {
        key: 'start',
        header: t('rangeBuffer.lowArrivals.start', 'Start SoC'),
        align: 'right',
        render: (row) => (
          <Text variant="bodySm" className="font-mono tabular-nums">
            {rangeBufferPercent(row.startPct, locale)}
          </Text>
        ),
      },
      {
        key: 'drop',
        header: t(
          'rangeBuffer.lowArrivals.drop',
          'Drive drop',
        ),
        align: 'right',
        render: (row) => (
          <Text variant="bodySm" className="font-mono tabular-nums">
            {rangeBufferPercent(row.dropPct, locale)}
          </Text>
        ),
      },
      {
        key: 'arrival',
        header: t('rangeBuffer.lowArrivals.arrival', 'Arrival SoC'),
        align: 'right',
        sortable: true,
        visibleOnMobile: true,
        render: (row) => (
          <Text
            variant="bodySm"
            className={cn(
              'font-mono font-semibold tabular-nums',
              row.arrivalPct < 10
                ? 'text-rose-300'
                : row.arrivalPct < result.config.thresholdPct
                  ? 'text-amber-300'
                  : 'text-emerald-300',
            )}
          >
            {rangeBufferPercent(row.arrivalPct, locale)}
          </Text>
        ),
      },
    ],
    [
      formatDistance,
      locale,
      result.config.thresholdPct,
      t,
      timeZone,
    ],
  );

  return (
    <section data-testid="range-buffer-low-arrivals">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <BatteryWarning
            className="h-4 w-4 text-amber-300"
            aria-hidden="true"
          />
          {t(
            'rangeBuffer.lowArrivals.title',
            'Ten lowest observed arrivals',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'rangeBuffer.lowArrivals.subtitle',
            'Ranked by end SoC, then newest completion; this is evidence review, not a future-risk prediction.',
          )}
        </Text>
        <RangeBufferSectionBody result={result} state={state}>
          <DataTable
            tableId="driving:range-buffer-low-arrivals"
            columns={columns}
            data={result.lowArrivals}
            keyExtractor={(row) => row.driveId}
            mobileColumns={['date', 'destination', 'arrival']}
            emptyMessage={t(
              'rangeBuffer.lowArrivals.empty',
              'No included arrivals are available.',
            )}
          />
        </RangeBufferSectionBody>
      </GlassPanel>
    </section>
  );
}
