// Native parity port of web/src/components/feedback/SectionErrorBoundary.tsx.
//
// Wraps a section / widget / chart in an error boundary so a render failure
// inside it doesn't bubble up and blank out the whole page. The web source was a
// thin wrapper that delegated to the shared web <ErrorBoundary> class component
// (./ErrorBoundary) with one of three fallback strategies: a caller-supplied
// `fallback` node, a custom `fallbackTitle` card (lucide-react <AlertTriangle> +
// title + react-i18next subtitle), or the underlying ErrorBoundary's default
// `inline` UI (AlertTriangle + "Component failed to load" + the error message +
// a working Retry button). Copy came from react-i18next and the card chrome was
// Tailwind tesla-red utility classes on <div>/<p> elements.
//
// React error boundaries (getDerivedStateFromError / componentDidCatch) are a
// React feature, not a DOM feature, so they work unchanged on React Native. The
// web ./ErrorBoundary has no native parity port yet, so -- exactly like the repo
// already does in charts/ChartContainer.tsx (its private NativeSectionError-
// Boundary) and how _ErrorState/DraftRecoveryBanner/LiveStaleDataBanner recreate
// their un-ported web dependencies inline -- this file inlines a self-contained
// native error boundary that mirrors the subset of ErrorBoundary that
// SectionErrorBoundary actually uses (the `name` log handle, the `fallback`
// override, and the `inline` default card with Retry). The DOM-only recovery
// paths of the full web ErrorBoundary (window.location.reload, sessionStorage
// chunk-reload throttling, ChunkLoadError detection, the full-page non-inline
// UI, and the @/lib/errorReporter call) are browser concepts with no native
// equivalent and are intentionally not ported here -- documented in the sidecar.
//
// All chrome is rebuilt with React Native View/Pressable/AppText primitives, the
// SemanticIcon warning glyph (lucide AlertTriangle's design-system equivalent),
// and the design tokens -- no DOM, no lucide-react, no recharts/leaflet, and no
// web UI components.

import React, {
  Component,
  useCallback,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {SemanticIcon} from '../../../components/icons/SemanticIcon';
import {AppText} from '../../../components/ui/AppText';
import {colors, spacing, typography} from '../../../theme/tokens';

type NativeTFunction = (key: string, fallback: string) => string;

// tesla-red (#e31937 = rgb(227, 25, 55)) is the web card hue. The Tailwind ramp
// used border-tesla-red/20 + bg-tesla-red/5 for the card and text-tesla-red for
// the icon. The shared token set exposes a rose danger hue (colors.danger) but
// not the exact tesla-red brand stops, so the card translucency is recreated
// here from the tesla-red channels (mirroring how _ErrorState recreates its
// rose-500 ramp); the icon keeps the SemanticIcon warning tone (see below).
const TESLA_RED_RGB = '227, 25, 55';
const CARD_BG = `rgba(${TESLA_RED_RGB}, 0.05)`;
const CARD_BORDER = `rgba(${TESLA_RED_RGB}, 0.2)`;

export interface SectionErrorBoundaryProps {
  children: ReactNode;
  /** Unique name for log correlation (e.g. "BatteryDegradationChart"). */
  name: string;
  /**
   * Custom inline title to show in the fallback. When omitted, the underlying
   * boundary's default inline UI (with a working Retry button) is used.
   */
  fallbackTitle?: string;
  /**
   * Override the entire fallback node -- useful when the boundary lives inside a
   * structural container where the default card would be the wrong shape. When
   * provided, no Retry button is shown.
   */
  fallback?: ReactNode;
}

/**
 * The web component read `t` from react-i18next. Native parity has no i18n
 * runtime wired yet, so this returns the English fallback string, preserving the
 * i18n key/fallback intent (`t('errors.section.subtitle', '...')`).
 */
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

interface NativeErrorBoundaryProps {
  children: ReactNode;
  /** Name for log correlation -- forwarded to the structured catch log + testID. */
  name?: string;
  /** When set, rendered verbatim on error instead of the default inline card. */
  fallback?: ReactNode;
  /** Render the compact inline card (the only non-fallback mode this wrapper uses). */
  inline?: boolean;
}

interface NativeErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  retryCount: number;
}

