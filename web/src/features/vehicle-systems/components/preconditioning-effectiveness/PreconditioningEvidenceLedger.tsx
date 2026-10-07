import {
  Activity,
  Gauge,
  Scale,
  ShieldCheck,
  Snowflake,
  ThermometerSun,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import { Grid } from '@/components/layout';
import { GlassPanel, PanelTitle } from '@/components/ui';
import { fmtInt, fmtPercent } from '@/lib/numberFormat';
import type { PreconditioningSummary } from '../../lib/preconditioningEffectiveness';
import { preconditioningEvidenceLabel } from './labels';
import { PreconditioningQueryStatus } from './PreconditioningQueryStatus';
import type {
  PreconditioningQueryState,
  TemperatureDeltaFormatter,
} from './types';

interface PreconditioningEvidenceLedgerProps {
  summary: PreconditioningSummary;
  state: PreconditioningQueryState;
  formatDelta: TemperatureDeltaFormatter;
}

export function PreconditioningEvidenceLedger({
  summary,
  state,
  formatDelta,
}: PreconditioningEvidenceLedgerProps) {
  const { t } = useTranslation();
  const resolved =
    state.climate.isResolved
    && state.drives.isResolved
    && !state.climate.error
    && !state.drives.error;
  const comparisonPublished = resolved && summary.overall.evidence !== 'none';
  const unavailable = !state.vehicleSelected
    ? t(
        'preconditioningEffectiveness.kpis.selectVehicle',
        'Select a vehicle to load both evidence sources.',
      )
    : state.climate.isLoading || state.drives.isLoading
      ? t(
          'preconditioningEffectiveness.kpis.loading',
          'Waiting for climate and drive history...',
        )
      : state.climate.isPaused || state.drives.isPaused
        ? t(
            'preconditioningEffectiveness.kpis.paused',
            'Evidence loading is paused while the network is unavailable.',
          )
      : state.climate.error || state.drives.error
        ? t(
            'preconditioningEffectiveness.kpis.error',
            'A required evidence source is unavailable.',
          )
        : t(
            'preconditioningEffectiveness.kpis.pending',
            'Evidence availability is unresolved.',
          );

  return (
    <section
      data-testid="preconditioning-kpis"
      aria-label={t(
        'preconditioningEffectiveness.kpis.aria',
        'Preconditioning effectiveness evidence ledger',
      )}
    >
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-4 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('preconditioningEffectiveness.kpis.title', 'KPI and evidence ledger')}
        </PanelTitle>
        <Grid cols={{ default: 1, sm: 2, xl: 6 }} gap={3}>
          <MetricCard
            label={t(
              'preconditioningEffectiveness.kpis.classified',
              'Classified departures',
            )}
            value={resolved ? fmtInt(summary.joinedDepartures) : '—'}
            subtitle={resolved
              ? t(
                  'preconditioningEffectiveness.kpis.classifiedHint',
                  '{{classified}} of {{valid}} unique valid drives',
                  {
                    classified: fmtInt(summary.joinedDepartures),
                    valid: fmtInt(summary.driveRows.uniqueValidDrives),
                  },
                )
              : unavailable}
            icon={<Activity className="h-5 w-5" />}
            color="blue"
          />
          <MetricCard
            label={t(
              'preconditioningEffectiveness.kpis.active',
              'Observed HVAC-active pre-drive',
            )}
            value={
              resolved && summary.conditionedShare != null
                ? fmtPercent(summary.conditionedShare * 100, 1)
                : resolved
                  ? '—'
                  : '—'
            }
            subtitle={resolved
              ? t(
                  'preconditioningEffectiveness.kpis.activeHint',
                  '{{count}} classified departures',
                  { count: summary.conditionedDepartures },
                )
              : unavailable}
            icon={<ThermometerSun className="h-5 w-5" />}
            color="cyan"
          />
          <MetricCard
            label={t(
              'preconditioningEffectiveness.kpis.control',
              'Explicitly HVAC-off control',
            )}
            value={resolved ? fmtInt(summary.unconditionedDepartures) : '—'}
            subtitle={resolved
              ? t(
                  'preconditioningEffectiveness.kpis.controlHint',
                  'Every joined window row explicitly reported HVAC off',
                )
              : unavailable}
            icon={<Snowflake className="h-5 w-5" />}
            color="purple"
          />
          <MetricCard
            label={t(
              'preconditioningEffectiveness.kpis.readinessDifference',
              'Observed readiness difference',
            )}
            value={comparisonPublished
              ? formatDelta(summary.overall.startDeltaAdvantageC, {
                  signed: true,
                })
              : '—'}
            subtitle={resolved
              ? t(
                  'preconditioningEffectiveness.kpis.readinessHint',
                  'Control median gap minus active median gap',
                )
              : unavailable}
            icon={<Gauge className="h-5 w-5" />}
            color="green"
          />
          <MetricCard
            label={t(
              'preconditioningEffectiveness.kpis.improvementDifference',
              'Observed improvement difference',
            )}
            value={comparisonPublished
              ? formatDelta(summary.overall.improvementLiftC, {
                  signed: true,
                })
              : '—'}
            subtitle={resolved
              ? t(
                  'preconditioningEffectiveness.kpis.improvementHint',
                  'Active median improvement minus control median improvement',
                )
              : unavailable}
            icon={<Scale className="h-5 w-5" />}
            color="amber"
          />
          <MetricCard
            label={t(
              'preconditioningEffectiveness.kpis.confidence',
              'Comparison confidence',
            )}
            value={
              resolved && summary.overall.evidence !== 'none'
                ? fmtPercent(summary.overall.confidence * 100, 0)
                : '—'
            }
            subtitle={resolved
              ? preconditioningEvidenceLabel(t, summary.overall.evidence)
              : unavailable}
            icon={<ShieldCheck className="h-5 w-5" />}
            color={summary.overall.evidence === 'strong' ? 'green' : 'amber'}
          />
        </Grid>
        <PreconditioningQueryStatus summary={summary} state={state} />
      </GlassPanel>
    </section>
  );
}
