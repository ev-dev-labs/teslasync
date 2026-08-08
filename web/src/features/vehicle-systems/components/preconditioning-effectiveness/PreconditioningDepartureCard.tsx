import { useTranslation } from 'react-i18next';

import {
  Badge,
  MetricLabel,
  Text,
} from '@/components/ui';
import type { UnitFormatter } from '@/hooks/useUnits';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtInt } from '@/lib/numberFormat';
import type { DepartureDirectoryItem } from '../../lib/preconditioningEffectiveness';
import {
  preconditioningDispositionLabel,
  preconditioningDispositionVariant,
  preconditioningRegimeLabel,
} from './labels';
import type { TemperatureDeltaFormatter } from './types';

interface PreconditioningDepartureCardProps {
  item: DepartureDirectoryItem;
  locale: string;
  formatDuration: UnitFormatter;
  formatDelta: TemperatureDeltaFormatter;
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <MetricLabel>{label}</MetricLabel>
      <Text as="p" variant="bodySm" mono className="mt-0.5">
        {value}
      </Text>
    </div>
  );
}

export function PreconditioningDepartureCard({
  item,
  locale,
  formatDuration,
  formatDelta,
}: PreconditioningDepartureCardProps) {
  const { t } = useTranslation();

  return (
    <li className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Text as="h4" variant="label">
            {t('preconditioningEffectiveness.directory.drive', 'Drive {{id}}', {
              id: fmtInt(item.driveId),
            })}
          </Text>
          <Text as="p" variant="caption" className="mt-1">
            {formatDateTime(new Date(item.departureMs), { locale })}
          </Text>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant={preconditioningDispositionVariant(item.disposition)}>
            {preconditioningDispositionLabel(t, item.disposition)}
          </Badge>
          {item.regime != null ? (
            <Badge variant={item.regime === 'hot' ? 'warning' : 'info'}>
              {preconditioningRegimeLabel(t, item.regime)}
            </Badge>
          ) : null}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Detail
          label={t('preconditioningEffectiveness.directory.windowRows', 'Window rows')}
          value={fmtInt(item.windowRowCount)}
        />
        <Detail
          label={t('preconditioningEffectiveness.directory.thermalRows', 'Thermal samples')}
          value={fmtInt(item.thermalSampleCount)}
        />
        <Detail
          label={t('preconditioningEffectiveness.directory.hvacSamples', 'HVAC active / off / unknown')}
          value={t(
            'preconditioningEffectiveness.directory.sampleCounts',
            '{{active}} / {{off}} / {{unknown}}',
            {
              active: fmtInt(item.hvacOnSamples),
              off: fmtInt(item.hvacOffSamples),
              unknown: fmtInt(item.unknownHvacSamples),
            },
          )}
        />
        <Detail
          label={t('preconditioningEffectiveness.directory.firstLead', 'First-sample lead')}
          value={formatDuration(item.firstSampleLeadS, { precision: 2 })}
        />
        <Detail
          label={t('preconditioningEffectiveness.directory.finalLead', 'Final-sample lead')}
          value={formatDuration(item.lastSampleLeadS, { precision: 2 })}
        />
        <Detail
          label={t('preconditioningEffectiveness.directory.span', 'Observation span')}
          value={formatDuration(item.observationSpanS, { precision: 2 })}
        />
        <Detail
          label={t('preconditioningEffectiveness.directory.targetShift', 'Target shift')}
          value={formatDelta(item.targetShiftC)}
        />
        <Detail
          label={t('preconditioningEffectiveness.directory.initialGap', 'Initial absolute gap')}
          value={formatDelta(item.initialDeltaC)}
        />
        <Detail
          label={t('preconditioningEffectiveness.directory.departureGap', 'Departure absolute gap')}
          value={formatDelta(item.startDeltaC)}
        />
        <Detail
          label={t('preconditioningEffectiveness.directory.improvement', 'Observed improvement')}
          value={formatDelta(item.improvementC, { signed: true })}
        />
        <Detail
          label={t('preconditioningEffectiveness.directory.group', 'Comparison group')}
          value={
            item.conditioned === true
              ? t(
                  'preconditioningEffectiveness.groups.observedActiveShort',
                  'HVAC-active',
                )
              : item.conditioned === false
                ? t(
                    'preconditioningEffectiveness.groups.explicitOffShort',
                    'Explicit-off control',
                  )
                : '—'
          }
        />
      </div>
    </li>
  );
}
