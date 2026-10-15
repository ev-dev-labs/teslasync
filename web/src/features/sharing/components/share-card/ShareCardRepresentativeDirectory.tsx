import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { AlertBanner, EmptyState } from '@/components/feedback';
import {
  DataTable,
  type Column,
} from '@/components/ui';
import { LayoutCard } from '@/components/layout';
import { applyColumnLayout, getColumnLayout, readLegacyVisibleLayout } from '@/lib/columnOrderStore';
import { defaultExportFilename, downloadCSV, downloadJSON, toCSV } from '@/lib/csvExport';
import type { ShareCardRepresentativeDrive } from '../../lib/shareCard';
import { ShareCardSectionBody } from './ShareCardSectionBody';
import type { ShareCardSectionProps } from './types';

const TABLE_ID = 'share-card:representative-drives';

export function ShareCardRepresentativeDirectory({
  analysis,
  state,
  display,
}: ShareCardSectionProps) {
  const { t } = useTranslation();
  const columns = useMemo<Array<Column<ShareCardRepresentativeDrive>>>(
    () => [
      {
        key: 'rank',
        align: 'right',
        header: t('shareCard.directory.rank', 'Rank'),
        render: (drive) => t('shareCard.directory.rankValue', '#{{rank}}', {
          rank: drive.rank,
        }),
        visibleOnMobile: true,
      },
      {
        key: 'day',
        header: t('shareCard.directory.day', 'Vehicle-local day'),
        render: (drive) => drive.localDay,
        visibleOnMobile: true,
      },
      {
        key: 'distance',
        header: t('shareCard.directory.distance', 'Distance'),
        render: (drive) => display.formatDistance(drive.distanceM),
        align: 'right',
        visibleOnMobile: true,
      },
      {
        key: 'duration',
        header: t('shareCard.directory.duration', 'Duration'),
        render: (drive) => display.formatDuration(drive.durationS),
        align: 'right',
      },
      {
        key: 'energy',
        header: t('shareCard.directory.energy', 'Energy'),
        render: (drive) => display.formatEnergy(drive.energyWh),
        align: 'right',
      },
      {
        key: 'efficiency',
        header: t('shareCard.directory.efficiency', 'Efficiency'),
        render: (drive) => display.formatEfficiency(drive.efficiencyWhPerKm),
        align: 'right',
      },
      {
        key: 'route',
        header: t('shareCard.directory.route', 'Route labels'),
        render: (drive) => drive.hasRouteLabels
          ? t('shareCard.directory.withheld', 'Present · withheld')
          : t('shareCard.directory.notRecorded', 'Not recorded'),
      },
    ],
    [display, t],
  );
  const onExport = useCallback((format: 'csv' | 'json', rows: readonly ShareCardRepresentativeDrive[]) => {
    const filename = defaultExportFilename(TABLE_ID);
    if (format === 'json') {
      // Export only privacy-safe evidence, never display units or route details.
      downloadJSON(filename, rows.map((drive) => ({
        rank: drive.rank,
        local_day: drive.localDay,
        distance_m: drive.distanceM ?? null,
        duration_s: drive.durationS ?? null,
        energy_wh: drive.energyWh ?? null,
        efficiency_wh_per_km: drive.efficiencyWhPerKm ?? null,
        has_route_labels: drive.hasRouteLabels,
      })));
    } else {
      const layout = getColumnLayout(TABLE_ID)
        ?? readLegacyVisibleLayout(TABLE_ID, columns.map((column) => column.key));
      downloadCSV(filename, toCSV(rows, applyColumnLayout(columns, layout).map((column) => ({
        key: column.key,
        header: column.header,
        accessor: (drive) => String(column.render(drive) ?? ''),
      }))));
    }
  }, [columns]);

  return (
    <section
      data-testid="share-card-representative-directory"
      aria-label={t('shareCard.directory.aria', 'Privacy-aware representative drive directory')}
    >
      <LayoutCard title={t('shareCard.directory.title', 'Representative drive directory')}>
        <ShareCardSectionBody state={state}>
          <AlertBanner variant="info" className="mb-4">
            {t(
              'shareCard.directory.privacy',
              'Ranked by measured distance. Exact addresses, route text, coordinates, and map geometry are never copied into this workspace or SVG.',
            )}
          </AlertBanner>
          {analysis.representatives.length > 0 ? (
            <DataTable
              tableId={TABLE_ID}
              data={[...analysis.representatives]}
              columns={columns}
              keyExtractor={(drive) => drive.id}
              density="compact"
              pagination={false}
              onExport={onExport}
              mobileColumns={['rank', 'day', 'distance']}
              mobilePresentation={{
                variant: 'cards',
                roles: {
                  rank: 'meta', day: 'title', distance: 'primary',
                  duration: 'hidden', energy: 'hidden',
                  efficiency: 'hidden', route: 'hidden',
                },
                displayValue: (drive, key) => {
                  switch (key) {
                    case 'rank': return t('shareCard.directory.rankValue', '#{{rank}}', { rank: drive.rank });
                    case 'day': return drive.localDay;
                    case 'distance': return display.formatDistance(drive.distanceM);
                    case 'duration': return display.formatDuration(drive.durationS);
                    case 'energy': return display.formatEnergy(drive.energyWh);
                    case 'efficiency': return display.formatEfficiency(drive.efficiencyWhPerKm);
                    case 'route': return drive.hasRouteLabels
                      ? t('shareCard.directory.withheld', 'Present · withheld')
                      : t('shareCard.directory.notRecorded', 'Not recorded');
                    default: return null;
                  }
                },
              }}
            />
          ) : (
            <EmptyState /* no-action: the shared report is read-only and reflects its fixed evidence scope */
              message={t(
                'shareCard.directory.empty',
                'No eligible drive can be ranked for this selected window.',
              )}
            />
          )}
        </ShareCardSectionBody>
      </LayoutCard>
    </section>
  );
}
