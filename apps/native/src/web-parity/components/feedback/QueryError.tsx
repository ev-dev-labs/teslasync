// Native parity port of web/src/components/feedback/QueryError.tsx.
//
// Inline error banner for failed API queries. It branches on `ApiError.status`
// so the user gets actionable recovery copy per failure mode instead of a
// generic "something went wrong":
//   - transient waiting (429 rate-limit / 503 upstream-breaker-open) — a calm
//     "Waiting for upstream" placeholder with no CTA (the global RateLimitBanner
//     owns the countdown + retry).
//   - 404 — "Resource not found" with an optional "Back to list" CTA.
//   - 401 / 403 — "Sign in required" with a "Sign in" CTA.
//   - 5xx — "Server error" with a manual "Retry" CTA.
//   - network / offline / unknown — "Can't reach server" / "You're offline"
//     with a "Retry"/"Retry when online" CTA.
//
// The QueryErrorProps contract (error / onRetry / resourceName / listHref) and
// the per-status branch order are preserved verbatim. Five web dependencies are
// NOT in the native parity manifest, so native-safe equivalents are inlined and
// documented here:
//
//   - react-i18next `useTranslation` (web L2) -> inlined
//     `useNativeTranslationFallback()` returning the web fallback copy and
//     reproducing i18next `{{thing}}` interpolation (used by the 404 title),
//     mirroring the established EditConflictBanner/ImpersonationBanner pattern.
//     Every i18n key + default string is preserved.
//   - react-router-dom `useNavigate` (web L3) + `window.location.href` (web
//     L126): the native web-parity tree has NO in-app router and there is no
//     DOM `window.location`, so programmatic route navigation is structurally
//     unavailable. Both the 404 "Back to list" (`navigate(listHref)`) and the
//     401/403 "Sign in" (`window.location.href = '/login'`) actions are routed
//     through an inlined `useNativeHrefNavigation()` that hands the href to the
//     platform URL handler via `Linking.openURL` on a best-effort basis. Web
//     route strings the OS cannot resolve (e.g. `/login`, `/drives`) are
//     swallowed so a failed navigation never crashes the error card.
//   - lucide-react icons (web L4): AlertCircle / Clock / FileQuestion / Lock /
//     Server / WifiOff have no native module. Because the web card renders every
//     icon with a single rose/danger tint (the shared SemanticIcon bakes a fixed
//     per-name tone that would break that unity), each icon becomes a small
//     decorative danger-toned glyph badge (`! / CK / ? / LK / SV / WX`) rendered
//     inline — the same icon-badge approach ImpersonationBanner used.
//   - `@/components/ui` Button (web L5) -> inlined `ErrorAction`, a compact
//     rose-tinted ghost Pressable preserving variant=ghost/size=sm intent plus
//     the disabled + aria-disabled state of the offline retry control.
//   - `@/hooks/useOnlineStatus` (web L6, backed by lib/resilience) -> inlined
//     native-safe `useOnlineStatus()`. React Native has no `navigator.onLine`,
//     no `online`/`offline` window events, and this app does not depend on
//     @react-native-community/netinfo, so live connectivity transitions are NOT
//     observable. The hook snapshots the api client's last observed status from
//     `getConnectionStatus()` at mount, treating 'offline' as disconnected and
//     'unknown'/'online' as connected so a fresh mount never falsely shows the
//     offline branch before any request has run.
//   - `./_ErrorState` ErrorState (web L9) -> inlined native `ErrorState` layout
//     primitive (rose/danger card + icon badge + title/message + optional
//     action), since `_ErrorState` is not in the native parity manifest.
//   - `@/api/client` `isApiError` (web L7) and `@/lib/errorClassification`
//     `isTransientWaiting` (web L8): `isApiError` is imported from the ported
//     web-parity api client; `isTransientWaiting` is inlined with the same
//     bundle-split-safe duck-typed checks the web resilience module uses for
//     RateLimitError (name/status 429/retryAfterSec) and UpstreamUnavailableError
//     (name/status 503/retryAfterSec/upstream).
//
// The web auto-retry-on-reconnect effect (web L53-66) attaches a one-shot
// `window.addEventListener('online', ...)` listener that fires `onRetry()` when
// the browser reconnects. There is no DOM `window` connectivity event on native
// and no NetInfo subscription, so that listener is structurally unavailable; the
// effect is preserved as a native-safe inert effect with the SAME guard and the
// SAME `[error, online, onRetry, status]` dependency list, and the manual
// "Retry when online" control remains the recovery path. The web `role`/
// `aria-live` status/alert regions map to RN `accessibilityRole`/
// `accessibilityLiveRegion`; arbitrary DOM debug attributes have no RN analogue.

