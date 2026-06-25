// Native parity port of web/src/components/feedback/CookieConsentBanner.tsx.
//
// Cookie / GDPR consent banner. Renders a non-blocking bottom-of-screen banner
// the first time a user lands on the app when the deployment opts into consent
// collection (server config `require_cookie_consent === true`) AND the user has
// not yet recorded a decision (`getConsent() === 'unknown'`).
//
// GDPR / CNIL-style behaviour is preserved from the web component:
//   - Non-essential reporting is OFF by default until the user clicks
//     "Accept all". Strictly-necessary functional storage is "always on" and
//     cannot be declined here (ePrivacy directive exemption).
//   - Dismissing without choosing does NOT count as consent: the banner only
//     unmounts after Accept or Decline.
//   - "Manage preferences" expands an inline details block listing the two
//     categories so the consent is informed.
//
// Native-safe adaptations (documented in the sidecar):
//   - The web lib `@/lib/cookieConsent` relies on `window.localStorage` and
//     `window` CustomEvents, and `@/lib/webVitalsReporter` / `@/lib/errorReporter`
//     POST browser telemetry. None of those browser globals exist in React
//     Native, so this file provides an in-memory, native-safe consent store
//     (getConsent / setConsent / subscribeConsent) plus no-op reporter
//     requirement setters that retain the flag for parity. State names, the
//     ConsentState tri-state, the test seams, the i18n keys/fallbacks, and the
//     accept/decline/manage behaviour are preserved exactly.
//   - DOM `div`/`p`/`ul`/`li`/`button`, Tailwind classes, the lucide
//     `ShieldCheck` icon, and the shared web `Button` are replaced with React
//     Native View/AppText/Pressable, native color tokens, the SemanticIcon
//     primitive, and `data-testid` -> `testID`.

import React, {useEffect, useState} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {SemanticIcon} from '../../../components/icons/SemanticIcon';
import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';
import {useVersionInfo} from '../../api/hooks/useSettings';

/**
 * Tri-state consent value. `unknown` means the user has not yet decided —
 * the banner is still showing or the user dismissed without choosing.
 * `accepted` and `declined` are explicit user decisions.
 */
export type ConsentState = 'unknown' | 'accepted' | 'declined';

// In-memory, native-safe consent store. React Native has no localStorage, so
// there is no cross-launch persistence: a fresh app launch always collapses to
// `unknown`, which is itself the correct GDPR behaviour (re-prompt when the
// prior decision cannot be recovered). The deployment-wide contract is still
// enforced server-side via the `/system/version` flag.
let nativeConsentState: ConsentState = 'unknown';
const consentListeners = new Set<(state: ConsentState) => void>();

function getConsent(): ConsentState {
  return nativeConsentState;
}

function setConsent(state: 'accepted' | 'declined'): void {
  nativeConsentState = state;
  consentListeners.forEach(cb => cb(state));
}

function subscribeConsent(cb: (state: ConsentState) => void): () => void {
  consentListeners.add(cb);
  return () => {
    consentListeners.delete(cb);
  };
}

// Native-safe replacements for the browser reporter requirement setters. The
// web build pushes the deployment-wide consent flag into webVitalsReporter /
// errorReporter so they gate their POSTs; React Native has no such browser
// reporters, so the flags are retained in-memory for parity / future use.
const reportingConsentRequirement = {
  errors: false,
  vitals: false,
};

function setVitalsConsentRequirement(required: boolean): void {
  reportingConsentRequirement.vitals = required;
}

function setErrorReporterConsentRequirement(required: boolean): void {
  reportingConsentRequirement.errors = required;
}

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return (_key: string, fallback: string) => fallback;
}

export interface CookieConsentBannerProps {
  /**
   * Test seam — overrides the live `useVersionInfo` lookup. Production callers
   * never set this; specs use it to render the banner without mocking the
   * entire TanStack Query stack.
   */
  testHookRequireConsent?: boolean;
  /**
   * Test seam — overrides the live `getConsent()` lookup. Lets specs exercise
   * the "user already accepted" / "user already declined" / "unknown" branches
   * without poking the consent store.
   */
  testHookConsentState?: ConsentState;
}

