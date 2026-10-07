import {
  CheckCircle2,
  Database,
  Filter,
  ScanSearch,
  Timer,
  XCircle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import { Grid } from '@/components/layout';
import { GlassPanel, PanelTitle } from '@/components/ui';
import type { UnitFormatter } from '@/hooks/useUnits';
import { fmtInt } from '@/lib/numberFormat';
import type { CabinThermalSummary } from '../../lib/cabinThermal';
import { CabinThermalQueryStatus } from './CabinThermalQueryStatus';
import type { CabinThermalQueryState } from './types';

interface CabinThermalEvidenceKpiBandProps {
  summary: CabinThermalSummary;
  state: CabinThermalQueryState;
  formatDuration: UnitFormatter;
}

export function CabinThermalEvidenceKpiBand({
  summary,
  state,
  formatDuration,
}: CabinThermalEvidenceKpiBandProps) {
  const { t } = useTranslation();
  const resolved = state.isResolved && !state.error;
  const unavailable = !state.vehicleSelected
    ? t('cabinThermal.states.selectVehicleKpi', 'Select a vehicle above to load evidence.')
    : state.isLoading
      ? t('cabinThermal.states.loadingKpi', 'Waiting for climate history…')
      : state.error
        ? t('cabinThermal.states.errorKpi', 'Climate history is unavailable; retry below.')
        : t('cabinThermal.states.pendingKpi', 'Climate-history availability is unresolved.');

  return (
    <section
      data-testid="cabin-thermal-kpis"
      aria-label={t(
        'cabinThermal.kpis.aria',
        'Cabin thermal evidence accounting summary',
      )}
    >
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-4 flex items-center gap-2">
          <ScanSearch className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
          {t('cabinThermal.kpis.title', 'Thermal evidence ledger')}
        </PanelTitle>
        <Grid cols={{ default: 1, sm: 2, xl: 6 }} gap={3}>
          <MetricCard
            label={t('cabinThermal.kpis.returned', 'Returned rows')}
            value={resolved ? fmtInt(summary.accounting.returnedRows) : '—'}
            subtitle={resolved
              ? t('cabinThermal.kpis.returnedHint', 'raw endpoint rows')
              : unavailable}
            icon={<Database className="h-5 w-5" />}
            color="blue"
          />
          <MetricCard
            label={t('cabinThermal.kpis.normalized', 'Normalized samples')}
            value={resolved ? fmtInt(summary.accounting.normalizedRows) : '—'}
            subtitle={resolved
              ? t('cabinThermal.kpis.normalizedHint', '{{count}} rows excluded', {
                  count: summary.accounting.excludedRows,
                })
              : unavailable}
            icon={<Filter className="h-5 w-5" />}
            color="cyan"
          />
          <MetricCard
            label={t('cabinThermal.kpis.candidates', 'Candidate windows')}
            value={resolved ? fmtInt(summary.accounting.candidateWindows) : '—'}
            subtitle={resolved
              ? t('cabinThermal.kpis.candidatesHint', 'contiguous HVAC-off segments')
              : unavailable}
            icon={<ScanSearch className="h-5 w-5" />}
            color="purple"
          />
          <MetricCard
            label={t('cabinThermal.kpis.accepted', 'Accepted fits')}
            value={resolved ? fmtInt(summary.accounting.acceptedFits) : '—'}
            subtitle={resolved
              ? t('cabinThermal.kpis.acceptedHint', 'the only windows supporting τ')
              : unavailable}
            icon={<CheckCircle2 className="h-5 w-5" />}
            color="green"
          />
          <MetricCard
            label={t('cabinThermal.kpis.rejected', 'Rejected candidates')}
            value={resolved ? fmtInt(summary.accounting.rejectedCandidates) : '—'}
            subtitle={resolved
              ? t('cabinThermal.kpis.rejectedHint', 'one final reason per candidate')
              : unavailable}
            icon={<XCircle className="h-5 w-5" />}
            color="amber"
          />
          <MetricCard
            label={t('cabinThermal.kpis.tau', 'Accepted median τ')}
            value={resolved && summary.tauMin != null
              ? formatDuration(summary.tauMin * 60, { precision: 1 })
              : '—'}
            subtitle={resolved
              ? t('cabinThermal.kpis.tauHint', 'withheld without an accepted fit')
              : unavailable}
            icon={<Timer className="h-5 w-5" />}
            color="cyan"
          />
        </Grid>
        <CabinThermalQueryStatus summary={summary} state={state} />
      </GlassPanel>
    </section>
  );
}
