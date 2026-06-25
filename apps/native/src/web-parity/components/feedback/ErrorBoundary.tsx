// Native parity port of web/src/components/feedback/ErrorBoundary.tsx.
//
// A React error boundary that catches render-time crashes in its subtree and
// shows a recovery surface. Every web behavior is preserved:
//
//   - Props: children, fallback, inline, name, resetKey.
//   - State: hasError, error, retryCount, lastResetKey.
//   - getDerivedStateFromError / getDerivedStateFromProps (resetKey-driven
//     auto-reset on route change) / componentDidCatch / isChunkLoadError /
//     handleRetry / render — same control flow, same string copy, same
//     network-vs-chunk-vs-generic branching and the >=3 "too many retries"
//     gate.
//
// Native-safe substitutions (documented in the parity sidecar):
//   - lucide-react icons (AlertTriangle / WifiOff / RefreshCw / Home) become
//     glyph AppText markers inside themed chips/buttons.
//   - The web ../ui/Button becomes a local Pressable-based ActionButton.
//   - i18n.t(key, fallback) becomes nativeT(key, fallback) so the one
//     translated string (error.chunkLoad.body) keeps its key + English copy
//     without bundling the web i18n runtime.
//   - @/lib/errorReporter#reportFrontendError POSTs to /api/v1/web-errors via
//     browser fetch/window/navigator; native keeps the best-effort,
//     never-throws "capture before recovery" contract via an in-process ring.
//     Wire-shipping to the backend endpoint is intentionally unavailable here.
//   - The sessionStorage chunk-reload throttle becomes an in-process timestamp
//     (cross-restart persistence intentionally unavailable). window.setTimeout
//     -> setTimeout. window.location.reload() / window.location.href = '/'
//     have no native bundle-asset / global-navigator equivalent, so they clear
//     the captured error to re-render children (reloadApp / goHome).

import React, {Component, type ErrorInfo, type ReactNode} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing, typography} from '../../../theme/tokens';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  /** If true, show a more compact inline error instead of full-page */
  inline?: boolean;
  /** Optional name for logging which boundary caught the error */
  name?: string;
  /**
   * When this value changes between renders, the boundary clears any
   * captured error and re-renders children. Pass the active route key to
   * auto-reset on route change without unmounting/remounting.
   */
  resetKey?: string | number;
}

interface State {
  hasError: boolean;
  error: Error | null;
  retryCount: number;
  lastResetKey: string | number | undefined;
}

// ── Native-safe error reporter ──────────────────────────────────────────────
// The web @/lib/errorReporter ships captured errors to /api/v1/web-errors via
// browser fetch + window + navigator. Native parity keeps the public contract
// that matters to this boundary — capture BEFORE recovery, never throw — by
// retaining the most-recent reports in an in-process ring. Backend wire
// delivery is intentionally unavailable here.

type ErrorSource = 'react';

interface CapturedReport {
  name: string;
  message: string;
  stack?: string;
  source: ErrorSource;
  occurredAt: string;
}

const FEEDBACK_RING_SIZE = 10;
const capturedReports: CapturedReport[] = [];

function reportFrontendError(err: unknown, source: ErrorSource): void {
  try {
    const name = err instanceof Error && err.name ? err.name : 'Error';
    const message = err instanceof Error ? err.message || String(err) : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    capturedReports.push({name, message, stack, source, occurredAt: new Date().toISOString()});
    if (capturedReports.length > FEEDBACK_RING_SIZE) {
      capturedReports.splice(0, capturedReports.length - FEEDBACK_RING_SIZE);
    }
  } catch {
    // swallow — telemetry must never throw into its caller
  }
}

// ── Native-safe i18n fallback ───────────────────────────────────────────────
// The web component calls i18n.t(key, fallback) once. Native renders the
// fallback copy directly so i18n intent is preserved without the web runtime.
function nativeT(_key: string, fallback: string): string {
  return fallback;
}

