// Native parity port of web/src/components/feedback/OfflineBanner.tsx.
//
// `OfflineBanner` is the small, non-blocking offline notice the web app pins to
// the bottom-right corner whenever the browser reports no network. It renders
// the shared warning-variant `<AlertBanner>` ("You're offline" / "Showing
// cached data. New requests will retry when you reconnect.") and hides itself
// the moment connectivity returns -- no manual dismiss.
//
// Three web-only dependencies have no native parity surface (rules 4/7), so a
// native-safe implementation is built:
//   - react-i18next `useTranslation` is absent from the native deps; a local
//     fallback resolver returns the inline English copy while still referencing
//     the i18n keys (pwa.offline.title / pwa.offline.banner) so intent is
//     preserved -- the same approach as the sibling BrowserCompatBanner /
//     InlineCallout / EmptyStateThreshold ports.
//   - `useOnlineStatus` is backed by `navigator.onLine` + window online/offline
//     events via `@/lib/resilience`, none of which exist in React Native (and no
//     NetInfo dependency is installed). The native analog reads the API client's
//     connection status (`getConnectionStatus()` from the parity api/client --
//     the same request-layer source of truth the web hook routes through
//     `lib/resilience`) and polls it, because the native client exposes no
//     push-based status broadcaster. 'unknown' (cold start, no request yet) is
//     treated as online so the banner stays hidden by default, matching the web
//     behavior on a connected device. An optional `testHookOnline` seam forces
//     the state for deterministic rendering.
//   - the shared `<AlertBanner>` and the lucide-react `WifiOff` SVG have no
//     native port yet; the warning-variant banner is reproduced inline with
//     View/AppText and the shared tokens, and WifiOff becomes a decorative amber
//     alert glyph (h-4 w-4 -> fontSize 16) flagged aria-hidden. The boxed
//     SemanticIcon `wifiOff` is danger-toned and visually heavier than
//     AlertBanner's icon-in-title-color, so the inline glyph preserves the
//     warning palette.
//
// Visual-intent mapping (Tailwind -> tokens): border-neon-amber/20 ->
// rgba(251,191,36,0.2); bg-neon-amber/5 -> rgba(251,191,36,0.05); text-neon-amber
// -> colors.warning (#fbbf24); text-neon-amber/80 -> rgba(251,191,36,0.8);
// rounded-xl -> 12; p-4 -> 16; gap-3 -> spacing.md; text-sm/font-medium ->
// 14/'600'; text-xs -> 12; mt-0.5 -> 2. backdrop-blur-sm has no native analog and
// is omitted. The web `fixed` positioning maps to position:'absolute' (right 16,
// zIndex 9997, max width 384). The responsive `lg:bottom-1rem` desktop step has no
// native breakpoint, so the mobile base `bottom-4.5rem` (72) is used, and the
// env(safe-area-inset-bottom,0px) term collapses to its web-declared 0px fallback
// because no SafeAreaProvider is wired in this slice. role="status"/aria-live
// -> accessibilityLiveRegion="polite"; data-testid -> testID.

import React, {useCallback, useEffect, useState} from 'react';
import {StyleSheet, View} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';
import {getConnectionStatus} from '../../api/client';

// React Native has no navigator online/offline events; the API client only
// refreshes its connection status on real requests, so the banner state is
// polled off that shared seam at a modest cadence (cleared on unmount).
const ONLINE_STATUS_POLL_MS = 5000;

// 4.5rem -- lifts the banner above the bottom navigation on mobile. The web
// `lg:bottom-1rem` desktop override has no native breakpoint, and the
// env(safe-area-inset-bottom,0px) term collapses to its declared 0px fallback.
const BANNER_BOTTOM_OFFSET = 72;

const AMBER_BORDER = 'rgba(251, 191, 36, 0.2)';
const AMBER_BG = 'rgba(251, 191, 36, 0.05)';
const AMBER_BODY = 'rgba(251, 191, 36, 0.8)';

type NativeTFunction = (key: string, fallback: string) => string;

// React Native ships no react-i18next runtime; resolve to the inline English
// fallback while keeping the i18n keys referenced at the call sites.
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

// Native analog of web `useOnlineStatus`. Reads the API client's last-known
// connection status (the request-layer source of truth, mirroring the web hook's
// routing through `lib/resilience`) and polls it, since the native client
// exposes no push-based broadcaster. 'unknown' is treated as online so the
// banner stays hidden until there is positive evidence of an offline request.
function useNativeOnlineStatus(testHookOnline?: boolean): boolean {
  const [online, setOnline] = useState<boolean>(
    () => testHookOnline ?? getConnectionStatus() !== 'offline',
  );

  useEffect(() => {
    if (testHookOnline !== undefined) {
      setOnline(testHookOnline);
      return undefined;
    }

    setOnline(getConnectionStatus() !== 'offline');
    const interval = setInterval(() => {
      setOnline(getConnectionStatus() !== 'offline');
    }, ONLINE_STATUS_POLL_MS);

    return () => clearInterval(interval);
  }, [testHookOnline]);

  return online;
}

export interface OfflineBannerProps {
  /**
   * Native test seam -- forces the online/offline state so specs can exercise
   * the rendered banner without driving the API client. Production callers
   * render `<OfflineBanner />` with no props, exactly like the web source.
   */
  testHookOnline?: boolean;
}

/**
 * OfflineBanner -- small, non-blocking warning pinned to the bottom-right
 * corner whenever the app is offline. Mirrors the web component: shows the
 * shared warning-variant banner with cached-data messaging and hides
 * automatically when connectivity returns. No manual dismiss.
 */
export function OfflineBanner({testHookOnline}: OfflineBannerProps = {}) {
  const t = useNativeTranslationFallback();
  const online = useNativeOnlineStatus(testHookOnline);

  if (online) {
    return null;
  }

  return (
    <View pointerEvents="box-none" style={styles.anchor} testID="offline-banner">
      <View accessibilityLiveRegion="polite" accessible style={styles.banner}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.iconWrap}>
          <AppText style={styles.iconGlyph} weight="bold">
            ⚠
          </AppText>
        </View>
        <View style={styles.body}>
          <AppText style={styles.title} weight="semibold">
            {t('pwa.offline.title', "You're offline")}
          </AppText>
          <AppText style={styles.bodyText}>
            {t(
              'pwa.offline.banner',
              'Showing cached data. New requests will retry when you reconnect.',
            )}
          </AppText>
        </View>
      </View>
    </View>
  );
}

OfflineBanner.displayName = 'OfflineBanner';

const styles = StyleSheet.create({
  anchor: {
    bottom: BANNER_BOTTOM_OFFSET,
    maxWidth: 384,
    position: 'absolute',
    right: 16,
    zIndex: 9997,
  },
  banner: {
    alignItems: 'flex-start',
    backgroundColor: AMBER_BG,
    borderColor: AMBER_BORDER,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: 16,
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  bodyText: {
    color: AMBER_BODY,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  iconGlyph: {
    color: colors.warning,
    fontSize: 16,
    lineHeight: 16,
  },
  iconWrap: {
    alignItems: 'center',
    flexShrink: 0,
    justifyContent: 'center',
    marginTop: 2,
  },
  title: {
    color: colors.warning,
    fontSize: 14,
    lineHeight: 20,
  },
});

export default OfflineBanner;
