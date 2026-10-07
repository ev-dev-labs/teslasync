import { useTranslation } from 'react-i18next';
import { Badge, PanelTitle, Text } from '@/components/ui';
import { formatDateTime } from '@/lib/dateFormat';
import { Icons } from '@/lib/icons';
import { CalculationDetails } from './CalculationDetails';
import type {
  OperationalConfidenceLabel,
  OperationalNarrative,
  OperationalNarrativeProvenance,
} from '@/types/operationalNarrative';

export interface OperationalNarrativeDetailsProps {
  narrative: OperationalNarrative;
  className?: string;
}

const CONFIDENCE_VARIANT: Record<
  OperationalConfidenceLabel,
  'success' | 'info' | 'warning' | 'neutral'
> = {
  high: 'success',
  medium: 'info',
  low: 'warning',
  not_scored: 'neutral',
};

const CONFIDENCE_FALLBACK: Record<OperationalConfidenceLabel, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  not_scored: 'Not scored',
};

function provenanceLine(
  item: OperationalNarrativeProvenance,
  recordLabel: string,
): string {
  const parts = [item.source];
  if (item.recordId) parts.push(`${recordLabel} ${item.recordId}`);
  if (item.method) parts.push(item.method);
  return parts.join(' · ');
}

export function OperationalNarrativeDetails({
  narrative,
  className,
}: OperationalNarrativeDetailsProps) {
  const { t, i18n } = useTranslation();
  const confidenceLabel = t(
    `operations.narrative.confidence.${narrative.confidence.label}`,
    CONFIDENCE_FALLBACK[narrative.confidence.label],
  );
  const recordLabel = t('operations.narrative.record', 'Record');

  return (
    <section
      aria-label={t(
        'operations.narrative.title',
        'Decision narrative',
      )}
      className={className}
      data-testid="operational-narrative"
    >
      <PanelTitle>
        {t('operations.narrative.title', 'Decision narrative')}
      </PanelTitle>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-shape-md border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
          <Text as="p" size="xs" weight="semibold" color="primary">
            {t('operations.narrative.whatChanged', 'What changed')}
          </Text>
          <Text as="p" size="sm" color="secondary" className="mt-1">
            {narrative.whatChanged}
          </Text>
        </div>

        <div className="rounded-shape-md border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
          <Text as="p" size="xs" weight="semibold" color="primary">
            {t('operations.narrative.whyItMatters', 'Why it matters')}
          </Text>
          <Text as="p" size="sm" color="secondary" className="mt-1">
            {narrative.whyItMatters ??
              t(
                'operations.narrative.whyUnavailable',
                'No defensible impact statement is available.',
              )}
          </Text>
        </div>

        <div className="rounded-shape-md border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
          <Text as="p" size="xs" weight="semibold" color="primary">
            {t('operations.narrative.likelyCause', 'Likely cause')}
          </Text>
          <Text as="p" size="sm" color="secondary" className="mt-1">
            {narrative.likelyCause ??
              t(
                'operations.narrative.causeUnavailable',
                'Cause is not established by the available evidence.',
              )}
          </Text>
        </div>

        <div className="rounded-shape-md border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
          <Text as="p" size="xs" weight="semibold" color="primary">
            {t(
              'operations.narrative.recommendedResponse',
              'Recommended response',
            )}
          </Text>
          <Text as="p" size="sm" color="secondary" className="mt-1">
            {narrative.recommendedResponse ??
              t(
                'operations.narrative.responseUnavailable',
                'No action is recommended from this evidence alone.',
              )}
          </Text>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Text as="p" size="xs" weight="semibold" color="primary">
              {t('operations.narrative.confidence.title', 'Confidence')}
            </Text>
            <Badge
              variant={CONFIDENCE_VARIANT[narrative.confidence.label]}
              size="sm"
            >
              {confidenceLabel}
              {narrative.confidence.score != null
                ? ` · ${Math.round(narrative.confidence.score * 100)}%`
                : ''}
            </Badge>
          </div>
          {narrative.confidence.basis.length > 0 ? (
            narrative.confidence.basis.map((basis) => (
              <Text key={basis} as="p" size="xs" color="muted">
                {basis}
              </Text>
            ))
          ) : (
            <Text as="p" size="xs" color="muted">
              {t(
                'operations.narrative.confidence.unavailable',
                'No confidence basis was supplied.',
              )}
            </Text>
          )}
        </div>

        <div className="space-y-2">
          <Text as="p" size="xs" weight="semibold" color="primary">
            {t('operations.narrative.limitations', 'Limitations')}
          </Text>
          {narrative.limitations.length > 0 ? (
            narrative.limitations.map((limitation) => (
              <Text key={limitation} as="p" size="xs" className="text-amber-300">
                {limitation}
              </Text>
            ))
          ) : (
            <Text as="p" size="xs" color="muted">
              {t(
                'operations.narrative.noLimitations',
                'No additional limitations were supplied.',
              )}
            </Text>
          )}
        </div>
      </div>

      <div className="mt-4 space-y-2 border-t border-[var(--border-subtle)] pt-4">
        <Text as="p" size="xs" weight="semibold" color="primary">
          {t('operations.narrative.evidence', 'Supporting evidence')}
        </Text>
        {narrative.evidence.length > 0 ? (
          narrative.evidence.map((evidence) => (
            <div
              key={evidence.id}
              className="rounded-shape-md border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
            >
              <Text as="p" size="sm" color="primary">
                {evidence.summary}
              </Text>
              <Text
                as="p"
                size="2xs"
                color="muted"
                className="mt-1 flex items-start gap-2"
              >
                <Icons.database
                  className="mt-0.5 h-3.5 w-3.5 shrink-0"
                  aria-hidden="true"
                />
                <span>
                  {provenanceLine(evidence.provenance, recordLabel)}
                  {evidence.observedAt
                    ? ` · ${formatDateTime(evidence.observedAt, {
                        locale: i18n.language,
                      })}`
                    : ''}
                </span>
              </Text>
            </div>
          ))
        ) : (
          <Text as="p" size="xs" color="muted">
            {t(
              'operations.narrative.noEvidence',
              'No supporting records were supplied.',
            )}
          </Text>
        )}
      </div>

      <CalculationDetails
        className="mt-4"
        methods={narrative.provenance
          .map((item) => item.method ?? '')
          .filter(Boolean)}
        sources={narrative.provenance.map((item) =>
          provenanceLine(
            { source: item.source, recordId: item.recordId },
            recordLabel,
          ),
        )}
        coverage={
          narrative.evidence.length > 0
            ? t(
                'operations.narrative.evidenceCoverage',
                '{{count}} supporting records supplied.',
                { count: narrative.evidence.length },
              )
            : null
        }
        exclusions={narrative.limitations}
      />
    </section>
  );
}
