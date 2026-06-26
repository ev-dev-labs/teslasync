/**
 * DLQ Inspector Page — native parity port of
 * web/src/features/admin/pages/DLQInspectorPage.tsx.
 *
 * Operator surface for the Phase-tracing `/system/dlq*` routes. Reads the list
 * of dead-lettered payloads, lets an operator open any entry to view its raw +
 * inner payload, and replay it back to the original source topic. The replay
 * action is sudo-gated (handled transparently by the shared `request()` client)
 * and gated again at the server boundary by the `DLQ_REPLAY_ENABLED` env flag —
 * when disabled the page surfaces a persistent warning banner instead of a
 * useless "Replay" button.
 *
 * The audit log is dual-rendered: scoped to the open entry inside its drawer
 * (handled by EntryDrawer), AND globally on the bottom panel of the page so a
 * freshly arrived operator can see the recent replay activity at a glance.
 *
 * Native adaptations vs. the web source (behavior/state/keys/API intent kept):
 *   - web `layout` `PageContainer` (title/subtitle header + `query` data-
 *     freshness chip) -> an inline RN PageScaffold: a ScrollView with the same
 *     title + subtitle and an inline FreshnessChip derived from the `list`
 *     query (same fresh/fetching/stale/error states + relative-time label the
 *     web `DataFreshnessAuto` showed, tap-to-refetch, 30s tick). The web
 *     loading/error/empty gating props are not passed by this page (content
 *     always renders; each section owns its own loading state), so they are not
 *     reproduced.
 *   - web `motion` `FadeIn` (framer-motion) -> an inline RN Animated FadeIn
 *     (fade + slide-up, reduced-motion aware via AccessibilityInfo).
 *   - web `feedback` `AlertBanner variant="warning" onClose` -> an inline RN
 *     warning banner with the same title/body/close affordance.
 *   - web `ui` `ConfirmDialog variant="warning"` -> an inline RN Modal confirm
 *     dialog (warning icon + message, Cancel/Replay actions, loading spinner,
 *     backdrop/hardware-back = cancel when not loading). The web silenceKey +
 *     requireTypedConfirmation features are unused by this page and not ported.
 *   - web `ui/Typography` `PanelTitle` + lucide `AlertOctagon`/`History` panel
 *     icons -> an inline PanelHeader (glyph + AppText title): ⚠ for the entries
 *     panel (web AlertOctagon), ↻ for the audit panel (web History).
 *   - web `@/hooks/usePageTitle` (writes `document.title`) -> a native-safe
 *     no-op hook (RN has no browser tab / document title); the call site +
 *     argument are preserved.
 *   - web `GlassPanel` -> the canonical native `GlassPanel`; the four sub-
 *     components are imported from the native `../components/dlq-inspector`
 *     barrel exactly like the web page.
 *   - react-i18next `useTranslation` -> a native-safe t(key, fallback, options?)
 *     fallback preserving every key, English default, and {{id}}/{{m}}/{{h}}/
 *     {{d}}/{{w}} interpolation.
 *   - `DLQEntrySummary` type imported from the native useDLQ hook (which
 *     re-exports it) rather than `@/types/admin-diagnostics`.
 */

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, shadows, spacing} from '../../../../theme/tokens';
import {
  useDLQAudit,
  useDLQEntry,
  useDLQList,
  useDLQReplay,
  type DLQEntrySummary,
} from '../../../api/hooks/useDLQ';
import {
  AuditPanel,
  EntriesTable,
  EntryDrawer,
  StatusHeader,
} from '../components/dlq-inspector';

// ---- Native-safe i18n fallback (web react-i18next useTranslation) -----------

type InterpolationValues = Record<string, string | number>;
type NativeTFunction = (
  key: string,
  fallback: string,
  options?: InterpolationValues,
) => string;

function interpolate(template: string, values: InterpolationValues): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = values[key];
    return value === undefined ? '' : String(value);
  });
}

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback(
    (_key, fallback, options) =>
      options ? interpolate(fallback, options) : fallback,
    [],
  );
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

// ---- Inline DataFreshness (web data-display DataFreshnessAuto) ---------------

interface FreshnessQuery {
  dataUpdatedAt: number;
  isError: boolean;
  isFetching: boolean;
  isStale: boolean;
  refetch: () => unknown;
}

type FreshnessStatus = 'fresh' | 'fetching' | 'stale' | 'error';

