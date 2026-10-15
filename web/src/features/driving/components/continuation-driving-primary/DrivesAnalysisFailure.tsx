import { useTranslation } from 'react-i18next';
import { Section, LayoutCard } from '@/components/layout';
import { QueryError } from '@/components/feedback';

export function DrivesAnalysisFailure({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <Section id="drives-analysis" title={t('drives.analysis', 'Trends and highlights')}>
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <LayoutCard title={t('drives.overTime.title', 'Drives over time')}>
          <QueryError error={error} onRetry={onRetry} />
        </LayoutCard>
        <LayoutCard title={t('drives.highlights', 'Highlights')}>
          <QueryError error={error} onRetry={onRetry} />
        </LayoutCard>
      </div>
    </Section>
  );
}
