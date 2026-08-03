import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GitCompareArrows, Swords } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, PanelTitle, Text, Badge, Select, HelpTooltip } from '@/components/ui';
import { VehicleSelect } from '@/components/forms';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';

import { useDrives, useDrive } from '@/api/hooks/useDriving';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDateShort } from '@/lib/dateFormat';
import type { Drive } from '@/types/driving';

import { compareDrives, type CompareMetricKey, type CompareRow } from '../lib/driveCompare';

const METRIC_I18N: Record<CompareMetricKey, { key: string; fallback: string }> = {
  distanceM: { key: 'driveCompare.m.distance', fallback: 'Distance' },
  durationS: { key: 'driveCompare.m.duration', fallback: 'Duration' },
  avgSpeedMps: { key: 'driveCompare.m.avgSpeed', fallback: 'Avg speed' },
  maxSpeedMps: { key: 'driveCompare.m.maxSpeed', fallback: 'Top speed' },
  energyUsedWh: { key: 'driveCompare.m.energy', fallback: 'Energy used' },
  whPerKm: { key: 'driveCompare.m.consumption', fallback: 'Consumption' },
  regenShare: { key: 'driveCompare.m.regenShare', fallback: 'Regen share' },
  socUsed: { key: 'driveCompare.m.socUsed', fallback: 'Battery used' },
  outsideTempAvgC: { key: 'driveCompare.m.temp', fallback: 'Outside temp' },
};

export default function DriveComparePage() {
  const { t } = useTranslation();
  usePageTitle(t('driveCompare.title', 'Drive Compare'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const { formatDistance, formatSpeed, formatEnergy, formatDuration, formatTemperature, unitPrefs } = useUnits();

  const drivesQuery = useDrives(vehicleIdStr);
  const drives = useMemo<Drive[]>(() => drivesQuery.data ?? [], [drivesQuery.data]);

  const [idA, setIdA] = useState('');
  const [idB, setIdB] = useState('');
  const activeA = idA || (drives[0] ? String(drives[0].id) : '');
  const activeB = idB || (drives[1] ? String(drives[1].id) : '');

  const driveAQuery = useDrive(activeA);
  const driveBQuery = useDrive(activeB);

  const rows = useMemo<CompareRow[] | null>(() => {
    if (!driveAQuery.data || !driveBQuery.data) return null;
    return compareDrives(driveAQuery.data, driveBQuery.data);
  }, [driveAQuery.data, driveBQuery.data]);

  const driveOptions = useMemo(
    () =>
      drives.map((d) => ({
        value: String(d.id),
        label: `${formatDateShort(d.startTs)} · ${formatDistance(d.distanceM, { precision: 1 })}`,
      })),
    [drives, formatDistance],
  );

  const isMiles = unitPrefs.distance === 'mi';
  const effUnit = isMiles ? 'Wh/mi' : 'Wh/km';
  const fmt = (key: CompareMetricKey, v: number | null): string => {
    if (v == null) return '—';
    switch (key) {
      case 'distanceM': return formatDistance(v, { precision: 1 });
      case 'durationS': return formatDuration(v, { precision: 0 });
      case 'avgSpeedMps':
      case 'maxSpeedMps': return formatSpeed(v, { precision: 0 });
      case 'energyUsedWh': return formatEnergy(v, { precision: 1 });
      case 'whPerKm': return `${Math.round(isMiles ? v * 1.609344 : v)} ${effUnit}`;
      case 'regenShare': return `${Math.round(v * 100)}%`;
      case 'socUsed': return `${Math.round(v)}%`;
      case 'outsideTempAvgC': return formatTemperature(v, { precision: 0 });
    }
  };

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('driveCompare.title', 'Drive Compare')} />;
  }

  const isLoading = drivesQuery.isLoading || driveAQuery.isLoading || driveBQuery.isLoading;
  const isError = drivesQuery.isError;
  const sameDrive = activeA !== '' && activeA === activeB;

  return (
    <PageContainer
      title={t('driveCompare.title', 'Drive Compare')}
      subtitle={t('driveCompare.subtitle', 'Put any two drives head to head')}
      query={[drivesQuery, driveAQuery, driveBQuery]}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <VehicleSelect />
          {driveOptions.length > 0 && (
            <>
              <Select
                aria-label={t('driveCompare.pickA', 'Choose drive A')}
                value={activeA}
                onChange={(e) => setIdA(e.target.value)}
                options={driveOptions}
              />
              <Select
                aria-label={t('driveCompare.pickB', 'Choose drive B')}
                value={activeB}
                onChange={(e) => setIdB(e.target.value)}
                options={driveOptions}
              />
            </>
          )}
        </div>
      }
    >
      <FadeIn>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <GitCompareArrows className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('driveCompare.duel', 'Head to Head')}
            <HelpTooltip
              size="sm"
              i18nKey="help.driveCompare.body"
              defaultValue="Pick two drives and compare them metric by metric. Rows with a clear efficiency meaning (energy, consumption, regen share, battery used) crown a winner; distance, speed, and temperature are context."
              ariaLabel={t('help.driveCompare.iconLabel', 'More info about drive compare')}
            />
          </PanelTitle>

          {isError ? (
            <QueryError error={drivesQuery.error} onRetry={() => drivesQuery.refetch()} />
          ) : isLoading ? (
            <Skeleton height={320} />
          ) : drives.length < 2 ? (
            <EmptyState
              icon={<Swords className="h-8 w-8" />}
              message={t('driveCompare.needTwo', 'At least two drives are needed for a comparison.')}
              actionTo={{ label: t('driveCompare.browseDrives', 'Browse drives'), to: '/drives' }}
            />
          ) : sameDrive ? (
            <EmptyState /* no-action: transient — the two pickers in the header are the recovery surface. */
              icon={<Swords className="h-8 w-8" />}
              message={t('driveCompare.samePick', 'Pick two different drives to compare.')}
            />
          ) : rows == null ? (
            <Skeleton height={320} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead className="border-b border-white/[0.06] text-xs uppercase tracking-wider text-[var(--text-muted)]">
                  <tr>
                    <th className="px-4 py-3 text-start font-medium">{t('driveCompare.metric', 'Metric')}</th>
                    <th className="px-4 py-3 text-end font-medium">
                      {t('driveCompare.driveA', 'Drive A')}
                      {driveAQuery.data && (
                        <Text variant="caption" as="div">{formatDateShort(driveAQuery.data.startTs)}</Text>
                      )}
                    </th>
                    <th className="px-4 py-3 text-end font-medium">
                      {t('driveCompare.driveB', 'Drive B')}
                      {driveBQuery.data && (
                        <Text variant="caption" as="div">{formatDateShort(driveBQuery.data.startTs)}</Text>
                      )}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.03]">
                  {rows.map((row) => (
                    <tr key={row.key} className="transition-colors hover:bg-white/[0.02]">
                      <td className="px-4 py-3">
                        <Text variant="bodySm">{t(METRIC_I18N[row.key].key, METRIC_I18N[row.key].fallback)}</Text>
                      </td>
                      {(['a', 'b'] as const).map((side) => (
                        <td key={side} className="px-4 py-3 text-end">
                          <span className="inline-flex items-center justify-end gap-2">
                            {row.winner === side && (
                              <Badge variant="success">{t('driveCompare.winner', 'winner')}</Badge>
                            )}
                            <Text
                              variant="body"
                              className={`font-mono tabular-nums ${row.winner === side ? 'text-emerald-300' : ''}`}
                            >
                              {fmt(row.key, row[side])}
                            </Text>
                          </span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
