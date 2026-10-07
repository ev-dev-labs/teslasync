import { useMemo } from 'react';
import { MapPinned } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AlertBanner } from '@/components/feedback';
import {
  Badge,
  DataTable,
  GlassPanel,
  PanelTitle,
  Text,
  type Column,
} from '@/components/ui';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtInt } from '@/lib/numberFormat';
import type {
  RangeBufferDestinationProfile,
  RangeBufferResult,
} from '../../lib/rangeBuffer';
import {
  rangeBufferPercent,
  rangeBufferShare,
} from './labels';
import { RangeBufferSectionBody } from './RangeBufferSectionBody';
import type {
  RangeBufferDistanceFormatter,
  RangeBufferQueryState,
} from './types';

interface RangeBufferDestinationDirectoryProps {
  result: RangeBufferResult;
  state: RangeBufferQueryState;
  locale: string;
  timeZone: string;
  formatDistance: RangeBufferDistanceFormatter;
}

export function RangeBufferDestinationDirectory({
  result,
  state,
  locale,
  timeZone,
  formatDistance,
}: RangeBufferDestinationDirectoryProps) {
  const { t } = useTranslation();
  const columns = useMemo<Column<RangeBufferDestinationProfile>[]>(
    () => [
      {
        key: 'destination',
        header: t(
          'rangeBuffer.destinations.destination',
          'Destination',
        ),
        visibleOnMobile: true,
        render: (row) => (
          <div className="min-w-44">
            <Text as="p" variant="bodySm" className="font-medium">
              {row.label}
            </Text>
            <Badge
              className="mt-1"
              variant={row.source === 'address' ? 'info' : 'neutral'}
            >
              {row.source === 'address'
                ? t(
                    'rangeBuffer.destinations.address',
                    'Address',
                  )
                : t(
                    'rangeBuffer.destinations.coordinates',
                    'Rounded coordinates',
                  )}
            </Badge>
          </div>
        ),
      },
      {
        key: 'samples',
        header: t('rangeBuffer.columns.arrivals', 'Arrivals'),
        align: 'right',
        sortable: true,
        visibleOnMobile: true,
        render: (row) => (
          <Text variant="bodySm" className="font-mono tabular-nums">
            {fmtInt(row.samples)}
          </Text>
        ),
      },
      {
        key: 'activeDays',
        header: t(
          'rangeBuffer.destinations.activeDays',
          'Active days',
        ),
        align: 'right',
        render: (row) => (
          <Text variant="bodySm" className="font-mono tabular-nums">
            {fmtInt(row.activeLocalDays)}
          </Text>
        ),
      },
      {
        key: 'p10',
        header: t('rangeBuffer.destinations.p10', 'p10'),
        align: 'right',
        render: (row) => (
          <Text variant="bodySm" className="font-mono tabular-nums">
            {rangeBufferPercent(row.p10Pct, locale)}
          </Text>
        ),
      },
      {
        key: 'median',
        header: t('rangeBuffer.destinations.median', 'Median'),
        align: 'right',
        visibleOnMobile: true,
        render: (row) => (
          <Text variant="bodySm" className="font-mono tabular-nums">
            {rangeBufferPercent(row.medianPct, locale)}
          </Text>
        ),
      },
      {
        key: 'below',
        header: t(
          'rangeBuffer.destinations.below',
          'Below threshold',
        ),
        align: 'right',
        render: (row) => (
          <Text variant="bodySm" className="font-mono tabular-nums">
            {rangeBufferShare(row.belowThresholdShare, locale)}
          </Text>
        ),
      },
      {
        key: 'distance',
        header: t(
          'rangeBuffer.destinations.distance',
          'Median distance',
        ),
        align: 'right',
        render: (row) => (
          <Text variant="bodySm" className="font-mono tabular-nums">
            {formatDistance(row.medianDistanceM, { precision: 1 })}
          </Text>
        ),
      },
      {
        key: 'latest',
        header: t(
          'rangeBuffer.destinations.latest',
          'Latest arrival',
        ),
        render: (row) => (
          <Text variant="bodySm">
            {formatDateTime(new Date(row.latestArrivalMs), {
              locale,
              tz: timeZone,
            })}
          </Text>
        ),
      },
    ],
    [formatDistance, locale, t, timeZone],
  );

  return (
    <section data-testid="range-buffer-destinations">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <MapPinned
            className="h-4 w-4 text-cyan-300"
            aria-hidden="true"
          />
          {t(
            'rangeBuffer.destinations.title',
            'Supported destination profiles',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'rangeBuffer.destinations.subtitle',
            'Normalized end addresses or rounded endpoint coordinates with at least three included arrivals.',
          )}
        </Text>
        <RangeBufferSectionBody
          result={result}
          state={state}
          requirement="destinations"
        >
          <DataTable
            tableId="driving:range-buffer-destinations"
            columns={columns}
            data={result.destinationProfiles}
            keyExtractor={(row) => row.key}
            mobileColumns={['destination', 'samples', 'median']}
            pagination={{ defaultPageSize: 12 }}
            emptyMessage={t(
              'rangeBuffer.destinations.empty',
              'No destination has enough included arrivals.',
            )}
          />
          <AlertBanner className="mt-4" variant="info">
            <Text as="p" variant="caption">
              {t(
                'rangeBuffer.destinations.coverage',
                '{{supportedRows}} of {{locatableRows}} locatable arrivals belong to {{supportedDestinations}} supported destinations; {{unlocatableRows}} included rows have no usable endpoint.',
                {
                  supportedRows:
                    result.destinationCoverage.supportedRows,
                  locatableRows:
                    result.destinationCoverage.locatableRows,
                  supportedDestinations:
                    result.destinationCoverage.supportedDestinations,
                  unlocatableRows:
                    result.destinationCoverage.unlocatableRows,
                },
              )}
            </Text>
          </AlertBanner>
        </RangeBufferSectionBody>
      </GlassPanel>
    </section>
  );
}
