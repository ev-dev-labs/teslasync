// SystemPage — native parity port of
// web/src/features/admin/pages/SystemPage.tsx.
//
// Admin page that aggregates "infrastructure-budget" panels — starting with
// RateLimitStatusPanel + QueueStatusPanel. Sibling system pages
// (SystemStatusPage, ApiLogsPage, DiagnosticPage) already cover health, request
// logs, and self-test; this page is focused on the "how close are we to throttle
// limits / how deep are the worker queues" question that previously had no
// surface.
//
// Route wiring lives in the native navigation manifest (web: App.tsx +
// routeRegistry.ts). SYSTEM_PAGE_PATH is preserved verbatim so the same
// nav-entry pattern as the Diagnostic page can register new system panels.
//
// Native adaptations vs. the web source (behavior/state/keys/intent kept):
//   - web `@/components/layout` `PageContainer` (title/subtitle header — this
//     page passes no loading/error/empty/query props) -> an inline RN
//     PageScaffold: a ScrollView with the same t() title + subtitle header.
//   - web `@/components/layout` `Stack` (className="gap-6", flex-col) -> a
//     vertically-gapped RN View carrying the same data-testid -> testID
//     "system-page-stack".
//   - web `@/components/motion` `FadeIn` (framer-motion) -> an inline RN Animated
//     FadeIn (fade + slide-up, reduced-motion aware via AccessibilityInfo).
//   - web `@/hooks/usePageTitle` (writes document.title) -> a native-safe no-op
//     hook preserving the call site + argument.
//   - react-i18next `useTranslation` -> a native-safe t(key, fallback) fallback
//     preserving every system.page.* key and the English defaults.
//   - the two child panels are imported from the native parity tree exactly like
//     the web siblings: `../components/RateLimitStatusPanel` and
//     `../components/QueueStatusPanel`.

import React, {
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';
import {QueueStatusPanel} from '../components/QueueStatusPanel';
import {RateLimitStatusPanel} from '../components/RateLimitStatusPanel';

// ---- Native-safe i18n fallback (web react-i18next useTranslation) -----------

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallback) => fallback, []);
}

// ---- Native-safe usePageTitle (web @/hooks/usePageTitle) --------------------

/**
 * Web `usePageTitle` writes `"{title} — TeslaSync"` to `document.title`. React
 * Native has no browser tab / document title, so this is a no-op that preserves
 * the call site and argument.
 */
function usePageTitle(title: string): void {
  useEffect(() => {
    // React Native has no browser tab / document.title to write; this hook is
    // intentionally a no-op. The `title` dependency mirrors the web hook so the
    // effect re-runs on title changes.
  }, [title]);
}

// ---- Inline FadeIn (web motion FadeIn — framer-motion) ----------------------

function FadeIn({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then(reduce => {
        if (cancelled) {
          return;
        }
        if (reduce) {
          progress.setValue(1);
          return;
        }
        Animated.timing(progress, {
          duration: 400,
          easing: Easing.out(Easing.ease),
          toValue: 1,
          useNativeDriver: true,
        }).start();
      })
      .catch(() => progress.setValue(1));
    return () => {
      cancelled = true;
    };
  }, [progress]);

  return (
    <Animated.View
      style={[
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [12, 0],
              }),
            },
          ],
        },
        style,
      ]}>
      {children}
    </Animated.View>
  );
}

// ---- Page scaffold (web layout PageContainer) -------------------------------

function PageScaffold({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}): React.ReactElement {
  return (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      style={styles.scroll}>
      <View style={styles.pageHeaderText}>
        <AppText style={styles.pageTitle} variant="display" weight="bold">
          {title}
        </AppText>
        <AppText style={styles.pageSubtitle} tone="muted" variant="caption">
          {subtitle}
        </AppText>
      </View>
      {children}
    </ScrollView>
  );
}

// ---- Page --------------------------------------------------------------------

export const SYSTEM_PAGE_PATH = '/admin/system';

export default function SystemPage(): React.ReactElement {
  const t = useNativeTranslationFallback();
  const title = t('system.page.title', 'System budgets');
  usePageTitle(title);

  return (
    <PageScaffold
      subtitle={t(
        'system.page.subtitle',
        'Operator dashboard for the throttles and budgets that bound this TeslaSync deployment.',
      )}
      title={title}>
      <FadeIn>
        <View style={styles.stack} testID="system-page-stack">
          <RateLimitStatusPanel />
          <QueueStatusPanel />
        </View>
      </FadeIn>
    </PageScaffold>
  );
}

const styles = StyleSheet.create({
  pageHeaderText: {
    gap: spacing.xs,
  },
  pageSubtitle: {
    color: colors.textMuted,
  },
  pageTitle: {
    color: colors.textPrimary,
  },
  scroll: {
    backgroundColor: colors.background,
    flex: 1,
  },
  scrollContent: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  stack: {
    gap: spacing.lg,
  },
});
