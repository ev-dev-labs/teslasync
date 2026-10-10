import { useTranslation } from 'react-i18next';
import { Flame } from 'lucide-react';
import { LayoutCard } from '@/components/layout/layout-reference';
import { Badge, HelpTooltip, DataTable, Text, type Column } from '@/components/ui';
import { EmptyState, Skeleton, QueryError } from '@/components/feedback';
import { useUnits } from '@/hooks/useUnits';
import { formatDateTime, formatDurationSecondsAsMinutes } from '@/lib/dateFormat';
import type { DataState } from '@/api/dataState';
import type { ChargingThermalTaxSummary, ThermalEnergySource, ThermalPhase, ThermalTaxSample } from '../../lib/chargingThermalTax';
import { phaseHasMissingHeater } from './thermalPresentation';

const SOURCE_DEFAULTS: Record<ThermalEnergySource, string> = {
  cumulative: 'Metered running total',
  power_integral: 'Estimated from instantaneous power',
  none: 'Unavailable',
};

interface ThermalPhasesProps {
  selected: boolean;
  loading: boolean;
  state: DataState<unknown>;
  summary: ChargingThermalTaxSummary;
  samples: readonly ThermalTaxSample[];
}

export function ThermalPhases({ selected, loading, state, summary, samples }: ThermalPhasesProps) {
  const { t, i18n } = useTranslation();
  const { formatPower } = useUnits();
  const rows = summary.phases.map((phase, index) => ({ ...phase, key: `${phase.startMs}-${index}` }));
  type PhaseRow = typeof rows[number];
  const algorithmPhaseLabel = (phase: ThermalPhase) => phase.state === 'heater_on'
    ? t('chargingThermalTax.phaseOn', 'Heater on')
    : t('chargingThermalTax.phaseOff', 'Heater off');
  const phaseLabel = (phase: ThermalPhase) => phaseHasMissingHeater(phase, samples)
    ? t('chargingThermalTax.phases.unknownState', 'Heater state uncertain')
    : algorithmPhaseLabel(phase);
  const displayValue = (phase: PhaseRow, key: string): string => {
    switch (key) {
      case 'state': return phaseLabel(phase);
      case 'analysisState': return algorithmPhaseLabel(phase);
      case 'duration': return formatDurationSecondsAsMinutes(phase.durationS);
      case 'power': return phase.state === 'heater_on' ? formatPower(phase.avgHeaterW) : '—';
      case 'start': return formatDateTime(new Date(phase.startMs), { locale: i18n.language });
      case 'end': return formatDateTime(new Date(phase.endMs), { locale: i18n.language });
      case 'quality': return phaseHasMissingHeater(phase, samples)
        ? t('chargingThermalTax.phases.uncertain', 'Heater readings missing; phase state is uncertain.')
        : t('chargingThermalTax.phases.sampled', 'Phase boundaries are sampled estimates.');
      default: return '—';
    }
  };
  const columns: Column<PhaseRow>[] = [
    {
      key: 'state', header: t('chargingThermalTax.phases.state', 'Heater state'),
      render: phase => <Badge variant={phase.state === 'heater_on' ? 'warning' : 'neutral'} size="sm">{phaseLabel(phase)}</Badge>,
    },
    { key: 'duration', header: t('chargingThermalTax.phases.duration', 'Duration'), render: phase => displayValue(phase, 'duration') },
    { key: 'power', header: t('chargingThermalTax.phases.power', 'Average heater power'), render: phase => displayValue(phase, 'power') },
    { key: 'start', header: t('chargingThermalTax.phases.start', 'Phase start'), render: phase => displayValue(phase, 'start'), defaultVisible: false },
    { key: 'end', header: t('chargingThermalTax.phases.end', 'Phase end'), render: phase => displayValue(phase, 'end'), defaultVisible: false },
    { key: 'quality', header: t('chargingThermalTax.phases.quality', 'Uncertainty'), render: phase => displayValue(phase, 'quality') },
    { key: 'analysisState', header: t('chargingThermalTax.phases.analysisState', 'Algorithm phase state (zero-fill analysis)'), render: phase => displayValue(phase, 'analysisState'), defaultVisible: false },
  ];

  return <LayoutCard
    title={t('chargingThermalTax.detail', 'Thermal Phases')}
    actions={<HelpTooltip
      size="sm"
      i18nKey="help.chargingThermalTax.detail"
      defaultValue="Delivered energy is preferably read from the charger's own cumulative counters; if those are missing or reset mid-session, it falls back to integrating instantaneous power instead — the source used is always disclosed below."
      ariaLabel={t('help.chargingThermalTax.iconLabel', 'More info about data sources')}
    />}
  >
    {selected && summary.sampleCount > 0 && <div className="flex flex-wrap items-center gap-2">
      <Badge variant="neutral" size="sm">
        {t('chargingThermalTax.coverage', 'Coverage {{pct}}%', { pct: summary.dataCoveragePct })}
      </Badge>
      <Badge variant={summary.energySource === 'none' ? 'warning' : 'info'} size="sm">
        {t(`chargingThermalTax.source.${summary.energySource}`, SOURCE_DEFAULTS[summary.energySource])}
      </Badge>
    </div>}
    {!selected ? (
      // no-action: the Inspect session selector above owns selection; this phase shell has no session to retry.
      <EmptyState icon={<Flame className="h-8 w-8" aria-hidden="true" />} message={t('chargingThermalTax.noSelectionShort', 'No session selected.')} />
    ) : state.fatalError ? (
      <QueryError error={state.fatalError} onRetry={state.retry ?? undefined} />
    ) : loading ? (
      <Skeleton height={160} />
    ) : !state.hasData && state.isRefreshBlocked ? (
      <Text as="p" variant="bodySm">
        {t('chargingThermalTax.state.paused', 'Telemetry loading is paused. Connect to resume or retry.')}
      </Text>
    ) : summary.phases.length === 0 ? (
      <EmptyState
        icon={<Flame className="h-8 w-8" aria-hidden="true" />}
        message={t('chargingThermalTax.noPhases', 'No usable telemetry to segment into phases.')}
        action={state.retry ? { label: t('common.retry', 'Retry'), onClick: state.retry } : undefined}
      />
    ) : (
      <>
        <Text as="p" variant="caption">
          {t('chargingThermalTax.phases.method', 'Heater-on threshold: 50 W. Coverage bridges sample gaps up to 300 seconds; phase boundaries are approximate.')}
        </Text>
        <DataTable
          tableId="charging:thermal-tax-phases"
          variant="embedded"
          name={t('chargingThermalTax.detail', 'Thermal Phases')}
          caption={t('chargingThermalTax.detail', 'Thermal Phases')}
          columns={columns}
          data={rows}
          keyExtractor={phase => phase.key}
          searchable={false}
          pagination={false}
          maxHeight={256}
          mobilePresentation={{
            variant: 'keyValue',
            roles: { state: 'title', duration: 'primary', power: 'meta', start: 'hidden', end: 'hidden', quality: 'meta', analysisState: 'hidden' },
            displayValue,
          }}
        />
      </>
    )}
  </LayoutCard>;
}
