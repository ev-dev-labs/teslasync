import { useTranslation } from 'react-i18next';
import { Database, ExternalLink } from 'lucide-react';
import { GlassPanel, PanelTitle, Badge, Caption, Text } from '@/components/ui';
import { DateTime } from '@/components/data-display';
import type { ServiceIntelligenceSource } from '@/api/hooks/useServiceIntelligence';
import { PanelState } from './PanelState';

export interface SourceFreshnessPanelProps {
  selected: boolean;
  loading: boolean;
  error: unknown;
  sources: ServiceIntelligenceSource[];
  onRetry: () => void;
}

export function SourceFreshnessPanel({
  selected,
  loading,
  error,
  sources,
  onRetry,
}: SourceFreshnessPanelProps) {
  const { t } = useTranslation();
  return (
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-3 flex items-center gap-2">
        <Database className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('serviceIntelligence.sources.title', 'Source freshness')}
      </PanelTitle>
      <PanelState
        selected={selected}
        loading={loading}
        error={error}
        empty={sources.length === 0}
        icon={<Database className="h-9 w-9" />}
        selectTitle={t('serviceIntelligence.common.selectTitle', 'Select a vehicle')}
        selectMessage={t(
          'serviceIntelligence.sources.select',
          'Choose a vehicle to inspect source availability and retrieval times.',
        )}
        emptyTitle={t('serviceIntelligence.sources.emptyTitle', 'No source metadata')}
        emptyMessage={t(
          'serviceIntelligence.sources.empty',
          'Source freshness metadata is not available yet.',
        )}
        onRetry={onRetry}
      >
        <ol className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {sources.map((source) => (
            <li
              key={source.id}
              className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <Text variant="body" weight="semibold">{source.name}</Text>
                <Badge variant={source.status === 'available' ? 'success' : 'warning'}>
                  {source.status === 'available'
                    ? t('serviceIntelligence.sources.available', 'Available')
                    : source.status === 'stale'
                      ? t('serviceIntelligence.sources.stale', 'Stale')
                      : t('serviceIntelligence.sources.unavailable', 'Unavailable')}
                </Badge>
              </div>
              <div className="mt-3 space-y-1">
                <Caption className="block">
                  {t('serviceIntelligence.sources.records', '{{count}} records', {
                    count: source.record_count,
                  })}
                </Caption>
                <Caption className="block">
                  {t('serviceIntelligence.sources.checked', 'Checked')}{' '}
                  <DateTime value={source.checked_at} variant="full" />
                </Caption>
                <Caption className="block">
                  {t('serviceIntelligence.sources.fetched', 'Fetched')}{' '}
                  <DateTime value={source.fetched_at} variant="full" />
                </Caption>
                {source.from_cache && (
                  <Badge variant="neutral">{t('serviceIntelligence.sources.cache', 'Normalized cache')}</Badge>
                )}
              </div>
              {source.detail && <Text as="p" variant="helper" className="mt-2">{source.detail}</Text>}
              <a
                href={source.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex min-h-11 items-center gap-1 rounded text-sm font-medium text-cyan-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40"
              >
                {t('serviceIntelligence.sources.open', 'Open source')}
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            </li>
          ))}
        </ol>
      </PanelState>
    </GlassPanel>
  );
}
