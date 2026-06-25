// Native parity port of web/src/components/feedback/NewVersionBanner.tsx.
//
// Surfaces a soft "a new version is available" banner when the backend has been
// redeployed since the app first booted. The web source composes a fixed-overlay
// <div role="status">, a lucide-react <Sparkles> glyph, the shared <Button>, the
// react-i18next t(), the @/hooks/useVersionWatcher poller, window.sessionStorage
// per-version dismissal, and window.location.reload(). Every browser-only piece
// is adapted here (see the parity sidecar for the full line-by-line mapping):
//   • <div> / <p>          -> View / AppText
//   • fixed bottom/right    -> position:'absolute' bottom/right/zIndex overlay
//   • lucide <Sparkles>     -> the "✨" text glyph (native ships no SVG icon set)
//   • shared <Button>       -> the native AppButton (ghost / primary variants)
//   • react-i18next t()     -> an inline English-default t() (no i18next provider)
//   • useVersionWatcher     -> an inline native-safe poller of /system/version via
//                              the native request() client; the web hook's
//                              BroadcastChannel cross-tab sync is dropped because
//                              a native app is a single instance with no peer tabs.
//   • window.sessionStorage -> a module-level dismissal cache keyed on
//                              SESSION_DISMISS_KEY, the faithful analog of the
//                              web's per-tab sessionStorage lifetime (survives
//                              remounts within the app process, resets on a cold
//                              start).
//   • window.location.reload() -> the onReload prop (defaults to a best-effort
//                              DevSettings.reload()); a JS/page reload has no
//                              production native analog, so the host wires its own
//                              update/restart mechanism (e.g. CodePush).
//
// No DOM modules, browser HTML elements, Recharts, Leaflet, or old web UI
// components are imported.

import React, {useEffect, useState} from 'react';
import {
  DevSettings,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppButton} from '../../../components/ui/AppButton';
import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';
import {ApiError, request} from '../../api/client';

/** Native parity ships no react-i18next provider; return the English default. */
function t(_key: string, fallback: string): string {
  return fallback;
}

/* ------------------------------------------------------------------ */
/*  Native-safe version watcher                                        */
/* ------------------------------------------------------------------ */

interface SystemVersionResponse {
  app_version: string;
}

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const VERSION_PATH = '/system/version';

export interface VersionWatcherState {
  /** The `app_version` reported by the backend on the very first poll after mount. */
  bootVersion: string | null;
  /** The most recent `app_version` reported by a poll. */
  latestVersion: string | null;
  /** `true` iff `bootVersion && latestVersion && latestVersion !== bootVersion`. */
  newVersionAvailable: boolean;
}

async function fetchVersion(): Promise<string | null> {
  try {
    const resp = await request<SystemVersionResponse>(VERSION_PATH);
    if (
      resp &&
      typeof resp.app_version === 'string' &&
      resp.app_version.length > 0
    ) {
      return resp.app_version;
    }
    return null;
  } catch (err) {
    // Swallow transient errors silently — the next tick retries. Surface a 4xx
    // (e.g. 401 unauthenticated) once so an operator can spot a misconfigured
    // deployment, mirroring the web hook.
    if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
      console.warn(
        '[useVersionWatcher] /system/version returned',
        err.status,
        err.message,
      );
    }
    return null;
  }
}

/**
 * useVersionWatcher — native-safe inline equivalent of @/hooks/useVersionWatcher.
 *
 * Captures the boot version once, then polls /system/version on a fixed cadence
 * and flips `newVersionAvailable` when the reported version diverges. The web
 * hook's BroadcastChannel cross-tab coordination is intentionally omitted: a
 * native app is a single instance, so there are no peer tabs to notify.
 */
