import type { OperationalNarrative } from '@/types/operationalNarrative';
import { getEfficiency } from '@/lib/drivesAggregation';
import type { useDrivesListPageData } from '../../hooks/useDrivesListPageData';
import type { useDrivesListPageFilters } from '../../hooks/useDrivesListPageFilters';
import type { useDrivesListPageSummary } from '../../hooks/useDrivesListPageSummary';

type NarrativeInput = ReturnType<typeof useDrivesListPageData>
  & ReturnType<typeof useDrivesListPageFilters>
  & ReturnType<typeof useDrivesListPageSummary>;

export function buildDrivesListNarrative(input: NarrativeInput): OperationalNarrative {
  const {
    t, fmtNumber, toDistanceDisplay, distanceUnit, toEfficiencyDisplay,
    efficiencyUnit, anomalyDrives, dateFilteredDrives, anomalyDriveIds,
    currentStats, efficiencyMovementPct, driveAttention, missingEfficiencyCount,
    routeContextCount,
  } = input;
  const narrativeSourceDrives =
    anomalyDrives.length > 0 ? anomalyDrives : dateFilteredDrives;
  const narrativeEvidence: OperationalNarrative['evidence'] = narrativeSourceDrives
    .slice(0, 5)
    .map((drive) => {
      const efficiency = getEfficiency(drive);
      return {
        id: `drive-${drive.id}`,
        summary: t(
          'operations.drives.narrative.driveSummary',
          '{{date}}: {{distance}} at {{efficiency}}; {{route}}.',
          {
            date: drive.startTs,
            distance: `${fmtNumber(toDistanceDisplay(drive.distanceM ?? 0))} ${distanceUnit}`,
            efficiency:
              efficiency == null
                ? t('operations.drives.narrative.efficiencyMissing', 'efficiency unavailable')
                : `${fmtNumber(toEfficiencyDisplay(efficiency))} ${efficiencyUnit}`,
            route:
              drive.startAddress && drive.endAddress
                ? `${drive.startAddress} → ${drive.endAddress}`
                : t('operations.drives.narrative.routeMissing', 'route context incomplete'),
          },
        ),
        observedAt: drive.endTs ?? drive.startTs,
        provenance: {
          source: t('operations.drives.historySource', 'Drive history'),
          recordId: String(drive.id),
          method: anomalyDriveIds.has(drive.id)
            ? t(
                'operations.drives.narrative.exceptionMethod',
                'Measured energy intensity matched the deterministic exception grade.',
              )
            : t(
                'operations.drives.narrative.driveMethod',
                'Direct completed-drive distance, energy, and route record.',
              ),
        },
      };
    });
  const narrative: OperationalNarrative = {
    whatChanged: t(
      'operations.drives.narrative.whatChanged',
      '{{drives}} drives covered {{distance}} at {{efficiency}} average energy intensity; {{exceptions}} records were flagged.',
      {
        drives: currentStats.count,
        distance: `${fmtNumber(toDistanceDisplay(currentStats.totalDistanceM))} ${distanceUnit}`,
        efficiency:
          currentStats.avgEfficiencyWhKm == null
            ? t('operations.drives.narrative.efficiencyMissing', 'efficiency unavailable')
            : `${fmtNumber(toEfficiencyDisplay(currentStats.avgEfficiencyWhKm))} ${efficiencyUnit}`,
        exceptions: anomalyDrives.length,
      },
    ),
    whyItMatters: t(
      'operations.drives.narrative.impact',
      'Measured energy intensity and route coverage reveal operational exceptions without guessing at their cause.',
    ),
    confidence: {
      label:
        currentStats.efficiencyMeasuredCount >= 10 && efficiencyMovementPct != null
          ? 'high'
          : currentStats.efficiencyMeasuredCount > 0
            ? 'medium'
            : 'low',
      score: null,
      basis: [
        t(
          'operations.drives.narrative.energyBasis',
          '{{measured}} of {{total}} drives include measured energy and sufficient distance.',
          {
            measured: currentStats.efficiencyMeasuredCount,
            total: currentStats.count,
          },
        ),
        efficiencyMovementPct != null
          ? t(
              'operations.drives.narrative.comparisonBasis',
              'The immediately preceding period provides a measured comparison baseline.',
            )
          : t(
              'operations.drives.narrative.comparisonLimitedBasis',
              'A comparable preceding-period energy baseline is unavailable.',
            ),
      ],
    },
    likelyCause: null,
    recommendedResponse:
      driveAttention[0]?.description
      ?? t(
        'operations.drives.narrative.monitorResponse',
        'No immediate response is indicated; continue monitoring energy intensity as more drives complete.',
      ),
    limitations: [
      ...(missingEfficiencyCount > 0
        ? [
            t(
              'operations.drives.narrative.energyLimitation',
              '{{count}} drive records are excluded from efficiency because measured energy or sufficient distance is missing.',
              { count: missingEfficiencyCount },
            ),
          ]
        : []),
      ...(routeContextCount < currentStats.count
        ? [
            t(
              'operations.drives.narrative.routeLimitation',
              '{{count}} drive records lack complete origin and destination evidence.',
              { count: currentStats.count - routeContextCount },
            ),
          ]
        : []),
      t(
        'operations.drives.narrative.causeLimitation',
        'Drive records do not isolate weather, traffic, payload, HVAC use, or road grade as a cause.',
      ),
      t(
        'operations.drives.narrative.evidenceLimit',
        'Supporting evidence is limited to five exception or recent-drive records.',
      ),
    ],
    evidence: narrativeEvidence,
    provenance: [
      {
        source: t('operations.drives.historySource', 'Drive history'),
        method: t(
          'operations.drives.narrative.historyMethod',
          'Aggregates completed-drive distance and measured energy in canonical units, excluding incomplete efficiency records.',
        ),
      },
    ],
  };
  return narrative;
}
