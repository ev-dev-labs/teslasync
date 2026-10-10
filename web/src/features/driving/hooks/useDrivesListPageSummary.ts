import { useMemo } from 'react';
import { type OperationalAttention } from '@/components/data-display';
import { formatDayKey } from '@/lib/dateFormat';
import { matchPresetId, getDatePreset } from '@/lib/datePresets';
import { gradeFromEfficiency } from '@/lib/drivesAggregation';
import type { useDrivesListPageData } from './useDrivesListPageData';
import type { useDrivesListPageFilters } from './useDrivesListPageFilters';

type SummaryInput = ReturnType<typeof useDrivesListPageData>
  & ReturnType<typeof useDrivesListPageFilters>;

export function useDrivesListPageSummary(input: SummaryInput) {
  const {
    startDate, endDate, t, priorRange, toDistanceDisplay, toEfficiencyDisplay,
    costPerKwh, fmtNumber, currentStats, priorStats, dateFilteredDrives, anomalyDrives,
  } = input;

  /* ---- Period labels for the comparison header ---- */
  // Friendly format that always shows years on both ends so a Dec→Jan
  // range is unambiguous: "Apr 12, 2026 – May 12, 2026". When the active
  // range matches a known preset (Last 7d / Last 30d / MTD / YTD / All
  // time / etc.), prepend the localised preset name so the user gets the
  // semantic label up-front: "Last 30 days · Apr 12, 2026 – May 12, 2026".
  const datePresetId = useMemo(() => matchPresetId(startDate, endDate), [startDate, endDate]);
  const datePreset = datePresetId ? getDatePreset(datePresetId) : undefined;
  const datePresetLabel = datePreset ? t(datePreset.i18nKey, datePreset.fallback) : null;
  const formattedRange = `${formatDayKey(startDate, { style: 'long' })} – ${formatDayKey(endDate, { style: 'long' })}`;
  const periodLabel = datePresetLabel
    ? `${datePresetLabel} · ${formattedRange}`
    : formattedRange;
  // Comparison label rules:
  // - If the prior period has data, show "vs <range>" so the user knows
  // the deltas on each metric tile compare against that window.
  // - If the prior period is empty, render an explicit "No drives in
  // prior period: …" message instead of silently hiding the slot —
  // better to communicate "no baseline" than to leave the user
  // wondering why there's no comparison.
  // Prior range never gets a preset name (the prior window isn't user
  // selected) — full date range with years on both ends keeps it clear.
  const priorHasData = priorStats != null && priorStats.count > 0;
  let priorLabel: string | undefined;
  if (priorHasData && priorRange) {
    priorLabel = t('drives.priorPeriod', 'prior period: {{start}} – {{end}}', {
      start: formatDayKey(priorRange.start, { style: 'long' }),
      end: formatDayKey(priorRange.end, { style: 'long' }),
    });
  } else if (priorRange) {
    priorLabel = t('drives.noPriorData', 'No drives in prior period: {{start}} – {{end}}', {
      start: formatDayKey(priorRange.start, { style: 'long' }),
      end: formatDayKey(priorRange.end, { style: 'long' }),
    });
  } else {
    priorLabel = undefined;
  }

  const avgGrade = gradeFromEfficiency(currentStats.avgEfficiencyWhKm);

  /* ---- Headline grids ---- */
  const distMi = toDistanceDisplay(currentStats.totalDistanceM);
  const priorDistMi = priorStats ? toDistanceDisplay(priorStats.totalDistanceM) : null;
  const driveTimeMin = currentStats.totalDurationS / 60;
  const priorDriveTimeMin = priorStats ? priorStats.totalDurationS / 60 : null;
  const avgEffDisp = currentStats.avgEfficiencyWhKm != null
    ? toEfficiencyDisplay(currentStats.avgEfficiencyWhKm)
    : null;
  const priorEffDisp = priorStats?.avgEfficiencyWhKm != null
    ? toEfficiencyDisplay(priorStats.avgEfficiencyWhKm)
    : null;
  const totalCost = costPerKwh != null ? (currentStats.totalEnergyWh / 1_000) * costPerKwh : null;
  const priorTotalCost = costPerKwh != null && priorStats && priorStats.energyMeasuredCount > 0
    ? (priorStats.totalEnergyWh / 1_000) * costPerKwh
    : null;
  const routeContextCount = dateFilteredDrives.filter((drive) => {
    const hasStart = Boolean(
      drive.startAddress
      || (drive.startLat != null && drive.startLon != null),
    );
    const hasEnd = Boolean(
      drive.endAddress
      || (drive.endLat != null && drive.endLon != null),
    );
    return hasStart && hasEnd;
  }).length;
  const missingEfficiencyCount = Math.max(
    0,
    currentStats.count - currentStats.efficiencyMeasuredCount,
  );
  const efficiencyMovementPct = (
    currentStats.avgEfficiencyWhKm != null
    && priorStats?.avgEfficiencyWhKm != null
    && priorStats.avgEfficiencyWhKm > 0
  )
    ? ((priorStats.avgEfficiencyWhKm - currentStats.avgEfficiencyWhKm)
      / priorStats.avgEfficiencyWhKm) * 100
    : null;

  let efficiencyMovementValue = t('drives.decision.noBaseline', 'No baseline');
  let efficiencyMovementTone: 'success' | 'warning' | 'neutral' = 'neutral';
  if (efficiencyMovementPct != null) {
    if (Math.abs(efficiencyMovementPct) < 1) {
      efficiencyMovementValue = t('drives.decision.stable', 'Stable');
    } else if (efficiencyMovementPct > 0) {
      efficiencyMovementValue = t(
        'drives.decision.improved',
        '{{value}}% lower',
        { value: fmtNumber(efficiencyMovementPct) },
      );
      efficiencyMovementTone = 'success';
    } else {
      efficiencyMovementValue = t(
        'drives.decision.regressed',
        '{{value}}% higher',
        { value: fmtNumber(Math.abs(efficiencyMovementPct)) },
      );
      efficiencyMovementTone = 'warning';
    }
  }

  const driveAttention: OperationalAttention[] = [];
  if (anomalyDrives.length > 0) {
    driveAttention.push({
      key: 'drive-anomalies',
      title: anomalyDrives.length === 1
        ? t('operations.drives.anomalyTitle_one', '1 energy-intensity exception')
        : t(
            'operations.drives.anomalyTitle_other',
            '{{count}} energy-intensity exceptions',
            { count: anomalyDrives.length },
          ),
      description: t(
        'operations.drives.anomalyDescription',
        'Review measured high-energy drives against route, speed, temperature, and battery context.',
      ),
      tone: 'warning',
    });
  }
  if (currentStats.count > 0 && missingEfficiencyCount > 0) {
    driveAttention.push({
      key: 'drive-energy-coverage',
      title: t(
        'operations.drives.partialEnergyTitle',
        '{{count}} drives excluded from efficiency',
        { count: missingEfficiencyCount },
      ),
      description: t(
        'operations.drives.partialEnergyDescription',
        'Activity remains visible, but efficiency requires measured energy and at least 1 km of distance.',
      ),
      tone: currentStats.efficiencyMeasuredCount === 0 ? 'warning' : 'info',
    });
  }
  if (currentStats.count === 0) {
    driveAttention.push({
      key: 'drives-empty',
      title: t('operations.drives.noDataTitle', 'No drives in this analysis window'),
      description: t(
        'operations.drives.noDataDescription',
        'Choose a wider window or complete a drive to build an operating baseline.',
      ),
      tone: 'info',
    });
  }

  return {
    datePresetLabel, periodLabel, priorHasData, priorLabel, avgGrade,
    distMi, priorDistMi, driveTimeMin, priorDriveTimeMin, avgEffDisp,
    priorEffDisp, totalCost, priorTotalCost, routeContextCount,
    missingEfficiencyCount, efficiencyMovementPct, efficiencyMovementValue,
    efficiencyMovementTone, driveAttention,
  };
}