// Stale-chunk reload throttle. The web component persists this per-tab in
// sessionStorage ('teslasync-chunk-reload'); native has no sessionStorage, so
// an in-process timestamp throttles per app process. Cross-restart persistence
// is intentionally unavailable.
const CHUNK_RELOAD_THROTTLE_MS = 60_000;
const CHUNK_RELOAD_GRACE_MS = 5_000;
let lastChunkReloadAt: number | null = null;

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      retryCount: 0,
      lastResetKey: props.resetKey,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {hasError: true, error};
  }

  static getDerivedStateFromProps(nextProps: Props, prevState: State): Partial<State> | null {
    if (nextProps.resetKey === prevState.lastResetKey) {
      return null;
    }
    if (prevState.hasError) {
      return {
        hasError: false,
        error: null,
        lastResetKey: nextProps.resetKey,
      };
    }
    return {lastResetKey: nextProps.resetKey};
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Forward the captured error to the reporter BEFORE any recovery logic so
    // it is retained even if the reload below tears the subtree down.
    reportFrontendError(error, 'react');

    // Log structured error for observability
    console.error(`[ErrorBoundary${this.props.name ? `:${this.props.name}` : ''}]`, {
      error: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
      retryCount: this.state.retryCount,
    });

    // Stale-chunk recovery.
    //
    // On web a ChunkLoadError almost always means the server redeployed and the
    // hashed asset the SPA tried to fetch no longer exists; the safety net waits
    // 5 s (long enough for the proactive NewVersionBanner / user to act) then
    // forces a reload, throttled to once per 60 s to defeat reload loops.
    //
    // A native bundle has no hashed chunks, so this branch is effectively inert
    // at runtime, but the logic is ported faithfully: native reloadApp() clears
    // the captured error to re-render children. The throttle uses an in-process
    // timestamp (no sessionStorage), so it cannot throw — the web try/catch that
    // guarded sessionStorage quota errors is therefore unnecessary here.
    if (this.isChunkLoadError(error)) {
      const now = Date.now();
      if (lastChunkReloadAt === null || now - lastChunkReloadAt > CHUNK_RELOAD_THROTTLE_MS) {
        lastChunkReloadAt = now;
        setTimeout(() => {
          // Re-check after the grace period — the user may have already retried
          // the boundary or navigated to a fresh route, in which case we MUST
          // NOT yank them back to a hard reset.
          if (this.state.hasError) {
            console.warn(
              '[ErrorBoundary] Chunk load error not user-resolved within 5 s — forcing reload',
            );
            this.reloadApp();
          }
        }, CHUNK_RELOAD_GRACE_MS);
      }
    }
  }

  private isChunkLoadError(error: Error): boolean {
    const msg = error.message?.toLowerCase() ?? '';
    return (
      error.name === 'ChunkLoadError' ||
      msg.includes('loading chunk') ||
      msg.includes('loading css chunk') ||
      msg.includes('dynamically imported module') ||
      msg.includes('failed to fetch dynamically imported module')
    );
  }

  // Native-safe replacement for window.location.reload(). The web reload
  // fetches fresh hashed assets after a redeploy; a native bundle has no such
  // assets, so the closest recovery is to clear the captured error and
  // re-render children.
  private reloadApp = () => {
    this.setState({hasError: false, error: null});
  };

  // Native-safe replacement for window.location.href = '/'. This leaf boundary
  // has no native navigator handle, so "Go Home" clears the error state to
  // return the user to rendered app content as a fresh start.
  private goHome = () => {
    this.setState({hasError: false, error: null, retryCount: 0});
  };

  handleRetry = () => {
    // For chunk errors, do a full reset to get a fresh subtree
    if (this.state.error && this.isChunkLoadError(this.state.error)) {
      this.reloadApp();
      return;
    }
    this.setState(prev => ({
      hasError: false,
      error: null,
      retryCount: prev.retryCount + 1,
    }));
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const isNetworkError =
        this.state.error?.message?.includes('fetch') ||
        this.state.error?.message?.includes('network') ||
        this.state.error?.message?.includes('offline') ||
        this.state.error?.message?.includes('Failed to fetch');

      const isChunkError = this.state.error ? this.isChunkLoadError(this.state.error) : false;

      const tooManyRetries = this.state.retryCount >= 3;

      if (this.props.inline) {
        return (
          <View accessibilityRole="alert" style={styles.inlineRoot} testID="error-boundary-inline">
            <View pointerEvents="none" style={styles.inlineIcon}>
              <AppText style={styles.inlineIconGlyph} weight="bold">
                ⚠
              </AppText>
            </View>
            <View style={styles.inlineCopy}>
              <AppText style={styles.inlineTitle} variant="caption" weight="semibold">
                Component failed to load
              </AppText>
              <AppText numberOfLines={1} style={styles.inlineMessage} variant="caption">
                {this.state.error?.message}
              </AppText>
            </View>
            <ActionButton
              compact
              glyph="↻"
              label="Retry"
              onPress={this.handleRetry}
              variant="secondary"
            />
          </View>
        );
      }

      return (
        <View accessibilityRole="alert" style={styles.pageRoot} testID="error-boundary-page">
          <View style={styles.pageCard}>
            <View pointerEvents="none" style={styles.pageIconChip}>
              <AppText style={styles.pageIconGlyph} weight="bold">
                {isNetworkError ? '⊘' : '⚠'}
              </AppText>
            </View>
            <AppText style={styles.pageTitle} variant="title" weight="bold">
              {isChunkError
                ? 'New Version Deployed'
                : isNetworkError
                ? 'Connection Lost'
                : 'Something went wrong'}
            </AppText>
            <AppText style={styles.pageBody} variant="caption">
              {isChunkError
                ? nativeT(
                    'error.chunkLoad.body',
                    'A new version was deployed. Click Reload to load the latest assets.',
                  )
                : isNetworkError
                ? 'Unable to reach the server. Check your connection and try again.'
                : this.state.error?.message || 'An unexpected error occurred. Please try again.'}
            </AppText>
            {tooManyRetries && (
              <AppText style={styles.pageNote} variant="caption">
                Multiple retries failed. Try refreshing the page or checking system status.
              </AppText>
            )}
            <View style={styles.pageActions}>
              <ActionButton
                glyph="↻"
                label={tooManyRetries ? 'Try Again Anyway' : 'Try Again'}
                onPress={this.handleRetry}
                variant="primary"
              />
              <ActionButton glyph="⌂" label="Go Home" onPress={this.goHome} variant="secondary" />
            </View>
            {this.state.retryCount > 0 && (
              <AppText style={styles.pageRetryCount} variant="caption">
                Retry attempt {this.state.retryCount}
              </AppText>
            )}
          </View>
        </View>
      );
    }

    return this.props.children;
  }
}