const FRESHNESS_DOT: Record<FreshnessStatus, string> = {
  fresh: colors.success,
  fetching: colors.accent,
  stale: colors.warning,
  error: colors.danger,
};

/** web DataFreshness `formatRelativeTime` (i18n-aware) ported verbatim. */
function formatRelativeTime(ms: number, t: NativeTFunction): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) {
    return t('freshness.justNow', 'just now');
  }
  if (seconds < 3600) {
    return t('freshness.minutes', '{{m}}m ago', {m: Math.floor(seconds / 60)});
  }
  if (seconds < 86_400) {
    return t('freshness.hours', '{{h}}h ago', {h: Math.floor(seconds / 3600)});
  }
  if (seconds < 604_800) {
    return t('freshness.days', '{{d}}d ago', {d: Math.floor(seconds / 86_400)});
  }
  return t('freshness.weeks', '{{w}}w ago', {w: Math.floor(seconds / 604_800)});
}

function FreshnessChip({
  query,
  t,
}: {
  query: FreshnessQuery;
  t: NativeTFunction;
}): React.ReactElement {
  const [, setTick] = useState(0);
  const updatedAt = query.dataUpdatedAt > 0 ? query.dataUpdatedAt : null;

  // Re-render on a 30s cadence so the relative-time label stays accurate
  // (matches the web DataFreshness tick).
  useEffect(() => {
    if (!updatedAt) {
      return undefined;
    }
    const id = setInterval(() => setTick(n => n + 1), 30_000);
    return () => clearInterval(id);
  }, [updatedAt]);

  const status: FreshnessStatus = query.isError
    ? 'error'
    : query.isFetching
      ? 'fetching'
      : query.isStale
        ? 'stale'
        : 'fresh';

  const label =
    updatedAt && !query.isFetching
      ? formatRelativeTime(updatedAt, t)
      : query.isFetching
        ? t('freshness.updating', 'updating…')
        : query.isError
          ? t('freshness.error', 'error')
          : '';

  const handlePress = () => {
    if (!query.isFetching) {
      query.refetch();
    }
  };

  return (
    <Pressable
      accessibilityLabel={t('a11y.dataFreshness', 'Data freshness: {{state}}', {
        state: status,
      })}
      accessibilityRole="button"
      disabled={query.isFetching}
      onPress={handlePress}
      style={styles.freshness}>
      <View style={[styles.freshnessDot, {backgroundColor: FRESHNESS_DOT[status]}]} />
      {label ? (
        <AppText style={styles.freshnessText} variant="caption">
          {label}
        </AppText>
      ) : null}
    </Pressable>
  );
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

// ---- Inline AlertBanner (web feedback AlertBanner) --------------------------

function AlertBanner({
  title,
  children,
  onClose,
}: {
  title: string;
  children: string;
  onClose: () => void;
}): React.ReactElement {
  return (
    <View style={styles.banner}>
      <AppText style={styles.bannerGlyph}>⚠</AppText>
      <View style={styles.bannerBody}>
        <AppText style={styles.bannerTitle} weight="semibold">
          {title}
        </AppText>
        <AppText style={styles.bannerMessage} variant="caption">
          {children}
        </AppText>
      </View>
      <Pressable
        accessibilityLabel="Close"
        accessibilityRole="button"
        hitSlop={8}
        onPress={onClose}
        style={({pressed}) => [styles.bannerClose, pressed && styles.pressed]}>
        <AppText style={styles.bannerCloseText}>✕</AppText>
      </Pressable>
    </View>
  );
}

// ---- Inline ConfirmDialog (web ui ConfirmDialog) ----------------------------

function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  variant,
  loading,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  variant: 'danger' | 'warning';
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}): React.ReactElement {
  const handleRequestClose = () => {
    if (!loading) {
      onCancel();
    }
  };

  return (
    <Modal
      animationType="fade"
      onRequestClose={handleRequestClose}
      transparent
      visible={open}>
      <View accessibilityRole="alert" style={styles.overlay}>
        <Pressable
          accessibilityElementsHidden
          disabled={loading}
          importantForAccessibility="no-hide-descendants"
          onPress={handleRequestClose}
          style={styles.backdrop}
        />
        <View style={styles.dialog}>
          <AppText style={styles.dialogTitle} variant="title" weight="bold">
            {title}
          </AppText>
          <View
            style={[
              styles.dialogMessageBox,
              variant === 'danger'
                ? styles.dialogMessageBoxDanger
                : styles.dialogMessageBoxWarning,
            ]}>
            <AppText
              style={variant === 'danger' ? styles.dialogGlyphDanger : styles.dialogGlyphWarning}>
              {variant === 'danger' ? '⛔' : '⚠'}
            </AppText>
            <AppText style={styles.dialogMessage}>{message}</AppText>
          </View>
          <View style={styles.dialogActions}>
            <Pressable
              accessibilityLabel={cancelLabel}
              accessibilityRole="button"
              disabled={loading}
              onPress={onCancel}
              style={({pressed}) => [
                styles.dialogButton,
                styles.dialogButtonGhost,
                loading && styles.disabled,
                pressed && !loading && styles.pressed,
              ]}>
              <AppText style={styles.dialogButtonGhostText} weight="semibold">
                {cancelLabel}
              </AppText>
            </Pressable>
            <Pressable
              accessibilityLabel={confirmLabel}
              accessibilityRole="button"
              disabled={loading}
              onPress={onConfirm}
              style={({pressed}) => [
                styles.dialogButton,
                variant === 'danger'
                  ? styles.dialogButtonDanger
                  : styles.dialogButtonWarning,
                loading && styles.disabled,
                pressed && !loading && styles.pressed,
              ]}>
              {loading ? (
                <ActivityIndicator color={colors.background} size="small" />
              ) : (
                <AppText style={styles.dialogButtonPrimaryText} weight="semibold">
                  {confirmLabel}
                </AppText>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ---- Inline SectionErrorBoundary (web feedback SectionErrorBoundary) --------

interface SectionErrorBoundaryProps {
  name: string;
  children: ReactNode;
}

interface SectionErrorBoundaryState {
  hasError: boolean;
}

/**
 * Wraps a section so a render failure inside it doesn't bubble up and blank out
 * the whole page — mirrors web `SectionErrorBoundary name="…"` (default inline
 * ErrorBoundary UI + Retry). Like the parity PageErrorBoundary, the fallback
 * copy is hardcoded English (web i18n keys `errors.section.*` noted in the
 * sidecar) and the `[ErrorBoundary:section:{name}]` log keeps the web `name`
 * correlation.
 */
class SectionErrorBoundary extends React.Component<
  SectionErrorBoundaryProps,
  SectionErrorBoundaryState
> {
  state: SectionErrorBoundaryState = {hasError: false};

  static getDerivedStateFromError(): SectionErrorBoundaryState {
    return {hasError: true};
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[ErrorBoundary:section:${this.props.name}]`, {
      error: error.message,
      componentStack: info.componentStack,
    });
  }

  private handleRetry = () => {
    this.setState({hasError: false});
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }
    return (
      <View accessibilityRole="alert" style={styles.sectionError}>
        <AppText style={styles.sectionErrorGlyph}>⚠</AppText>
        <View style={styles.sectionErrorBody}>
          <AppText style={styles.sectionErrorTitle} variant="caption" weight="semibold">
            This section failed to load.
          </AppText>
          <AppText style={styles.sectionErrorSubtitle} variant="caption">
            Other parts of the page should still work.
          </AppText>
        </View>
        <Pressable
          accessibilityLabel="Try again"
          accessibilityRole="button"
          hitSlop={8}
          onPress={this.handleRetry}
          style={({pressed}) => [
            styles.sectionErrorRetry,
            pressed && styles.pressed,
          ]}>
          <AppText style={styles.sectionErrorRetryText} variant="caption" weight="semibold">
            Try again
          </AppText>
        </Pressable>
      </View>
    );
  }
}

// ---- Panel header (web ui/Typography PanelTitle + lucide panel icon) --------

function PanelHeader({
  glyph,
  title,
}: {
  glyph: string;
  title: string;
}): React.ReactElement {
  return (
    <View style={styles.panelHeader}>
      <AppText style={styles.panelGlyph}>{glyph}</AppText>
      <AppText style={styles.panelTitle} weight="semibold">
        {title}
      </AppText>
    </View>
  );
}

// ---- Page scaffold (web layout PageContainer) -------------------------------

function PageScaffold({
  title,
  subtitle,
  query,
  t,
  children,
}: {
  title: string;
  subtitle: string;
  query: FreshnessQuery;
  t: NativeTFunction;
  children: ReactNode;
}): React.ReactElement {
  return (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      style={styles.scroll}>
      <View style={styles.pageHeader}>
        <View style={styles.pageHeaderText}>
          <AppText style={styles.pageTitle} variant="display" weight="bold">
            {title}
          </AppText>
          <AppText style={styles.pageSubtitle} tone="muted" variant="caption">
            {subtitle}
          </AppText>
        </View>
        <FreshnessChip query={query} t={t} />
      </View>
      {children}
    </ScrollView>
  );
}

// ---- Page --------------------------------------------------------------------

export default function DLQInspectorPage(): React.ReactElement {
  const t = useNativeTranslationFallback();
  usePageTitle(t('admin.dlq.pageTitle', 'DLQ Inspector'));

  // Selected DLQ summary row drives both the drawer and the scoped audit fetch.
  // Keeping it in page state (rather than a route param) lets the drawer stack
  // on top of the table without a navigation round-trip.
  const [selected, setSelected] = useState<DLQEntrySummary | null>(null);
  const [pendingReplay, setPendingReplay] = useState<DLQEntrySummary | null>(
    null,
  );
  const [replayDisabledBanner, setReplayDisabledBanner] = useState(false);

  const list = useDLQList();
  const entry = useDLQEntry(selected?.id, !!selected);
  const audit = useDLQAudit(null, 50);
  const replay = useDLQReplay();

  const handleInspect = (row: DLQEntrySummary) => {
    setSelected(row);
  };

  const handleAskReplay = () => {
    if (selected) {
      setPendingReplay(selected);
    }
  };

  const handleConfirmReplay = async () => {
    if (!pendingReplay) {
      return;
    }
    try {
      const result = await replay.mutateAsync({id: pendingReplay.id});
      // Server may return 200 OK with result="disabled" via a future soft-flag —
      // keep the banner branch in case that arrives.
      if (result.result === 'disabled') {
        setReplayDisabledBanner(true);
      } else {
        setReplayDisabledBanner(false);
      }
      setPendingReplay(null);
      // Close the drawer on a successful publish so the audit row that just
      // landed in the global panel is the first thing the operator sees.
      if (result.result === 'ok') {
        setSelected(null);
      }
    } catch (err) {
      // Hard-disabled at env level surfaces as a 403 — show the page banner so
      // the operator has more room than a toast affords.
      const status = (err as {status?: number}).status;
      if (status === 403) {
        setReplayDisabledBanner(true);
        setPendingReplay(null);
      }
      // Every other error is already handled by the mutation's built-in toast
      // (`useMutationToast`).
    }
  };

  return (
    <PageScaffold
      query={list}
      subtitle={t(
        'admin.dlq.subtitle',
        'Dead-letter queue — inspect failed ingests and replay them back to their source topic.',
      )}
      t={t}
      title={t('admin.dlq.pageTitle', 'DLQ Inspector')}>
      <FadeIn style={styles.body}>
        {replayDisabledBanner ? (
          <AlertBanner
            onClose={() => setReplayDisabledBanner(false)}
            title={t('admin.dlq.banners.replayBlockedTitle', 'Replay blocked')}>
            {t(
              'admin.dlq.banners.replayBlockedMessage',
              'The server rejected the replay because DLQ_REPLAY_ENABLED is not set. Restart the worker with this env var to enable replays.',
            )}
          </AlertBanner>
        ) : null}

        <SectionErrorBoundary name="dlq-status">
          <StatusHeader data={list.data} loading={list.isLoading} />
        </SectionErrorBoundary>

        <SectionErrorBoundary name="dlq-entries">
          <GlassPanel style={styles.panel}>
            <PanelHeader
              glyph="⚠"
              title={t('admin.dlq.panels.entries', 'Dead-letter entries')}
            />
            <EntriesTable
              loading={list.isLoading}
              onInspect={handleInspect}
              rows={list.data?.entries ?? []}
            />
          </GlassPanel>
        </SectionErrorBoundary>

        <SectionErrorBoundary name="dlq-audit">
          <GlassPanel style={styles.panel}>
            <PanelHeader
              glyph="↻"
              title={t('admin.dlq.panels.audit', 'Recent replay activity')}
            />
            <AuditPanel loading={audit.isLoading} rows={audit.data?.rows ?? []} />
          </GlassPanel>
        </SectionErrorBoundary>
      </FadeIn>

      <EntryDrawer
        full={entry.data}
        loading={entry.isLoading}
        onClose={() => setSelected(null)}
        onReplay={handleAskReplay}
        open={selected !== null}
        replayEnabled={list.data?.replay_enabled ?? false}
        replayInFlight={replay.isPending}
        summary={selected}
      />

      <ConfirmDialog
        cancelLabel={t('common.cancel', 'Cancel')}
        confirmLabel={t('admin.dlq.confirm.confirm', 'Replay')}
        loading={replay.isPending}
        message={t(
          'admin.dlq.confirm.message',
          'This will republish entry #{{id}} to its source topic. The action is logged and rate-limited.',
          {id: pendingReplay?.id ?? 0},
        )}
        onCancel={() => setPendingReplay(null)}
        onConfirm={handleConfirmReplay}
        open={pendingReplay !== null}
        title={t('admin.dlq.confirm.title', 'Replay DLQ entry?')}
        variant="warning"
      />
    </PageScaffold>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  banner: {
    alignItems: 'flex-start',
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  bannerBody: {
    flex: 1,
    gap: 2,
  },
  bannerClose: {
    borderRadius: 8,
    padding: 4,
  },
  bannerCloseText: {
    color: colors.warning,
    fontSize: 14,
  },
  bannerGlyph: {
    color: colors.warning,
    fontSize: 15,
    lineHeight: 20,
  },
  bannerMessage: {
    color: colors.textSecondary,
  },
  bannerTitle: {
    color: colors.warning,
  },
  body: {
    gap: spacing.lg,
  },
  dialog: {
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderAccent,
    borderRadius: 24,
    borderWidth: 1,
    gap: spacing.md,
    margin: spacing.lg,
    maxWidth: 480,
    padding: spacing.lg,
    width: '92%',
    ...shadows.panel,
  },
  dialogActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  dialogButton: {
    alignItems: 'center',
    borderRadius: 14,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 96,
    paddingHorizontal: spacing.lg,
  },
  dialogButtonDanger: {
    backgroundColor: colors.danger,
  },
  dialogButtonGhost: {
    backgroundColor: 'transparent',
    borderColor: colors.border,
    borderWidth: 1,
  },
  dialogButtonGhostText: {
    color: colors.textSecondary,
  },
  dialogButtonPrimaryText: {
    color: colors.background,
  },
  dialogButtonWarning: {
    backgroundColor: colors.warning,
  },
  dialogGlyphDanger: {
    color: colors.danger,
    fontSize: 18,
    lineHeight: 22,
  },
  dialogGlyphWarning: {
    color: colors.warning,
    fontSize: 18,
    lineHeight: 22,
  },
  dialogMessage: {
    color: colors.textPrimary,
    flex: 1,
  },
  dialogMessageBox: {
    alignItems: 'flex-start',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  dialogMessageBoxDanger: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  dialogMessageBoxWarning: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
  dialogTitle: {
    color: colors.textPrimary,
  },
  disabled: {
    opacity: 0.48,
  },
  freshness: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  freshnessDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  freshnessText: {
    color: colors.textMuted,
  },
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    flex: 1,
    justifyContent: 'center',
  },
  panel: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  panelGlyph: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 20,
  },
  panelHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  panelTitle: {
    color: colors.textPrimary,
  },
  pageHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  pageHeaderText: {
    flex: 1,
    gap: spacing.xs,
  },
  pageSubtitle: {
    color: colors.textMuted,
  },
  pageTitle: {
    color: colors.textPrimary,
  },
  pressed: {
    opacity: 0.82,
  },
  scroll: {
    backgroundColor: colors.background,
    flex: 1,
  },
  scrollContent: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  sectionError: {
    alignItems: 'center',
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  sectionErrorBody: {
    flex: 1,
    gap: 2,
  },
  sectionErrorGlyph: {
    color: colors.warning,
    fontSize: 15,
    lineHeight: 20,
  },
  sectionErrorRetry: {
    alignItems: 'center',
    borderColor: colors.borderAccent,
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: spacing.md,
  },
  sectionErrorRetryText: {
    color: colors.accent,
  },
  sectionErrorSubtitle: {
    color: colors.textMuted,
  },
  sectionErrorTitle: {
    color: colors.textSecondary,
  },
});
