// Native parity port of web/src/components/feedback/PageErrorBoundary.tsx.
//
// The web component is a thin wrapper that delegates to
// web/src/components/feedback/ErrorBoundary.tsx for its full-page fallback UI
// (icon + retry + go-home), mounting it with `name={`page:${pageName}`}` so a
// captured error stays correlated to a specific page in logs. That
// ErrorBoundary has not been ported into the native parity tree yet and this
// conversion is scoped to a single file, so the page-level boundary is
// reproduced here as a self-contained React error boundary — the same
// self-contained pattern ChartContainer uses for its NativeSectionErrorBoundary.
//
// Behaviour preserved from the web ErrorBoundary full-page path this wrapper
// relies on:
//   - Render errors are caught via getDerivedStateFromError + componentDidCatch.
//   - componentDidCatch emits the structured `[ErrorBoundary:page:{pageName}]`
//     console.error log (the `name` correlation the web wrapper sets).
//   - Network-style errors (message contains fetch/network/offline/Failed to
//     fetch) render the WifiOff branch ("Connection Lost"); everything else
//     renders the AlertTriangle branch ("Something went wrong").
//   - "Try Again" resets the boundary and bumps retryCount; after >= 3 retries
//     the button reads "Try Again Anyway" and the extra warning copy shows.
//   - The current retry attempt count is surfaced once retryCount > 0.
//
// Browser-only behaviour is replaced with native-safe equivalents (mapped
// line-by-line in the .parity.json sidecar):
//   - lucide-react icons (AlertTriangle/WifiOff/RefreshCw/Home) -> tinted glyph
//     badge / text labels.
//   - `../ui/Button` -> internal Pressable actions.
//   - `@/lib/errorReporter` reportFrontendError -> web-only, not ported; the
//     console.error observability log is kept.
//   - i18next `i18n.t` chunk-load copy + the stale-chunk
//     `window.location.reload()` recovery -> browser code-splitting concern with
//     no native analogue; dropped, so "Retry" always resets the boundary
//     in-place.
//   - `window.location.href = '/'` go-home redirect -> an optional `onGoHome`
//     navigation bridge prop the native shell can wire to its router.

import React, {type ReactNode} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';

// Substring checks copied from the web ErrorBoundary network heuristic: a
// matching message routes to the offline/WifiOff branch.
const NETWORK_ERROR_HINTS = ['fetch', 'network', 'offline', 'Failed to fetch'];

interface PageErrorBoundaryProps {
  children: ReactNode;
  /** Page identifier for log correlation, e.g. "Battery Health". */
  pageName: string;
  /**
   * Native navigation bridge replacing the web `window.location.href = '/'`
   * go-home redirect. Invoked when the user taps "Go home"; when omitted the
   * action is hidden (there is no DOM location to fall back on natively).
   */
  onGoHome?: () => void;
  testID?: string;
}

interface PageErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  retryCount: number;
}

/**
 * Page-level error boundary. Wraps a full page so a render failure on one page
 * doesn't take down the surrounding shell (sidebar, top bar, route
 * navigation). Mounted automatically by `<PageContainer>`.
 *
 * Uses the full-page fallback UI ported from the web `ErrorBoundary`
 * (icon + retry + go-home).
 */
export class PageErrorBoundary extends React.Component<
  PageErrorBoundaryProps,
  PageErrorBoundaryState
> {
  state: PageErrorBoundaryState = {
    hasError: false,
    error: null,
    retryCount: 0,
  };

  static getDerivedStateFromError(
    error: Error,
  ): Partial<PageErrorBoundaryState> {
    return {hasError: true, error};
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Preserve the web `[ErrorBoundary:${name}]` structured log so a page
    // render failure stays correlated to its page (name = `page:${pageName}`).
    console.error(`[ErrorBoundary:page:${this.props.pageName}]`, {
      error: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
      retryCount: this.state.retryCount,
    });
  }

  private handleRetry = () => {
    this.setState(prev => ({
      hasError: false,
      error: null,
      retryCount: prev.retryCount + 1,
    }));
  };

  private isNetworkError(error: Error | null): boolean {
    const message = error?.message ?? '';
    return NETWORK_ERROR_HINTS.some(hint => message.includes(hint));
  }

  render(): ReactNode {
    const {children, onGoHome, testID} = this.props;
    const {hasError, error, retryCount} = this.state;

    if (!hasError) {
      return children;
    }

    const isNetworkError = this.isNetworkError(error);
    const tooManyRetries = retryCount >= 3;

    return (
      <View accessibilityRole="alert" style={styles.container} testID={testID}>
        <View style={styles.card}>
          <View style={styles.iconBadge}>
            <AppText style={styles.iconGlyph} weight="bold">
              {isNetworkError ? 'WX' : '!'}
            </AppText>
          </View>
          <AppText style={styles.title} variant="title" weight="bold">
            {isNetworkError ? 'Connection Lost' : 'Something went wrong'}
          </AppText>
          <AppText style={styles.message} variant="caption">
            {isNetworkError
              ? 'Unable to reach the server. Check your connection and try again.'
              : error?.message ||
                'An unexpected error occurred. Please try again.'}
          </AppText>
          {tooManyRetries ? (
            <AppText style={styles.warning} variant="caption">
              Multiple retries failed. Try refreshing or checking system status.
            </AppText>
          ) : null}
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              hitSlop={8}
              onPress={this.handleRetry}
              style={({pressed}) => [
                styles.button,
                styles.buttonPrimary,
                pressed && styles.buttonPrimaryPressed,
              ]}
              testID="page-error-retry">
              <AppText style={styles.buttonPrimaryText} weight="semibold">
                {tooManyRetries ? 'Try Again Anyway' : 'Try Again'}
              </AppText>
            </Pressable>
            {onGoHome ? (
              <Pressable
                accessibilityRole="button"
                hitSlop={8}
                onPress={onGoHome}
                style={({pressed}) => [
                  styles.button,
                  styles.buttonSecondary,
                  pressed && styles.buttonSecondaryPressed,
                ]}
                testID="page-error-go-home">
                <AppText style={styles.buttonSecondaryText} weight="semibold">
                  Go Home
                </AppText>
              </Pressable>
            ) : null}
          </View>
          {retryCount > 0 ? (
            <AppText style={styles.attempt} variant="caption">
              {`Retry attempt ${retryCount}`}
            </AppText>
          ) : null}
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  attempt: {
    color: colors.textMuted,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  button: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.lg,
  },
  buttonPrimary: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  buttonPrimaryPressed: {
    backgroundColor: colors.accentGlow,
  },
  buttonPrimaryText: {
    color: colors.accent,
  },
  buttonSecondary: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
  buttonSecondaryPressed: {
    backgroundColor: colors.surfaceHover,
  },
  buttonSecondaryText: {
    color: colors.textSecondary,
  },
  card: {
    alignItems: 'center',
    maxWidth: 420,
  },
  container: {
    alignItems: 'center',
    flexGrow: 1,
    justifyContent: 'center',
    minHeight: 400,
    padding: spacing.xl,
  },
  iconBadge: {
    alignItems: 'center',
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderRadius: 18,
    borderWidth: 1,
    height: 64,
    justifyContent: 'center',
    marginBottom: spacing.md,
    width: 64,
  },
  iconGlyph: {
    color: colors.danger,
    fontSize: 22,
    letterSpacing: 0.5,
    lineHeight: 28,
  },
  message: {
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  title: {
    color: colors.textPrimary,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  warning: {
    color: colors.textMuted,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
});
