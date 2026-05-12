/**
 * TeslaOrdersPage — dedicated page wrapper for the Tesla "Active
 * Orders" surface (vehicle orders + delivery tracking pulled from the
 * Tesla account). Previously rendered as an inline section on
 * /settings; promoted to a first-class page under the Integrations
 * sidebar group.
 *
 * The actual UI lives in the shared <ActiveOrdersSection /> component
 * (features/settings/components/ActiveOrdersSection), which is also
 * still referenced from the Settings landing page via a "moved" link
 * card.
 */

import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { usePageTitle } from '@/hooks/usePageTitle';
import { ActiveOrdersSection } from '@/features/settings/components/ActiveOrdersSection';

export default function TeslaOrdersPage() {
  const { t } = useTranslation('settings');
  const title = t('orders.title', 'Active Orders');
  usePageTitle(title);

  return (
    <PageContainer
      title={title}
      subtitle={t('orders.subtitle', 'Vehicle orders and delivery tracking from Tesla')}
    >
      <ActiveOrdersSection />
    </PageContainer>
  );
}
