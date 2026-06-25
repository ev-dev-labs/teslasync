// Native parity port of web/src/components/feedback/LiveStaleDataBanner.tsx.
//
// Page-level companion to <LiveIndicator>. The web source rendered a shared web
// <AlertBanner variant="warning"> (neon-amber) holding a lucide-react <WifiOff>
// glyph, a title, and a body sentence, shown only once the live-data pipeline
// has been `disconnected` for at least two minutes. Connection health came from
// the useLiveConnection() hook (a browser sseManager/EventSource singleton) and
// the copy came from react-i18next.
//
// This port reproduces the same sustained-outage threshold behaviour and visual
// intent with React Native View/AppText primitives, the SemanticIcon wifi-off
// glyph, the design tokens, and self-contained native ports of the warning
// AlertBanner chrome and the i18n fallback -- no DOM, no lucide-react, no
// recharts/leaflet, and no web UI components. AlertBanner has no native parity
// port yet, so its warning-variant chrome is recreated inline here (mirroring
// how _ErrorState recreates its rose card and DraftRecoveryBanner its info
// banner). The web useLiveConnection hook is backed by the browser-only
// sseManager singleton, which has no native port; this file keeps the identical
// threshold/timer logic and reads `status` from a native-safe useLiveConnection
// that reports the explicit 'unknown' (live wiring unavailable) state, while
// also accepting an optional `status` override so a future native live-state
// provider (or a test) can drive the banner -- documented in the sidecar.

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {StyleSheet, View, type StyleProp, type ViewStyle} from 'react-native';

import {SemanticIcon} from '../../../components/icons/SemanticIcon';
import {AppText} from '../../../components/ui/AppText';
import {spacing} from '../../../theme/tokens';

/**
 * Show the banner once the live pipe has been disconnected for at least
 * this long. Pages that rely on live data only show the warning after a
 * sustained outage to avoid flapping during transient reconnects.
 */
const STALE_BANNER_THRESHOLD_MS = 2 * 60_000;

// neon-amber (#f59e0b = rgb(245, 158, 11)) is the web AlertBanner "warning"
// variant hue. The Tailwind ramp used border-neon-amber/20, bg-neon-amber/5, the
// icon/title at full neon-amber, and the body text at neon-amber/80. The shared
// token set exposes a warning amber (#fbbf24) but not these exact neon-amber
// alpha stops, so they are recreated here from the neon-amber channels (the same
// way _ErrorState recreates the rose ramp).
const NEON_AMBER = '#f59e0b';
const NEON_AMBER_RGB = '245, 158, 11';
const BANNER_BG = `rgba(${NEON_AMBER_RGB}, 0.05)`;
const BANNER_BORDER = `rgba(${NEON_AMBER_RGB}, 0.2)`;
const BODY_TEXT = `rgba(${NEON_AMBER_RGB}, 0.8)`;

type NativeTFunction = (key: string, fallback: string) => string;

/**
 * Overall live-data pipeline health. Mirrors the `LiveConnectionStatus` union
 * from web/src/hooks/useLiveConnection.ts so callers and a future native
 * live-state provider can speak the same vocabulary.
 */
export type LiveConnectionStatus =
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'unknown';

export interface LiveStaleDataBannerProps {
  /**
   * Optional live-connection status override. The web component self-wired via
   * useLiveConnection(); native has no ported sseManager singleton, so this prop
   * lets a real native live-state provider (or a test) drive the banner. When
   * omitted it falls back to the native-safe useLiveConnection() below, which
   * reports 'unknown' (live wiring unavailable) and therefore never shows.
   */
  status?: LiveConnectionStatus;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  /** Native style override for the banner container (parity for `className`). */
  style?: StyleProp<ViewStyle>;
  /** Test hook. */
  testID?: string;
}

/**
 * Native-safe stand-in for web/src/hooks/useLiveConnection.ts. That hook derives
 * live-pipeline health from the browser `sseManager` singleton (an EventSource
 * wrapper), which is DOM-only and not ported to native. Until a native live-
 * state provider exists, this reports the explicit 'unknown' state -- the same
 * value the web hook returns before any successful connection -- so the banner
 * stays hidden instead of raising a false "live data unavailable" alarm.
 */
function useLiveConnection(): {status: LiveConnectionStatus} {
  return {status: 'unknown'};
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
 * `<LiveStaleDataBanner>` -- page-level companion to `<LiveIndicator>`.
 *
 * Shows an in-flow warning banner when the live data pipeline has been
 * `disconnected` for longer than two minutes. Drop one near the top of any page
 * whose content depends on live telemetry -- the sidebar `<LiveIndicator>`
 * always shows the wire health, this banner is for users staring at a single
 * page who would otherwise miss it.
 */
export function LiveStaleDataBanner({
  status: statusOverride,
  className: _className,
  style,
  testID,
}: LiveStaleDataBannerProps) {
  const live = useLiveConnection();
  const status = statusOverride ?? live.status;
  const t = useNativeTranslationFallback();

  const disconnectedSinceRef = useRef<number | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (status === 'disconnected') {
      if (disconnectedSinceRef.current == null) {
        disconnectedSinceRef.current = Date.now();
      }
      const elapsed = Date.now() - disconnectedSinceRef.current;
      if (elapsed >= STALE_BANNER_THRESHOLD_MS) {
        setShow(true);
        return;
      }
      const timer = setTimeout(
        () => setShow(true),
        STALE_BANNER_THRESHOLD_MS - elapsed + 50,
      );
      return () => clearTimeout(timer);
    }
    // Any non-disconnected status clears the timer and hides the banner.
    disconnectedSinceRef.current = null;
    setShow(false);
  }, [status]);

  if (!show) {
    return null;
  }

  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.banner, style]}
      testID={testID}>
      <View pointerEvents="none" style={styles.icon}>
        <SemanticIcon decorative name="wifiOff" size="sm" />
      </View>
      <View style={styles.body}>
        <AppText style={styles.title}>
          {t('live.staleBanner.title', 'Live data unavailable')}
        </AppText>
        <AppText style={styles.message}>
          {t(
            'live.staleBanner.message',
            'The live data connection has been offline for more than 2 minutes. Values on this page may be stale until the connection is restored.',
          )}
        </AppText>
      </View>
    </View>
  );
}

LiveStaleDataBanner.displayName = 'LiveStaleDataBanner';

const styles = StyleSheet.create({
  banner: {
    alignItems: 'flex-start',
    backgroundColor: BANNER_BG,
    borderColor: BANNER_BORDER,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  icon: {
    marginTop: 2,
  },
  message: {
    color: BODY_TEXT,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  title: {
    color: NEON_AMBER,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
});
