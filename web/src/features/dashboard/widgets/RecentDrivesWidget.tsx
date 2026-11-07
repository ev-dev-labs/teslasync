import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Route, ArrowUpRight, ArrowRight } from 'lucide-react';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useDashboardDriveHistory } from '@/api/hooks/useDriving';
import { useUnits } from '@/hooks/useUnits';

import { convertDistanceFromSI } from '@/lib/unitConversion';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useDateLabels } from '@/hooks/useDateLabels';
import { useDataState } from '@/hooks/useDataState';
import { knownNumber } from '@/api/dataState';
import { safeArray } from '@/lib/safeArray';
import { Caption, IconButton } from '@/components/ui';
import { WidgetBigNumber, WidgetDetailCard, type DetailEntry } from './shared';
import { WidgetShell } from './WidgetShell';
import InstrumentPresentation from './designPacks/InstrumentPresentation';
import type { WidgetProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { WidgetJourneyDiagram } from './shared/WidgetJourneyDiagram';

export default function RecentDrivesWidget({ vehicleId, size, config }: WidgetProps) {
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { unitPrefs } = useUnits();
  const { formatTime } = useDateFormat();
  const { formatRelativeDays, formatWeekdayName } = useDateLabels();

  const { data: drives, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch } =
    useDashboardDriveHistory(id, { kind: 'recent', limit: 5, range: config?.timeRange });

  const driveList = safeArray(drives);

  const entries: DetailEntry[] = driveList.map((drive) => {
    const distance = knownNumber(drive.distance_m);
    const duration = knownNumber(drive.duration_s);
    const energy = knownNumber(drive.energy_used_wh);
    const distDisplay = distance == null ? null : convertDistanceFromSI(distance, unitPrefs.distance);

    const start = drive.start_address?.trim();
    const end = drive.end_address?.trim();
    const routeLabel = start || end
      ? `${start || '—'} → ${end || '—'}`
      : t('activity.timeline.item.drive', 'Drive');

    const day = formatRelativeDays(drive.start_ts);
    const dateLabel = day === 'Today' || day === 'Yesterday'
      ? `${day} ${formatTime(drive.start_ts)}`
      : `${formatWeekdayName(drive.start_ts)} ${formatTime(drive.start_ts)}`;
    const durationLabel = duration == null
      ? '—'
      : `${fmtInt(duration / 60)} ${t('widget.recentDrivesDurationUnit', 'min')}`;

    const efficiencyLabel = energy != null && distDisplay != null && distDisplay > 0
      ? `${fmtInt(energy / distDisplay)} Wh/${unitPrefs.distance}`
      : undefined;

    return {
      id: drive.id,
      label: routeLabel,
      sublabel: `${dateLabel} · ${durationLabel}`,
      value: distDisplay == null ? '—' : `${fmtNumber(distDisplay, 1)} ${unitPrefs.distance}`,
      hint: efficiencyLabel,
    };
  });

  const hasKnownDistance = driveList.some((drive) => knownNumber(drive.distance_m) != null);
  const totalDistanceM = driveList.reduce(
    (sum, drive) => sum + (knownNumber(drive.distance_m) ?? 0),
    0,
  );
  const footerTotal = hasKnownDistance
    ? `${fmtNumber(convertDistanceFromSI(totalDistanceM, unitPrefs.distance), 0)} ${unitPrefs.distance}`
    : '—';

  const trust = useDataState({
    data: drives, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch,
  }, { provenance: 'historical' });
  const latest = entries[0];
  const content = (
    <WidgetDetailCard
      entries={entries}
      compact
      emptyIcon={<Route className="h-5 w-5" aria-hidden="true" />}
      emptyMessage={t('widget.noDrives', 'No recent drives')}
    />
  );

  return (
    <WidgetShell
      title={t('widget.recentDrives', 'Recent drives')}
      icon={<Route className="h-3.5 w-3.5" aria-hidden="true" />}
      loading={isLoading}
      dataState={trust.hasData ? trust : undefined}
      error={trust.fatalError?.message ?? null}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
      actions={
        <IconButton href="/drives" icon={<ArrowUpRight className="h-4 w-4" aria-hidden="true" />}
          label={t('widget.viewAll', 'View all')} aria-label={t('widget.viewAll', 'View all')} />
      }
      footer={driveList.length > 0 ? (
        <div className="flex min-w-0 items-center justify-between gap-2">
          <Caption className="min-w-0">
            {t('widget.recentDrivesSummary', '{{count}} recent drives · {{total}}', {
              count: driveList.length,
              total: footerTotal,
            })}
          </Caption>
          <Link
            to="/drives"
            className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-[var(--accent-primary)] hover:underline"
          >
            {t('drives.allDrives', 'All drives')}
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        </div>
      ) : undefined}
    >
      <InstrumentPresentation
        family="map"
        compact={size.cols <= 1 || size.rows === 1}
        headline={latest ? (
          <WidgetBigNumber value={latest.value} label={latest.label}
            subtitle={latest.sublabel} animated={false} />
        ) : undefined}
        icon={latest ? <Route aria-hidden="true" /> : undefined}
        instrument={<div className="min-w-0 space-y-2">
          {latest && <WidgetJourneyDiagram
            start={driveList[0]?.start_address?.trim() || null}
            end={driveList[0]?.end_address?.trim() || null} />}
          {content}
        </div>}
        details={latest?.hint ? <Caption className="block tabular-nums">{latest.hint}</Caption> : undefined}
      >
        {content}
      </InstrumentPresentation>
    </WidgetShell>
  );
}
