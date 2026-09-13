import { Icons } from '@/lib/icons';
import { useTranslation } from 'react-i18next';
import { useGhostDrives } from '@/api/hooks/useOwnership';
import { useDataState } from '@/hooks/useDataState';
import { AlertBanner, QueryError } from '@/components/feedback';
import { Badge, Button, DataTable, Text } from '@/components/ui';
import type { Column } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import type { GhostDrive } from '@/types/ownership';
import { OwnershipPanel } from './OwnershipPanel';
import { formatPct, formatSpan } from '../formatters';

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
  const { t } = useTranslation();
  const units = useUnits();
  const ghostsQuery = useGhostDrives(vehicleId, windowDays);
  const ghostsState = useDataState(ghostsQuery);

  const ghosts = ghostsQuery.data?.ghosts ?? [];
  const scanned = ghostsQuery.data?.scanned ?? 0;

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
      header: t('ownership.ghost.col.score', 'Ghost score'),
      render: (row) => (
        <div className="flex min-w-[7rem] items-center gap-2">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
            <div
              className="h-full rounded-full bg-rose-400/70"
              style={{ width: `${Math.min(100, Math.max(0, row.score))}%` }}
            />
          </div>
          <Badge variant={scoreTone(row.score)}>{fmtNumber(row.score, 0)}</Badge>
        </div>
      ),
      sortable: true,
    },
    {
      key: 'trip',
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
      header: t('ownership.ghost.col.deviation', 'Deviation'),
      render: (row) => (
        <div>
          <span className="tabular-nums">
            {t('ownership.ghost.ratio', '{{ratio}}× typical', {
              ratio: fmtNumber(row.distance_ratio, 1),
            })}
          </span>
          <Text as="p" variant="caption">
            {t('ownership.ghost.confidence', '{{pct}} confidence', {
              pct: formatPct(row.confidence_pct, 0),
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
        <Button variant="ghost" size="sm" onClick={() => onLabel(row.drive_id)}>
          {t('ownership.driver.fp.assign', 'Label')}
        </Button>
      ),
    },
  ];

  return (
    <OwnershipPanel
      title={t('ownership.ghost.title', 'Ghost-driver alerts')}
      description={t(
        'ownership.ghost.subtitle',
        'Recent drives that match no named driver and behave unlike the rest. Confirm who was driving — or investigate.',
      )}
      actions={
        ghosts.length > 0 ? (
          <Badge variant="warning">
            <Icons.ghost className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            {t('ownership.ghost.count', '{{count}} flagged', { count: ghosts.length })}
          </Badge>
        ) : undefined
      }
      empty={!ghostsState.fatalError && (ghostsQuery.isLoading || ghosts.length === 0)}
      emptyMessage={
        ghostsQuery.isLoading
          ? t('ownership.ghost.scanning', 'Scanning recent drives…')
          : t(
              'ownership.ghost.clear',
              'No unknown-driver activity in this window — every scanned drive fits a known profile.',
            )
      }
    >
      {ghostsState.fatalError ? (
        <QueryError error={ghostsState.fatalError} onRetry={() => ghostsState.retry?.()} />
      ) : null}
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
        data={ghosts}
        keyExtractor={(row) => row.drive_id}
        tableId="ownership-ghost-drives"
      />
    </OwnershipPanel>
  );
}
