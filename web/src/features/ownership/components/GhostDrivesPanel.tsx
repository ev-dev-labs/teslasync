import { Icons } from '@/lib/icons';
import { useTranslation } from 'react-i18next';
import { useGhostDrives } from '@/api/hooks/useOwnership';
import { AlertBanner } from '@/components/feedback';
import { Badge, Button, DataTable, Text, useSortToggle } from '@/components/ui';
import type { Column } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { formatDateTime } from '@/lib/dateFormat';

import type { GhostDrive } from '@/types/ownership';
import { OwnershipPanel } from './OwnershipPanel';
import { formatPct, formatSpan } from '../formatters';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface GhostDrivesPanelProps {
  vehicleId: number | null;
  windowDays: number;
  onLabel: (driveId: number) => void;
}

function scoreTone(score: number): 'warning' | 'info' {
  return score >= 80 ? 'warning' : 'info';
}

/**
 * Ghost-driver alerting: drives that fit no named profile and sit far from
 * their cluster centroid. Same detection math as the attribution report, so
 * labelling a drive here re-anchors the cluster everywhere else.
 */
export function GhostDrivesPanel({ vehicleId, windowDays, onLabel }: GhostDrivesPanelProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const units = useUnits();
  const ghostsQuery = useGhostDrives(vehicleId, windowDays);
  const sort = useSortToggle();

  const ghosts = ghostsQuery.data?.ghosts ?? [];
  const scanned = ghostsQuery.data?.scanned;
  const sortedGhosts = sort.sortFn(ghosts, (row, key) =>
    key === 'score' ? row.score : row.distance_ratio,
  );

  const columns: Column<GhostDrive>[] = [
    {
      key: 'drive',
      header: t('ownership.ghost.col.drive', 'Drive'),
      render: (row) => (
        <div>
          <Text as="p" variant="label">
            #{row.drive_id}
          </Text>
          <Text as="p" variant="caption">
            {formatDateTime(row.started_at)}
          </Text>
        </div>
      ),
    },
    {
      key: 'score',
      align: 'right',
      header: t('ownership.ghost.col.score', 'Ghost score'),
      render: (row) => (
        <div className="flex min-w-[7rem] items-center gap-2">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
            <div
              className="h-full rounded-full bg-[var(--semantic-warning)]"
              style={{ width: `${Math.min(100, Math.max(0, row.score))}%` }}
            />
          </div>
          <Badge variant={scoreTone(row.score)}>{fmtNumber(row.score)}</Badge>
        </div>
      ),
      sortable: true,
    },
    {
      key: 'trip',
      align: 'right',
      header: t('ownership.ghost.col.trip', 'Trip'),
      render: (row) => (
        <div>
          <span className="tabular-nums">{units.formatDistance(row.distance_m)}</span>
          <Text as="p" variant="caption">
            {formatSpan(row.duration_s)}
          </Text>
        </div>
      ),
    },
    {
      key: 'deviation',
      align: 'right',
      header: t('ownership.ghost.col.deviation', 'Deviation'),
      render: (row) => (
        <div>
          <span className="tabular-nums">
            {t('ownership.ghost.ratio', '{{ratio}}× typical', {
              ratio: fmtNumber(row.distance_ratio),
            })}
          </span>
          <Text as="p" variant="caption">
            {t('ownership.ghost.confidence', '{{pct}} confidence', {
              pct: formatPct(row.confidence_pct),
            })}
          </Text>
        </div>
      ),
      sortable: true,
    },
    {
      key: 'reason',
      header: t('ownership.ghost.col.reason', 'Why flagged'),
      render: (row) => (
        <Text as="span" variant="bodySm">
          {row.reason}
        </Text>
      ),
    },
    {
      key: 'assign',
      header: t('ownership.action.header', 'Actions'),
      render: (row) => (
        <Button variant="ghost" size="sm" className="min-h-11 min-w-11" onClick={() => onLabel(row.drive_id)}>
          {t('ownership.driver.fp.assign', 'Label')}
        </Button>
      ),
    },
  ];

  return (
    <OwnershipPanel
      source={ghostsQuery}
      sourceEnabled={vehicleId != null}
      title={t('ownership.ghost.title', 'Ghost-driver alerts')}
      description={t(
        'ownership.ghost.subtitle',
        'Recent drives that match no named driver and behave unlike the rest. confirm who was driving — or investigate.',
      )}
      actions={
        vehicleId != null && ghosts.length > 0 ? (
          <Badge variant="warning">
            <Icons.ghost className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            {t('ownership.ghost.count', '{{count}} flagged', { count: ghosts.length })}
          </Badge>
        ) : undefined
      }
      empty={vehicleId == null || ghosts.length === 0}
      emptyMessage={
        vehicleId == null
          ? t('common.noVehicleSelected.title', 'No vehicle selected')
          : ghostsQuery.isLoading
            ? t('ownership.ghost.scanning', 'Scanning recent drives…')
            : scanned != null && scanned > 0
              ? t(
                  'ownership.ghost.clear',
                  'No unknown-driver activity in this window — every scanned drive fits a known profile.',
                )
              : t('ownership.driver.fingerprints.empty', 'No drives with sufficient telemetry in this window.')
      }
    >
      {ghosts.length > 0 ? (
        <div className="mb-4">
          <AlertBanner
            variant="warning"
            title={t(
              'ownership.ghost.alert.title',
              '{{count}} of {{scanned}} drives look like someone else',
              { count: ghosts.length, scanned },
            )}
          >
            {t(
              'ownership.ghost.alert.body',
              'Valet, teen, thief — or just an unusual trip. Label the drive if you recognise it; the cluster learns from every label.',
            )}
          </AlertBanner>
        </div>
      ) : null}
      <DataTable
        columns={columns}
        mobileColumns={['drive', 'score', 'reason']}
        mobilePresentation={{
          roles: { drive: 'title', score: 'primary', reason: 'meta' },
          displayValue: (row, key) => key === 'drive' ? `#${row.drive_id}`
            : key === 'score' ? fmtNumber(row.score)
              : key === 'reason' ? row.reason : null,
          inlineActions: (row) => columns.find(column => column.key === 'assign')?.render(row),
        }}
        data={sortedGhosts}
        onSort={sort.onSort}
        sortKey={sort.sortKey}
        sortDir={sort.sortDir}
        keyExtractor={(row) => row.drive_id}
        tableId="ownership-ghost-drives"
      />
    </OwnershipPanel>
  );
}
