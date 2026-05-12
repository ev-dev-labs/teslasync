/**
 * TwoFactorAuthPage — `/account/2fa`.
 *
 * Promoted out of `/settings` (was `<section id="security">`) into a
 * first-class page under the new "Account" side-nav category so user-level
 * security primitives (TOTP enrollment, backup codes, disable) get a
 * dedicated surface instead of competing with the dense Settings page.
 *
 * Wraps the existing `TOTPEnrollmentSection` 1:1 — all auth/forward-mode
 * state, dialog flow, and step-up gating live inside that component, so
 * the page stays a thin shell and there's no behavior drift.
 */

import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout';
import { usePageTitle } from '@/hooks/usePageTitle';
import { TOTPEnrollmentSection } from '../components/TOTPEnrollmentSection';

export default function TwoFactorAuthPage() {
  const { t } = useTranslation('settings');
  usePageTitle(t('account.twoFactor.title', 'Two-factor authentication'));

  return (
    <PageContainer
      title={t('account.twoFactor.title', 'Two-factor authentication')}
      subtitle={t(
        'account.twoFactor.subtitle',
        'Add a second factor to your sign-in. Required for sensitive admin actions.',
      )}
      copyLink
    >
      <TOTPEnrollmentSection />
    </PageContainer>
  );
}
