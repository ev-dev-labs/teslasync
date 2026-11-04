import { AlertTriangle, Database, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { EmptyState } from '@/components/feedback';
import { SourceContent, type SourceState } from '@/components/layout';
import { Badge, CardContent, Icon, Text, type BadgeProps } from '@/components/ui';
import { KVList } from '@/components/data-display';
import type { DataStateSource } from '@/api/dataState';
import { useDataState } from '@/hooks/useDataState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { cn } from '@/lib/cn';
import { neonColorMap, typography } from '@/lib/tokens';

import type { DataQuality, Evidence } from '@/types/advancedIntelligence';
import { InsightPanel } from './InsightPanel';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface EvidencePanelProps {
  quality?: DataQuality | null;
  evidence?: Evidence[] | null;
  limitations?: string[] | null;
  unsupported?: string[] | null;
  /** The same source as the caller's insight; its notices and retry remain caller-owned. */
  query?: DataStateSource<unknown>;
}

function qualityVariant(status: DataQuality['status'] | undefined): BadgeProps['variant'] {
  if (status === 'sufficient') return 'success';
  if (status === 'limited') return 'warning';
  if (status === 'insufficient') return 'danger';
  return 'neutral';
}

export function qualityStatusLabel(status: string | null | undefined, t: TFunction): string {
  if (status === 'sufficient') return t('advancedIntelligence.brief.quality.sufficient', 'Sufficient evidence');
  if (status === 'limited') return t('advancedIntelligence.brief.quality.limited', 'Limited evidence');
  if (status === 'insufficient') return t('advancedIntelligence.brief.quality.insufficient', 'Insufficient evidence');
  if (status != null) return t('advancedIntelligence.quality.unknownCode', 'Unknown quality: {{code}}', { code: status });
  return t('advancedIntelligence.brief.quality.unknown', 'Quality not supplied');
}

export function EvidencePanel({
  quality,
  evidence,
  limitations,
  unsupported,
  query,
}: EvidencePanelProps) {
  const { formatDateTime } = useDateFormat();
  const { fmtInt, fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const dataState = useDataState(query ?? {});
  const sourceState: SourceState = !query || dataState.hasData ? 'ready'
    : !dataState.fatalError && (query.isLoading || query.fetchStatus === 'fetching') ? 'loading'
    : 'empty';
  const unknownMessage = t('common.unknown', 'Unknown');
  const sourceContentProps = {
    state: sourceState,
    emptyMessage: unknownMessage,
    errorMessage: t('advancedIntelligence.panel.error', 'Intelligence evidence could not be loaded.'),
    // Do not repeat the parent insight's failure/paused notice or recovery action.
    emptyContent: <Text as="p" variant="bodySm" className={typography.color.secondary}>{unknownMessage}</Text>,
  };
  const evidenceItems = evidence ?? [];
  const limitationItems = limitations ?? [];
  const unsupportedItems = unsupported ?? [];
  const qualityLabel = qualityStatusLabel(quality?.status, t);

  return (
    <InsightPanel
      title={t('advancedIntelligence.evidence.title', 'Evidence, quality, and limitations')}
      description={t(
        'advancedIntelligence.evidence.subtitle',
        'Supported observations are separated from assumptions and unsupported fields.',
      )}
    >
      <div className="grid min-w-0 gap-5 break-words lg:grid-cols-3"
        aria-busy={query ? sourceState === 'loading' || dataState.isRefreshing : undefined}
        data-source-status={query ? dataState.status : undefined}
        data-source-provenance={query ? dataState.provenance : undefined}>
        <CardContent as="section" layoutSlot="column" aria-label={t('advancedIntelligence.quality.title', 'Data quality')}>
          <div className="flex items-center gap-2">
            <Icon icon={ShieldCheck} className={typography.color.secondary} aria-hidden={true} />
            <Text as="h3" variant="label">
              {t('advancedIntelligence.quality.title', 'Data quality')}
            </Text>
          </div>
          <SourceContent {...sourceContentProps} label={t('advancedIntelligence.quality.title', 'Data quality')}>
          {quality ? (
            <>
              <Badge variant={qualityVariant(quality.status)} dot>{qualityLabel}</Badge>
              <KVList layout="responsive" wrap items={[
                { id: 'samples', label: t('advancedIntelligence.quality.samples', 'Samples'), value: fmtInt(quality.sample_count) },
                { id: 'coverage', label: t('advancedIntelligence.quality.coverage', 'Coverage'), value: quality.coverage_pct != null ? `${fmtNumber(quality.coverage_pct)}%` : '—' },
                { id: 'window', label: t('advancedIntelligence.quality.window', 'Observation window'), value: quality.window_start || quality.window_end
                  ? `${formatDateTime(quality.window_start)} – ${formatDateTime(quality.window_end)}` : '—' },
              ]} />
              {(quality.reasons ?? []).map((reason, index) => (
                <Text as="p" variant="caption" key={`${reason}-${index}`}>• {reason}</Text>
              ))}
            </>
          ) : (
            <Text as="p" variant="bodySm">
              {t('advancedIntelligence.quality.unsupported', 'Quality metadata is unsupported.')}
            </Text>
          )}
          </SourceContent>
        </CardContent>

        <CardContent as="section" layoutSlot="column" aria-label={t('advancedIntelligence.evidence.sources', 'Evidence sources')}>
          <div className="flex items-center gap-2">
            <Icon icon={Database} className={typography.color.secondary} aria-hidden={true} />
            <Text as="h3" variant="label">
              {t('advancedIntelligence.evidence.sources', 'Evidence sources')}
            </Text>
          </div>
          <SourceContent {...sourceContentProps} label={t('advancedIntelligence.evidence.sources', 'Evidence sources')}>
          {evidenceItems.length > 0 ? evidenceItems.map((item, index) => (
            <div key={`${item.source}-${index}`} className="min-w-0 rounded-lg border border-[var(--border-default)] bg-[var(--surface-2)] p-3">
              <Text as="p" variant="label">{item.source}</Text>
              <Text as="p" variant="caption">{item.summary}</Text>
              <Text as="p" variant="caption" className="mt-1">
                {item.sample_count != null && Number.isFinite(item.sample_count)
                  ? t('advancedIntelligence.evidence.sampleLine', '{{formattedCount}} samples · {{date}}', {
                    count: item.sample_count,
                    formattedCount: fmtInt(item.sample_count),
                    date: formatDateTime(item.observed_at),
                  })
                  : formatDateTime(item.observed_at)}
              </Text>
            </div>
          )) : (
            // no-action: which evidence sources a calc run returns is determined server-side by that specific run; there is no client action that adds evidence after the fact.
            <EmptyState
              className="py-8"
              message={t('advancedIntelligence.evidence.empty', 'No supporting evidence was returned.')}
            />
          )}
          </SourceContent>
        </CardContent>

        <CardContent as="section" layoutSlot="column" aria-label={t('advancedIntelligence.limitations.title', 'Limitations')}>
          <div className="flex items-center gap-2">
            <Icon icon={AlertTriangle} className={neonColorMap.amber.text} aria-hidden={true} />
            <Text as="h3" variant="label">
              {t('advancedIntelligence.limitations.title', 'Limitations')}
            </Text>
          </div>
          <SourceContent {...sourceContentProps} label={t('advancedIntelligence.limitations.title', 'Limitations')}>
          {limitationItems.length > 0 ? limitationItems.map((item, index) => (
            <Text as="p" variant="bodySm" key={`${item}-${index}`}>• {item}</Text>
          )) : (
            <Text as="p" variant="bodySm">
              {t('advancedIntelligence.limitations.empty', 'No additional limitations were returned.')}
            </Text>
          )}
          </SourceContent>
          {unsupportedItems.length > 0 ? (
            <div className={cn('min-w-0 rounded-lg border p-3', neonColorMap.amber.border, neonColorMap.amber.bg)}>
              <Text as="p" variant="label">
                {t('advancedIntelligence.unsupported.title', 'Explicitly unsupported')}
              </Text>
              {unsupportedItems.map((item, index) => (
                <Text as="p" variant="caption" key={`${item}-${index}`}>• {item}</Text>
              ))}
            </div>
          ) : null}
        </CardContent>
      </div>
    </InsightPanel>
  );
}
