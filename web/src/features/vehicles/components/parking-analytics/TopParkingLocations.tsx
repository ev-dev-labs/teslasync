import { MapPin, ParkingCircle } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/feedback';
import {
  Badge,
  DataTable,
  GlassPanel,
  HelpTooltip,
  PanelTitle,
  Text,
  type Column,
} from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';

import type { LocationDwell, ParkingSummary } from '../../lib/parkingDwell';
import { ParkingSectionBody } from './ParkingSectionBody';
import type { ParkingSectionState } from './types';

interface TopParkingLocationsProps {
  summary: ParkingSummary;
  state: ParkingSectionState;
  className?: string;
}

/** Destination-address aggregation for all reconstructed stints. */
export function TopParkingLocations({
  summary,
  state,
  className,
}: TopParkingLocationsProps) {
  const { t } = useTranslation();
  const { formatDuration } = useUnits();
  const ongoing = summary.stints.find((stint) => stint.ongoing);
  const columns = useMemo<Column<LocationDwell>[]>(
    () => [
      {
        key: 'location',
        header: t('parking.location', 'Location'),
        visibleOnMobile: true,
        render: (row) => (
          <span className="flex items-center gap-2">
            <Text
              variant="bodySm"
              className="block max-w-64 truncate"
              title={row.location ?? undefined}
            >
              {row.location ?? t('parking.unknown', 'Unknown location')}
            </Text>
            {ongoing?.location === row.location ? (
              <Badge variant="info" size="sm">
                {t('parking.now', 'now')}
              </Badge>
            ) : null}
          </span>
        ),
      },
      {
        key: 'stints',
        header: t('parking.stints', 'Stints'),
        align: 'right',
        render: (row) => (
          <Text variant="body" mono>
            {fmtInt(row.stints)}
          </Text>
        ),
      },
      {
        key: 'totalMs',
        header: t('parking.dwell', 'Time Parked'),
        align: 'right',
        visibleOnMobile: true,
        render: (row) => (
          <Text variant="body" mono>
            {formatDuration(row.totalMs / 1_000, { precision: 1 })}
          </Text>
        ),
      },
      {
        key: 'share',
        header: t('parking.share', 'Share'),
        align: 'right',
        render: (row) => (
          <Text variant="body" mono>
            {fmtNumber(row.share * 100, 0)}%
          </Text>
        ),
      },
    ],
    [formatDuration, ongoing, t],
  );

  return (
    <section
      className={className}
      aria-label={t('parking.sections.locations', 'Top parking locations')}
      data-testid="parking-locations"
    >
      <GlassPanel className="h-full p-4 sm:p-5">
        <PanelTitle className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('parking.topLocations', 'Where It Sits')}
          <HelpTooltip
            size="sm"
            i18nKey="help.parkingAnalytics.body"
            defaultValue="Parking stints are reconstructed from the gaps between consecutive drives, located at the previous drive's destination. The overnight share counts parked time falling between 22:00 and 06:00 local."
            ariaLabel={t(
              'help.parkingAnalytics.iconLabel',
              'More info about parking analytics',
            )}
          />
        </PanelTitle>
        <Text as="p" variant="caption" className="mt-1">
          {t(
            'parking.locations.subtitle',
            '{{count}} location groups across {{stints}} reconstructed stints',
            {
              count: summary.locations.length,
              stints: fmtInt(summary.stints.length),
            },
          )}
        </Text>
        <ParkingSectionBody state={state} className="mt-3 min-h-72">
          {summary.locations.length === 0 ? (
            <EmptyState
              className="h-full"
              icon={<ParkingCircle className="h-8 w-8" aria-hidden="true" />}
              message={t(
                'parking.locations.empty',
                'No destination-linked parking stints are available in this window.',
              )}
              actionTo={{
                label: t('parking.browseDrives', 'Browse drives'),
                to: '/drives',
              }}
            />
          ) : (
            <DataTable
              tableId="vehicles:parking-locations"
              columns={columns}
              data={summary.locations}
              keyExtractor={(row) => row.location ?? '__unknown__'}
              emptyMessage={t(
                'parking.locations.empty',
                'No destination-linked parking stints are available in this window.',
              )}
              mobileColumns={['location', 'totalMs']}
              pagination
            />
          )}
        </ParkingSectionBody>
      </GlassPanel>
    </section>
  );
}
