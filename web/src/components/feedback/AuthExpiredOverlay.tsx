import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { GlassPanel, Button } from '@/components/ui';
import { Lock } from 'lucide-react';

/**
 * Full-screen overlay shown when the auth middleware session expires.
 *
 * In regular browsers, resilientFetch auto-reloads to trigger ForwardAuth
 * redirect. In PWA standalone mode, there's no address bar — so we show
 * this overlay with a "Sign In Again" button instead.
 *
 * This component is also the fallback for regular browsers if the reload
 * doesn't redirect (e.g. when running without auth middleware in dev).
 */
export function AuthExpiredOverlay() {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);

  useEffect(() => {
    const handler = () => setShow(true);
    document.addEventListener('teslasync:auth-expired', handler);
    return () => document.removeEventListener('teslasync:auth-expired', handler);
  }, []);

  if (!show) return null;

  return (
    // Phase-45 / Prompt 04: NOT migrated to <Modal>.
    // Rationale: page-blocking system message that's never dismissable from
    // inside (only via "Sign In Again" reload). Must remain on top of <Modal>
    // (z-[60]) so a stale modal can't obscure the auth wall during expiry.
    // New interactive dialogs MUST use <Modal>.
    // eslint-disable-next-line no-restricted-syntax
    <div className="fixed inset-0 z-[9999] bg-[var(--surface-overlay)] backdrop-blur-xl flex items-center justify-center p-6">
      <GlassPanel className="p-8 max-w-sm text-center space-y-4">
        <Lock className="h-12 w-12 text-neon-amber mx-auto" />
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">
          {t('auth.expired.title', 'Session Expired')}
        </h2>
        <p className="text-sm text-[var(--text-secondary)]">
          {t('auth.expired.message', 'Your authentication session has expired. Please sign in again to continue.')}
        </p>
        <Button
          onClick={() => window.location.reload()}
          className="w-full"
        >
          {t('auth.expired.signIn', 'Sign In Again')}
        </Button>
      </GlassPanel>
    </div>
  );
}
