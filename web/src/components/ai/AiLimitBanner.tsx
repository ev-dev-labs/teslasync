// Phase-50 / 0010 — F9: Rate Limiter + Cost Cap.
//
// AiLimitBanner renders a user-facing notice when the AI rate-limiter
// or cost-cap rejected a call. The banner is the SPA's R8 surface:
// AI is exhausted, the page should pivot to its non-AI baseline, and
// the user should be told why + when they can try again.
//
// Pure presentational. The parent component owns the data
// (typically the `limit` field from `useAiStream`) and the
// callbacks (the page knows how to "Use baseline" — the banner just
// invokes the handler when the user clicks).
//
// ADR-015 invariants
// ------------------
//   §I3  Baseline intact      — when info.baselineAvailable is true,
//                                the banner shows a "Use baseline"
//                                button. The page wires it to its
//                                pre-AI render path so the user
//                                always has a working flow.
//   §I7  Per-feature opt-in   — the banner is only ever rendered by a
//                                page that opted into AI. A page that
//                                never calls useAiStream never sees a
//                                limit error and never renders the
//                                banner.
//   §I9  Provenance visible   — the reason taxonomy is rendered as a
//                                short, stable phrase (i18n) so the
//                                user can search for it in docs.
//
// All copy goes through react-i18next with English fallbacks inlined.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { AlertBanner } from '@/components/feedback';
import { Button } from '@/components/ui/Button';
import type { AiLimitInfo } from '@/hooks/useAiStream';

/**
 * Props for the AiLimitBanner component.
 *
 * The component is fully controlled — the parent decides when to
 * render it (typically: render when `info != null`) and supplies the
 * handlers. Keeps the banner test-light and lets a page place it
 * anywhere in its layout (top of the chat panel, inside a popover,
 * etc.) without the banner needing to know about the page.
 */
export interface AiLimitBannerProps {
  /**
   * The structured limit info parsed from a terminal SSE error
   * frame. When null the banner renders nothing — the parent should
   * conditionally mount it instead, but the null guard exists so a
   * page can pass `info={limit}` unconditionally without juggling
   * the TS narrowing.
   */
  info: AiLimitInfo | null;

  /**
   * Optional callback invoked when the user clicks "Retry". The
   * banner does NOT call useAiStream's `start()` itself — it has no
   * reference to it. The page passes a closure that re-opens the
   * stream against the correct endpoint.
   *
   * When omitted, the Retry button is hidden. Some reasons (e.g.
   * `cost_cap`) carry RetryAfter=0 because retrying within the same
   * day will hit the cap again — pass undefined in those cases to
   * suppress the button explicitly.
   */
  onRetry?: () => void;

  /**
   * Optional callback invoked when the user clicks "Use baseline".
   * The page wires this to switch its render path to the non-AI
   * fallback. When omitted (or when info.baselineAvailable is
   * false), the button is hidden.
   */
  onUseBaseline?: () => void;

  /**
   * Optional dismiss callback. When set, the banner shows an X icon
   * (delegated to AlertBanner.onClose). The page should track its
   * own "user dismissed" flag and stop rendering the banner.
   */
  onDismiss?: () => void;
}

/**
 * AiLimitBanner — the user-facing notice for AI rate-limit / cost-cap.
 *
 * Renders nothing when `info` is null. Otherwise shows:
 *   - A heading + short description keyed on info.reason (i18n).
 *   - A live countdown when retryAfterS > 0 — the banner re-renders
 *     once per second so the user sees the timer tick down.
 *   - "Retry" button (only when onRetry is supplied AND the
 *     countdown reached zero, or no countdown was set).
 *   - "Use baseline" button (only when info.baselineAvailable AND
 *     onUseBaseline is supplied).
 *
 * Variant selection:
 *   bannerLevel='warn'     → AlertBanner variant="warning" (amber)
 *   bannerLevel='critical' → AlertBanner variant="danger"  (red)
 *   bannerLevel=''         → AlertBanner variant="info"    (cyan)
 */
