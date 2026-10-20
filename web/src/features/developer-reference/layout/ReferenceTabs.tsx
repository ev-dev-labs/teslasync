import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Section } from '@/components/layout/layout-reference';
import { Tabs, Text } from '@/components/ui';

export function ReferenceTabs() {
  const { t } = useTranslation();
  const id = useId();
  const [active, setActive] = useState('overview');
  const tabs = [
    { key: 'overview', label: t('developerReference.layout.tabs.overview', 'Overview'), body: t('developerReference.layout.tabs.overviewBody', 'This developer reference is synthetic and isolated from production.') },
    { key: 'order', label: t('developerReference.layout.tabs.order', 'Reading order'), body: t('developerReference.layout.tabs.orderBody', 'Grid packing preserves the array and DOM order. No dense placement or hidden card migration is used.') },
    { key: 'availability', label: t('developerReference.layout.tabs.availability', 'Availability'), body: t('developerReference.layout.tabs.availabilityBody', 'Loading, failures and empty results belong to their own panels, not one blanket page guard.') },
    { key: 'charts', label: t('developerReference.layout.tabs.charts', 'Chart sizing'), body: t('developerReference.layout.tabs.chartsBody', 'Plot sizing follows the measured containing grid. The complete fixture remains in the accessible chart table.') },
    { key: 'methodology', label: t('developerReference.layout.tabs.methodology', 'Methodology'), body: t('developerReference.layout.tabs.methodologyBody', 'The bottom disclosure contains the full reference methodology and acceptance limitations.') },
    { key: 'acceptance', label: t('developerReference.layout.tabs.acceptance', 'Human acceptance'), body: t('developerReference.layout.tabs.acceptanceBody', 'Source authoring does not prove visual quality. Human reference and per-page plan approvals remain required.') },
  ];
  return (
    <Section id="layout-tabs" title={t('developerReference.layout.tabs.title', 'Six accessible reference tabs')}>
      <div className="relative min-w-0">
        <Tabs tabs={tabs} activeTab={active} onChange={setActive} idBase={id} ariaLabel={t('developerReference.layout.tabs.label', 'Layout reference topics')} />
        <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-3 bg-gradient-to-l from-[var(--bg-app)] to-transparent" />
      </div>
      {tabs.map(tab => (
        <div key={tab.key} id={`${id}-panel-${tab.key}`} role="tabpanel" aria-labelledby={`${id}-tab-${tab.key}`} hidden={tab.key !== active} tabIndex={0}>
          <Text as="p" variant="bodySm">{tab.body}</Text>
        </div>
      ))}
    </Section>
  );
}
