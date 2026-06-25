// Native parity port of web/src/components/feedback/TeslaReauthBanner.tsx.
//
// Tesla third-party OAuth grant recovery banner. The web source sat at the top
// of <Layout> as a sticky, amber-tinted alert row driven entirely by two
// document-level CustomEvents that `resilientFetch` dispatched once a Tesla-
// backed call started returning 401 TESLA_TOKEN_EXPIRED:
//   - `teslasync:tesla-auth-expired`   -> show the banner
//   - `teslasync:tesla-auth-recovered` -> hide it + replay queued mutations
// It rendered a lucide-react <AlertTriangle> in an amber badge, a title/body
// pair, a shared web UI <Button size="sm" variant="primary"> "Reconnect" CTA
// that react-router navigated to /tesla-account, and a bare <button> dismiss
// "X", with react-i18next copy.
//
// React Native has no `document` event bus, no react-router, no lucide-react,
// and no shared web UI <Button>, so this port reproduces the same behaviour and
// visual intent with React Native View/Pressable/AppText primitives, the
// SemanticIcon warning glyph, the design tokens, and self-contained native
// ports of the amber banner chrome, the compact primary/dismiss affordances,
// and the i18n fallback -- no DOM, no react-router, no lucide-react, no
// recharts/leaflet, and no web UI components. The browser-only document-event
// bridge is unavailable on native (matching
// nativeVehicleCommandAuthRecovery.documentEventBridgeAvailable === false), so
// the self-arming wiring is replaced by an explicit `expired` controlled prop a
// future native Tesla auth-status provider (or a test) can drive -- mirroring
// how LiveStaleDataBanner accepts a `status` override -- defaulting to the
// native-safe "never expired" state so the banner stays hidden. Navigation is
// surfaced as an `onReconnect` callback (parity for navigate('/tesla-account'),
// route id exported as TESLA_REAUTH_ROUTE_ID) and the recovery replay defaults
// to the native drainQueuedTeslaCommandMutations queue drain -- all documented
// in the sidecar.

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {SemanticIcon} from '../../../components/icons/SemanticIcon';
import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';
import {drainQueuedTeslaCommandMutations} from '../../api/hooks/useVehicleCommand';

type NativeTFunction = (key: string, fallback: string) => string;

// amber-500 (#f59e0b = rgb(245, 158, 11)) is the web banner hue: the container
// used border-b border-amber-500/30 over bg-amber-500/[0.08], the icon sat in an
// amber-500/15 badge, and the glyph was amber-300. The shared token set exposes a
// warning amber (#fbbf24) used by SemanticIcon's warning tone for the glyph badge,
// but not these exact amber-500 alpha stops, so the container fill/border are
// recreated from the amber-500 channels (the same way LiveStaleDataBanner
// recreates its neon-amber ramp).
const AMBER_500_RGB = '245, 158, 11';
const BANNER_BG = `rgba(${AMBER_500_RGB}, 0.08)`;
const BANNER_BORDER = `rgba(${AMBER_500_RGB}, 0.3)`;

/**
 * Web route the "Reconnect" CTA navigated to via react-router
 * (`navigate('/tesla-account')`). Exposed as the native route id so the shell
 * (or a test) can wire {@link TeslaReauthBannerProps.onReconnect} to the
 * equivalent `onNavigate('tesla-account')`.
 */
export const TESLA_REAUTH_ROUTE_ID = 'tesla-account';

/**
 * Documents how the web banner's browser-only wiring maps onto native, mirroring
 * `nativeVehicleCommandAuthRecovery` in api/hooks/useVehicleCommand.ts.
 */
export const nativeTeslaReauthBannerRecovery = {
  // The web banner self-armed from `teslasync:tesla-auth-expired` /
  // `teslasync:tesla-auth-recovered` document CustomEvents. React Native has no
  // `document` event bus, so the banner is driven by the `expired` prop instead.
  documentEventBridgeAvailable: false,
  // On recovery the banner replays queued Tesla mutations. The web drained the
  // generic @/lib/teslaAuthRecovery queue; native drains the command queue that
  // is the only Tesla auth-recovery queue ported so far.
  queuedReplayTrigger:
    'expired prop true->false transition drains drainQueuedTeslaCommandMutations',
} as const;

export interface TeslaReauthBannerProps {
  /**
   * Whether the user's Tesla OAuth grant is currently expired. The web component
   * self-armed from the `teslasync:tesla-auth-expired` document event (and
   * disarmed on `teslasync:tesla-auth-recovered`); native has no document event
   * bridge, so a native Tesla auth-status provider (or a test) drives the banner
   * through this prop. A false->true edge shows the banner; a true->false edge
   * hides it and replays queued Tesla mutations. Omitted -> native-safe "never
   * expired", so the banner stays hidden.
   */
  expired?: boolean;
  /**
   * "Reconnect" CTA handler. Parity for the web `navigate('/tesla-account')`;
   * callers should route to {@link TESLA_REAUTH_ROUTE_ID}.
   */
  onReconnect?: () => void;
  /** Called when the user dismisses the banner (parity for the web "X" button). */
  onDismiss?: () => void;
  /**
   * Recovery replay invoked on a true->false `expired` transition. Defaults to
   * the native {@link drainQueuedTeslaCommandMutations} queue drain (parity for
   * the web `drainQueuedTeslaMutations`).
   */
  onRecovered?: () => void | Promise<void>;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  /** Native style override for the banner container (parity for `className`). */
  style?: StyleProp<ViewStyle>;
  /** Test hook. */
  testID?: string;
}

