import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { DataTable, Text, type Column } from '@/components/ui';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useUnits } from '@/hooks/useUnits';
import type { RankedRegenDrive } from '../../lib/regenEfficiency';
import { isKnownNumber } from './presentation';

interface RankedDriveTableProps {
  rows: RankedRegenDrive[];
  timeZone: string;
}

export function RankedDriveTable({ rows, timeZone }: RankedDriveTableProps) {
  const { t } = useTranslation();
  const { formatDate } = useDateFormat();
  const { fmtPercent } = useNumberFormatting();
  const { formatDistance, formatDuration, formatEnergy, formatSpeed, formatTemperature } = useUnits();
  const columns = useMemo<Column<RankedRegenDrive>[]>(() => [
    {
      key: 'rank', header: t('regen.evidence.rank', 'Rank'), align: 'right', visibleOnMobile: true,
      render: row => <Text variant="body" mono>{row.rank}</Text>,
    },
    {
      key: 'date', header: t('regen.evidence.date', 'Drive'), visibleOnMobile: true,
      render: row => <div>
        <Text as="p" variant="bodySm">{formatDate(row.startTs, { tz: timeZone })}</Text>
        <Text as="p" variant="caption">{t('regen.evidence.driveId', 'Drive #{{id}}', { id: row.driveId })}</Text>
      </div>,
    },
    {
      key: 'recovered', header: t('regen.evidence.recovered', 'Recovered'), align: 'right', visibleOnMobile: true,
      render: row => <Text variant="body" mono>{isKnownNumber(row.regenEnergyWh) ? formatEnergy(row.regenEnergyWh) : '—'}</Text>,
    },
    {
      key: 'ratio', header: t('regen.evidence.ratio', 'Recovery share'), align: 'right', visibleOnMobile: true,
      render: row => <Text variant="body" mono>{isKnownNumber(row.recoveryRatioPct) ? fmtPercent(row.recoveryRatioPct) : '—'}</Text>,
    },
    {
      key: 'driveEnergy', header: t('regen.evidence.driveEnergy', 'Drive energy'), align: 'right',
      render: row => <Text variant="body" mono>{isKnownNumber(row.driveEnergyWh) ? formatEnergy(row.driveEnergyWh) : '—'}</Text>,
    },
    {
      key: 'distance', header: t('regen.evidence.distance', 'Distance'), align: 'right',
      render: row => <Text variant="body" mono>{isKnownNumber(row.distanceM) ? formatDistance(row.distanceM) : '—'}</Text>,
    },
    {
      key: 'duration', header: t('regen.evidence.duration', 'Duration'), align: 'right',
      render: row => <Text variant="body" mono>{isKnownNumber(row.durationS) ? formatDuration(row.durationS) : '—'}</Text>,
    },
    {
      key: 'speed', header: t('regen.evidence.avgSpeed', 'Average speed'), align: 'right',
      render: row => <Text variant="body" mono>{isKnownNumber(row.avgSpeedMps) ? formatSpeed(row.avgSpeedMps) : '—'}</Text>,
    },
    {
      key: 'soc', header: t('regen.evidence.startSoc', 'Start SoC'), align: 'right',
      render: row => <Text variant="body" mono>{isKnownNumber(row.startSocPct) ? fmtPercent(row.startSocPct) : '—'}</Text>,
    },
    {
      key: 'temperature', header: t('regen.evidence.temperature', 'Ambient temperature'), align: 'right',
      render: row => <Text variant="body" mono>{isKnownNumber(row.outsideTempAvgC) ? formatTemperature(row.outsideTempAvgC) : '—'}</Text>,
    },
  ], [formatDate, formatDistance, formatDuration, formatEnergy, formatSpeed, formatTemperature, t, timeZone, fmtPercent]);

  // Explicit accessors use the same specialist formatters as the desktop cells.
  // The shared adapter opens ALL columns, including saved/summary-hidden ones.
  const displayValue = (row: RankedRegenDrive, key: string): string | number => {
    switch (key) {
      case 'rank': return row.rank;
      case 'date': return `${formatDate(row.startTs, { tz: timeZone })} · ${t('regen.evidence.driveId', 'Drive #{{id}}', { id: row.driveId })}`;
      case 'recovered': return isKnownNumber(row.regenEnergyWh) ? formatEnergy(row.regenEnergyWh) : '—';
      case 'ratio': return isKnownNumber(row.recoveryRatioPct) ? fmtPercent(row.recoveryRatioPct) : '—';
      case 'driveEnergy': return isKnownNumber(row.driveEnergyWh) ? formatEnergy(row.driveEnergyWh) : '—';
      case 'distance': return isKnownNumber(row.distanceM) ? formatDistance(row.distanceM) : '—';
      case 'duration': return isKnownNumber(row.durationS) ? formatDuration(row.durationS) : '—';
      case 'speed': return isKnownNumber(row.avgSpeedMps) ? formatSpeed(row.avgSpeedMps) : '—';
      case 'soc': return isKnownNumber(row.startSocPct) ? fmtPercent(row.startSocPct) : '—';
      case 'temperature': return isKnownNumber(row.outsideTempAvgC) ? formatTemperature(row.outsideTempAvgC) : '—';
      default: return '—';
    }
  };
  return (
    <DataTable
      tableId="driving:regen-ranked-evidence"
      columns={columns}
      data={rows}
      keyExtractor={row => `${row.driveId}:${row.rank}`}
      emptyMessage={t('regen.evidence.empty', 'No eligible detailed drives are available to rank.')}
      caption={t('regen.evidence.title', 'Most recovered energy by drive')}
      rowLabel={row => t('regen.evidence.driveId', 'Drive #{{id}}', { id: row.driveId })}
      mobileColumns={['rank', 'date', 'recovered', 'ratio']}
      mobilePresentation={{
        variant: 'cards',
        roles: {
          rank: 'meta', date: 'title', recovered: 'primary', ratio: 'meta',
          driveEnergy: 'hidden', distance: 'hidden', duration: 'hidden',
          speed: 'hidden', soc: 'hidden', temperature: 'hidden',
        },
        displayValue,
      }}
      density="compact"
    />
  );
}
