import { useMemo } from 'react';
import { FolderSearch } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AlertBanner, EmptyState } from '@/components/feedback';
import {
  DataTable,
  GlassPanel,
  PanelTitle,
  type Column,
} from '@/components/ui';
import type { ShareCardRepresentativeDrive } from '../../lib/shareCard';
import { ShareCardSectionBody } from './ShareCardSectionBody';
import type { ShareCardSectionProps } from './types';

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

  return (
    <section
      data-testid="share-card-representative-directory"
      aria-label={t('shareCard.directory.aria', 'Privacy-aware representative drive directory')}
    >
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-4 flex items-center gap-2">
          <FolderSearch className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('shareCard.directory.title', 'Representative drive directory')}
        </PanelTitle>
        <ShareCardSectionBody state={state}>
          <AlertBanner variant="info" className="mb-4">
            {t(
              'shareCard.directory.privacy',
              'Ranked by measured distance. Exact addresses, route text, coordinates, and map geometry are never copied into this workspace or SVG.',
            )}
          </AlertBanner>
          {analysis.representatives.length > 0 ? (
            <DataTable
              tableId="share-card:representative-drives"
              data={[...analysis.representatives]}
              columns={columns}
              keyExtractor={(drive) => drive.id}
              density="compact"
              pagination={false}
              mobileColumns={['rank', 'day', 'distance']}
            />
          ) : (
            <EmptyState
              message={t(
                'shareCard.directory.empty',
                'No eligible drive can be ranked for this selected window.',
              )}
            />
          )}
        </ShareCardSectionBody>
      </GlassPanel>
    </section>
  );
}
