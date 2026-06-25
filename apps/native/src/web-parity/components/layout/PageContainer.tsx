// Native parity port of web/src/components/layout/PageContainer.tsx.
//
// Mirrors the web page shell: a title/subtitle header with an actions cluster
// (data-freshness chip + copy-link affordance + caller actions) above a body
// that switches between loading, error, empty, and content states. The content
// path is wrapped in a page-scoped error boundary so a single screen's render
// crash doesn't take down the surrounding native shell.
//
// Web-only pieces are reimplemented native-safe:
//  - `cn(...)` Tailwind class merging -> RN `style` prop (web `className` is kept
//    in the prop type for source compatibility but ignored on native).
//  - `<Spinner size="lg">` (brand SVG bolt) -> `<ActivityIndicator size="large">`.
//  - `<CopyLinkButton>` (window.location.href + navigator.clipboard) -> native-safe
//    button that preserves the affordance + i18n keys and surfaces an explicit
//    "unavailable" state, since a native runtime has no DOM URL or clipboard bind.
//  - `<PageErrorBoundary>` -> inlined class error boundary keeping the same
//    `page:{name}` log-correlation contract.

import React, {
  Component,
  useCallback,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';
import {useSetBreadcrumbOverrides} from './BreadcrumbOverridesContext';
import {DataFreshnessAuto, type FreshnessQuery} from '../data-display/DataFreshness';

// The `sm:` Tailwind breakpoint the web header collapses at (640px). Below this
// the header stacks (title over actions); at/above it the header is a row with
// actions pushed to the trailing edge.
const SM_BREAKPOINT = 640;

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

/**
 * Pick the most-degraded query in a list so the single page-tier badge
 * reflects the worst data state on the page.
 *
 * Priority: `error` > `stale` (incl. `forceStaleAfterMs`) > `fetching` >
 * `fresh`. A page that fans out into a hero query + a long-tail of cagg
 * queries can pass them all in and the chip will surface the one that
 * actually warrants attention.
 */
function pickWorstQuery(queries: readonly FreshnessQuery[]): FreshnessQuery {
  // queries.length is guaranteed >= 1 by the caller — we never invoke this
  // with an empty list, so non-null assertion on the fallback is safe.
  let worst = queries[0]!;
  let worstRank = -1;
  for (const q of queries) {
    const rank = q.isError ? 3 : q.isStale ? 2 : q.isFetching ? 1 : 0;
    if (rank > worstRank) {
      worst = q;
      worstRank = rank;
    }
  }
  return worst;
}

export interface PageContainerProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  loading?: boolean;
  error?: Error | null;
  empty?: boolean;
  emptyMessage?: string;
  /**
   * Per-render label overrides keyed by route pattern (e.g.
   * `{ '/drives/:id': 'Trip to office' }`). Pushed up to the global
   * shell breadcrumb via `BreadcrumbOverridesContext` so the single
   * top-of-page breadcrumb slot can show rich, friendly labels without
   * each screen rendering its own duplicate breadcrumb row.
   */
  breadcrumbLabels?: Partial<Record<string, string>>;
  children: ReactNode;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  /** Native style override for parity consumers. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
  /**
   * Show a "Copy link" button next to actions. On web this copies the current
   * URL; on native there is no shareable URL or clipboard binding, so the
   * affordance renders with an explicit unavailable state. Use on screens where
   * users would reasonably share a filtered view.
   */
  copyLink?: boolean;
  /**
   * When provided, renders `<DataFreshnessAuto>` in the header next to
   * `actions`. Pass either a single `useQuery()` result or an array; arrays
   * surface the most-degraded state via `pickWorstQuery` so a single chip can
   * stand in for the whole page.
   *
   * Pages that need finer control (e.g. `forceStaleAfterMs` for cagg-driven
   * data) should keep mounting `<DataFreshnessAuto>` directly via the
   * `actions` prop instead of using this convenience.
   */
  query?: FreshnessQuery | readonly FreshnessQuery[];
}

