/**
 * GasPriceAutoPollPage — dedicated page wrapper for the EIA gas-price
 * auto-poll surface. Previously rendered as an inline section on
 * /settings (#gas-price); promoted to a first-class page under the
 * Integrations sidebar group, mirroring the earlier promotion of the
 * other Tesla integration sub-sections.
 *
 * The actual UI lives in the shared <GasPriceSettings /> component
 * (features/settings/components/GasPriceSettings), which is also still
 * referenced from the Settings landing page via a "moved" link card.
 */

import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { usePageTitle } from '@/hooks/usePageTitle';
import { GasPriceSettings } from '@/features/settings/components/GasPriceSettings';

export default function GasPriceAutoPollPage() {
  const { t } = useTranslation('settings');
  const title = t('gas.title', 'Gas Price Auto-Poll');
  usePageTitle(title);

  return (
    <PageContainer
      title={title}
      subtitle={t('gas.subtitle', 'Automatically fetch US average gas prices from EIA')}
    >
      <GasPriceSettings />
    </PageContainer>
  );
}
