/**
 * PrivacyPage — `/account/privacy`.
 *
 * Promoted out of `/settings` (was `<section id="privacy">`) into a
 * first-class page under the "Account" side-nav category alongside
 * Two-factor Auth and Active Sessions, so user-scoped privacy controls
 * (recently viewed pages, GDPR / cookie consent) live in their own
 * surface instead of being buried in the dense Settings page.
 *
 * Wraps the existing `PrivacySection` 1:1 — all browser-local state
 * (recent pages LRU, consent banner machinery), confirmation dialogs,
 * and toast feedback live inside that component, so the page stays a
 * thin shell and there's no behavior drift.
 */

import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout';
import { usePageTitle } from '@/hooks/usePageTitle';
import { PrivacySection } from '../components/PrivacySection';

export default function PrivacyPage() {
  const { t } = useTranslation('settings');
  usePageTitle(t('account.privacy.title', 'Privacy'));

  return (
    <PageContainer
      title={t('account.privacy.title', 'Privacy')}
      subtitle={t(
        'account.privacy.subtitle',
        'Manage browser-local data: recently viewed pages and cookies / analytics consent.',
      )}
      copyLink
    >
      <PrivacySection />
    </PageContainer>
  );
}
