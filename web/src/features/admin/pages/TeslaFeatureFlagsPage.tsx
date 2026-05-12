/**
 * TeslaFeatureFlagsPage — dedicated page wrapper for the Tesla account
 * Feature Flags surface. Previously rendered as an inline section on
 * /settings; promoted to a first-class page under the Integrations
 * sidebar group so it has a stable URL and is discoverable from the
 * sidebar/command palette without scrolling through /settings.
 *
 * The actual UI lives in the shared <FeatureToggles /> component
 * (features/settings/components/FeatureToggles), which is also still
 * referenced from the Settings landing page via a "moved" link card.
 */

import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { usePageTitle } from '@/hooks/usePageTitle';
import { FeatureToggles } from '@/features/settings/components/FeatureToggles';

export default function TeslaFeatureFlagsPage() {
  const { t } = useTranslation('settings');
  const title = t('featureConfig.title', 'Feature Flags');
  usePageTitle(title);

  return (
    <PageContainer
      title={title}
      subtitle={t('featureConfig.subtitle', 'Tesla account feature configuration')}
    >
      <FeatureToggles />
    </PageContainer>
  );
}
