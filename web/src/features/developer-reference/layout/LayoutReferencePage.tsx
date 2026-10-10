import { useTranslation } from 'react-i18next';
import { PageLayout, LockedNotice, Section, CardGrid, LayoutCard } from '@/components/layout/layout-reference';
import { FadeIn } from '@/components/motion';
import { Button, GlassPanel, Text } from '@/components/ui';
import { usePageTitle } from '@/hooks/usePageTitle';
import { ReferenceCharts } from './ReferenceCharts';
import { ReferenceFillRows } from './ReferenceFillRows';
import { ReferenceLists } from './ReferenceLists';
import { ReferenceMethodology } from './ReferenceMethodology';
import { ReferenceSourceStates } from './ReferenceSourceStates';
import { ReferenceStats } from './ReferenceStats';
import { ReferenceTabs } from './ReferenceTabs';
import { ReferenceDailyChart } from './ReferenceDailyChart';

/** Parent registers this default export only on a DEV/reference-review route.
 * No live-data hook, production calculation or app-shell replacement. */
export default function LayoutReferencePage() {
  const { t } = useTranslation();
  const title = t('developerReference.layout.page.title', 'Responsive layout reference');
  usePageTitle(title);
  return (
    <PageLayout title={title} subtitle={t('developerReference.layout.page.subtitle', 'Synthetic developer reference · no production migration')}>
      <GlassPanel padding="sm" data-banner role="note">
        <Text as="p" variant="bodySm">{t('developerReference.layout.page.notice', 'Synthetic presentation fixtures only. Native validation and human approval are pending; source inventory is not verified runtime inventory.')}</Text>
      </GlassPanel>
      <ReferenceTabs />
      <ReferenceStats />
      <LockedNotice
        title={t('developerReference.layout.locked.title', 'Three synthetic analyses share one unavailable reason')}
        reason={t('developerReference.layout.locked.reason', 'This fixture intentionally groups unavailable analyses. It does not assert a production eligibility rule.')}
        items={[
          { id: 'fitted', label: t('developerReference.layout.locked.fitted', 'Synthetic fitted curve') },
          { id: 'trend', label: t('developerReference.layout.locked.trend', 'Synthetic adjusted trend') },
          { id: 'residuals', label: t('developerReference.layout.locked.residuals', 'Synthetic residual distribution') },
        ]}
        progress={{ current: 2, required: 9, label: t('developerReference.layout.locked.progress', 'Illustrative progress only: 2 of 9 fixture steps; not calendar eligibility.') }}
      />
      <ReferenceCharts />
      <ReferenceLists />
      <ReferenceFillRows />
      <ReferenceSourceStates />
      <Section
        id="layout-narrow-container"
        title={t('developerReference.layout.container.title', 'Container boundary: narrow panel on a wide screen')}
        description={t('developerReference.layout.container.description', 'This bounded host stays narrow regardless of the viewport; its cards must stack and its charts use the phone plot height.')}
      >
        <div className="w-full max-w-[520px]">
          <CardGrid label={t('developerReference.layout.container.grid', 'Narrow-container cards')} items={[
            { id: 'narrow-a', size: 'half', content: <LayoutCard title={t('developerReference.layout.container.firstTitle', 'First narrow card')}><Text as="p" variant="bodySm">{t('developerReference.layout.container.firstBody', 'Viewport width cannot promote this card to desktop columns.')}</Text></LayoutCard> },
            { id: 'narrow-b', size: 'half', content: <LayoutCard title={t('developerReference.layout.container.secondTitle', 'Second narrow card')}><Text as="p" variant="bodySm">{t('developerReference.layout.container.secondBody', 'Reading order and complete text are preserved inside the bounded host.')}</Text></LayoutCard> },
            { id: 'narrow-chart', size: 'full', content: <ReferenceDailyChart title={t('developerReference.layout.container.chartTitle', 'Dense chart inside the narrow host')} /> },
          ]} />
        </div>
      </Section>
      <FadeIn>
        <ReferenceMethodology />
      </FadeIn>
      <div className="relative min-h-20" data-reference-action-reservation>
        {/* Contained floating reference action. Global fixed/floating hosts,
            shell offsets and safe-area padding remain parent-owned. */}
        <Button
          type="button" variant="secondary" data-floating="pdf"
          className="absolute bottom-0 right-0 min-h-11"
          onClick={() => window.print()}
          aria-label={t('developerReference.layout.action.pdfLabel', 'Print the synthetic reference or save it as PDF')}
        >
          {t('developerReference.layout.action.pdf', 'Print / save PDF')}
        </Button>
      </div>
    </PageLayout>
  );
}