export function CookieConsentBanner({
  testHookRequireConsent,
  testHookConsentState,
}: CookieConsentBannerProps = {}) {
  const t = useNativeTranslationFallback();

  // Always call the hook so React's hook-call ordering is stable; the test seam
  // below short-circuits its result. The query has a long staleTime and is
  // shared with other consumers, so this is effectively free.
  const versionQuery = useVersionInfo();
  const requireConsent =
    testHookRequireConsent ??
    Boolean(versionQuery.data?.require_cookie_consent);

  // Push the deployment-wide consent flag into the (native-safe) reporters so
  // they gate their telemetry on the user's stored consent. Re-pushed on every
  // change so a mid-session version-query resolve, or a Privacy reset that
  // surfaces the banner again, propagates before the next metric/error fires.
  useEffect(() => {
    if (testHookRequireConsent !== undefined) {
      return;
    }
    setVitalsConsentRequirement(requireConsent);
    setErrorReporterConsentRequirement(requireConsent);
  }, [requireConsent, testHookRequireConsent]);

  const [consent, setConsentState] = useState<ConsentState>(
    () => testHookConsentState ?? getConsent(),
  );
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    // When the test seam pins consent, do not subscribe — the spec owns the
    // value lifecycle and a stray subscription would race.
    if (testHookConsentState !== undefined) {
      setConsentState(testHookConsentState);
      return;
    }
    setConsentState(getConsent());
    return subscribeConsent(next => setConsentState(next));
  }, [testHookConsentState]);

  if (!requireConsent) {
    return null;
  }
  if (consent !== 'unknown') {
    return null;
  }

  const handleAccept = () => {
    setConsent('accepted');
    setConsentState('accepted');
  };
  const handleDecline = () => {
    setConsent('declined');
    setConsentState('declined');
  };

  const title = t('consent.banner.title', 'Cookies & analytics');
  const body = t(
    'consent.banner.body',
    'TeslaSync uses strictly necessary storage to keep you signed in and to remember your preferences. With your consent, we also collect anonymous performance and error reports to improve the app. You can change your mind any time in Settings → Privacy.',
  );

  return (
    <View
      pointerEvents="box-none"
      style={styles.overlay}
      testID="cookie-consent-banner">
      <View style={styles.card}>
        <View style={styles.row}>
          <SemanticIcon
            decorative
            name="securityCheck"
            size="sm"
            style={styles.icon}
          />
          <View style={styles.bodyColumn}>
            <View
              accessibilityHint={body}
              accessibilityLabel={title}
              accessible
              style={styles.textGroup}>
              <AppText style={styles.title} weight="semibold">
                {title}
              </AppText>
              <AppText style={styles.bodyText} tone="secondary">
                {body}
              </AppText>
            </View>

            <View style={styles.toggleWrap}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{expanded: showDetails}}
                onPress={() => setShowDetails(v => !v)}
                style={({pressed}) => [pressed && styles.pressed]}
                testID="cookie-consent-toggle-details">
                <AppText style={styles.toggleText} tone="muted" variant="caption">
                  {showDetails
                    ? t('consent.banner.hideDetails', 'Hide details')
                    : t('consent.banner.manage', 'Manage preferences')}
                </AppText>
              </Pressable>
            </View>

            {showDetails ? (
              <View style={styles.details} testID="cookie-consent-details">
                <View style={styles.detailItem}>
                  <View style={styles.detailItemTitleRow}>
                    <AppText style={styles.detailItemTitle} weight="semibold">
                      {t(
                        'consent.category.essential.title',
                        'Strictly necessary',
                      )}
                    </AppText>
                    <View style={styles.chip}>
                      <AppText style={styles.chipText} weight="semibold">
                        {t('consent.category.alwaysOn', 'Always on')}
                      </AppText>
                    </View>
                  </View>
                  <AppText style={styles.detailItemBody} tone="muted">
                    {t(
                      'consent.category.essential.body',
                      'Authentication, session, theme, and saved drafts. Required for the app to work and exempt from consent under the ePrivacy directive.',
                    )}
                  </AppText>
                </View>
                <View style={styles.detailItem}>
                  <AppText style={styles.detailItemTitle} weight="semibold">
                    {t(
                      'consent.category.analytics.title',
                      'Performance & error reporting',
                    )}
                  </AppText>
                  <AppText style={styles.detailItemBody} tone="muted">
                    {t(
                      'consent.category.analytics.body',
                      'Anonymous Core Web Vitals (page-load timings) and uncaught error reports sent to this TeslaSync instance to help operators diagnose issues. No third parties involved.',
                    )}
                  </AppText>
                </View>
              </View>
            ) : null}

            <View style={styles.actions}>
              <ConsentAction
                label={t('consent.banner.accept', 'Accept all')}
                onPress={handleAccept}
                testID="cookie-consent-accept"
                variant="primary"
              />
              <ConsentAction
                label={t('consent.banner.decline', 'Decline non-essential')}
                onPress={handleDecline}
                testID="cookie-consent-decline"
                variant="ghost"
              />
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

CookieConsentBanner.displayName = 'CookieConsentBanner';

function ConsentAction({
  label,
  onPress,
  testID,
  variant,
}: {
  label: string;
  onPress: () => void;
  testID: string;
  variant: 'primary' | 'ghost';
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({pressed}) => [
        styles.actionButton,
        variant === 'primary' ? styles.primaryButton : styles.ghostButton,
        pressed && styles.pressed,
      ]}
      testID={testID}>
      <AppText
        style={
          variant === 'primary'
            ? styles.primaryButtonText
            : styles.ghostButtonText
        }
        weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  actionButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingTop: spacing.md,
  },
  bodyColumn: {
    flex: 1,
    gap: spacing.sm,
    minWidth: 0,
  },
  bodyText: {
    lineHeight: 18,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 24,
    borderWidth: 1,
    maxWidth: 768,
    padding: spacing.lg,
    width: '100%',
  },
  chip: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  chipText: {
    color: colors.success,
    fontSize: 10,
    lineHeight: 14,
  },
  details: {
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  detailItem: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  detailItemBody: {
    fontSize: 11,
    lineHeight: 16,
  },
  detailItemTitle: {
    fontSize: 12,
    lineHeight: 16,
  },
  detailItemTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  ghostButton: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  ghostButtonText: {
    color: colors.textPrimary,
    lineHeight: 18,
  },
  icon: {
    marginTop: 2,
  },
  overlay: {
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    width: '100%',
  },
  pressed: {
    opacity: 0.82,
  },
  primaryButton: {
    backgroundColor: colors.accent,
    borderColor: colors.borderAccent,
  },
  primaryButtonText: {
    color: colors.background,
    lineHeight: 18,
  },
  row: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
  },
  textGroup: {
    gap: spacing.xs,
  },
  title: {
    fontSize: 14,
    lineHeight: 18,
  },
  toggleText: {
    textDecorationLine: 'underline',
  },
  toggleWrap: {
    alignSelf: 'flex-start',
  },
});

export default CookieConsentBanner;
