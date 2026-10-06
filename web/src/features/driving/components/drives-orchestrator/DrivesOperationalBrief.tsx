import { GitCompareArrows } from 'lucide-react';
import { Badge, Button } from '@/components/ui';
import { OperationalBrief, DataProvenanceBadge } from '@/components/data-display';
import { DrivesBriefSource } from '../continuation-driving-primary/DrivesBriefSource';
import type { DrivesListPageController } from '../../hooks/useDrivesListPage';

type Props = Pick<DrivesListPageController,
  't' | 'isDrivesLoading' | 'hasDrivePayload' | 'drivesState' | 'refetchDrives'
  | 'currentStats' | 'anomalyDrives' | 'missingEfficiencyCount' | 'narrative'
  | 'datePresetLabel' | 'startDate' | 'endDate' | 'fmtCompact' | 'distanceUnit'
  | 'distMi' | 'efficiencyUnit' | 'avgEffDisp' | 'fmtInt' | 'efficiencyMovementValue'
  | 'efficiencyMovementTone' | 'routeContextCount' | 'driveAttention' | 'navigate'>;

export function DrivesOperationalBrief({
  t, isDrivesLoading, hasDrivePayload, drivesState, refetchDrives,
  currentStats, anomalyDrives, missingEfficiencyCount, narrative,
  datePresetLabel, startDate, endDate, fmtCompact, distanceUnit, distMi,
  efficiencyUnit, avgEffDisp, fmtInt, efficiencyMovementValue,
  efficiencyMovementTone, routeContextCount, driveAttention, navigate,
}: Props) {
  return (
    <DrivesBriefSource
      initial={isDrivesLoading}
      unavailable={!hasDrivePayload}
      fatalError={drivesState.fatalError}
      onRetry={() => { void refetchDrives(); }}
    >
      <OperationalBrief
        testId="drives-operational-brief"
        compact
        eyebrow={t('operations.drives.eyebrow', 'Driving posture')}
        title={t('operations.drives.title', 'Activity, efficiency, and exceptions in context')}
        description={t(
          'operations.drives.description',
          'Measured energy, route context, and exceptions use one vehicle-aware period with direct access to supporting evidence.',
        )}
        statusLabel={
          currentStats.count === 0
            ? t('operations.status.awaitingData', 'Awaiting data')
            : anomalyDrives.length > 0 || missingEfficiencyCount > 0
              ? t('operations.status.review', 'Review recommended')
              : t('operations.status.onTrack', 'On track')
        }
        statusTone={
          currentStats.count === 0
            ? 'neutral'
            : anomalyDrives.length > 0 || missingEfficiencyCount > 0
              ? 'warning'
              : 'success'
        }
        narrative={narrative}
        scope={
          <Badge variant="neutral" size="sm">
            {datePresetLabel ?? `${startDate} → ${endDate}`}
          </Badge>
        }
        freshness={(
          <div className="flex flex-wrap items-center gap-2">
            <DataProvenanceBadge
              provenance={drivesState.provenance}
              status={drivesState.status}
              updatedAt={drivesState.updatedAt}
            />
          </div>
        )}
        metricColumns={3}
        metrics={[
          {
            key: 'drives',
            label: t('drives.totalDrives', 'Drives'),
            value: fmtCompact(currentStats.count),
            detail: t(
              'operations.drives.countDetail',
              'Completed drives in the selected analysis window.',
            ),
            tone: 'info',
          },
          {
            key: 'distance',
            label: `${t('drives.distance', 'Distance')} (${distanceUnit})`,
            value: fmtCompact(distMi, 10_000),
            detail: t(
              'operations.drives.distanceDetail',
              'Total distance traveled using the current display unit.',
            ),
            tone: 'success',
          },
          {
            key: 'efficiency',
            label: `${t('drives.efficiency', 'Energy intensity')} (${efficiencyUnit})`,
            value: avgEffDisp != null ? fmtInt(avgEffDisp) : '—',
            detail: t(
              'operations.drives.efficiencyDetail',
              '{{measured}} of {{total}} drives have measured energy and sufficient distance.',
              {
                measured: currentStats.efficiencyMeasuredCount,
                total: currentStats.count,
              },
            ),
            tone: avgEffDisp == null
              ? 'neutral'
              : anomalyDrives.length > 0
                ? 'warning'
                : 'success',
          },
          {
            key: 'movement',
            label: t('drives.decision.movement', 'Efficiency movement'),
            value: efficiencyMovementValue,
            detail: t(
              'operations.drives.movementDetail',
              'Distance-weighted energy intensity compared with the prior period.',
            ),
            tone: efficiencyMovementTone,
          },
          {
            key: 'exceptions',
            label: t('drives.decision.exceptions', 'Efficiency exceptions'),
            value: fmtCompact(anomalyDrives.length),
            detail: t(
              'operations.drives.exceptionDetail',
              'Measured drives in the high energy-intensity grade.',
            ),
            tone: anomalyDrives.length > 0 ? 'warning' : 'success',
          },
          {
            key: 'route-context',
            label: t('drives.decision.routeCoverage', 'Route context'),
            value: currentStats.count > 0
              ? `${fmtInt((routeContextCount / currentStats.count) * 100)}%`
              : '—',
            detail: t(
              'operations.drives.routeCoverageDetail',
              '{{covered}} of {{total}} drives include both origin and destination evidence.',
              { covered: routeContextCount, total: currentStats.count },
            ),
            tone: currentStats.count === 0
              ? 'neutral'
              : routeContextCount === currentStats.count
                ? 'success'
                : 'info',
          },
        ]}
        attention={driveAttention}
        actions={(
          <Button
            type="button"
            variant="secondary"
            size="sm"
            wrapLabel
            icon={<GitCompareArrows className="h-4 w-4" aria-hidden="true" />}
            onClick={() => navigate('/drive-compare')}
          >
            {t('drives.openCompare', 'Compare drives')}
          </Button>
        )}
        provenance={t(
          'operations.drives.provenance',
          'Measured energy and distance stay canonical until display; missing evidence is excluded rather than estimated.',
        )}
      />
    </DrivesBriefSource>
  );
}
