// Native parity port of web/src/components/feedback/MaintenanceBanner.tsx.
//
// Maintenance / degraded-mode banner.
//
// Polls /api/v1/system/health (via useSystemHealth) on the standard interval
// and renders a top-of-app banner when the resolved service mode is "degraded"
// or "maintenance". The banner includes a live countdown to `maintenance_until`
// so users know when the window is expected to end.
//
// Dismissal is per-snapshot, keyed on `maintenance_updated_at` (or a
// deterministic fingerprint of mode/message/until when updated_at is absent):
//   - A user who dismisses once stays dismissed for THAT specific banner state.
//   - An operator who pushes a NEW banner (different message, different end-time,
//     or even the same mode after a clear -> re-set cycle) re-surfaces the banner,
//     so the dismissal does not silently swallow a fresh announcement.
//
// Native adaptations (each reduction documented in the .parity.json sidecar):
//   - useSystemHealth: imported from the native ../../api/hooks/useAdmin port,
//     which already exposes mode / maintenance_message / maintenance_until /
//     maintenance_updated_at on SystemHealth.
//   - window.sessionStorage: React Native has no Web Storage API. The web banner
//     uses sessionStorage (not localStorage) purely so a closed-and-reopened tab
//     starts fresh while a single session keeps a dismissal sticky. The native
//     analog of "this tab/session" is the running JS runtime, so the dismissal is
//     kept in a module-level Map keyed by the same SESSION_DISMISS_KEY constant.
//     Reads/writes stay synchronous (the web code reads storage in a useState
//     initializer) and reset on a cold app start, mirroring the web semantics.
//   - lucide-react Wrench / AlertTriangle / X: no SVG icon library in native, so
//     each renders as a monochrome decorative AppText glyph that inherits the
//     banner tone colour (Wrench -> gear, AlertTriangle -> warning sign, X -> ✕),
//     marked importantForAccessibility="no" to mirror the web `aria-hidden`.
//   - <div role="alert|status" aria-live="polite">: View with accessibilityRole
//     (alert for maintenance, summary for the degraded "status" role which has no
//     native equivalent) + accessibilityLiveRegion="polite" + accessible.
//   - data-testid -> testID; data-mode -> accessibilityValue={{ text: mode }}
//     since RN has no arbitrary data-* attribute.
//   - Tailwind sticky/top-0/z-[60]/backdrop-blur-md have no RN equivalents; the
//     banner renders in normal flow and the host layout decides placement. The
//     amber tone maps to the warning token ramp and the sky tone to the accent
//     token ramp (the closest existing native tokens).

import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {useSystemHealth} from '../../api/hooks/useAdmin';
import {AppText} from '../../../components/ui/AppText';
import {colors, spacing, typography} from '../../../theme/tokens';

type NativeTParams = Record<string, string | number>;

type NativeTFunction = (
  key: string,
  fallback: string,
  params?: NativeTParams,
) => string;

/** Interpolates i18next-style `{{name}}` placeholders, mirroring t(key, def, opts). */
function interpolate(template: string, params?: NativeTParams): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback(
    (_key: string, fallback: string, params?: NativeTParams) =>
      interpolate(fallback, params),
    [],
  );
}

const SESSION_DISMISS_KEY = 'teslasync:maintenance-dismissed-for';

// Native stand-in for window.sessionStorage: a module-level store that lives for
// the app process and resets on cold start, mirroring the "closed-and-reopened
// tab starts fresh" intent of the web sessionStorage usage.
const sessionDismissStore = new Map<string, string>();

/** Returns the dismissal-fingerprint for the supplied snapshot. */
function fingerprint(
  mode: string,
  message: string,
  until: string,
  updatedAt: string,
): string {
  if (updatedAt) {
    return `u:${updatedAt}`;
  }
  return `s:${mode}|${message}|${until}`;
}