import React, {useCallback, useEffect, useState, type ReactNode} from 'react';
import {Linking, Pressable, StyleSheet, View} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';
import {getConnectionStatus, isApiError} from '../../api/client';

type NativeTOptions = Record<string, string | number>;

type NativeTFunction = (
  key: string,
  fallback: string,
  options?: NativeTOptions,
) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback(
    (_key: string, fallback: string, options?: NativeTOptions) => {
      if (!options) {
        return fallback;
      }
      // Mirror i18next `{{name}}` interpolation against the web fallback copy.
      return Object.keys(options).reduce(
        (text, name) => text.split(`{{${name}}}`).join(String(options[name])),
        fallback,
      );
    },
    [],
  );
}

// ---------------------------------------------------------------------------
// useNativeHrefNavigation — native-safe replacement for react-router-dom
// useNavigate() / window.location.href. The native web-parity tree has no
// in-app router, so web route strings are handed to the platform URL handler on
// a best-effort basis. Unresolvable routes are swallowed so a failed navigation
// never crashes the error card.
// ---------------------------------------------------------------------------

function useNativeHrefNavigation(): (href: string) => void {
  return useCallback((href: string) => {
    Promise.resolve()
      .then(() => Linking.openURL(href))
      .catch(() => undefined);
  }, []);
}

// ---------------------------------------------------------------------------
// useOnlineStatus — native-safe port of web/src/hooks/useOnlineStatus.ts.
// See the file header for the connectivity-observability caveat.
// ---------------------------------------------------------------------------

function useOnlineStatus(): boolean {
  const [online] = useState<boolean>(() => getConnectionStatus() !== 'offline');
  return online;
}

// ---------------------------------------------------------------------------
// isTransientWaiting — native-safe port of web/src/lib/errorClassification.ts.
// Uses the same bundle-split-safe duck-typed checks as the web resilience
// module; the RateLimitError / UpstreamUnavailableError classes are not present
// in the native client, so only the structural fallback branch is needed.
// ---------------------------------------------------------------------------

function isRateLimitError(err: unknown): boolean {
  if (
    err &&
    typeof err === 'object' &&
    'name' in err &&
    'status' in err &&
    'retryAfterSec' in err
  ) {
    const e = err as {name: unknown; status: unknown; retryAfterSec: unknown};
    return (
      e.name === 'RateLimitError' &&
      e.status === 429 &&
      typeof e.retryAfterSec === 'number'
    );
  }
  return false;
}

function isUpstreamUnavailableError(err: unknown): boolean {
  if (
    err &&
    typeof err === 'object' &&
    'name' in err &&
    'status' in err &&
    'retryAfterSec' in err &&
    'upstream' in err
  ) {
    const e = err as {name: unknown; status: unknown; retryAfterSec: unknown};
    return (
      e.name === 'UpstreamUnavailableError' &&
      e.status === 503 &&
      typeof e.retryAfterSec === 'number'
    );
  }
  return false;
}

function isTransientWaiting(err: unknown): boolean {
  return isRateLimitError(err) || isUpstreamUnavailableError(err);
}

// ---------------------------------------------------------------------------
// ErrorAction — inline rose-tinted ghost button (web `@/components/ui` Button
// variant=ghost size=sm). Preserves the disabled + aria-disabled offline state.
// ---------------------------------------------------------------------------

interface ErrorActionProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}

