// Native parity port of web/src/components/feedback/ImpersonationBanner.tsx.
//
// Admin impersonation banner: a persistent security bar that surfaces whenever
// the active impersonation status (from the already-ported web-parity
// useImpersonationStatus hook) reports `mode === 'active'`. It shows the
// impersonated subject, the remaining cookie lifetime, and an "End
// impersonation" action. It is intentionally NOT dismissible — the security
// context must stay visible for the whole impersonation session. In open-mode
// installs the hook returns `{ mode: 'open' }` and the component renders
// nothing, exactly like the web original.
//
// Web -> native mapping notes:
//   - react-i18next useTranslation -> inlined useNativeTranslationFallback()
//     that returns the web fallback copy and reproduces i18next `{{name}}`
//     interpolation (used by the title `{{target}}` and the countdown
//     `{{time}}`), mirroring the established EditConflictBanner pattern.
//   - lucide-react UserCheck -> a decorative amber glyph badge. The shared
//     SemanticIcon `userCheck` glyph carries a success/green tone that would
//     clash with this amber security bar, so the icon is rendered as a small
//     warning-toned badge (bg-amber-300/20 + amber glyph) to preserve the
//     banner's amber visual intent. It is hidden from the accessibility tree
//     to match the web `aria-hidden` icon.
//   - The web `sticky top-0 z-[65] ... backdrop-blur-md` positioning is
//     browser-only layout; the native parent decides placement, so the bar is
//     a plain row with a bottom border (border-b) and the amber surface.
//   - The web `role="alert"` + `aria-live="polite"` live region is preserved as
//     an accessible polite alert group wrapping the title/body/countdown text.
//   - The `data-target` / `data-original-admin` debug attributes have no React
//     Native analogue (arbitrary data-* attributes are web-only) and are
//     dropped; the impersonated `target` is still rendered in the title copy and
//     e2e targeting uses the preserved testIDs. `original_admin` has no visible
//     or functional role on web (data attribute only), so it is not surfaced.

import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';
import {
  isImpersonationActive,
  useEndImpersonation,
  useImpersonationStatus,
} from '../../api/hooks/useImpersonation';

type NativeTOptions = Record<string, string | number>;

type NativeTFunction = (
  key: string,
  fallback: string,
  options?: NativeTOptions,
) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return React.useCallback(
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

/** Renders "MMm SSs" or "HHh MMm" depending on remaining magnitude. */
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

export function ImpersonationBanner(): React.ReactElement | null {
  const t = useNativeTranslationFallback();
  const {data} = useImpersonationStatus();
  const endMut = useEndImpersonation();
  const [now, setNow] = useState(() => Date.now());
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const expiresAt = data?.mode === 'active' ? data.expires_at : '';
  const expiresMs = useMemo(() => {
    if (!expiresAt) {
      return null;
    }
    const ts = Date.parse(expiresAt);
    return Number.isFinite(ts) ? ts : null;
  }, [expiresAt]);

  // Tick every second only while the banner is mounted; otherwise we'd churn
  // the entire app subtree once per second on every screen.
  useEffect(() => {
    if (data?.mode !== 'active' || expiresMs === null) {
      return;
    }
    tickRef.current = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
    };
  }, [data?.mode, expiresMs]);

  if (!isImpersonationActive(data)) {
    return null;
  }
  if (data?.mode !== 'active') {
    return null;
  }

  const target = data.target;

  let countdown: string | null = null;
  if (expiresMs !== null) {
    const remaining = expiresMs - now;
    if (remaining > 1000) {
      countdown = t('impersonation.banner.endsIn', 'Expires in {{time}}', {
        time: formatRemaining(remaining),
      });
    } else {
      countdown = t('impersonation.banner.expired', 'Session expired');
    }
  }

  const handleEnd = () => {
    endMut.mutate();
  };

  const title = t('impersonation.banner.title', 'Impersonating {{target}}', {
    target,
  });
  const body = t(
    'impersonation.banner.body',
    'You are viewing TeslaSync as another subject. End impersonation to restore your session.',
  );
  const endLabel = endMut.isPending
    ? t('impersonation.banner.ending', 'Ending…')
    : t('impersonation.banner.end', 'End impersonation');

  const a11yLabel = [title, body, countdown].filter(Boolean).join('. ');

  return (
    <View style={styles.banner} testID="impersonation-banner">
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.iconBadge}>
        <AppText style={styles.iconGlyph}>UC</AppText>
      </View>
      <View style={styles.content}>
        <View
          accessibilityLabel={a11yLabel}
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          accessible>
          <AppText style={styles.title} weight="semibold">
            {title}
          </AppText>
          <AppText style={styles.body}>{body}</AppText>
          {countdown ? (
            <AppText
              style={styles.countdown}
              testID="impersonation-banner-countdown">
              {countdown}
            </AppText>
          ) : null}
        </View>
      </View>
      <Pressable
        accessibilityLabel={endLabel}
        accessibilityRole="button"
        accessibilityState={{disabled: endMut.isPending}}
        disabled={endMut.isPending}
        onPress={handleEnd}
        style={({pressed}) => [
          styles.endButton,
          pressed && !endMut.isPending && styles.endButtonPressed,
          endMut.isPending && styles.endButtonDisabled,
        ]}
        testID="impersonation-banner-end">
        <AppText style={styles.endLabel} weight="semibold">
          {endLabel}
        </AppText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    alignItems: 'flex-start',
    backgroundColor: colors.warningSurface,
    borderBottomColor: colors.warningBorder,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  body: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  countdown: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  endButton: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(251, 191, 36, 0.08)',
    borderColor: colors.warningBorder,
    borderRadius: 10,
    borderWidth: 1,
    flexShrink: 0,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  endButtonDisabled: {
    opacity: 0.6,
  },
  endButtonPressed: {
    backgroundColor: 'rgba(251, 191, 36, 0.14)',
  },
  endLabel: {
    color: colors.warning,
    fontSize: 14,
    lineHeight: 18,
  },
  iconBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(251, 191, 36, 0.2)',
    borderRadius: 10,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  iconGlyph: {
    color: colors.warning,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
    lineHeight: 14,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 20,
  },
});

export default ImpersonationBanner;