export function PageContainer({
  title,
  subtitle,
  actions,
  loading,
  error,
  empty,
  emptyMessage,
  breadcrumbLabels,
  children,
  className: _className,
  style,
  testID,
  copyLink,
  query,
}: PageContainerProps): React.ReactElement {
  // Push per-screen breadcrumb label overrides up to the global shell
  // breadcrumb. The shell reads from BreadcrumbOverridesContext and renders the
  // single canonical breadcrumb row, so PageContainer renders none of its own.
  useSetBreadcrumbOverrides(breadcrumbLabels);

  // Resolve the query prop into a single representative result. An empty
  // array is treated the same as `undefined` so callers can pass conditional
  // arrays without guarding at the call site.
  const resolvedQuery: FreshnessQuery | null = (() => {
    if (!query) {
      return null;
    }
    if (Array.isArray(query)) {
      return query.length > 0 ? pickWorstQuery(query) : null;
    }
    return query as FreshnessQuery;
  })();

  const {width} = useWindowDimensions();
  const wide = width >= SM_BREAKPOINT;
  const showActions = Boolean(actions || copyLink || resolvedQuery);

  return (
    <View style={[styles.root, style]} testID={testID}>
      <View style={[styles.header, wide ? styles.headerWide : styles.headerNarrow]}>
        <View style={[styles.titleBlock, wide ? styles.titleBlockWide : null]}>
          <AppText
            accessibilityRole="header"
            style={styles.title}
            variant="title"
            weight="bold">
            {title}
          </AppText>
          {subtitle ? (
            <AppText style={styles.subtitle} tone="muted">
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {showActions ? (
          <View
            style={[
              styles.actions,
              wide ? styles.actionsWide : styles.actionsNarrow,
            ]}>
            {resolvedQuery ? <DataFreshnessAuto query={resolvedQuery} /> : null}
            {copyLink ? <CopyLinkButton /> : null}
            {actions}
          </View>
        ) : null}
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : error ? (
        <View style={styles.errorBox}>
          <AppText style={styles.errorText}>{error.message}</AppText>
        </View>
      ) : empty ? (
        <View style={styles.empty}>
          <AppText style={styles.emptyText} tone="muted">
            {emptyMessage ?? `No ${title.toLowerCase()} found.`}
          </AppText>
        </View>
      ) : (
        <PageErrorBoundary pageName={title}>{children}</PageErrorBoundary>
      )}
    </View>
  );
}

PageContainer.displayName = 'PageContainer';

/**
 * Native-safe parity for the web `<CopyLinkButton>`. The web version copies
 * `window.location.href` to the clipboard; neither a shareable URL nor a
 * clipboard binding exists in this native runtime, so the affordance is kept
 * (same i18n keys) but pressing it surfaces an explicit unavailable hint.
 */
function CopyLinkButton(): React.ReactElement {
  const t = useNativeTranslationFallback();
  const [notified, setNotified] = useState(false);

  const handlePress = useCallback(() => {
    setNotified(true);
  }, []);

  const label = t('common.copyLink.action', 'Copy link');
  const hint = t(
    'common.copyLink.unavailable',
    'Link sharing is unavailable on this device',
  );

  return (
    <View style={styles.copyLinkWrap}>
      <Pressable
        accessibilityHint={notified ? hint : undefined}
        accessibilityLabel={t('common.copyLink.label', 'Copy link to this view')}
        accessibilityRole="button"
        hitSlop={8}
        onPress={handlePress}
        style={({pressed}) => [
          styles.copyLink,
          pressed ? styles.copyLinkPressed : null,
        ]}>
        <AppText style={styles.copyLinkText} variant="caption" weight="semibold">
          {label}
        </AppText>
      </Pressable>
      {notified ? (
        <AppText
          accessibilityLiveRegion="polite"
          style={styles.copyLinkHint}
          tone="muted"
          variant="caption">
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

interface PageErrorBoundaryProps {
  children: ReactNode;
  /** Page identifier for log correlation, e.g. "Battery Health". */
  pageName: string;
}

interface PageErrorBoundaryState {
  error: Error | null;
}

/**
 * Page-level error boundary. Wraps a full screen so a render failure on one
 * screen doesn't take down the surrounding native shell (tab bar, navigation).
 * Mounted automatically by `<PageContainer>`. Mirrors the web ErrorBoundary's
 * `page:{name}` log-correlation channel and retry affordance.
 */
class PageErrorBoundary extends Component<
  PageErrorBoundaryProps,
  PageErrorBoundaryState
> {
  state: PageErrorBoundaryState = {error: null};

  static getDerivedStateFromError(error: Error): PageErrorBoundaryState {
    return {error};
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(
      `page:${this.props.pageName} render failed`,
      error,
      info.componentStack,
    );
  }

  handleRetry = (): void => {
    this.setState({error: null});
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <PageErrorFallback error={this.state.error} onRetry={this.handleRetry} />
      );
    }
    return this.props.children;
  }
}

function PageErrorFallback({
  error,
  onRetry,
}: {
  error: Error;
  onRetry: () => void;
}): React.ReactElement {
  const t = useNativeTranslationFallback();

  return (
    <View accessibilityRole="alert" style={styles.boundary} testID="page-error-boundary">
      <AppText style={styles.boundaryTitle} weight="bold">
        {t('error.page.title', 'Something went wrong')}
      </AppText>
      <AppText style={styles.boundaryMessage} tone="secondary">
        {error.message || t('error.page.generic', 'This page failed to render.')}
      </AppText>
      <Pressable
        accessibilityLabel={t('error.page.retry', 'Try again')}
        accessibilityRole="button"
        onPress={onRetry}
        style={({pressed}) => [styles.retry, pressed ? styles.retryPressed : null]}>
        <AppText style={styles.retryText} weight="semibold">
          {t('error.page.retry', 'Try again')}
        </AppText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    maxWidth: '100%',
  },
  actionsNarrow: {
    justifyContent: 'flex-start',
  },
  actionsWide: {
    justifyContent: 'flex-end',
  },
  boundary: {
    alignItems: 'flex-start',
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderRadius: 16,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.lg,
  },
  boundaryMessage: {
    lineHeight: 20,
  },
  boundaryTitle: {
    color: colors.textPrimary,
  },
  copyLink: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 32,
    paddingHorizontal: spacing.md,
  },
  copyLinkHint: {
    maxWidth: 180,
  },
  copyLinkPressed: {
    opacity: 0.7,
  },
  copyLinkText: {
    color: colors.textPrimary,
  },
  copyLinkWrap: {
    alignItems: 'flex-start',
    gap: spacing.xs,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 64,
  },
  emptyText: {
    textAlign: 'center',
  },
  errorBox: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderRadius: 12,
    borderWidth: 1,
    padding: spacing.md,
  },
  errorText: {
    color: colors.danger,
    fontSize: 14,
    lineHeight: 20,
  },
  header: {
    gap: spacing.md,
  },
  headerNarrow: {
    flexDirection: 'column',
  },
  headerWide: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  loading: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
  },
  retry: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: spacing.lg,
  },
  retryPressed: {
    opacity: 0.82,
  },
  retryText: {
    color: colors.textPrimary,
  },
  root: {
    gap: 24,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
  },
  title: {
    color: colors.textPrimary,
    letterSpacing: -0.3,
  },
  titleBlock: {
    flexShrink: 1,
    gap: spacing.xs,
  },
  titleBlockWide: {
    flex: 1,
  },
});
