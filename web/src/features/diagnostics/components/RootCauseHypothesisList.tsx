import { useTranslation } from 'react-i18next';
import { ListOrdered, ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { GlassPanel, PanelTitle, Text, Caption, Badge, type BadgeProps, HelpTooltip } from '@/components/ui';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { fmtNumber } from '@/lib/numberFormat';
import type { EvidenceRelation, RankedHypothesis } from '../lib/rootCauseIntelligence';

const RELATION_VARIANT: Record<EvidenceRelation, BadgeProps['variant']> = {
  leads: 'warning',
  lags: 'info',
  concurrent: 'neutral',
};

function directionIcon(direction: RankedHypothesis['shift']['direction']) {
  if (direction === 'up') return <ArrowUp className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />;
  if (direction === 'down') return <ArrowDown className="h-3.5 w-3.5 text-rose-400" aria-hidden="true" />;
  return <Minus className="h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden="true" />;
}

export interface RootCauseHypothesisListProps {
  hypotheses: RankedHypothesis[];
  hasChosenSignal: boolean;
  focalShiftFound: boolean;
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  onRetry?: () => void;
  className?: string;
}

/**
 * Ranked hypothesis panel. Every item is a statistical observation about
 * temporal association with the focal signal's detected shift — never a
 * diagnosis or a claim of causal proof (see `rationale`, which repeats that
 * hedge verbatim from the pure `rootCauseIntelligence` engine).
 */
export function RootCauseHypothesisList({
  hypotheses,
  hasChosenSignal,
  focalShiftFound,
  isLoading,
  isError,
  error,
  onRetry,
  className,
}: RootCauseHypothesisListProps) {
  const { t } = useTranslation();

  const emptyMessage = !hasChosenSignal
    ? t('rootCauseIntelligence.hypotheses.pickOne', 'Choose a signal above to generate ranked hypotheses.')
    : !focalShiftFound
      ? t('rootCauseIntelligence.hypotheses.noFocalShift', 'No robust shift was found for this signal in the analyzed window, so no hypotheses are offered.')
      : t('rootCauseIntelligence.hypotheses.noneCorroborate', 'This signal shows a shift, but no other analyzed signal showed a comparable, well-timed shift.');

  return (
    <GlassPanel className={className ?? 'p-4 sm:p-5'}>
      <PanelTitle className="mb-3 flex items-center gap-2">
        <ListOrdered className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('rootCauseIntelligence.hypotheses.title', 'Ranked Hypotheses')}
        <HelpTooltip
          size="sm"
          i18nKey="help.rootCauseIntelligence.hypotheses"
          defaultValue="Ranked by robust shift strength, temporal lead/lag proximity, sample coverage, and evidence reliability. Every item is an evidence-ranked hypothesis, never a diagnosis or a claim of causal proof."
          ariaLabel={t('rootCauseIntelligence.hypotheses.helpLabel', 'More info about how hypotheses are ranked')}
        />
      </PanelTitle>
      {isError ? (
        <QueryError error={error} onRetry={onRetry} />
      ) : isLoading ? (
        <Skeleton height={96} />
      ) : hypotheses.length === 0 ? (
        <EmptyState /* no-action: hypotheses appear once a focal signal with a qualifying shift and corroborating evidence is found. */
          icon={<ListOrdered className="h-8 w-8" />}
          message={emptyMessage}
        />
      ) : (
        <ol className="space-y-3">
          {hypotheses.map((h, index) => (
            <li key={h.signal} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <Caption className="tabular-nums">#{index + 1}</Caption>
                <Text variant="body" weight="semibold" className="break-all">
                  {h.signal}
                </Text>
                <Badge variant={RELATION_VARIANT[h.relation] ?? 'neutral'}>
                  {h.relation === 'leads'
                    ? t('rootCauseIntelligence.graph.leads', 'leads')
                    : h.relation === 'lags'
                      ? t('rootCauseIntelligence.graph.lags', 'lags')
                      : t('rootCauseIntelligence.graph.concurrent', 'concurrent')}
                </Badge>
                <span className="inline-flex items-center gap-1">
                  {directionIcon(h.shift.direction)}
                  <Caption>{fmtNumber(h.shift.before.median, 2)} → {fmtNumber(h.shift.after.median, 2)}</Caption>
                </span>
              </div>
              <Text variant="body">{h.rationale}</Text>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                <Caption>{t('rootCauseIntelligence.hypotheses.score', 'Rank score {{n}}', { n: fmtNumber(h.score, 2) })}</Caption>
                <Caption>{t('rootCauseIntelligence.hypotheses.effect', 'Effect size {{n}}', { n: fmtNumber(h.shift.effectSize, 2) })}</Caption>
                <Caption>{t('rootCauseIntelligence.hypotheses.samples', '{{n}} samples', { n: h.sampleCount })}</Caption>
                <Caption>{t('rootCauseIntelligence.hypotheses.lag', 'Lag {{n}} min', { n: fmtNumber(Math.abs(h.lagMs) / 60_000, 1) })}</Caption>
              </div>
            </li>
          ))}
        </ol>
      )}
    </GlassPanel>
  );
}
