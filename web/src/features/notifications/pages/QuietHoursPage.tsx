/**
 * QuietHoursPage — Server-backed quiet hours / Do-Not-Disturb schedule.
 * Wraps QuietHoursPanel. Was a Settings sub-section.
 */

import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { usePageTitle } from '@/hooks/usePageTitle';
import { QuietHoursPanel } from '@/features/settings/components/QuietHoursPanel';

export default function QuietHoursPage() {
  const { t } = useTranslation();
  usePageTitle(t('notifications.quietHours.title', 'Quiet hours'));

  return (
    <PageContainer
      title={t('notifications.quietHours.title', 'Quiet hours')}
      subtitle={t('notifications.quietHours.subtitle', 'Suppress non-critical notifications during a configurable window.')}
      copyLink
    >
      <QuietHoursPanel />
    </PageContainer>
  );
}
