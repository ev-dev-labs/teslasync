import { AlertTriangle, Compass, MapPin } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { EmptyState, InlineCallout } from '@/components/feedback';
import {
  DataTable,
  GlassPanel,
  HelpTooltip,
  PanelTitle,
  Text,
  type Column,
} from '@/components/ui';
import { formatDate } from '@/lib/dateFormat';
import { cn } from '@/lib/cn';

import type { Destination, ExplorerSummary } from '../../lib/explorer';
import { ExplorerSectionBody } from './ExplorerSectionBody';
import type {
  ExplorerDistanceDisplay,
  ExplorerSectionState,
} from './types';

interface DestinationDirectoryProps extends ExplorerDistanceDisplay {
  summary: ExplorerSummary;
  state: ExplorerSectionState;
  className?: string;
}

export function DestinationDirectory({
  summary,
  state,
  formatDistance,
  className,
}: DestinationDirectoryProps) {
  const { t } = useTranslation();
  const emptyMessage =
    summary.eligibility.eligible === 0
      ? t(
          'explorer.noData',
          'No located drives yet — GPS end positions are required.',
        )
      : t(
          'explorer.destination.empty',
          'No non-base destination clusters are present in this observed window.',
        );
  const columns = useMemo<Column<Destination>[]>(
    () => [
      {
        key: 'label',
        header: t('explorer.place', 'Place'),
        visibleOnMobile: true,
        render: (destination) => {
          const label =
            destination.label ??
            t(
              'explorer.destination.unnamed',
              'Unnamed destination {{number}}',
              { number: destination.ordinal },
            );
          return (
            <Text
              variant="bodySm"
              className="block max-w-[16rem] truncate"
              title={label}
            >
              {label}
            </Text>
          );
        },
      },
      {
        key: 'visits',
        header: t('explorer.visits', 'Visits'),
        align: 'right',
        sortable: true,
        visibleOnMobile: true,
        render: (destination) => (
          <Text variant="body" mono>
            {destination.visits}
          </Text>
        ),
      },
      {
        key: 'repeatVisits',
        header: t(
          'explorer.destination.repeatVisits',
          'Repeat arrivals',
        ),
        align: 'right',
        sortable: true,
        render: (destination) => (
          <Text variant="body" mono>
            {destination.repeatVisits}
          </Text>
        ),
      },
      {
        key: 'distanceFromBaseM',
        header: t(
          'explorer.destination.fromBase',
          'From inferred base',
        ),
        align: 'right',
        sortable: true,
        render: (destination) => (
          <Text variant="body" mono>
            {summary.evidence.baseSufficient
              ? formatDistance(destination.distanceFromBaseM, {
                  precision: 0,
                })
              : '—'}
          </Text>
        ),
      },
      {
        key: 'firstVisitedAt',
        header: t('explorer.firstVisit', 'First Visit'),
        align: 'right',
        sortable: true,
        render: (destination) => (
          <Text variant="bodySm">
            {formatDate(destination.firstVisitedAt)}
          </Text>
        ),
      },
    ],
    [formatDistance, summary.evidence.baseSufficient, t],
  );

  return (
    <section
      className={className}
      aria-label={t(
        'explorer.section.directory',
        'Observed destination directory',
      )}
      data-testid="explorer-destinations"
    >
      <GlassPanel className={cn('h-full p-4 sm:p-5')}>
        <PanelTitle className="mb-3 flex items-center gap-2">
          <MapPin className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('explorer.destinations', 'Destinations')}
          <HelpTooltip
            size="sm"
            i18nKey="help.explorerWorkspace.body"
            defaultValue="Drive-end coordinates are grouped into coarse 0.01° cells. The most-observed cell is an inferred base for distance comparisons, not a verified home or saved location."
            ariaLabel={t(
              'help.explorerWorkspace.iconLabel',
              'More information about destination clustering',
            )}
          />
        </PanelTitle>

        <ExplorerSectionBody state={state} className="min-h-72">
          {summary.destinations.length === 0 ? (
            <EmptyState
              icon={<Compass className="h-8 w-8" aria-hidden="true" />}
              message={emptyMessage}
              actionTo={{
                label: t('explorer.browseDrives', 'Browse drives'),
                to: '/drives',
              }}
            />
          ) : (
            <div className="space-y-3">
              {!summary.evidence.baseSufficient ? (
                <InlineCallout
                  variant="warning"
                  icon={<AlertTriangle aria-hidden="true" />}
                >
                  {t(
                    'explorer.destination.baseEvidence',
                    'Distances stay hidden until at least three located arrivals include a repeated inferred-base cluster.',
                  )}
                </InlineCallout>
              ) : null}
              <DataTable
                tableId="driving:explorer-destinations"
                columns={columns}
                data={summary.destinations}
                keyExtractor={(destination) => destination.id}
                emptyMessage={emptyMessage}
                mobileColumns={['label', 'visits']}
                pagination
              />
            </div>
          )}
        </ExplorerSectionBody>
      </GlassPanel>
    </section>
  );
}
