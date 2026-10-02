import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { GlassPanel, PanelTitle } from '@/components/ui';
import { EmptyState, SectionErrorBoundary } from '@/components/feedback';

/** Keep the deep-link target and panel visible even without a drive record. */
export function DriveDetailSection({
  id, title, testId, available = true, children,
}: {
  id: string;
  title: string;
  testId?: string;
  available?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <section id={id} data-testid={testId} aria-label={title} className="min-w-0 scroll-mt-24">
      <SectionErrorBoundary name={`drive-detail:${id}`} fallbackTitle={title}>
        {available ? children : (
          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle>{title}</PanelTitle>
            <EmptyState message={t('driveDetail.report.sectionUnavailable', 'No {{section}} data is available for this drive.', { section: title })} />
          </GlassPanel>
        )}
      </SectionErrorBoundary>
    </section>
  );
}