// ── Internal: glyph + label action button (native ../ui/Button parity) ───────

function ActionButton({
  compact = false,
  glyph,
  label,
  onPress,
  variant,
}: {
  compact?: boolean;
  glyph: string;
  label: string;
  onPress: () => void;
  variant: 'primary' | 'secondary';
}) {
  const isPrimary = variant === 'primary';
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({pressed}) => [
        styles.actionButton,
        compact && styles.actionButtonCompact,
        isPrimary ? styles.actionPrimary : styles.actionSecondary,
        pressed && styles.actionPressed,
      ]}>
      <AppText
        style={isPrimary ? styles.actionPrimaryGlyph : styles.actionSecondaryGlyph}
        weight="bold">
        {glyph}
      </AppText>
      <AppText
        style={isPrimary ? styles.actionPrimaryText : styles.actionSecondaryText}
        variant="caption"
        weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Inline (compact) variant
  inlineRoot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerSurface,
    padding: spacing.md,
  },
  inlineIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.dangerSurface,
  },
  inlineIconGlyph: {
    color: colors.danger,
    fontSize: typography.body,
  },
  inlineCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  inlineTitle: {
    color: colors.textSecondary,
  },
  inlineMessage: {
    color: colors.textMuted,
  },

  // Full-page variant
  pageRoot: {
    minHeight: 400,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  pageCard: {
    maxWidth: 420,
    alignItems: 'center',
  },
  pageIconChip: {
    marginBottom: spacing.lg,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerSurface,
    padding: spacing.lg,
  },
  pageIconGlyph: {
    color: colors.danger,
    fontSize: 28,
    lineHeight: 32,
  },
  pageTitle: {
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  pageBody: {
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  pageNote: {
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  pageActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  pageRetryCount: {
    color: colors.textMuted,
    marginTop: spacing.md,
    fontSize: 10,
  },

  // Action buttons
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: 44,
    borderRadius: 14,
    paddingHorizontal: spacing.lg,
  },
  actionButtonCompact: {
    minHeight: 34,
    paddingHorizontal: spacing.md,
    borderRadius: 12,
  },
  actionPrimary: {
    backgroundColor: colors.accent,
  },
  actionSecondary: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  actionPressed: {
    opacity: 0.82,
  },
  actionPrimaryGlyph: {
    color: colors.background,
    fontSize: typography.caption,
  },
  actionSecondaryGlyph: {
    color: colors.textPrimary,
    fontSize: typography.caption,
  },
  actionPrimaryText: {
    color: colors.background,
  },
  actionSecondaryText: {
    color: colors.textPrimary,
  },
});
