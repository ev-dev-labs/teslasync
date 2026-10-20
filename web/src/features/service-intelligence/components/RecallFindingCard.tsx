import { useTranslation } from 'react-i18next';
import { AlertTriangle, ExternalLink, RadioTower } from 'lucide-react';
import { Badge, Button, BUTTON_BASE, BUTTON_VARIANTS, Caption, Heading, Text, Tooltip } from '@/components/ui';
import { cn } from '@/lib/cn';
import { typography } from '@/lib/tokens';
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
          <Badge variant="neutral">
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
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {finding.park_it && (
            <Badge variant="danger">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              {t('serviceIntelligence.recall.parkIt', 'NHTSA park-it warning')}
            </Badge>
          )}
          {finding.park_outside && (
            <Badge variant="danger">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              {t('serviceIntelligence.recall.parkOutside', 'NHTSA park-outside warning')}
            </Badge>
          )}
        </div>
      )}

      <div className="mt-3 space-y-3">
        <Text as="p" variant="bodySm">{finding.summary}</Text>
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
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
            <Tooltip key={factor.dimension} content={factor.detail} multiline>
              <Button type="button" variant="ghost" size="sm" wrapLabel className="min-h-11 px-1">
                <Badge variant="neutral">
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
              </Button>
            </Tooltip>
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
          <DateTime value={finding.report_received_at} variant="day" />
        </Caption>
        <a
          href={finding.source_document_url}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(BUTTON_BASE, BUTTON_VARIANTS.ghost, typography.size.sm, 'min-h-11 max-w-full justify-start whitespace-normal px-2 hover:underline')}
        >
          {t('serviceIntelligence.recall.source', 'Open NHTSA campaign')}
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      </div>
    </li>
  );
}
