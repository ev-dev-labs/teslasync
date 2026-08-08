import { useTranslation } from 'react-i18next';
import { Scale, Trophy } from 'lucide-react';

import { GlassPanel, MetricLabel, MetricValue, PanelTitle, Text, Badge } from '@/components/ui';
import { cn } from '@/lib/cn';

import type { CompareSummary } from '../../lib/driveCompare';
import { CompareSectionBody, type CompareSectionState } from './CompareSectionBody';

interface ComparisonVerdictProps {
  summary: CompareSummary | null;
  state: CompareSectionState;
  className?: string;
  browseAction?: { label: string; to: string };
}

export function ComparisonVerdict({
  summary,
  state,
  className,
  browseAction,
}: ComparisonVerdictProps) {
  const { t } = useTranslation();

  const label = summary?.verdict === 'a'
    ? t('driveCompare.verdict.aLeads', 'Drive A leads')
    : summary?.verdict === 'b'
      ? t('driveCompare.verdict.bLeads', 'Drive B leads')
      : summary?.verdict === 'tie'
        ? t('driveCompare.verdict.tie', 'Dead heat')
        : t('driveCompare.verdict.insufficient', 'Not enough comparable data');

  const explanation = summary?.verdict === 'a' || summary?.verdict === 'b'
    ? t(
        'driveCompare.verdict.leadBody',
        '{{leader}} wins {{wins}} of {{count}} fair metrics.',
        {
          leader: summary.verdict === 'a'
            ? t('driveCompare.driveA', 'Drive A')
            : t('driveCompare.driveB', 'Drive B'),
          wins: summary.verdict === 'a' ? summary.aWins : summary.bWins,
          count: summary.comparableCount,
        },
      )
    : summary?.verdict === 'tie'
      ? t(
          'driveCompare.verdict.tieBody',
          'The fair score is level at {{wins}}–{{wins}}, with {{ties}} tied metrics.',
          { wins: summary.aWins, ties: summary.ties },
        )
      : t(
          'driveCompare.verdict.insufficientBody',
          'Both drives need valid consumption, regen, or drive-score data before a fair verdict is possible.',
        );

  return (
    <GlassPanel
      className={cn(
        'overflow-hidden bg-gradient-to-br from-cyan-500/[0.08] via-transparent to-purple-500/[0.08] p-5 sm:p-6',
        className,
      )}
      data-testid="drive-compare-verdict"
    >
      <PanelTitle className="mb-4 flex items-center gap-2">
        <Trophy className="h-4 w-4 text-amber-300" aria-hidden="true" />
        {t('driveCompare.verdict.title', 'Fair comparison verdict')}
      </PanelTitle>
      <CompareSectionBody
        state={state}
        icon={<Scale className="h-8 w-8" aria-hidden="true" />}
        emptyActionTo={browseAction}
        className="min-h-48"
      >
        {summary ? (
          <div className="grid min-h-48 items-center gap-6 md:grid-cols-[1fr_auto]">
            <div className="min-w-0">
              <Badge
                variant={summary.verdict === 'insufficient' ? 'warning' : summary.verdict === 'tie' ? 'neutral' : 'success'}
                size="lg"
              >
                {label}
              </Badge>
              <Text as="p" variant="subhead" className="mt-4">
                {explanation}
              </Text>
              <Text as="p" variant="bodySm" className="mt-3 max-w-xl">
                {t(
                  'driveCompare.verdict.neutralNote',
                  'Distance, duration, total energy, and absolute battery use stay neutral because trip size changes those totals.',
                )}
              </Text>
            </div>
            <div
              className="grid grid-cols-[1fr_auto_1fr] items-end gap-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-2)] px-6 py-4 text-center"
              aria-label={t(
                'driveCompare.verdict.scoreAria',
                'Fair metric score: Drive A {{a}}, Drive B {{b}}',
                { a: summary.aWins, b: summary.bWins },
              )}
            >
              <div>
                <MetricValue>{summary.aWins}</MetricValue>
                <MetricLabel>{t('driveCompare.driveA', 'Drive A')}</MetricLabel>
              </div>
              <MetricValue className="text-[var(--text-muted)]">–</MetricValue>
              <div>
                <MetricValue>{summary.bWins}</MetricValue>
                <MetricLabel>{t('driveCompare.driveB', 'Drive B')}</MetricLabel>
              </div>
            </div>
          </div>
        ) : null}
      </CompareSectionBody>
    </GlassPanel>
  );
}
