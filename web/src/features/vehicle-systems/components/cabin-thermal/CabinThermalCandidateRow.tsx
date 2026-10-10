import { Badge, MetricLabel, Text } from '@/components/ui';
import type { UnitFormatter } from '@/hooks/useUnits';
import { formatDateTime } from '@/lib/dateFormat';

import type { TemperatureUnitPref } from '@/lib/unitConversion';
import { useTranslation } from 'react-i18next';

import type { CandidateWindow } from '../../lib/cabinThermal';
import {
  cabinDirectionLabel,
  cabinRejectionLabel,
  formatTemperatureDelta,
} from './labels';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface CabinThermalCandidateRowProps {
  candidate: CandidateWindow;
  locale: string;
  temperatureUnit: TemperatureUnitPref;
  formatTemperature: UnitFormatter;
  formatDuration: UnitFormatter;
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <MetricLabel>{label}</MetricLabel>
      <Text as="p" variant="bodySm" className="mt-0.5 font-mono tabular-nums">
        {value}
      </Text>
    </div>
  );
}

export function CabinThermalCandidateRow({
  candidate,
  locale,
  temperatureUnit,
  formatTemperature,
  formatDuration,
}: CabinThermalCandidateRowProps) {
  const { fmtInt, fmtScientificNumber, fmtPercent } = useNumberFormatting();
  const { t } = useTranslation();
  const status = candidate.reason != null
    ? cabinRejectionLabel(t, candidate.reason)
    : t('cabinThermal.directory.accepted', 'Accepted fit');

  return (
    <li className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <Text as="p" variant="label">
            {t('cabinThermal.directory.window', 'Candidate {{index}}', {
              index: fmtInt(candidate.index),
            })}
          </Text>
          <Text as="p" variant="caption">
            {formatDateTime(candidate.startTs, { locale })}
          </Text>
        </div>
        <Badge variant={candidate.disposition === 'accepted' ? 'success' : 'warning'}>
          {status}
        </Badge>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        <Detail
          label={t('cabinThermal.directory.direction', 'Direction')}
          value={cabinDirectionLabel(t, candidate.direction)}
        />
        <Detail
          label={t('cabinThermal.directory.samples', 'Samples')}
          value={fmtInt(candidate.samples)}
        />
        <Detail
          label={t('cabinThermal.directory.duration', 'Duration')}
          value={formatDuration(candidate.durationMin * 60)}
        />
        <Detail
          label={t('cabinThermal.directory.startAmbient', 'Start / ambient')}
          value={t('cabinThermal.directory.temperaturePair', '{{start}} / {{ambient}}', {
            start: formatTemperature(candidate.startInsideC),
            ambient: formatTemperature(candidate.ambientC),
          })}
        />
        <Detail
          label={t('cabinThermal.directory.initialGap', 'Initial gap')}
          value={formatTemperatureDelta(
            candidate.initialGapC,
            temperatureUnit,
            locale,
          )}
        />
        <Detail
          label={t('cabinThermal.directory.slopeR2', 'Slope / R²')}
          value={candidate.slopePerMin != null && candidate.r2 != null
            ? t('cabinThermal.directory.fitPair', '{{slope}} / {{r2}}', {
                slope: fmtScientificNumber(candidate.slopePerMin, 5, locale),
                r2: fmtPercent(candidate.r2 * 100),
              })
            : '—'}
        />
        <Detail
          label={t('cabinThermal.directory.tau', 'Derived τ')}
          value={candidate.tauMin != null
            ? formatDuration(candidate.tauMin * 60)
            : '—'}
        />
      </div>
    </li>
  );
}
