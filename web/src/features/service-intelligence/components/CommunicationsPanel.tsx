import { useTranslation } from 'react-i18next';
import { BookOpen, ExternalLink } from 'lucide-react';
import { Badge, Button, BUTTON_BASE, BUTTON_VARIANTS, Caption, Heading, Text } from '@/components/ui';
import { cn } from '@/lib/cn';
import { typography } from '@/lib/tokens';
import { LayoutCard } from '@/components/layout';
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
  const available = source?.status === 'available';
  const unknown = !available && !unavailable && !stale;

  return (
    <LayoutCard title={t('serviceIntelligence.communications.title', 'Manufacturer communications & TSBs')}
      actions={<BookOpen className="h-4 w-4 text-[var(--text-secondary)]" aria-hidden="true" />}>
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
          <div className="space-y-3">
            {unknown && (
              <div role="status" className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
                <Text as="p" variant="bodySm" color="secondary">
                  {t('provenance.unknown', 'Unknown source')}
                </Text>
                <Button type="button" variant="secondary" className="mt-2" onClick={onRetry}>
                  {t('common.retry', 'Retry')}
                </Button>
              </div>
            )}
            {unavailable && (
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
                    className={cn(BUTTON_BASE, BUTTON_VARIANTS.ghost, typography.size.sm, 'mt-2 min-h-11 max-w-full justify-start whitespace-normal px-2 hover:underline')}
                  >
                    {t('serviceIntelligence.communications.docs', 'Review NHTSA datasets')}
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </a>
                )}
              </AlertBanner>
            )}
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
            {communications.length === 0 && available ? (
              <EmptyState
                /* no-action: the configured authoritative source returned a valid empty inventory. */
                icon={<BookOpen className="h-9 w-9" />}
                title={t('serviceIntelligence.communications.emptyTitle', 'No communications found')}
                message={t(
                  'serviceIntelligence.communications.empty',
                  'The normalized official NHTSA index returned no manufacturer communications for this model year.',
                )}
              />
            ) : communications.length > 0 ? (
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
                          <DateTime value={communication.published_at} variant="day" />
                        </Caption>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={communication.applicability === 'potentially_applicable' ? 'warning' : communication.applicability === 'needs_review' ? 'info' : 'neutral'}>
                          {communication.applicability === 'potentially_applicable'
                            ? t('serviceIntelligence.applicability.potential', 'Potentially applicable')
                            : communication.applicability === 'needs_review'
                              ? t('serviceIntelligence.applicability.review', 'Needs review')
                              : t('serviceIntelligence.applicability.unlikely', 'Unlikely')}
                        </Badge>
                        <Badge variant="neutral">
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
                    <div className="mt-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
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
                      className={cn(BUTTON_BASE, BUTTON_VARIANTS.ghost, typography.size.sm, 'mt-2 min-h-11 max-w-full justify-start whitespace-normal px-2 hover:underline')}
                    >
                      {t('serviceIntelligence.communications.source', 'Open official NHTSA document')}
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    </a>
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
      </PanelState>
    </LayoutCard>
  );
}
