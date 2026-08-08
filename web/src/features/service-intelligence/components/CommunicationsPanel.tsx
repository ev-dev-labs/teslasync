import { useTranslation } from 'react-i18next';
import { BookOpen, ExternalLink } from 'lucide-react';
import { Badge, GlassPanel, PanelTitle, Caption, Heading, Text } from '@/components/ui';
import { AlertBanner, EmptyState } from '@/components/feedback';
import { DateTime } from '@/components/data-display';
import type {
  ServiceIntelligenceCommunication,
  ServiceIntelligenceSource,
} from '@/api/hooks/useServiceIntelligence';
import { PanelState } from './PanelState';

export interface CommunicationsPanelProps {
  selected: boolean;
  loading: boolean;
  error: unknown;
  communications: ServiceIntelligenceCommunication[];
  source: ServiceIntelligenceSource | null;
  onRetry: () => void;
}

export function CommunicationsPanel({
  selected,
  loading,
  error,
  communications,
  source,
  onRetry,
}: CommunicationsPanelProps) {
  const { t } = useTranslation();
  const unavailable = source?.status === 'unavailable';
  const stale = source?.status === 'stale';

  return (
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-3 flex items-center gap-2">
        <BookOpen className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('serviceIntelligence.communications.title', 'Manufacturer communications & TSBs')}
      </PanelTitle>
      <PanelState
        selected={selected}
        loading={loading}
        error={error}
        empty={false}
        icon={<BookOpen className="h-9 w-9" />}
        selectTitle={t('serviceIntelligence.common.selectTitle', 'Select a vehicle')}
        selectMessage={t(
          'serviceIntelligence.communications.select',
          'Choose a vehicle to check the configured manufacturer-communications provider.',
        )}
        emptyTitle=""
        emptyMessage=""
        onRetry={onRetry}
      >
        {unavailable ? (
          <AlertBanner
            variant="warning"
            title={t('serviceIntelligence.communications.unavailableTitle', 'Typed TSB source unavailable')}
          >
            <Text as="p" variant="bodySm">
              {source?.detail ??
                t(
                  'serviceIntelligence.communications.unavailable',
                  'NHTSA does not currently document a stable vehicle-scoped JSON API for manufacturer communications. TeslaSync does not fabricate records.',
                )}
            </Text>
            {source?.source_url && (
              <a
                href={source.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex min-h-11 items-center gap-1 rounded font-medium text-amber-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/40"
              >
                {t('serviceIntelligence.communications.docs', 'Review NHTSA datasets')}
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            )}
          </AlertBanner>
        ) : (
          <div className="space-y-3">
            {stale && (
              <AlertBanner
                variant="warning"
                title={t('serviceIntelligence.communications.staleTitle', 'TSB index needs refresh')}
              >
                <Text as="p" variant="bodySm">
                  {source?.detail ??
                    t(
                      'serviceIntelligence.communications.stale',
                      'Showing matches from the last successful official NHTSA bulk import.',
                    )}
                </Text>
              </AlertBanner>
            )}
            {communications.length === 0 ? (
              <EmptyState
                /* no-action: the configured authoritative source returned a valid empty inventory. */
                icon={<BookOpen className="h-9 w-9" />}
                title={t('serviceIntelligence.communications.emptyTitle', 'No communications found')}
                message={t(
                  'serviceIntelligence.communications.empty',
                  'The normalized official NHTSA index returned no manufacturer communications for this model year.',
                )}
              />
            ) : (
              <ol className="space-y-3">
                {communications.map((communication) => (
                  <li
                    key={communication.id}
                    className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <Heading level="panel">{communication.communication_number}</Heading>
                        <Caption className="mt-1 block">
                          {communication.component || '—'} ·{' '}
                          <DateTime value={communication.published_at} variant="date" />
                        </Caption>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="warning">
                          {communication.applicability === 'potentially_applicable'
                            ? t('serviceIntelligence.applicability.potential', 'Potentially applicable')
                            : communication.applicability === 'needs_review'
                              ? t('serviceIntelligence.applicability.review', 'Needs review')
                              : t('serviceIntelligence.applicability.unlikely', 'Unlikely')}
                        </Badge>
                        <Badge variant="info">
                          {t('serviceIntelligence.confidence.value', '{{value}}% confidence', {
                            value: Math.round(communication.confidence * 100),
                          })}
                        </Badge>
                      </div>
                    </div>
                    <Caption className="mt-2 block">
                      {communication.communication_type ||
                        t('serviceIntelligence.communications.typeUnknown', 'Communication type unavailable')}
                    </Caption>
                    <Text as="p" variant="bodySm" className="mt-2">{communication.summary}</Text>
                    <div className="mt-3 rounded-lg border border-cyan-400/15 bg-cyan-400/5 p-3">
                      <Caption className="mb-1 block">
                        {t('serviceIntelligence.communications.hypothesis', 'Applicability hypothesis')}
                      </Caption>
                      <Text as="p" variant="bodySm">{communication.hypothesis}</Text>
                    </div>
                    {communication.symptom_matches.length > 0 && (
                      <Badge variant="warning" className="mt-3">
                        {t(
                          'serviceIntelligence.communications.symptoms',
                          '{{count}} observed symptom match',
                          { count: communication.symptom_matches.length },
                        )}
                      </Badge>
                    )}
                    <a
                      href={communication.source_document_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex min-h-11 items-center gap-1 rounded text-sm font-medium text-cyan-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40"
                    >
                      {t('serviceIntelligence.communications.source', 'Open official NHTSA document')}
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    </a>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </PanelState>
    </GlassPanel>
  );
}
