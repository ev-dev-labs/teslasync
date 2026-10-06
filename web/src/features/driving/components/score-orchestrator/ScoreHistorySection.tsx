import { GlassPanel, PanelTitle } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { Icons } from '@/lib/icons';
import { ScoreHistoryTable } from '../continuation-driving-primary/ScoreHistoryTable';
import type { ScoreSectionProps } from './scoreSectionTypes';

type ScoreHistorySectionProps = ScoreSectionProps<
  't' | 'historyColumns' | 'sortedHistory' | 'sortKey' | 'sortDir' | 'onSort'
>;

export function ScoreHistorySection({ model, driveState }: ScoreHistorySectionProps) {
  const { t, historyColumns, sortedHistory, sortKey, sortDir, onSort } = model;

  return (
    <FadeIn delay={0.3}>
      <section aria-label={t('driveScore.driveHistory', 'Drive History')}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3">{t('driveScore.driveHistory', 'Drive History')}</PanelTitle>
          {driveState(
            320,
            t('driveScore.noDrives', 'No drives found for the selected period.'),
            <Icons.drive className="h-8 w-8" aria-hidden="true" />,
          ) ?? (
            <ScoreHistoryTable
              columns={historyColumns}
              rows={sortedHistory}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
            />
          )}
        </GlassPanel>
      </section>
    </FadeIn>
  );
}
