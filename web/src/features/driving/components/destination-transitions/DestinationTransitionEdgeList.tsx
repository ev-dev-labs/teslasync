import { ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Badge, Text } from '@/components/ui';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import type { DestinationEdge } from '../../lib/destinationTransitions';
import {
  destinationEvidenceBandLabel,
  destinationPercent,
} from './labels';

interface DestinationTransitionEdgeListProps {
  edges: DestinationEdge[];
  locale: string;
  mode: 'frequency' | 'information';
}

export function DestinationTransitionEdgeList({
  edges,
  locale,
  mode,
}: DestinationTransitionEdgeListProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-2">
      {edges.map((edge, index) => (
        <article
          key={`${edge.fromKey}-${edge.toKey}`}
          className="flex flex-col gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex min-w-0 items-center gap-3">
            <Text
              variant="metricLabel"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--surface-1)]"
            >
              {fmtInt(index + 1)}
            </Text>
            <div className="min-w-0">
              <Text as="p" variant="bodySm" weight="semibold">
                {t(
                  'destinationTransitions.edges.route',
                  '{{from}} → {{to}}',
                  { from: edge.fromLabel, to: edge.toLabel },
                )}
              </Text>
              <Text as="p" variant="caption">
                {mode === 'frequency'
                  ? t(
                      'destinationTransitions.edges.frequencyDetail',
                      '{{count}} accepted · {{conditional}} from origin · {{overall}} of all accepted transitions · {{days}} active days',
                      {
                        count: edge.count,
                        conditional: destinationPercent(
                          edge.observedConditionalShare,
                          locale,
                        ),
                        overall: destinationPercent(
                          edge.shareOfAcceptedTransitions,
                          locale,
                        ),
                        days: fmtInt(edge.activeLocalDays),
                      },
                    )
                  : t(
                      'destinationTransitions.edges.informationDetail',
                      '{{bits}} empirical information bits · {{count}} accepted · {{share}} observed origin share',
                      {
                        bits: fmtNumber(
                          edge.empiricalInformationBits,
                          2,
                          locale,
                        ),
                        count: edge.count,
                        share: destinationPercent(
                          edge.observedConditionalShare,
                          locale,
                        ),
                      },
                    )}
              </Text>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge
              variant={edge.originSupported ? 'success' : 'warning'}
            >
              {destinationEvidenceBandLabel(t, edge.originSupportBand)}
            </Badge>
            <ArrowRight
              className="h-4 w-4 text-[var(--text-muted)]"
              aria-hidden="true"
            />
          </div>
        </article>
      ))}
    </div>
  );
}