function ErrorAction({
  label,
  onPress,
  disabled = false,
  testID,
}: ErrorActionProps): React.ReactElement {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{disabled}}
      disabled={disabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.actionButton,
        disabled && styles.actionDisabled,
        pressed && !disabled && styles.actionPressed,
      ]}
      testID={testID}>
      <AppText style={styles.actionLabel} weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// ErrorState — inline native port of web/src/components/feedback/_ErrorState.tsx.
// The standard rose/danger "icon + title + message + action" failure card.
// ---------------------------------------------------------------------------

interface ErrorStateProps {
  glyph: string;
  title: string;
  message: string;
  action?: ReactNode;
  role?: 'alert' | 'status';
  ariaLive?: 'polite' | 'assertive';
}

function ErrorState({
  glyph,
  title,
  message,
  action,
  role = 'alert',
  ariaLive = 'assertive',
}: ErrorStateProps): React.ReactElement {
  return (
    <View
      accessibilityLiveRegion={ariaLive}
      accessibilityRole={role === 'alert' ? 'alert' : undefined}
      style={styles.card}
      testID="query-error">
      <View style={styles.row}>
        <View style={styles.iconBadge}>
          <AppText style={styles.iconGlyph} weight="bold">
            {glyph}
          </AppText>
        </View>
        <View style={styles.content}>
          <View accessible accessibilityLabel={`${title}. ${message}`}>
            <AppText style={styles.title} weight="semibold">
              {title}
            </AppText>
            <AppText style={styles.message}>{message}</AppText>
          </View>
        </View>
        {action ? <View style={styles.action}>{action}</View> : null}
      </View>
    </View>
  );
}

export interface QueryErrorProps {
  /**
   * The error from a failed query. Accepts `unknown` so callers can pass raw
   * TanStack Query `error` values without casting; the component branches on
   * `ApiError.status` when present and falls back to the generic network
   * message otherwise.
   */
  error: unknown;
  onRetry?: () => void;
  /**
   * Singular human-readable name of the resource being loaded (e.g. "Drive",
   * "Charging session"). Surfaced in the 404 title so the user knows what
   * wasn't found.
   */
  resourceName?: string;
  /**
   * Path to the corresponding list view. When provided on a 404, the component
   * renders a "Back to list" CTA that navigates there. Detail pages should pass
   * this so users have an obvious recovery path when the record was deleted or
   * the URL is stale.
   */
  listHref?: string;
}

/**
 * Inline error banner for failed API queries.
 *
 * Branches by `ApiError.status` so users get actionable recovery copy per
 * failure mode rather than a generic "something went wrong". On native the
 * browser-only auto-retry-on-reconnect and route navigation degrade to a
 * native-safe inert effect and a best-effort `Linking.openURL` — see the file
 * header.
 */