/**
 * The web component read `t` from react-i18next. Native parity has no i18n
 * runtime wired yet, so this returns the English fallback string, preserving the
 * i18n key/fallback intent.
 */
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

/**
 * Tesla third-party OAuth grant recovery banner.
 *
 * The Tesla refresh token has a hard 8-week TTL. When it expires, every
 * Tesla-backed call starts returning 401 with `code: TESLA_TOKEN_EXPIRED`. The
 * web component picked that up from a `teslasync:tesla-auth-expired` document
 * event and rendered a sticky top-of-page row with a single-click CTA that
 * deep-linked the user to `/tesla-account` to complete the OAuth flow again.
 *
 * Distinct from a hard session-expiry blocker -- Tesla token expiry is a
 * *partial* failure: non-Tesla data keeps loading, so a non-modal banner is the
 * right fit. On recovery the banner hides itself and replays any commands the
 * user tried during the disconnected window.
 */
export function TeslaReauthBanner({
  expired = false,
  onReconnect,
  onDismiss,
  onRecovered,
  className: _className,
  style,
  testID = 'tesla-reauth-banner',
}: TeslaReauthBannerProps) {
  const t = useNativeTranslationFallback();
  const [visible, setVisible] = useState(false);
  const wasExpiredRef = useRef(false);

  const runRecovery = useCallback(() => {
    // Best-effort replay; errors surface via each mutation's normal onError path.
    void (onRecovered ?? drainQueuedTeslaCommandMutations)();
  }, [onRecovered]);

  useEffect(() => {
    const wasExpired = wasExpiredRef.current;
    wasExpiredRef.current = expired;
    if (expired && !wasExpired) {
      // teslasync:tesla-auth-expired
      setVisible(true);
    } else if (!expired && wasExpired) {
      // teslasync:tesla-auth-recovered
      setVisible(false);
      runRecovery();
    }
  }, [expired, runRecovery]);

  if (!visible) {
    return null;
  }

  const handleReconnect = () => {
    onReconnect?.();
  };

  const handleDismiss = () => {
    setVisible(false);
    onDismiss?.();
  };

  return (
    <View
      accessibilityLiveRegion="assertive"
      accessibilityRole="alert"
      style={[styles.banner, style]}
      testID={testID}>
      <View pointerEvents="none" style={styles.icon}>
        <SemanticIcon decorative name="warning" size="sm" />
      </View>
      <View style={styles.body}>
        <AppText style={styles.title}>
          {t('tesla.reauth.title', 'Tesla account disconnected')}
        </AppText>
        <AppText style={styles.message}>
          {t('tesla.reauth.body', 'Reconnect to resume live data and commands.')}
        </AppText>
      </View>
      <View style={styles.actions}>
        <Pressable
          accessibilityLabel={t('tesla.reauth.cta', 'Reconnect')}
          accessibilityRole="button"
          hitSlop={8}
          onPress={handleReconnect}
          style={({pressed}) => [styles.cta, pressed && styles.ctaPressed]}>
          <AppText style={styles.ctaText} weight="semibold">
            {t('tesla.reauth.cta', 'Reconnect')}
          </AppText>
        </Pressable>
        <Pressable
          accessibilityLabel={t('common.dismiss', 'Dismiss')}
          accessibilityRole="button"
          hitSlop={8}
          onPress={handleDismiss}
          style={({pressed}) => [
            styles.dismiss,
            pressed && styles.dismissPressed,
          ]}>
          <AppText style={styles.dismissGlyph}>✕</AppText>
        </Pressable>
      </View>
    </View>
  );
}

TeslaReauthBanner.displayName = 'TeslaReauthBanner';

const styles = StyleSheet.create({
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 0,
    gap: spacing.sm,
  },
  banner: {
    alignItems: 'center',
    backgroundColor: BANNER_BG,
    borderBottomColor: BANNER_BORDER,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  cta: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 32,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  ctaPressed: {
    opacity: 0.82,
  },
  ctaText: {
    color: colors.background,
    fontSize: 12,
  },
  dismiss: {
    alignItems: 'center',
    borderRadius: 8,
    justifyContent: 'center',
    padding: 6,
  },
  dismissGlyph: {
    color: colors.textSecondary,
    fontSize: 16,
    lineHeight: 16,
  },
  dismissPressed: {
    backgroundColor: colors.surfaceRaised,
  },
  icon: {
    flexShrink: 0,
  },
  message: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
});

export default TeslaReauthBanner;
