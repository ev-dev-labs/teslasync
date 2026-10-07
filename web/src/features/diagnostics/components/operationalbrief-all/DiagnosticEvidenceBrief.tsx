import { useTranslation } from 'react-i18next';
import type { DataState } from '@/api/dataState';
import type { SignalEvidenceBundleSource } from '@/api/hooks/useTelemetry';
import { OperationalBrief, type StatMetric } from '@/components/data-display';
import { QueryError } from '@/components/feedback';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';

interface DiagnosticEvidenceBriefProps {
  testId: string;
  eyebrow: string;
  title: string;
  description: string;
  metrics: readonly StatMetric[];
  state: DataState<unknown>;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
  focalSignal: string;
  windowHours: number;
  hasChosenSignal: boolean;
  sources?: readonly SignalEvidenceBundleSource[];
  summary: string | null;
  limitations: readonly string[];
}

export function DiagnosticEvidenceBrief({
  testId, eyebrow, title, description, metrics, state, loading, error,
  onRetry, focalSignal, windowHours, hasChosenSignal, sources, summary, limitations,
}: DiagnosticEvidenceBriefProps) {
  const { t } = useTranslation();
  const briefMetrics = useOperationalMetrics(metrics);
  const retained = state.refreshError != null || state.isRefreshBlocked
    || (sources?.some(({ state: source }) => source.hasData
      && (source.refreshError != null || source.isRefreshBlocked || source.status === 'stale')) ?? false);
  const partial = state.status === 'partial'
    || (sources?.some(({ state: source }) => !source.hasData
      || source.status === 'unavailable' || source.status === 'partial') ?? false);
  const provenance = t('diagnostics.brief.provenance', 'Evidence-ranked analysis of retrieved signal histories; not a diagnosis or proof of causation.');
  const statusLabel = loading ? t('common.loading', 'Loading')
    : error ? t('error.loadFailed', 'Failed to load data')
      : !hasChosenSignal ? t('diagnostics.brief.chooseSignal', 'Choose a focal signal')
        : retained ? t('developerReference.stats.state.retained', 'Showing retained measurements')
          : partial ? t('diagnostics.brief.partial', 'Partial signal evidence')
            : state.isRefreshing ? t('diagnostics.brief.refreshing', 'Refreshing signal evidence')
              : state.hasData ? t('diagnostics.brief.available', 'Signal evidence available')
                : t('diagnostics.brief.unavailable', 'Signal evidence unavailable');

  return (
    <div className="space-y-3">
      <OperationalBrief
        compact
        testId={testId}
        eyebrow={eyebrow}
        title={title}
        description={description}
        metrics={briefMetrics}
        loading={loading}
        statusLabel={statusLabel}
        statusTone={error ? 'danger' : retained || partial ? 'warning' : 'neutral'}
        scope={t('diagnostics.brief.scope', '{{signal}} · {{h}}h requested history window', {
          signal: focalSignal || t('diagnostics.brief.noSignal', 'No focal signal'),
          h: windowHours,
        })}
        freshness={(sources?.length ?? 0) > 0
          ? t('diagnostics.brief.sourceDetails', 'Per-signal source states shown above')
          : t('diagnostics.brief.sourceUnknown', 'Per-signal freshness unavailable')}
        provenance={provenance}
        narrative={{
          whatChanged: summary ?? description,
          whyItMatters: null,
          confidence: {
            label: 'not_scored', score: null,
            basis: [t('diagnostics.brief.scoreBasis', 'Existing evidence-quality score on a 0–1 scale, not a probability or causal confidence.')],
          },
          likelyCause: null,
          recommendedResponse: null,
          limitations,
          evidence: [],
          provenance: [{ source: provenance }],
        }}
      />
      {error && <QueryError error={error} onRetry={onRetry} />}
    </div>
  );
}
