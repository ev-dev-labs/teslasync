import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useOnboardingStatus } from '@/api/hooks/useOnboarding';
import { broadcast } from '@/lib/broadcast';
import { useOnboardingSkip } from '../hooks/useOnboardingSkip';
import { markOnboardingCompleted } from '../completion';

/**
 * Onboarding gate.
 * First-run redirect guard. The backend persists setup completion once; live
 * telemetry or Tesla-account health can later degrade without sending an
 * established installation back through setup.
 * Allow-listed paths bypass the gate so the user can reach the
 * Tesla account setup page, settings, public share links, the
 * watch face, the login/auth screen, and onboarding itself.
 * The user can also click "Skip for now" on the onboarding page,
 * which sets a localStorage flag (see useOnboardingSkip) that the
 * gate honours across reloads and tabs.
 * The gate is intentionally non-blocking: it renders nothing
 * (`return null`) and only triggers redirects via effects, so the
 * surrounding <Routes> can render normally for already-onboarded
 * users.
 */

// Paths that bypass the gate. Match by prefix so nested routes
// (e.g. /vehicles/:id/access) work without listing every variant.
export const ALLOW_PREFIXES = [
  '/onboarding',
  '/tesla-account',
  '/settings',
  '/s/', // public share links
  '/watch',
  '/login',
];

// Exported for direct unit testing of the prefix-matching branches.
export function isAllowed(pathname: string): boolean {
  return ALLOW_PREFIXES.some((prefix) =>
    prefix.endsWith('/') ? pathname.startsWith(prefix) : pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function OnboardingGate() {
  const location = useLocation();
  const navigate = useNavigate();
  const { data, isLoading, isError } = useOnboardingStatus();
  const { isSkipped } = useOnboardingSkip();

  /**
   * Record onboarding completion (HELP-08 correction round).
   *
   * `teslasync-onboarded` used to be written only by <OnboardingWizard>, which
   * is not mounted anywhere — so the key was never set and
   * `useChangelog().hasCompletedOnboarding` was permanently false, silently
   * disabling the changelog auto-show for every user.
   *
   * The gate is the right owner: it already runs the status query on every
   * route, so observing `setup_required === false` costs nothing extra, and it
   * is the same contract the redirect below trusts. `markOnboardingCompleted`
   * is idempotent, so running this on every status refetch writes once.
   */
  useEffect(() => {
    if (isLoading || isError || !data) return;
    if (data.setup_required) return;
    if (markOnboardingCompleted('setup-complete')) {
      // Tell peer tabs so a second window stops treating this as a first run.
      broadcast({ type: 'onboarded' });
    }
  }, [data, isLoading, isError]);

  useEffect(() => {
    // While the status request is in flight or has errored, don't
    // bounce the user — let them see whatever is loading rather than
    // a flash redirect, and never trap them on /onboarding when the
    // backend is briefly unreachable.
    if (isLoading || isError || !data) return;
    if (!data.setup_required) return;
    // The user explicitly chose "Skip for now" on the onboarding
    // page. Honour that across reloads and tabs.
    if (isSkipped) return;
    if (isAllowed(location.pathname)) return;

    navigate('/onboarding', { replace: true });
  }, [data, isLoading, isError, isSkipped, location.pathname, navigate]);

  return null;
}