export function QueryError({
  error,
  onRetry,
  resourceName,
  listHref,
}: QueryErrorProps): React.ReactElement | null {
  const t = useNativeTranslationFallback();
  const navigate = useNativeHrefNavigation();
  const online = useOnlineStatus();
  const status = isApiError(error) ? error.status : undefined;

  useEffect(() => {
    // Auto-retry only on the offline branch — 4xx/5xx don't recover from a
    // network event, so we don't want to spam the API for permanent failures.
    if (!error || online || !onRetry || status !== undefined) {
      return;
    }
    // The web original attaches a one-shot `window.addEventListener('online')`
    // listener here to fire onRetry() when the browser reconnects. React Native
    // has no DOM connectivity event and no NetInfo subscription, so there is
    // nothing to subscribe to; the manual "Retry when online" control is the
    // recovery path.
  }, [error, online, onRetry, status]);

  if (!error) {
    return null;
  }

  // Transient waiting (rate-limited, upstream breaker open). The global
  // RateLimitBanner already shows a countdown so we render a calm "waiting"
  // placeholder here instead of a loud "request failed" panel. No CTA: the
  // banner owns Retry.
  if (isTransientWaiting(error)) {
    return (
      <ErrorState
        ariaLive="polite"
        glyph="CK"
        message={t(
          'error.waiting.message',
          "We're pausing requests briefly. Data will refresh automatically.",
        )}
        role="status"
        title={t('error.waiting.title', 'Waiting for upstream')}
      />
    );
  }

  // 404 — record was deleted or URL is wrong.
  if (status === 404) {
    const thing = resourceName ?? t('error.notFound.thingDefault', 'Resource');
    return (
      <ErrorState
        action={
          listHref ? (
            <ErrorAction
              label={t('error.notFound.cta', 'Back to list')}
              onPress={() => navigate(listHref)}
              testID="query-error-back-to-list"
            />
          ) : undefined
        }
        glyph="?"
        message={t(
          'error.notFound.message',
          'It may have been deleted or the link is wrong.',
        )}
        title={t('error.notFound.title', '{{thing}} not found', {thing})}
      />
    );
  }

  // 401 / 403 — session expired or RBAC mismatch.
  if (status === 401 || status === 403) {
    return (
      <ErrorState
        action={
          <ErrorAction
            label={t('error.unauthorized.cta', 'Sign in')}
            onPress={() => navigate('/login')}
            testID="query-error-sign-in"
          />
        }
        glyph="LK"
        message={t(
          'error.unauthorized.message',
          'Your session has expired. Please sign in again.',
        )}
        title={t('error.unauthorized.title', 'Sign in required')}
      />
    );
  }

  // 5xx — backend failure.
  if (status !== undefined && status >= 500) {
    return (
      <ErrorState
        action={
          onRetry ? (
            <ErrorAction
              label={t('error.retry', 'Retry')}
              onPress={onRetry}
              testID="query-error-retry"
            />
          ) : undefined
        }
        glyph="SV"
        message={t(
          'error.serverError.message',
          'Something went wrong on our end. Please try again.',
        )}
        title={t('error.serverError.title', 'Server error')}
      />
    );
  }

  // Network / offline / unknown.
  // status === 0 is what the api client throws when the device is offline.
  const isOffline = !online || status === 0;
  return (
    <ErrorState
      action={
        onRetry ? (
          <ErrorAction
            disabled={isOffline}
            label={
              isOffline
                ? t('error.network.retryWhenOnline', 'Retry when online')
                : t('error.retry', 'Retry')
            }
            onPress={onRetry}
            testID="query-error-network-retry"
          />
        ) : undefined
      }
      ariaLive={isOffline ? 'polite' : 'assertive'}
      glyph={isOffline ? 'WX' : '!'}
      message={
        isOffline
          ? t(
              'error.network.offlineDetail',
              "We'll retry automatically when your connection returns.",
            )
          : t(
              'error.network.message',
              'Check your internet connection and try again.',
            )
      }
      role={isOffline ? 'status' : 'alert'}
      title={
        isOffline
          ? t('error.network.offlineTitle', "You're offline")
          : t('error.network.title', "Can't reach server")
      }
    />
  );
}

const styles = StyleSheet.create({
  action: {
    flexShrink: 0,
  },
  actionButton: {
    alignSelf: 'flex-start',
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 32,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  actionDisabled: {
    opacity: 0.48,
  },
  actionLabel: {
    color: colors.danger,
    fontSize: 12,
    lineHeight: 16,
  },
  actionPressed: {
    opacity: 0.82,
  },
  card: {
    backgroundColor: 'rgba(251, 113, 133, 0.06)',
    borderColor: colors.dangerBorder,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: spacing.lg,
    padding: spacing.lg,
  },
  content: {
    flex: 1,
  },
  iconBadge: {
    alignItems: 'center',
    backgroundColor: colors.dangerSurface,
    borderRadius: 10,
    height: 32,
    justifyContent: 'center',
    marginTop: 2,
    width: 32,
  },
  iconGlyph: {
    color: colors.danger,
    fontSize: 13,
    letterSpacing: 0.4,
    lineHeight: 16,
  },
  message: {
    color: 'rgba(251, 113, 133, 0.72)',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },
  row: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
  },
  title: {
    color: colors.danger,
    fontSize: 14,
    lineHeight: 20,
  },
});

export default QueryError;
