/**
 * ActiveSessionsPage — `/account/sessions`.
 *
 * Promoted out of `/settings` (was `<section id="sessions">`) into a
 * first-class page under the new "Account" side-nav category. Lists every
 * active browser/device session for the signed-in user and allows
 * per-row + bulk revoke — all step-up-gated by RequireSudo upstream.
 *
 * Wraps the existing `ActiveSessionsSection` 1:1 so no behavior diverges
 * between the old and new surfaces during the transition.
 */

import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout';
import { usePageTitle } from '@/hooks/usePageTitle';
import { ActiveSessionsSection } from '../components/ActiveSessionsSection';

export default function ActiveSessionsPage() {
  const { t } = useTranslation('settings');
  usePageTitle(t('account.sessions.title', 'Active sessions'));

  return (
    <PageContainer
      title={t('account.sessions.title', 'Active sessions')}
      subtitle={t(
        'account.sessions.subtitle',
        'Devices currently signed in to TeslaSync. Revoke individual sessions or sign out everywhere else.',
      )}
      copyLink
    >
      <ActiveSessionsSection />
    </PageContainer>
  );
}
