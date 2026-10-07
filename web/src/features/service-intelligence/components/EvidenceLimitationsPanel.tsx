import { useTranslation } from 'react-i18next';
import { ExternalLink, FileSearch, Info } from 'lucide-react';
import { GlassPanel, PanelTitle, Badge, Caption, Heading, Text } from '@/components/ui';
import type { ServiceIntelligenceEvidenceBundle } from '@/api/hooks/useServiceIntelligence';
import { PanelState } from './PanelState';

export interface EvidenceLimitationsPanelProps {
  selected: boolean;
  loading: boolean;
  error: unknown;
  evidence: ServiceIntelligenceEvidenceBundle | null;
  onRetry: () => void;
}

export function EvidenceLimitationsPanel({
  selected,
  loading,
  error,
  evidence,
  onRetry,
}: EvidenceLimitationsPanelProps) {
  const { t } = useTranslation();
  const items = evidence?.items ?? [];
  const limitations = evidence?.limitations ?? [];

  return (
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-3 flex items-center gap-2">
        <FileSearch className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('serviceIntelligence.evidence.title', 'Evidence & limitations')}
      </PanelTitle>
      <PanelState
        selected={selected}
        loading={loading}
        error={error}
        empty={evidence == null}
        icon={<FileSearch className="h-9 w-9" />}
        selectTitle={t('serviceIntelligence.common.selectTitle', 'Select a vehicle')}
        selectMessage={t(
          'serviceIntelligence.evidence.select',
          'Choose a vehicle to assemble service-ready evidence references.',
        )}
        emptyTitle={t('serviceIntelligence.evidence.emptyTitle', 'No evidence bundle')}
        emptyMessage={t(
          'serviceIntelligence.evidence.empty',
          'No normalized service-intelligence evidence is available yet.',
        )}
        onRetry={onRetry}
      >
        <div className="space-y-5">
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <Heading level="sub">{t('serviceIntelligence.evidence.inventory', 'Evidence inventory')}</Heading>
              <Badge variant="info">
                {t('serviceIntelligence.evidence.count', '{{count}} items', { count: items.length })}
              </Badge>
            </div>
            <ol className="space-y-2">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <Text variant="body" weight="semibold">{item.title}</Text>
                      <Caption className="mt-1 block">{item.source_name}</Caption>
                    </div>
                    <Badge variant="neutral">
                      {t(
                        `serviceIntelligence.evidence.kind.${item.kind}`,
                        item.kind.split('_').join(' '),
                      )}
                    </Badge>
                  </div>
                  <Text as="p" variant="bodySm" className="mt-2">{item.summary}</Text>
                  {item.source_document_url && (
                    <a
                      href={item.source_document_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex min-h-11 items-center gap-1 rounded text-sm font-medium text-cyan-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40"
                    >
                      {t('serviceIntelligence.evidence.source', 'Open evidence source')}
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    </a>
                  )}
                </li>
              ))}
            </ol>
          </div>
          <div className="border-t border-[var(--border-subtle)] pt-4">
            <Heading level="sub" className="mb-2 flex items-center gap-2">
              <Info className="h-4 w-4 text-amber-300" aria-hidden="true" />
              {t('serviceIntelligence.limitations.title', 'Interpretation limits')}
            </Heading>
            <ul className="list-disc space-y-2 ps-5">
              {limitations.map((limitation) => (
                <li key={limitation}><Text variant="bodySm">{limitation}</Text></li>
              ))}
            </ul>
            <Text as="p" variant="helper" className="mt-3">{evidence?.disclaimer ?? '—'}</Text>
          </div>
        </div>
      </PanelState>
    </GlassPanel>
  );
}
