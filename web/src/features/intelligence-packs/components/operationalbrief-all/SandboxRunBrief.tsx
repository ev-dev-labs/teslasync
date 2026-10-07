import { useTranslation } from 'react-i18next';
import { OperationalBrief, type StatMetric } from '@/components/data-display';
import { Caption } from '@/components/ui';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import type { SandboxRunResult } from '../../lib/sandboxRunner';

interface SandboxRunBriefProps {
  run: SandboxRunResult;
  packName: string;
  packVersion: string;
  grantDescription: string;
}

export function SandboxRunBrief({ run, packName, packVersion, grantDescription }: SandboxRunBriefProps) {
  const { t } = useTranslation();
  const runStats = t('intelPacks.sandbox.runStats', '{{rows}} sample rows · {{steps}} evaluation steps · {{ms}}ms{{truncated}}', {
    rows: run.rowsUsed,
    steps: run.totalStepsUsed,
    ms: run.durationMs,
    truncated: run.truncated ? t('intelPacks.sandbox.truncatedSuffix', ' · truncated by budget') : '',
  });
  const partial = run.truncated || run.formulas.some((formula) => formula.budgetError != null);
  const sourceMetrics: readonly StatMetric[] = [
    {
      metricId: 'count',
      occurrenceId: 'sandbox-sample-rows',
      rawValue: run.rowsUsed,
      label: t('intelPacks.sandbox.brief.rows', 'Sample rows'),
      description: t('intelPacks.sandbox.brief.rowsDetail', 'Bundled synthetic rows used by this evaluation, not recorded vehicle observations.'),
      context: runStats,
    },
    {
      metricId: 'count',
      occurrenceId: 'sandbox-evaluation-steps',
      rawValue: run.totalStepsUsed,
      label: t('intelPacks.sandbox.brief.steps', 'Evaluation steps'),
      description: t('intelPacks.sandbox.brief.stepsDetail', 'Interpreter steps consumed by the selected pack, not a configured execution ceiling.'),
    },
    {
      metricId: 'latency',
      occurrenceId: 'sandbox-elapsed-time',
      rawValue: run.durationMs / 1000,
      label: t('intelPacks.sandbox.brief.elapsed', 'Evaluation time'),
      description: t('intelPacks.sandbox.brief.elapsedDetail', 'Measured wall-clock time for this synthetic evaluation; this is not a live-data freshness timestamp.'),
      display: {
        formatter: () => ({ value: String(run.durationMs), unit: 'ms' }),
      },
    },
  ];
  const metrics = useOperationalMetrics(sourceMetrics);

  return (
    <OperationalBrief
      compact
      testId="intelligence-packs-sandbox-run-brief"
      eyebrow={t('intelPacks.sandbox.brief.eyebrow', 'Synthetic sandbox')}
      title={t('intelPacks.sandbox.brief.title', 'Selected pack evaluation')}
      description={t('intelPacks.sandbox.brief.description', 'These measurements describe the bundled sample run only. Pack installation and capability grants are local configuration, not a subscription or evidence of model accuracy on real vehicle data.')}
      statusLabel={partial
        ? t('intelPacks.sandbox.brief.partial', 'Budget-limited results')
        : t('intelPacks.sandbox.brief.complete', 'Sample evaluation complete')}
      statusTone={partial ? 'warning' : 'neutral'}
      metrics={metrics}
      scope={<Caption>{packName} · v{packVersion}</Caption>}
      freshness={<Caption>{t('intelPacks.sandbox.brief.freshness', 'Selected run; no vehicle-data timestamp')}</Caption>}
      provenance={`${t('intelPacks.sandbox.brief.provenance', 'Local bounded interpreter over bundled synthetic sample data; no network or real telemetry.')} ${grantDescription}`}
      attention={partial ? [{
        key: 'sandbox-budget',
        title: t('intelPacks.sandbox.brief.partial', 'Budget-limited results'),
        description: t('intelPacks.sandbox.brief.partialDetail', 'Retained widget outputs may be partial. Review each formula’s budget and capability-denial notices; no analytical accuracy or confidence is inferred.'),
        tone: 'warning',
      }] : []}
    />
  );
}
