import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout';
import { GlassPanel, Heading, Text } from '@/components/ui';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { ReferenceScenarioPanel } from './ReferenceScenarioPanel';
import { REFERENCE_SCENARIOS } from './fixtures';

/** Parent must mount only behind its DEV/reference-review gate at /dev/grid-states. */
export default function MobileGridReferencePage() {
  const { t } = useTranslation();
  const title = t('developerReference.mobileGrid.page.title', 'Mobile grid states reference');
  usePageTitle(title);
  return (
    <PageContainer title={title}
      subtitle={t('developerReference.mobileGrid.page.subtitle', 'REFERENCE FIXTURES — early presentation candidate, not production integration.')}>
      <FadeIn>
        <GlassPanel className="mb-4 p-4">
          <Heading level="panel">{t('developerReference.mobileGrid.page.gateTitle', 'Review scope and adapter gaps')}</Heading>
          <Text as="p" className="mt-2">{t('developerReference.mobileGrid.page.scope', 'Container widths below 640px show the controlled mobile candidate. At 640px and wider, the existing shared DataTable is composed unchanged. All examples use synthetic canonical SI fixtures; units are converted only for display.')}</Text>
          <Text as="p" className="mt-2">{t('developerReference.mobileGrid.page.adapter', 'DataTable does not expose its loaded-data/filter/sort/export pipeline as a mobile view model. Production integration requires an approved adapter owned by DataTable; this fixture controller must not be copied into production.')}</Text>
          <Text as="p" className="mt-2">{t('developerReference.mobileGrid.page.export', 'Export buttons demonstrate exact callback scopes and request feedback only. No file is serialized or downloaded by the mobile candidate. Full-result callbacks never appear as selected export.')}</Text>
          <Text as="p" className="mt-2">{t('developerReference.mobileGrid.page.approval', 'Runtime Phase 0, native 375/390 light/dark screenshots, narrow-container desktop freeze decisions and human contract approval remain pending. No production rollout is authorized.')}</Text>
          <Text as="p" className="mt-2">{t('developerReference.mobileGrid.page.clock', 'Dates use UTC and a fixed reference clock: October 4, 2026. Open any row for every source field and its reference actions; use Enter or Space to activate or select.')}</Text>
        </GlassPanel>
      </FadeIn>
      <div className="space-y-6">
        {REFERENCE_SCENARIOS.map(scenario => <ReferenceScenarioPanel key={scenario.id} scenario={scenario} />)}
      </div>
    </PageContainer>
  );
}
