import { useTranslation } from 'react-i18next';
import type { DataStateSource } from '@/api/dataState';
import { OperationalBrief } from '@/components/data-display';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import { AlertBanner, ErrorDisplay } from '@/components/feedback';
import { Button, Text } from '@/components/ui';
import { useDataState } from '@/hooks/useDataState';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { formatDateTime } from '@/lib/dateFormat';
import type { DataQuality, Evidence } from '@/types/advancedIntelligence';

interface AnalysisBriefProps {
  id: string;
  title: string;
  description: string;
  emptyMessage: string;
  metrics: readonly StatMetric[];
  vehicleId: number | null;
  hasResult: boolean;
  pending?: boolean;
  error?: unknown;
  query?: DataStateSource<unknown>;
  quality?: DataQuality | null;
  evidence?: readonly Evidence[] | null;
  limitations?: readonly string[] | null;
  generatedAt?: string | null;
  provenance: string;
}

export function AnalysisBrief({
  id, title, description, emptyMessage, metrics, vehicleId, hasResult,
  pending = false, error, query, quality, evidence, limitations, generatedAt, provenance,
}: AnalysisBriefProps) {
  const { t } = useTranslation();
  const { fmtInt, fmtNumber } = useNumberFormatting();
  const state = useDataState(query ?? {});
  const operationalMetrics = useOperationalMetrics(metrics);
  const retained = query ? state.hasData && state.status === 'stale' : hasResult && error != null;
  const refreshing = hasResult && (query ? state.isRefreshing : pending);
  const failure = query ? state.fatalError : !hasResult ? error : null;
  const loading = failure == null && vehicleId != null && !hasResult
    && (query ? query.isLoading || query.fetchStatus === 'fetching' : pending);
  const qualityLabel = quality?.status === 'sufficient'
    ? t('advancedIntelligence.brief.quality.sufficient', 'Sufficient evidence')
    : quality?.status === 'limited'
      ? t('advancedIntelligence.brief.quality.limited', 'Limited evidence')
      : quality?.status === 'insufficient'
        ? t('advancedIntelligence.brief.quality.insufficient', 'Insufficient evidence')
        : t('advancedIntelligence.brief.quality.unknown', 'Quality not supplied');
  const statusLabel = vehicleId == null
    ? t('advancedIntelligence.vehicle.empty', 'Select a vehicle to load intelligence.')
    : retained
      ? t('advancedIntelligence.brief.retained', 'Retained result')
      : failure
        ? t('advancedIntelligence.brief.failed', 'Source unavailable')
        : loading
          ? t('advancedIntelligence.brief.loading', 'Awaiting result')
          : refreshing
            ? t('advancedIntelligence.brief.refreshing', 'Updating result')
            : hasResult
              ? qualityLabel
              : query
                ? t('advancedIntelligence.brief.unresolved', 'Source unresolved')
                : t('advancedIntelligence.brief.notCalculated', 'Not calculated');
  const window = quality?.window_start || quality?.window_end
    ? t('advancedIntelligence.brief.window', 'Observation window: {{start}} – {{end}}', {
      start: formatDateTime(quality.window_start),
      end: formatDateTime(quality.window_end),
    })
    : t('advancedIntelligence.brief.windowUnknown', 'Observation window not supplied');
  const sourceScope = vehicleId == null
    ? t('advancedIntelligence.brief.vehicleUnknown', 'Vehicle scope not selected')
    : t('advancedIntelligence.brief.vehicle', 'Vehicle #{{id}}', { id: vehicleId });
  const noResultMessage = query
    ? query.fetchStatus === 'paused'
      ? t('advancedIntelligence.panel.paused', 'The initial evidence query is paused; no empty result is inferred.')
      : t('advancedIntelligence.panel.unresolved', 'Evidence availability has not resolved yet.')
    : emptyMessage;

  return (
    <div className="space-y-3">
      {retained && (
        <AlertBanner variant="warning" role="status">
          {t('advancedIntelligence.brief.retainedNotice', 'Previously loaded data remains visible while affected sources recover.')}
          {state.retry && <Button variant="ghost" size="sm" onClick={state.retry}>
            {t('common.retry', 'Retry')}
          </Button>}
        </AlertBanner>
      )}
      {failure != null && (
        <ErrorDisplay
          error={failure}
          compact
          message={t('advancedIntelligence.panel.error', 'Intelligence evidence could not be loaded.')}
          onRetry={state.retry ?? undefined}
        />
      )}
      <OperationalBrief
        compact
        testId={id}
        eyebrow={provenance}
        title={title}
        description={description}
        statusLabel={statusLabel}
        statusTone={retained || quality?.status === 'limited' ? 'warning'
          : failure || quality?.status === 'insufficient' ? 'danger' : 'neutral'}
        metrics={operationalMetrics}
        loading={Boolean(loading)}
        scope={<Text as="span" variant="caption">{sourceScope} · {window}</Text>}
        freshness={<Text as="span" variant="caption">
          {generatedAt
            ? t('advancedIntelligence.brief.generated', 'Result generated: {{date}}', { date: formatDateTime(generatedAt) })
            : t('advancedIntelligence.brief.generatedUnknown', 'Result generation time not supplied')}
        </Text>}
        attention={!hasResult && !loading && !failure ? [{
          key: 'unresolved',
          title: statusLabel,
          description: vehicleId == null
            ? t('advancedIntelligence.vehicle.empty', 'Select a vehicle to load intelligence.')
            : noResultMessage,
          tone: 'neutral',
        }] : []}
        narrative={{
          whatChanged: description,
          whyItMatters: null,
          confidence: {
            label: 'not_scored',
            score: null,
            basis: [
              qualityLabel,
              window,
              ...(quality ? [
                t('advancedIntelligence.brief.qualitySamples', 'Source quality sample count: {{value}}', { value: fmtInt(quality.sample_count) }),
                quality.coverage_pct != null
                  ? t('advancedIntelligence.brief.qualityCoverage', 'Source coverage: {{value}}%', { value: fmtNumber(quality.coverage_pct) })
                  : t('advancedIntelligence.brief.coverageUnknown', 'Source coverage not supplied'),
              ] : []),
              ...(quality?.reasons ?? []),
            ],
          },
          likelyCause: null,
          recommendedResponse: null,
          limitations: limitations ?? [],
          evidence: (evidence ?? []).map((item, index) => ({
            id: `${item.source}-${index}`,
            summary: item.sample_count == null ? item.summary : t(
              'advancedIntelligence.brief.evidenceSamples', '{{summary}} · {{count}} samples',
              { summary: item.summary, count: item.sample_count },
            ),
            observedAt: item.observed_at,
            provenance: { source: item.source },
          })),
          provenance: [{ source: provenance }],
        }}
      />
    </div>
  );
}