function readDismissedKey(): string | null {
  try {
    return sessionDismissStore.get(SESSION_DISMISS_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeDismissedKey(key: string) {
  try {
    sessionDismissStore.set(SESSION_DISMISS_KEY, key);
  } catch {
    /* mirror the web try/catch (private mode / quota) — in-memory dismissal still works */
  }
}

/** Renders "Hh Mm Ss" (zero-padded short form). */
function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  }
  return `${seconds}s`;
}

type BannerTone = 'amber' | 'sky';

export function MaintenanceBanner() {
  const t = useNativeTranslationFallback();
  const {data} = useSystemHealth();
  const [dismissedKey, setDismissedKey] = useState<string | null>(() =>
    readDismissedKey(),
  );
  const [now, setNow] = useState(() => Date.now());
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const mode = data?.mode ?? 'ok';
  const message = data?.maintenance_message ?? '';
  const until = data?.maintenance_until ?? '';
  const updatedAt = data?.maintenance_updated_at ?? '';

  const currentKey = useMemo(
    () => fingerprint(mode, message, until, updatedAt),
    [mode, message, until, updatedAt],
  );

  const untilMs = useMemo(() => {
    if (!until) {
      return null;
    }
    const parsed = Date.parse(until);
    return Number.isFinite(parsed) ? parsed : null;
  }, [until]);

  // Reset stale dismissal whenever the upstream snapshot changes —
  // keeps the operator's "I just pushed a new banner" workflow honest.
  useEffect(() => {
    if (dismissedKey && dismissedKey !== currentKey) {
      setDismissedKey(null);
    }
  }, [currentKey, dismissedKey]);

  // Tick every second only while the countdown is mounted; otherwise
  // we'd churn the whole subtree once per second on every page load.
  useEffect(() => {
    if (mode === 'ok' || untilMs === null) {
      return;
    }
    tickRef.current = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
    };
  }, [mode, untilMs]);

  if (!data || mode === 'ok') {
    return null;
  }
  if (dismissedKey === currentKey) {
    return null;
  }

  const isMaintenance = mode === 'maintenance';
  const iconGlyph = isMaintenance ? '\u2699' : '\u26A0';
  const tone: BannerTone = isMaintenance ? 'amber' : 'sky';

  const title = isMaintenance
    ? t('serviceMode.banner.maintenanceTitle', 'Scheduled maintenance')
    : t('serviceMode.banner.degradedTitle', 'Service is degraded');

  const body =
    message.trim() ||
    (isMaintenance
      ? t(
          'serviceMode.banner.defaultMaintenance',
          'Maintenance is in progress. Live data may be paused.',
        )
      : t(
          'serviceMode.banner.defaultDegraded',
          'Some features may be slow or unavailable while we work on it.',
        ));

  let countdown: string | null = null;
  if (untilMs !== null) {
    const remaining = untilMs - now;
    if (remaining > 1000) {
      countdown = t('serviceMode.banner.endsIn', 'Ends in {{time}}', {
        time: formatRemaining(remaining),
      });
    } else if (remaining > -1000) {
      countdown = t('serviceMode.banner.endingNow', 'Ending now');
    } else {
      countdown = t(
        'serviceMode.banner.ended',
        'Window has ended; refresh to confirm.',
      );
    }
  }

  const handleDismiss = () => {
    writeDismissedKey(currentKey);
    setDismissedKey(currentKey);
  };

  // Tone colours are kept on dedicated StyleSheet entries rather than a clsx
  // call so the bundle stays free of the ternary helper.
  const toneContainer = tone === 'amber' ? styles.amberContainer : styles.skyContainer;
  const toneIconBox = tone === 'amber' ? styles.amberIconBox : styles.skyIconBox;
  const toneIconText = tone === 'amber' ? styles.amberIconText : styles.skyIconText;

  return (
    <View
      accessibilityRole={isMaintenance ? 'alert' : 'summary'}
      accessibilityLiveRegion="polite"
      accessibilityValue={{text: mode}}
      accessible
      testID="maintenance-banner"
      style={[styles.container, toneContainer]}>
      <View style={[styles.iconBox, toneIconBox]}>
        <AppText
          importantForAccessibility="no"
          style={[styles.iconText, toneIconText]}
          weight="bold">
          {iconGlyph}
        </AppText>
      </View>
      <View style={styles.content}>
        <AppText style={styles.title} weight="semibold">
          {title}
        </AppText>
        <AppText style={styles.body} tone="secondary">
          {body}
        </AppText>
        {countdown ? (
          <AppText
            style={styles.countdown}
            testID="maintenance-banner-countdown"
            tone="muted">
            {countdown}
          </AppText>
        ) : null}
      </View>
      <Pressable
        accessibilityLabel={t('common.dismiss', 'Dismiss')}
        accessibilityRole="button"
        onPress={handleDismiss}
        style={({pressed}) => [styles.dismissButton, pressed && styles.dismissPressed]}
        testID="maintenance-banner-dismiss">
        <AppText
          importantForAccessibility="no"
          style={styles.dismissText}
          weight="bold">
          {'\u2715'}
        </AppText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    fontSize: 14,
    lineHeight: 20,
  },
  container: {
    alignItems: 'flex-start',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  countdown: {
    fontSize: typography.caption,
    lineHeight: 16,
    marginTop: 2,
  },
  dismissButton: {
    alignItems: 'center',
    borderRadius: 8,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  dismissPressed: {
    backgroundColor: colors.surfaceHover,
  },
  dismissText: {
    color: colors.textSecondary,
    fontSize: 16,
    lineHeight: 18,
  },
  iconBox: {
    alignItems: 'center',
    borderRadius: 8,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  iconText: {
    fontSize: 16,
    lineHeight: 18,
  },
  title: {
    fontSize: 14,
    lineHeight: 20,
  },
  amberContainer: {
    backgroundColor: colors.warningSurface,
    borderBottomColor: colors.warningBorder,
  },
  skyContainer: {
    backgroundColor: colors.accentSoft,
    borderBottomColor: colors.borderAccent,
  },
  amberIconBox: {
    backgroundColor: colors.warningSurface,
  },
  skyIconBox: {
    backgroundColor: colors.accentSoft,
  },
  amberIconText: {
    color: colors.warning,
  },
  skyIconText: {
    color: colors.accent,
  },
});

export default MaintenanceBanner;