/**
 * Native-safe subset of web/src/components/feedback/ErrorBoundary.tsx -- only the
 * behaviour SectionErrorBoundary relies on: catch a render error, log it under
 * the boundary `name`, isolate the failure from siblings, render either the
 * caller's `fallback` or the default inline card, and offer a Retry that clears
 * the captured error. The web boundary's DOM-only chunk-reload recovery,
 * full-page UI, and errorReporter hand-off are not part of this surface.
 */
class NativeErrorBoundary extends Component<
  NativeErrorBoundaryProps,
  NativeErrorBoundaryState
> {
  state: NativeErrorBoundaryState = {
    hasError: false,
    error: null,
    retryCount: 0,
  };

  static getDerivedStateFromError(error: Error): Partial<NativeErrorBoundaryState> {
    return {hasError: true, error};
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Structured error log for observability, mirroring the web boundary's
    // `[ErrorBoundary:name]` correlation shape so failures stay greppable.
    console.error(
      `[ErrorBoundary${this.props.name ? `:${this.props.name}` : ''}]`,
      {
        error: error.message,
        stack: error.stack,
        componentStack: info.componentStack,
        retryCount: this.state.retryCount,
      },
    );
  }

  handleRetry = () => {
    this.setState(prev => ({
      hasError: false,
      error: null,
      retryCount: prev.retryCount + 1,
    }));
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback !== undefined) {
        return this.props.fallback;
      }

      return (
        <View
          accessibilityRole="alert"
          style={styles.card}
          testID={this.props.name ? `${this.props.name}-error` : undefined}>
          <View pointerEvents="none" style={styles.icon}>
            <SemanticIcon decorative name="warning" size="sm" />
          </View>
          <View style={styles.body}>
            <AppText style={styles.title}>Component failed to load</AppText>
            <AppText numberOfLines={1} style={styles.message}>
              {this.state.error?.message}
            </AppText>
          </View>
          <Pressable
            accessibilityLabel="Retry"
            accessibilityRole="button"
            hitSlop={8}
            onPress={this.handleRetry}
            style={({pressed}) => [styles.retry, pressed && styles.retryPressed]}>
            <AppText style={styles.retryText} weight="semibold">
              Retry
            </AppText>
          </Pressable>
        </View>
      );
    }

    return this.props.children;
  }
}

/**
 * `<SectionErrorBoundary>` -- wraps a section / widget / chart in an error
 * boundary so a render failure inside it doesn't bubble up and blank out the
 * whole page.
 *
 * Defaults to the inline card UI (with a Retry button); pass `fallbackTitle` for
 * a custom message or `fallback` to override the entire node (e.g. for a
 * structural placement where the default card would be the wrong shape).
 */
export function SectionErrorBoundary({
  children,
  name,
  fallbackTitle,
  fallback,
}: SectionErrorBoundaryProps) {
  const t = useNativeTranslationFallback();

  if (fallback !== undefined) {
    return (
      <NativeErrorBoundary name={name} fallback={fallback}>
        {children}
      </NativeErrorBoundary>
    );
  }

  if (fallbackTitle) {
    const titleFallback = (
      <View
        accessibilityRole="alert"
        style={styles.card}
        testID={`${name}-error`}>
        <View pointerEvents="none" style={styles.icon}>
          <SemanticIcon decorative name="warning" size="sm" />
        </View>
        <View style={styles.body}>
          <AppText style={styles.title}>{fallbackTitle}</AppText>
          <AppText style={styles.message}>
            {t(
              'errors.section.subtitle',
              'Other parts of the page should still work.',
            )}
          </AppText>
        </View>
      </View>
    );
    return (
      <NativeErrorBoundary name={name} fallback={titleFallback}>
        {children}
      </NativeErrorBoundary>
    );
  }

  return (
    <NativeErrorBoundary name={name} inline>
      {children}
    </NativeErrorBoundary>
  );
}

SectionErrorBoundary.displayName = 'SectionErrorBoundary';

const styles = StyleSheet.create({
  body: {
    flex: 1,
    minWidth: 0,
  },
  card: {
    alignItems: 'center',
    backgroundColor: CARD_BG,
    borderColor: CARD_BORDER,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: 16,
  },
  icon: {
    flexShrink: 0,
  },
  message: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  retry: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderRadius: 8,
    flexShrink: 0,
    justifyContent: 'center',
    minHeight: 32,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  retryPressed: {
    opacity: 0.7,
  },
  retryText: {
    color: colors.textPrimary,
    fontSize: typography.caption,
  },
  title: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
});
