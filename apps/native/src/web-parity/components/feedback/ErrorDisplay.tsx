// Native parity port of web/src/components/feedback/ErrorDisplay.tsx.
//
// Status-aware error banner used for non-query errors (mutation failures,
// imperative fetches). The web component leans on browser-only deps that have
// no place in the native parity tree, so they are reproduced natively and kept
// self-contained here:
//   - react-i18next `useTranslation`     -> the shared native fallback hook
//     (key + English fallback + {{var}} interpolation, identical copy).
//   - react-router-dom `useNavigate` and the 401 `window.location.href`
//     redirect -> a single `onNavigate(href)` bridge prop. The 404 CTA still
//     pushes `listHref`; the 401 CTA still targets `/login`.
//   - `@/hooks/useOnlineStatus` (navigator.onLine subscription) -> an `online`
//     bridge prop defaulting to `true`. Native callers can wire NetInfo and
//     pass the live value; until then offline branches stay reachable via
//     `status === 0`.
//   - lucide-react icons (AlertCircle/FileQuestion/Lock/Server/WifiOff) -> a
//     rose-tinted glyph badge; the lucide identity is preserved as the `icon`
//     key per branch (the web card already renders every icon in the same rose
//     tone, so the uniform-rose visual intent is kept).
//   - `../ui/Button` ghost+rose -> an internal rose Pressable.
//   - `./_ErrorState` -> the internal `ErrorState` layout primitive, mirrored
//     1:1 (icon badge + title + message + action, compact variant, role/aria).
// See the .parity.json sidecar for the line-by-line source map.

import React, {useCallback, type ReactNode} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {spacing} from '../../../theme/tokens';
import {isApiError} from '../../api/client';

// rose-300 text / rose-500 surfaces, matching the web `text-rose-300` +
// `bg-rose-500/{5,10,20}` palette the error card renders for every branch.
const ROSE_TEXT = '#fda4af';
const ROSE_TEXT_MUTED = 'rgba(253, 164, 175, 0.7)';
const ROSE_CARD_BG = 'rgba(251, 113, 133, 0.06)';
const ROSE_CARD_BORDER = 'rgba(251, 113, 133, 0.2)';
const ROSE_BADGE_BG = 'rgba(251, 113, 133, 0.1)';
const ROSE_BUTTON_BG = 'rgba(251, 113, 133, 0.1)';
const ROSE_BUTTON_PRESSED_BG = 'rgba(251, 113, 133, 0.2)';

// ---- Native-safe i18n fallback (web react-i18next useTranslation) -----------

type TranslationValues = Record<string, string | number>;

type NativeTFunction = (
  key: string,
  fallback: string,
  values?: TranslationValues,
) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback(
    (_key, fallback, values) =>
      values ? interpolate(fallback, values) : fallback,
    [],
  );
}

function interpolate(template: string, values: TranslationValues): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = values[key];
    return value === undefined ? '' : String(value);
  });
}

