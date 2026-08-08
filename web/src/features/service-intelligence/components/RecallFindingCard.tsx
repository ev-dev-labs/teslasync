import { useTranslation } from 'react-i18next';
import { AlertTriangle, ExternalLink, RadioTower } from 'lucide-react';
import { Badge, Caption, Heading, Text } from '@/components/ui';
import { DateTime } from '@/components/data-display';
import type {
  ServiceIntelligenceApplicability,
  ServiceIntelligenceFinding,
} from '@/api/hooks/useServiceIntelligence';

export interface RecallFindingCardProps {
  finding: ServiceIntelligenceFinding;
}

function humanize(value: string): string {
  return value.split('_').join(' ');
}

function applicabilityVariant(
  applicability: ServiceIntelligenceApplicability,
): 'warning' | 'info' | 'neutral' {
  if (applicability === 'potentially_applicable') return 'warning';
  if (applicability === 'needs_review') return 'info';
  return 'neutral';
}

export function RecallFindingCard({ finding }: RecallFindingCardProps) {
  const { t } = useTranslation();
  const applicability =
    finding.applicability === 'potentially_applicable'
      ? t('serviceIntelligence.applicability.potential', 'Potentially applicable')
      : finding.applicability === 'needs_review'
        ? t('serviceIntelligence.applicability.review', 'Needs review')
        : t('serviceIntelligence.applicability.unlikely', 'Unlikely');

  return (
    <li className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-1)] p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Heading level="panel">{finding.title}</Heading>
          <Caption className="mt-1 block">{finding.component || '—'}</Caption>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={applicabilityVariant(finding.applicability)}>
            {applicability}
          </Badge>
          <Badge variant={finding.confidence_label === 'high' ? 'success' : 'info'}>
            {t('serviceIntelligence.confidence.value', '{{value}}% confidence', {
              value: Math.round(finding.confidence * 100),
            })}
          </Badge>
          <Badge variant="neutral">
            {t('serviceIntelligence.completion.unknown', 'Completion unknown')}
          </Badge>
        </div>
      </div>

      {(finding.park_it || finding.park_outside) && (
        <div className="mt-3 flex items-center gap-2 text-rose-300">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          <Text size="sm" weight="semibold" className="text-rose-300">
            {finding.park_it
              ? t('serviceIntelligence.recall.parkIt', 'NHTSA park-it warning')
              : t('serviceIntelligence.recall.parkOutside', 'NHTSA park-outside warning')}
          </Text>
        </div>
      )}

      <div className="mt-3 space-y-3">
        <Text as="p" variant="bodySm">{finding.summary}</Text>
        <div className="rounded-lg border border-cyan-400/15 bg-cyan-400/5 p-3">
          <Caption className="mb-1 block">{t('serviceIntelligence.recall.hypothesis', 'Applicability hypothesis')}</Caption>
          <Text as="p" variant="bodySm">{finding.hypothesis}</Text>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <Caption className="block">{t('serviceIntelligence.recall.consequence', 'Potential consequence')}</Caption>
            <Text as="p" variant="bodySm">{finding.consequence || '—'}</Text>
          </div>
          <div>
            <Caption className="block">{t('serviceIntelligence.recall.remedy', 'Published remedy')}</Caption>
            <Text as="p" variant="bodySm">{finding.remedy || '—'}</Text>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {finding.match_factors.map((factor) => (
            <Badge
              key={factor.dimension}
              variant={factor.status === 'matched' ? 'success' : 'neutral'}
              title={factor.detail}
            >
              {t(
                `serviceIntelligence.matchFactors.dimension.${factor.dimension}`,
                humanize(factor.dimension),
              )}
              {': '}
              {t(
                `serviceIntelligence.matchFactors.status.${factor.status}`,
                humanize(factor.status),
              )}
            </Badge>
          ))}
          {finding.over_the_air_update && (
            <Badge variant="info">
              <RadioTower className="h-3 w-3" aria-hidden="true" />
              {t('serviceIntelligence.recall.ota', 'OTA remedy')}
            </Badge>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-subtle)] pt-3">
        <Caption>
          {t('serviceIntelligence.recall.reported', 'Reported')}{' '}
          <DateTime value={finding.report_received_at} variant="date" />
        </Caption>
        <a
          href={finding.source_document_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center gap-1 rounded text-sm font-medium text-cyan-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40"
        >
          {t('serviceIntelligence.recall.source', 'Open NHTSA campaign')}
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      </div>
    </li>
  );
}