export function useVersionWatcher(): VersionWatcherState {
  const [bootVersion, setBootVersion] = useState<string | null>(null);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);

  // 1. Boot probe — captured ONCE on mount.
  useEffect(() => {
    let cancelled = false;
    void fetchVersion().then(v => {
      if (cancelled || !v) {
        return;
      }
      setBootVersion(v);
      setLatestVersion(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 2. Periodic poll — only starts once we have a baseline to compare against.
  useEffect(() => {
    if (!bootVersion) {
      return undefined;
    }

    let cancelled = false;
    const tick = async () => {
      const v = await fetchVersion();
      if (cancelled || !v) {
        return;
      }
      setLatestVersion(v);
    };

    const id = setInterval(() => {
      void tick();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [bootVersion]);

  const newVersionAvailable = !!(
    bootVersion &&
    latestVersion &&
    latestVersion !== bootVersion
  );

  return {bootVersion, latestVersion, newVersionAvailable};
}

/* ------------------------------------------------------------------ */
/*  Session-scoped dismissal cache                                     */
/* ------------------------------------------------------------------ */

const SESSION_DISMISS_KEY = 'teslasync:new-version-dismissed-for';

// React Native has no window.sessionStorage. This module-level cache is the
// faithful analog: it survives component remounts within the running app
// process (like sessionStorage survives in-tab navigations) and resets on a
// cold start (like sessionStorage resets in a brand-new tab).
const sessionDismissStore = new Map<string, string>();

function readDismissedVersion(): string | null {
  return sessionDismissStore.get(SESSION_DISMISS_KEY) ?? null;
}

function writeDismissedVersion(version: string): void {
  sessionDismissStore.set(SESSION_DISMISS_KEY, version);
}

/** Test-only reset for the session-scoped dismissal cache. */
export function __resetNewVersionDismissalForTests(): void {
  sessionDismissStore.clear();
}

/* ------------------------------------------------------------------ */
/*  Default reload affordance                                          */
/* ------------------------------------------------------------------ */

function defaultReload(): void {
  // window.location.reload() has no native analog. In dev, DevSettings.reload()
  // restarts the JS bundle (clearing a stale-chunk mismatch the way the web
  // reload does); in production the host should pass `onReload` wired to its own
  // update/restart mechanism (e.g. CodePush restart). Best-effort + guarded.
  try {
    DevSettings.reload();
  } catch {
    /* no-op — production native updates ship via the app store, not a reload. */
  }
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export interface NewVersionBannerProps {
  /**
   * Native reload hook replacing window.location.reload(). Fires when the user
   * taps "Reload". Defaults to a best-effort DevSettings.reload().
   */
  onReload?: () => void;
  /** Native composition hook replacing the web `className` / fixed positioning. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * NewVersionBanner — soft "new version available" banner.
 *
 * Surfaced when {@link useVersionWatcher} detects the backend was redeployed
 * since the app first booted. The user can either:
 *   • Reload — applies the new version (drops the stale JS bundle), and
 *   • Later — dismisses the banner for THIS specific new version. A subsequent
 *     redeploy surfaces the banner again for the newer version.
 *
 * Per-version dismissal is keyed on the `latestVersion` string and held in a
 * session-scoped cache, so a user who deferred a reload still sees the banner
 * for the next deploy.
 */
export function NewVersionBanner({
  onReload,
  style,
  testID,
}: NewVersionBannerProps = {}) {
  const {newVersionAvailable, latestVersion} = useVersionWatcher();
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(() =>
    readDismissedVersion(),
  );

  // If the banner is dismissed for v1.0 but the next poll bumps to v1.1, the
  // dismissal does NOT carry forward — reset the local dismissal whenever
  // `latestVersion` no longer matches the stored dismissal target.
  useEffect(() => {
    if (!latestVersion) {
      return;
    }
    if (dismissedVersion && dismissedVersion !== latestVersion) {
      setDismissedVersion(null);
    }
  }, [latestVersion, dismissedVersion]);

  if (!newVersionAvailable) {
    return null;
  }
  if (latestVersion && dismissedVersion === latestVersion) {
    return null;
  }

  const handleReload = () => {
    (onReload ?? defaultReload)();
  };

  const handleLater = () => {
    if (latestVersion) {
      writeDismissedVersion(latestVersion);
      setDismissedVersion(latestVersion);
    }
  };

  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.container, style]}
      testID={testID ?? 'new-version-banner'}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.iconWrap}>
        <AppText style={styles.iconGlyph}>{'\u2728'}</AppText>
      </View>
      <AppText style={styles.message}>
        {t('app.newVersion.message', 'A new version of TeslaSync is available.')}
      </AppText>
      <View style={styles.actions}>
        <AppButton
          label={t('app.newVersion.later', 'Later')}
          onPress={handleLater}
          variant="ghost"
        />
        <AppButton
          label={t('app.newVersion.reload', 'Reload')}
          onPress={handleReload}
          variant="primary"
        />
      </View>
    </View>
  );
}

NewVersionBanner.displayName = 'NewVersionBanner';

export default NewVersionBanner;

const styles = StyleSheet.create({
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 0,
    gap: spacing.xs,
  },
  container: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.successBorder,
    borderRadius: 12,
    borderWidth: 1,
    bottom: 16,
    elevation: 8,
    flexDirection: 'row',
    gap: spacing.md,
    maxWidth: 384,
    paddingHorizontal: 16,
    paddingVertical: 12,
    position: 'absolute',
    right: 16,
    shadowColor: colors.success,
    shadowOffset: {width: 0, height: 8},
    shadowOpacity: 0.1,
    shadowRadius: 16,
    zIndex: 80,
  },
  iconGlyph: {
    color: colors.success,
    fontSize: 16,
    lineHeight: 20,
  },
  iconWrap: {
    backgroundColor: colors.successSurface,
    borderRadius: 8,
    flexShrink: 0,
    padding: 8,
  },
  message: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
});
