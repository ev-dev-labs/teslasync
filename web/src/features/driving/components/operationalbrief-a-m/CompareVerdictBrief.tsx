import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import type { StatMetric } from '@/components/data-display/stat-reference';
import type { ComparisonVerdict } from '../drive-compare/ComparisonVerdict';
import { CompareSectionBody } from '../drive-compare/CompareSectionBody';
import { DrivingSummaryBrief } from './DrivingSummaryBrief';

type Props = ComponentProps<typeof ComparisonVerdict> & { retained?: boolean };

export function CompareVerdictBrief({ summary, state, className, browseAction, retained = false }: Props) {
  const { t } = useTranslation();
  const label = summary?.verdict === 'a' ? t('driveCompare.verdict.aLeads', 'Drive A leads')
    : summary?.verdict === 'b' ? t('driveCompare.verdict.bLeads', 'Drive B leads')
      : summary?.verdict === 'tie' ? t('driveCompare.verdict.tie', 'Dead heat')
        : t('driveCompare.verdict.insufficient', 'Not enough comparable data');
  const explanation = summary?.verdict === 'a' || summary?.verdict === 'b'
    ? t('driveCompare.verdict.leadBody', '{{leader}} wins {{wins}} of {{count}} fair metrics.', {
      leader: summary.verdict === 'a' ? t('driveCompare.driveA', 'Drive A') : t('driveCompare.driveB', 'Drive B'),
      wins: summary.verdict === 'a' ? summary.aWins : summary.bWins, count: summary.comparableCount,
    })
    : summary?.verdict === 'tie'
      ? t('driveCompare.verdict.tieBody', 'The fair score is level at {{wins}}–{{wins}}, with {{ties}} tied metrics.', { wins: summary.aWins, ties: summary.ties })
      : t('driveCompare.verdict.insufficientBody', 'Both drives need valid consumption, regen, or drive-score data before a fair verdict is possible.');
  const neutral = t('driveCompare.verdict.neutralNote', 'Distance, duration, total energy, and absolute battery use stay neutral because trip size changes those totals.');
  const metrics: readonly StatMetric[] = [
    { metricId: 'count', occurrenceId: 'drive-a-wins', rawValue: summary?.aWins,
      label: t('driveCompare.driveA', 'Drive A'), description: explanation, context: neutral },
    { metricId: 'count', occurrenceId: 'drive-b-wins', rawValue: summary?.bWins,
      label: t('driveCompare.driveB', 'Drive B'), description: explanation, context: neutral },
  ];
  return <div className={className} data-testid="drive-compare-verdict">
    <div role="group" aria-label={summary
      ? t('driveCompare.verdict.scoreAria', 'Fair metric score: Drive A {{a}}, Drive B {{b}}', { a: summary.aWins, b: summary.bWins })
      : undefined}>
    <DrivingSummaryBrief metrics={metrics} title={t('driveCompare.verdict.title', 'Fair comparison verdict')}
      description={explanation}
      scope={t('driveCompare.brief.scope', 'Selected Drive A and Drive B; only fair, comparable measurements decide the verdict')}
      provenance={neutral}
      loading={state.isLoading} error={state.error} showError={false} retained={retained}
      statusLabel={state.error || state.isLoading ? undefined : label}
      onRetry={state.onRetry} />
    </div>
    {(state.isLoading || state.error != null || state.emptyMessage != null) && (
      <CompareSectionBody state={state} emptyActionTo={browseAction} className="min-h-0">
        {null}
      </CompareSectionBody>
    )}
  </div>;
}