export function AiLimitBanner({
  info,
  onRetry,
  onUseBaseline,
  onDismiss,
}: AiLimitBannerProps) {
  const { t } = useTranslation();
  const [secondsLeft, setSecondsLeft] = useState<number>(info?.retryAfterS ?? 0);

  useEffect(() => {
    if (!info) return;
    setSecondsLeft(info.retryAfterS);
    if (info.retryAfterS <= 0) return;
    const id = setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(id);
  }, [info]);

  if (!info) return null;

  const variant: 'info' | 'warning' | 'danger' =
    info.bannerLevel === 'critical'
      ? 'danger'
      : info.bannerLevel === 'warn'
        ? 'warning'
        : 'info';

  const title = titleForReason(t, info.reason);
  const description = descriptionForReason(t, info.reason);
  const retryReady = secondsLeft <= 0;

  return (
    <AlertBanner
      variant={variant}
      title={title}
      onClose={onDismiss}
      role="alert"
      data-testid="ai-limit-banner"
      data-reason={info.reason}
    >
      <div className="space-y-2">
        <p>{description}</p>
        {!retryReady && (
          <p className="text-white/60">
            {t('ai.limit.retryIn', `Try again in ${secondsLeft}s`, {
              seconds: secondsLeft,
              defaultValue: `Try again in ${secondsLeft}s`,
            })}
          </p>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          {onUseBaseline && info.baselineAvailable && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onUseBaseline}
              data-testid="ai-limit-banner-baseline"
            >
              {t('ai.limit.useBaseline', 'Use baseline')}
            </Button>
          )}
          {onRetry && retryReady && (
            <Button
              size="sm"
              variant="primary"
              onClick={onRetry}
              data-testid="ai-limit-banner-retry"
            >
              {t('ai.limit.retry', 'Retry')}
            </Button>
          )}
        </div>
      </div>
    </AlertBanner>
  );
}

// titleForReason returns the short heading for a given Decision.Reason.
// New reasons added on the backend MUST have a row here AND in the
// frontend i18n table (web/public/locales/{lng}/translation.json).
// Unknown reasons fall back to a generic heading so a forward-compat
// SPA still renders something sane.
function titleForReason(t: TFunction, reason: string): string {
  switch (reason) {
    case 'cost_cap':
      return t('ai.limit.title.costCap', 'Daily cost cap reached');
    case 'cost_cap_unavailable':
      return t('ai.limit.title.costCapUnavailable', 'Cost cap check unavailable');
    case 'settings_unavailable':
      return t('ai.limit.title.settingsUnavailable', 'Helix settings unavailable');
    case 'burst':
      return t('ai.limit.title.burst', 'Too many Helix requests at once');
    case 'per_minute':
      return t('ai.limit.title.perMinute', 'Helix rate limit hit');
    case 'per_day':
      return t('ai.limit.title.perDay', 'Daily Helix usage limit reached');
    case 'input_tokens':
    case 'output_tokens':
      return t('ai.limit.title.tokens', 'Helix token quota exhausted');
    case 'provider_unavailable':
      return t('ai.limit.title.providerUnavailable', 'Helix provider unavailable');
    case 'missing_feature_id':
    case 'unknown_feature_id':
      return t('ai.limit.title.featureMisconfigured', 'Helix feature misconfigured');
    default:
      return t('ai.limit.title.generic', 'Helix temporarily unavailable');
  }
}

// descriptionForReason mirrors titleForReason but produces the body
// copy. Kept as a separate function so a future "compact" variant can
// drop the description without ripping the title.
function descriptionForReason(t: TFunction, reason: string): string {
  switch (reason) {
    case 'cost_cap':
      return t(
        'ai.limit.desc.costCap',
        'You have reached your daily Helix cost limit. Helix features will resume tomorrow or after you raise the cap in Settings.',
      );
    case 'cost_cap_unavailable':
      return t(
        'ai.limit.desc.costCapUnavailable',
        'Could not read your Helix usage history. Failing closed for safety.',
      );
    case 'settings_unavailable':
      return t(
        'ai.limit.desc.settingsUnavailable',
        'Could not load your Helix settings. Helix is paused until settings are reachable.',
      );
    case 'burst':
      return t(
        'ai.limit.desc.burst',
        'Too many Helix requests are in flight. The limiter is keeping the system responsive.',
      );
    case 'per_minute':
      return t(
        'ai.limit.desc.perMinute',
        'You have sent more Helix requests than allowed per minute. The window resets shortly.',
      );
    case 'per_day':
      return t(
        'ai.limit.desc.perDay',
        'You have used your daily Helix request budget. The budget resets at UTC midnight.',
      );
    case 'input_tokens':
    case 'output_tokens':
      return t(
        'ai.limit.desc.tokens',
        'Your Helix token quota for this minute is exhausted. Try a shorter prompt.',
      );
    case 'provider_unavailable':
      return t(
        'ai.limit.desc.providerUnavailable',
        'The Helix provider is not responding. The system will retry automatically.',
      );
    case 'missing_feature_id':
    case 'unknown_feature_id':
      return t(
        'ai.limit.desc.featureMisconfigured',
        'This page is missing a Helix feature registration. Please report this to your administrator.',
      );
    default:
      return t(
        'ai.limit.desc.generic',
        'Helix features are temporarily unavailable. The non-Helix baseline continues to work.',
      );
  }
}
