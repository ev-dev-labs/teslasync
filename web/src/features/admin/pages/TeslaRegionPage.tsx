/**
 * TeslaRegionPage — dedicated page wrapper for the Tesla account
 * Region & Fleet API endpoint surface. Previously rendered as an
 * inline section on /settings; promoted to a first-class page under
 * the Integrations sidebar group.
 *
 * The actual UI lives in the shared <RegionSettings /> component
 * (features/settings/components/RegionSettings), which is also still
 * referenced from the Settings landing page via a "moved" link card.
 */

import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { usePageTitle } from '@/hooks/usePageTitle';
import { RegionSettings } from '@/features/settings/components/RegionSettings';

export default function TeslaRegionPage() {
  const { t } = useTranslation('settings');
  const title = t('region.title', 'Region & API');
  usePageTitle(title);

  return (
    <PageContainer
      title={title}
      subtitle={t('region.subtitle', 'Tesla account region and Fleet API endpoint')}
    >
      <RegionSettings />
    </PageContainer>
  );
}
