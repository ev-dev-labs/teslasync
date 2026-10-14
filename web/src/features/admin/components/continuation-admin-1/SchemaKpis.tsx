import { useTranslation } from 'react-i18next';
import { AlertTriangle, ShieldCheck, Database, Columns3, KeyRound } from 'lucide-react';
import { OperationalBrief, SeverityBadge, type OperationalAttention } from '@/components/data-display';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import type { StatMetric } from '@/components/data-display/stat-reference';
import type { OperationalNarrative } from '@/types/operationalNarrative';
import { QueryError } from '@/components/feedback';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { formatSchemaDelta, schemaDeltaTone, type SchemaSectionState } from './schemaPresentation';

export function SchemaKpis({ state, isDrifted, retained = false }: {
  state: SchemaSectionState; isDrifted: boolean; retained?: boolean;
}) {
  const { t } = useTranslation();
  const { fmtInt } = useNumberFormatting();
  const { drift, isLoading } = state;
  const title = t('admin.schemaDrift.kpis', 'Schema drift summary');
  const hint = t('admin.schemaDrift.statusHint', 'Current schema vs recorded seed');
  const count = (value: number | null | undefined) => value == null ? '—' : fmtInt(value);
  const deltas = [
    { key: 'tables', label: t('admin.schemaDrift.tableDelta', 'Tables Δ'),
      delta: drift?.table_count_delta, current: drift?.current?.table_count, expected: drift?.expected?.table_count,
      icon: <Database className="h-4 w-4 text-cyan-300" aria-hidden /> },
    { key: 'columns', label: t('admin.schemaDrift.columnDelta', 'Columns Δ'),
      delta: drift?.column_count_delta, current: drift?.current?.column_count, expected: drift?.expected?.column_count,
      icon: <Columns3 className="h-4 w-4 text-emerald-300" aria-hidden /> },
    { key: 'indexes', label: t('admin.schemaDrift.indexDelta', 'Indexes Δ'),
      delta: drift?.index_count_delta, current: drift?.current?.index_count, expected: drift?.expected?.index_count,
      icon: <KeyRound className="h-4 w-4 text-amber-300" aria-hidden /> },
  ];
  const metrics: StatMetric[] = [
    {
      metricId: 'status', occurrenceId: 'schema-status',
      label: t('admin.schemaDrift.statusLabel', 'Status'),
      description: hint,
      rawValue: drift ? (isDrifted
        ? t('admin.schemaDrift.statusDrifted', 'Drift detected')
        : t('admin.schemaDrift.statusClean', 'No drift')) : null,
      context: <div className="flex items-center gap-2">
        {drift && (isDrifted
          ? <AlertTriangle className="h-4 w-4 text-amber-300" aria-hidden />
          : <ShieldCheck className="h-4 w-4 text-emerald-300" aria-hidden />)}
        <span>{hint}</span>
      </div>,
    },
    ...deltas.map(({ key, label, delta, current, expected, icon }): StatMetric => ({
      metricId: 'number', occurrenceId: `schema-${key}-delta`, rawValue: delta,
      label, description: hint,
      display: { precision: 0, formatter: value => ({ value: formatSchemaDelta(value), unit: '' }) },
      context: <div className="flex items-center gap-2">{icon}<span>
        {t('admin.schemaDrift.deltaSub', '{{current}} current · {{expected}} expected', {
          current: count(current), expected: count(expected),
        })}
      </span></div>,
      comparisonContent: delta != null && Number.isFinite(delta)
        ? <SeverityBadge severity={schemaDeltaTone(delta)} size="sm">
          {delta === 0 ? t('admin.schemaDrift.match', 'Match') : t('admin.schemaDrift.drift', 'Drift')}
        </SeverityBadge> : undefined,
    })),
  ];
  const briefMetrics = useOperationalMetrics(metrics);
  const periodUnknown = t('admin.operationalBrief.periodUnknown', 'Observation time and complete analysis bounds are not supplied by this source.');
  const missingEvidence = t('admin.schemaDrift.guidanceEmpty', 'Restart the API to capture a seed fingerprint, then drift interpretation appears here.');
  const changes = deltas.filter(({ delta }) => delta != null && Number.isFinite(delta) && delta !== 0)
    .map(({ key, delta }) => t(`admin.schemaDrift.change${key[0].toUpperCase()}${key.slice(1)}`,
      key === 'tables' ? 'Tables {{delta}}' : key === 'columns' ? 'Columns {{delta}}' : 'Indexes {{delta}}',
      { delta: formatSchemaDelta(delta) }));
  const countsKnown = deltas.every(({ delta }) => delta != null && Number.isFinite(delta));
  const interpretation = !drift ? missingEvidence : !isDrifted
    ? t('admin.schemaDrift.statusClean', 'No drift')
    : changes.length > 0
      ? t('admin.schemaDrift.driftedBodyCounts', 'The live schema differs from the seed: {{changes}}.', { changes: changes.join(' · ') })
      : countsKnown
        ? t('admin.schemaDrift.driftedBodyHash', 'The live schema fingerprint differs from the seed even though object counts match — inspect column definitions or index expressions.')
        : t('admin.schemaDrift.driftedBodyUnknownCounts', 'The live schema fingerprint differs from the seed. Object-count comparisons are unavailable; inspect the available fingerprints and confirm migrations before making changes.');
  const attention: OperationalAttention[] = !drift || isDrifted ? [{
    key: 'schema-comparison',
    title: drift ? t('admin.schemaDrift.guidanceTitle', 'What this means')
      : t('admin.operationalBrief.unmeasured', 'Not measured'),
    description: interpretation,
    tone: drift ? 'warning' : 'neutral',
  }] : [];
  const narrative: OperationalNarrative = {
    whatChanged: interpretation,
    whyItMatters: null,
    confidence: { label: 'not_scored', score: null, basis: [] },
    likelyCause: null,
    recommendedResponse: !drift ? missingEvidence : isDrifted
      ? [
        t('admin.schemaDrift.remediateSeed', 'Confirm migrations are applied, then restart the API to regenerate the seed fingerprint.'),
        t('admin.schemaDrift.remediateDdl', 'If migrations are already current, investigate raw DDL that bypassed the migration system.'),
      ].join(' ') : null,
    limitations: [periodUnknown, ...(retained ? [t('admin.operationalBrief.retained', 'Retained evidence')] : [])],
    evidence: drift ? [{ id: 'schema-comparison', summary: interpretation, observedAt: null,
      provenance: { source: hint } }] : [],
    provenance: [{ source: hint }],
  };
  return (
    <section className="min-w-0" data-retained={retained}>
      <OperationalBrief compact testId="schema-drift-summary" metrics={briefMetrics}
        eyebrow={t('admin.schemaDrift.pageTitle', 'Schema drift')} title={title} description={hint}
        statusLabel={isLoading ? t('common.loading', 'Loading') : state.error
          ? t('common.error', 'Error') : retained ? t('admin.operationalBrief.retained', 'Retained evidence')
          : drift ? t('admin.operationalBrief.snapshot', 'Source snapshot')
          : t('admin.operationalBrief.unmeasured', 'Not measured')}
        statusTone={state.error || retained ? 'warning' : 'neutral'}
        scope={<span>{hint} · {periodUnknown}</span>} loading={isLoading && !retained}
        freshness={retained ? t('admin.operationalBrief.retained', 'Retained evidence') : undefined}
        provenance={hint} attention={attention} narrative={narrative} />
      {Boolean(state.error) && <QueryError error={state.error} onRetry={state.onRetry}
        resourceName={t('admin.schemaDrift.pageTitle', 'Schema drift')} />}
    </section>
  );
}