export interface ErrorDisplayProps {
  /**
   * The error to display. Accepts `unknown` so callers can pass raw
   * mutation errors without casting; branches on `ApiError.status` when
   * present.
   */
  error: unknown;
  onRetry?: () => void;
  /** Tighter padding for inline mutation errors (e.g. inside a panel). */
  compact?: boolean;
  /** Web Tailwind className; retained for API parity but unused natively. */
  className?: string;
  /** Singular human-readable name of the resource (used in 404 titles). */
  resourceName?: string;
  /** Path to the corresponding list view (renders Back-to-list CTA on 404). */
  listHref?: string;
  /**
   * Native navigation bridge. Replaces the web `useNavigate()` push and the
   * 401 `window.location.href = '/login'` redirect. Called with `listHref`
   * (404 CTA) or `'/login'` (401 CTA).
   */
  onNavigate?: (href: string) => void;
  /**
   * Native online-status bridge. Replaces the web `useOnlineStatus()` hook
   * (navigator.onLine). Defaults to `true`; offline copy still surfaces when
   * `status === 0`.
   */
  online?: boolean;
  /** Native style escape hatch applied to the error card container. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Status-aware error banner used for non-query errors (mutation failures,
 * imperative fetches). Mirrors {@link QueryError}'s 404 / 401 / 5xx /
 * network branching but supports a `compact` variant for inline contexts
 * where a full-bleed banner would dominate the panel.
 */
export function ErrorDisplay({
  error,
  onRetry,
  compact,
  className: _className,
  resourceName,
  listHref,
  online = true,
  onNavigate,
  style,
  testID,
}: ErrorDisplayProps) {
  const t = useNativeTranslationFallback();

  if (!error) {
    return null;
  }

  const status = isApiError(error) ? error.status : undefined;

  // 404 — record was deleted or URL is wrong.
  if (status === 404) {
    const thing = resourceName ?? t('error.notFound.thingDefault', 'Resource');
    return (
      <ErrorState
        icon="fileQuestion"
        compact={compact}
        style={style}
        testID={testID}
        title={t('error.notFound.title', '{{thing}} not found', {thing})}
        message={t(
          'error.notFound.message',
          'It may have been deleted or the link is wrong.',
        )}
        action={
          listHref ? (
            <ErrorActionButton
              label={t('error.notFound.cta', 'Back to list')}
              onPress={() => onNavigate?.(listHref)}
              testID="error-display-notfound-cta"
            />
          ) : undefined
        }
      />
    );
  }

  // 401 / 403 — session expired or RBAC mismatch.
  if (status === 401 || status === 403) {
    return (
      <ErrorState
        icon="lock"
        compact={compact}
        style={style}
        testID={testID}
        title={t('error.unauthorized.title', 'Sign in required')}
        message={t(
          'error.unauthorized.message',
          'Your session has expired. Please sign in again.',
        )}
        action={
          <ErrorActionButton
            label={t('error.unauthorized.cta', 'Sign in')}
            onPress={() => onNavigate?.('/login')}
            testID="error-display-unauthorized-cta"
          />
        }
      />
    );
  }

  // 5xx — backend failure.
  if (status !== undefined && status >= 500) {
    return (
      <ErrorState
        icon="server"
        compact={compact}
        style={style}
        testID={testID}
        title={t('error.serverError.title', 'Server error')}
        message={t(
          'error.serverError.message',
          'Something went wrong on our end. Please try again.',
        )}
        action={
          onRetry ? (
            <ErrorActionButton
              label={t('error.retry', 'Retry')}
              onPress={onRetry}
              testID="error-display-server-retry"
            />
          ) : undefined
        }
      />
    );
  }

  // Network / offline / unknown.
  const isOffline = !online || status === 0;
  return (
    <ErrorState
      icon={isOffline ? 'wifiOff' : 'alertCircle'}
      compact={compact}
      style={style}
      testID={testID}
      role={isOffline ? 'status' : 'alert'}
      ariaLive={isOffline ? 'polite' : 'assertive'}
      title={
        isOffline
          ? t('error.network.offlineTitle', "You're offline")
          : t('error.network.title', "Can't reach server")
      }
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
      action={
        onRetry ? (
          <ErrorActionButton
            label={
              isOffline
                ? t('error.network.retryWhenOnline', 'Retry when online')
                : t('error.retry', 'Retry')
            }
            onPress={onRetry}
            disabled={isOffline}
            testID="error-display-network-retry"
          />
        ) : undefined
      }
    />
  );
}

ErrorDisplay.displayName = 'ErrorDisplay';

// ---- Internal layout primitive (web ./_ErrorState) --------------------------

type ErrorIconKey =
  | 'alertCircle'
  | 'fileQuestion'
  | 'lock'
  | 'server'
  | 'wifiOff';

/**
 * Short glyph per lucide icon used by the web `_ErrorState` badge. The lucide
 * identity is preserved as the `icon` key (FileQuestion/Lock/Server/WifiOff/
 * AlertCircle); every badge renders in the uniform rose tone like the web card.
 */
const ERROR_ICON_GLYPHS: Record<ErrorIconKey, string> = {
  alertCircle: '!',
  fileQuestion: '?',
  lock: 'LK',
  server: 'SV',
  wifiOff: 'WX',
};

interface ErrorStateProps {
  icon: ErrorIconKey;
  title: string;
  message: string;
  action?: ReactNode;
  /** "status" for non-blocking offline/info states, "alert" otherwise. */
  role?: 'alert' | 'status';
  /** Matches `role`: "polite" for status, "assertive" for alert. */
  ariaLive?: 'assertive' | 'polite';
  /** Compact variant — tighter padding for inline mutation errors. */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

function ErrorState({
  icon,
  title,
  message,
  action,
  role = 'alert',
  ariaLive = 'assertive',
  compact = false,
  style,
  testID,
}: ErrorStateProps) {
  return (
    <View
      accessibilityLiveRegion={ariaLive}
      accessibilityRole={role === 'alert' ? 'alert' : undefined}
      style={[
        styles.card,
        compact ? styles.cardCompact : styles.cardRegular,
        style,
      ]}
      testID={testID}>
      <View
        style={[styles.row, compact ? styles.rowCompact : styles.rowRegular]}>
        <View
          style={[
            styles.badge,
            compact ? styles.badgeCompact : styles.badgeRegular,
          ]}>
          <AppText
            style={[
              styles.badgeGlyph,
              compact ? styles.badgeGlyphCompact : styles.badgeGlyphRegular,
            ]}
            weight="bold">
            {ERROR_ICON_GLYPHS[icon]}
          </AppText>
        </View>
        <View style={styles.copy}>
          <AppText
            style={[
              styles.title,
              compact ? styles.titleCompact : styles.titleRegular,
            ]}
            weight="semibold">
            {title}
          </AppText>
          <AppText
            style={[
              styles.message,
              compact ? styles.messageCompact : styles.messageRegular,
            ]}>
            {message}
          </AppText>
        </View>
        {action ? <View style={styles.action}>{action}</View> : null}
      </View>
    </View>
  );
}

// ---- Internal rose action button (web ../ui/Button ghost+rose) --------------

interface ErrorActionButtonProps {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  testID?: string;
}

function ErrorActionButton({
  label,
  onPress,
  disabled = false,
  testID,
}: ErrorActionButtonProps) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{disabled}}
      disabled={disabled || !onPress}
      hitSlop={8}
      onPress={onPress}
      style={({pressed}) => [
        styles.button,
        pressed && !disabled && styles.buttonPressed,
        disabled && styles.buttonDisabled,
      ]}
      testID={testID}>
      <AppText style={styles.buttonText} variant="caption" weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: {
    flexShrink: 0,
  },
  badge: {
    alignItems: 'center',
    backgroundColor: ROSE_BADGE_BG,
    justifyContent: 'center',
    marginTop: 2,
  },
  badgeCompact: {
    borderRadius: 6,
    height: 24,
    width: 24,
  },
  badgeGlyph: {
    color: ROSE_TEXT,
    letterSpacing: 0.4,
    textAlign: 'center',
  },
  badgeGlyphCompact: {
    fontSize: 11,
    lineHeight: 14,
  },
  badgeGlyphRegular: {
    fontSize: 12,
    lineHeight: 16,
  },
  badgeRegular: {
    borderRadius: 8,
    height: 28,
    width: 28,
  },
  button: {
    alignItems: 'center',
    backgroundColor: ROSE_BUTTON_BG,
    borderRadius: 10,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: spacing.md,
  },
  buttonDisabled: {
    opacity: 0.48,
  },
  buttonPressed: {
    backgroundColor: ROSE_BUTTON_PRESSED_BG,
  },
  buttonText: {
    color: ROSE_TEXT,
  },
  card: {
    backgroundColor: ROSE_CARD_BG,
    borderColor: ROSE_CARD_BORDER,
    borderRadius: 12,
    borderWidth: 1,
  },
  cardCompact: {
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  cardRegular: {
    marginBottom: 24,
    padding: 16,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  message: {
    color: ROSE_TEXT_MUTED,
    marginTop: 2,
  },
  messageCompact: {
    fontSize: 11,
    lineHeight: 15,
  },
  messageRegular: {
    fontSize: 12,
    lineHeight: 16,
  },
  row: {
    alignItems: 'flex-start',
    flexDirection: 'row',
  },
  rowCompact: {
    gap: spacing.sm,
  },
  rowRegular: {
    gap: spacing.md,
  },
  title: {
    color: ROSE_TEXT,
  },
  titleCompact: {
    fontSize: 12,
    lineHeight: 16,
  },
  titleRegular: {
    fontSize: 14,
    lineHeight: 18,
  },
});
