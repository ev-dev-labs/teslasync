import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { DataTable, Text, type Column } from '@/components/ui';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useUnits } from '@/hooks/useUnits';
import { fmtPercent } from '@/lib/numberFormat';

import type { RankedRegenDrive } from '../../lib/regenEfficiency';

interface RankedDriveTableProps {
  rows: RankedRegenDrive[];
  timeZone: string;
}

export function RankedDriveTable({
  rows,
  timeZone,
}: RankedDriveTableProps) {
  const { t } = useTranslation();
  const { formatDate } = useDateFormat();
  const {
    formatDistance,
    formatDuration,
    formatEnergy,
    formatSpeed,
    formatTemperature,
  } = useUnits();
  const columns = useMemo<Column<RankedRegenDrive>[]>(
    () => [
      {
        key: 'rank',
        header: t('regen.evidence.rank', 'Rank'),
        align: 'right',
        visibleOnMobile: true,
        render: (row) => (
          <Text variant="body" mono>{row.rank}</Text>
        ),
      },
      {
        key: 'date',
        header: t('regen.evidence.date', 'Drive'),
        visibleOnMobile: true,
        render: (row) => (
          <div>
            <Text as="p" variant="bodySm">
              {formatDate(row.startTs, { tz: timeZone })}
            </Text>
            <Text as="p" variant="caption">
              {t('regen.evidence.driveId', 'Drive #{{id}}', {
                id: row.driveId,
              })}
            </Text>
          </div>
        ),
      },
      {
        key: 'recovered',
        header: t('regen.evidence.recovered', 'Recovered'),
        align: 'right',
        visibleOnMobile: true,
        render: (row) => (
          <Text variant="body" mono className="text-emerald-300">
            {formatEnergy(row.regenEnergyWh, { precision: 1 })}
          </Text>
        ),
      },
      {
        key: 'ratio',
        header: t('regen.evidence.ratio', 'Recovery share'),
        align: 'right',
        visibleOnMobile: true,
        render: (row) => (
          <Text variant="body" mono>
            {fmtPercent(row.recoveryRatioPct, 1)}
          </Text>
        ),
      },
      {
        key: 'driveEnergy',
        header: t('regen.evidence.driveEnergy', 'Drive energy'),
        align: 'right',
        render: (row) => (
          <Text variant="body" mono>
            {formatEnergy(row.driveEnergyWh, { precision: 1 })}
          </Text>
        ),
      },
      {
        key: 'distance',
        header: t('regen.evidence.distance', 'Distance'),
        align: 'right',
        render: (row) => (
          <Text variant="body" mono>
            {formatDistance(row.distanceM, { precision: 1 })}
          </Text>
        ),
      },
      {
        key: 'duration',
        header: t('regen.evidence.duration', 'Duration'),
        align: 'right',
        render: (row) => (
          <Text variant="body" mono>
            {formatDuration(row.durationS, { precision: 1 })}
          </Text>
        ),
      },
      {
        key: 'speed',
        header: t('regen.evidence.avgSpeed', 'Average speed'),
        align: 'right',
        render: (row) => (
          <Text variant="body" mono>
            {formatSpeed(row.avgSpeedMps, { precision: 1 })}
          </Text>
        ),
      },
      {
        key: 'soc',
        header: t('regen.evidence.startSoc', 'Start SoC'),
        align: 'right',
        render: (row) => (
          <Text variant="body" mono>
            {row.startSocPct != null ? fmtPercent(row.startSocPct, 0) : '—'}
          </Text>
        ),
      },
      {
        key: 'temperature',
        header: t('regen.evidence.temperature', 'Ambient temperature'),
        align: 'right',
        render: (row) => (
          <Text variant="body" mono>
            {formatTemperature(row.outsideTempAvgC, { precision: 1 })}
          </Text>
        ),
      },
    ],
    [
      formatDate,
      formatDistance,
      formatDuration,
      formatEnergy,
      formatSpeed,
      formatTemperature,
      t,
      timeZone,
    ],
  );

  return (
    <DataTable
      tableId="driving:regen-ranked-evidence"
      columns={columns}
      data={rows}
      keyExtractor={(row) => `${row.driveId}:${row.rank}`}
      emptyMessage={t(
        'regen.evidence.empty',
        'No eligible detailed drives are available to rank.',
      )}
      mobileColumns={['rank', 'date', 'recovered', 'ratio']}
      density="compact"
    />
  );
}
