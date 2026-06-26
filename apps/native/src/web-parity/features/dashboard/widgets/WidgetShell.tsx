// Native parity port of
// web/src/features/dashboard/widgets/WidgetShell.tsx.
//
// `WidgetShell` is the generic chrome every dashboard widget wraps itself in:
// it renders a loading skeleton, an error state, an optional header (icon +
// uppercase muted title + "?" help tooltip on the left; a data-freshness chip,
// a pin button, and caller `actions` on the right), and a body that holds the
// widget `children`. When the widget has no `title` the freshness chip floats
// in the top-right corner instead and `actions` get their own row. A green
// glow pulses on the shell for 1.5s whenever the underlying data timestamp
// changes.
//
// Unlike the per-widget inline shells already in this directory
// (AutomationHistoryWidget / GuardModeWidget), this is the standalone, reusable
// `WidgetShell` itself, so EVERY prop the web component exposes is honoured —
// title, icon, loading, error, children, noPadding, actions, query, updatedAt,
// isFetching, isStale, isError, onRefresh, help, widgetId, dashboardId — and
// every shared web dependency it pulls in is reproduced native-safe and
// documented in the sidecar:
//
//   - @/lib/cn (className merge) -> dropped; React Native composes StyleSheet
//     arrays instead. The Tailwind utility strings are translated to the
//     equivalent flex/spacing/colour styles.
//   - @/components/feedback Skeleton -> inline `Skeleton` View (flex-1 rounded
//     surface block), same role as the web `<Skeleton className="h-full
//     rounded-xl" />`.
//   - @/components/feedback QueryError -> inline `WidgetQueryError`. The shell
//     only ever feeds it `new Error(error)` (a plain Error, never an ApiError)
//     with no onRetry, and native has no navigator.onLine, so QueryError's
//     status branches (transient-waiting / 404 / 401-403 / 5xx / offline) are
//     all unreachable here; the realised output is always the generic network
//     ErrorState (AlertCircle glyph + "Can't reach server" + "Check your
//     internet connection and try again."), which is reproduced verbatim. Web
//     likewise never renders the raw error string, so neither do we.
//   - @/components/data-display DataFreshness / DataFreshnessAuto / FreshnessQuery
//     -> inline `DataFreshness` + `DataFreshnessAuto` + re-exported
//     `FreshnessQuery` type. Same isError>fetching>stale>fresh precedence, same
//     dot colour tiers (#34d399/#38bdf8/#fbbf24/#f87171), same "just now /
//     Nm/Nh/Nd/Nw ago" + "updating…"/"error" relative ladder, the 30s
//     re-render tick (active only while updatedAt is truthy), onRefresh wired
//     to a role=button Pressable, and the same compact (dot-only) mode. The
//     lucide Wifi/WifiOff/RefreshCw icon and the reduced-motion ping/spin/pulse
//     animations are dropped (RN has no CSS animation); the dot colour carries
//     the status signal.
//   - @/components/ui HelpTooltip -> inline `HelpTooltip`. Same text resolution
//     (i18nKey + defaultValue, else text; renders nothing when empty). The web
//     hover/focus floating tooltip has no touch equivalent, so the "?" trigger
//     toggles an inline disclosure bubble on press; `learnMore` opens via
//     Linking.openURL (web opened a new tab). `placement` is dropped.
//   - @/components/ui PinButton -> inline `PinButton`, wired to the REAL native
//     usePinned/useTogglePin hooks (same /pinned API path, same PinnedItemType,
//     same isPinned lookup + toggle.mutate({itemId,context,pin}) contract), so
//     pinning still persists. The lucide Pin/PinOff icons and the wrapping
//     Tooltip collapse to a PIN/PINNED text token (amber when pinned, muted
//     otherwise) with the label exposed via accessibilityLabel.
//   - ./types WidgetHelp -> re-declared `WidgetHelp` interface (no native
//     widget types module exists yet).
//   - react-i18next is not wired in native; the inline `t` returns the supplied
//     English default and applies the same {{var}} interpolation, keeping every
//     freshness.*/error.network.*/help.*/pin.*/a11y.* key intact.
//
// State names (justUpdated, prevUpdatedAt, effectiveUpdatedAt, showFreshness,
// freshnessCompact, freshnessEl) and prop names are preserved verbatim. The
// web body's `@container` context + `overflow-auto` scroll have no RN
// equivalent; scrolling is delegated to the widget `children` (matching the
// repo's inline-shell idiom), avoiding nested VirtualizedList. No DOM,
// lucide-react, Recharts, Leaflet, or old web UI components are imported.

import React, {type ReactNode, useEffect, useRef, useState} from 'react';
import {Linking, Pressable, StyleSheet, View} from 'react-native';
import type {UseQueryResult} from '@tanstack/react-query';

import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';
import {
  usePinned,
  useTogglePin,
  type PinnedItemType,
} from '../../../api/hooks/usePinned';

/* ─── i18n fallback (mirrors i18next default-value + {{var}} interpolation) ─── */

type TVars = Record<string, string | number>;

// react-i18next is not wired in native; i18next returns the supplied English
// default when a translation is missing, so this returns that default while
// keeping every key verbatim and applying the same {{var}} interpolation.
function t(key: string, fallback: string, vars?: TVars): string {
  let out = fallback ?? key;
  if (vars) {
    for (const varKey of Object.keys(vars)) {
      out = out.split(`{{${varKey}}}`).join(String(vars[varKey]));
    }
  }
  return out;
}

/* ─── WidgetHelp (web ./types.ts) ────────────────────────────────────────── */

/**
 * Metadata describing a widget's contextual help. Use `i18nKey` (with
 * `defaultValue`) for translated help; `text` is supported for static strings.
 * `learnMore` adds a "Learn more" link that opens the URL.
 */
export interface WidgetHelp {
  text?: string;
  i18nKey?: string;
  defaultValue?: string;
  learnMore?: {url: string; label?: string};
}

/* ─── FreshnessQuery (web data-display) ───────────────────────────────────── */

/**
 * Subset of `UseQueryResult` that `<DataFreshnessAuto>` consumes. Kept loose
 * (`unknown` data + error) so the shell accepts any TanStack Query result.
 */
export type FreshnessQuery = Pick<
  UseQueryResult<unknown, unknown>,
  'isFetching' | 'isStale' | 'isError' | 'dataUpdatedAt' | 'refetch'
>;

/* ─── DataFreshness (web data-display 4-state chip) ───────────────────────── */

type FreshnessStatus = 'fresh' | 'fetching' | 'stale' | 'error';

// web FRESHNESS_COLORS dot tiers (emerald-400 / sky-400 / amber-400 / red-400).
const FRESHNESS_DOT: Record<FreshnessStatus, string> = {
  fresh: '#34d399',
  fetching: '#38bdf8',
  stale: '#fbbf24',
  error: '#f87171',
};

// web DataFreshness.formatRelativeTime — minute/hour/day/week relative ladder.
function formatFreshnessRelative(ms: number): string {
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

// web DataFreshness re-renders on a 30s cadence so the relative label stays
// accurate; the interval only runs while there is a timestamp to age.
function useThirtySecondTick(active: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) {
      return;
    }
    const id = setInterval(() => setTick(n => n + 1), 30_000);
    return () => clearInterval(id);
  }, [active]);
}

interface DataFreshnessProps {
  updatedAt: number | null;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  onRefresh?: () => void;
  compact?: boolean;
}

function DataFreshness({
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
  compact = false,
}: DataFreshnessProps) {
  useThirtySecondTick(!!updatedAt);

  const status: FreshnessStatus = isError
    ? 'error'
    : isFetching
    ? 'fetching'
    : isStale
    ? 'stale'
    : 'fresh';

  const relativeTime =
    updatedAt && !isFetching
      ? formatFreshnessRelative(updatedAt)
      : isFetching
      ? t('freshness.updating', 'updating\u2026')
      : isError
      ? t('freshness.error', 'error')
      : '';

  const refreshable = !!onRefresh && !isFetching;

  return (
    <Pressable
      accessibilityRole={onRefresh ? 'button' : 'text'}
      accessibilityLabel={
        onRefresh
          ? t('freshness.refresh', 'Refresh')
          : t('a11y.dataFreshness', 'Data freshness: {{state}}', {state: status})
      }
      accessibilityState={{disabled: !refreshable}}
      disabled={!refreshable}
      onPress={() => {
        if (refreshable) {
          onRefresh?.();
        }
      }}
      testID="widget-shell-freshness"
      style={[styles.freshness, compact ? styles.freshnessCompact : null]}>
      <View
        style={[styles.freshnessDot, {backgroundColor: FRESHNESS_DOT[status]}]}
        testID="widget-shell-freshness-dot"
      />
      {!compact && relativeTime ? (
        <AppText
          variant="caption"
          tone="muted"
          numberOfLines={1}
          style={styles.freshnessLabel}>
          {relativeTime}
        </AppText>
      ) : null}
    </Pressable>
  );
}

interface DataFreshnessAutoProps {
  query: FreshnessQuery;
  compact?: boolean;
  refetchable?: boolean;
  forceStaleAfterMs?: number;
}

function DataFreshnessAuto({
  query,
  compact,
  refetchable = true,
  forceStaleAfterMs,
}: DataFreshnessAutoProps) {
  const isStale =
    query.isStale ||
    (forceStaleAfterMs != null && query.dataUpdatedAt
      ? Date.now() - query.dataUpdatedAt > forceStaleAfterMs
      : false);

  return (
    <DataFreshness
      updatedAt={query.dataUpdatedAt > 0 ? query.dataUpdatedAt : null}
      isFetching={query.isFetching}
      isStale={isStale}
      isError={query.isError}
      onRefresh={
        refetchable
          ? () => {
              query.refetch();
            }
          : undefined
      }
      compact={compact}
    />
  );
}

/* ─── Skeleton (web feedback Skeleton) ────────────────────────────────────── */

function Skeleton() {
  return <View style={styles.skeleton} testID="widget-shell-skeleton" />;
}

/* ─── WidgetQueryError (web feedback QueryError, reachable network branch) ─── */

function WidgetQueryError() {
  // The shell only constructs a plain Error with no onRetry, so QueryError's
  // ApiError-status branches never fire — the generic network ErrorState is the
  // realised output (web ErrorState: rose card + AlertCircle + title + message).
  return (
    <View
      accessibilityRole="alert"
      style={styles.errorCard}
      testID="widget-shell-error">
      <View style={styles.errorIconChip}>
        <AppText style={styles.errorIconGlyph}>!</AppText>
      </View>
      <View style={styles.errorTextCol}>
        <AppText style={styles.errorTitle}>
          {t('error.network.title', "Can't reach server")}
        </AppText>
        <AppText style={styles.errorMessage}>
          {t(
            'error.network.message',
            'Check your internet connection and try again.',
          )}
        </AppText>
      </View>
    </View>
  );
}

/* ─── HelpTooltip (web ui HelpTooltip) ────────────────────────────────────── */

interface HelpTooltipProps {
  text?: string;
  i18nKey?: string;
  defaultValue?: string;
  learnMore?: {url: string; label?: string};
  ariaLabel?: string;
}

function HelpTooltip({
  text,
  i18nKey,
  defaultValue,
  learnMore,
  ariaLabel,
}: HelpTooltipProps) {
  const [open, setOpen] = useState(false);

  // web: i18nKey ? t(i18nKey, {defaultValue: defaultValue ?? ''}) : text ?? ''.
  const resolved = i18nKey ? defaultValue ?? '' : text ?? '';

  // Render nothing when no content is supplied — keeps consumers from gating.
  if (!resolved) {
    return null;
  }

  const label = ariaLabel ?? t('help.tooltip.iconLabel', 'More info');

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={resolved}
        accessibilityState={{expanded: open}}
        onPress={() => setOpen(o => !o)}
        testID="widget-shell-help"
        style={styles.helpTrigger}>
        <AppText style={styles.helpGlyph}>?</AppText>
      </Pressable>
      {open ? (
        <View style={styles.helpBubble} testID="widget-shell-help-bubble">
          <AppText style={styles.helpText}>{resolved}</AppText>
          {learnMore ? (
            <Pressable
              accessibilityRole="link"
              onPress={() => {
                Linking.openURL(learnMore.url);
              }}
              style={styles.helpLink}>
              <AppText style={styles.helpLinkText}>
                {`${learnMore.label ?? t('common.learnMore', 'Learn more')} \u2197`}
              </AppText>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/* ─── PinButton (web ui PinButton, wired to native usePinned/useTogglePin) ─── */

interface PinButtonProps {
  itemType: PinnedItemType;
  itemId: string | number;
  context?: string;
  showLabel?: boolean;
}

function PinButton({itemType, itemId, context, showLabel = false}: PinButtonProps) {
  const {data: pinned = []} = usePinned(itemType, context);
  const toggle = useTogglePin(itemType);

  const idStr = String(itemId);
  const isPinned = pinned.some(p => String(p.item_id) === idStr);

  const tooltipLabel = isPinned
    ? t('pin.unpin', 'Unpin')
    : t('pin.pin', 'Pin');

  const handlePress = () => {
    if (toggle.isPending) {
      return;
    }
    toggle.mutate({itemId: idStr, context, pin: !isPinned});
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tooltipLabel}
      accessibilityState={{disabled: toggle.isPending, selected: isPinned}}
      disabled={toggle.isPending}
      onPress={handlePress}
      testID="pin-button"
      style={[styles.pinBtn, isPinned ? styles.pinBtnActive : null]}>
      <AppText
        style={[
          styles.pinGlyph,
          isPinned ? styles.pinGlyphActive : styles.pinGlyphIdle,
        ]}>
        {isPinned ? 'PINNED' : 'PIN'}
      </AppText>
      {showLabel ? (
        <AppText style={styles.pinLabel}>
          {isPinned ? t('pin.pinned', 'Pinned') : t('pin.pin', 'Pin')}
        </AppText>
      ) : null}
    </Pressable>
  );
}

/* ─── WidgetShell (web .../WidgetShell.tsx) ───────────────────────────────── */

export interface WidgetShellProps {
  title?: string;
  icon?: ReactNode;
  loading?: boolean;
  error?: string | null;
  children: ReactNode;
  noPadding?: boolean;
  actions?: ReactNode;
  /**
   * Convenience: pass an entire TanStack Query result and the shell will
   * render `<DataFreshnessAuto query={query} />` in the header. Mutually
   * exclusive with the granular `updatedAt`/`isFetching`/`isStale`/`isError`/
   * `onRefresh` props (those win when supplied for backward compatibility).
   */
  query?: FreshnessQuery;
  /** Freshness: ms timestamp from dataUpdatedAt (0 = never) */
  updatedAt?: number;
  /** Is TanStack Query currently fetching in the background? */
  isFetching?: boolean;
  /** Has the query data gone stale? */
  isStale?: boolean;
  /** Is the query in an error state? */
  isError?: boolean;
  /** Callback to manually refetch the widget data */
  onRefresh?: () => void;
  /**
   * Optional help metadata. When provided AND the widget has a visible
   * `title`, a small "?" tooltip is rendered next to the title with the
   * provided text/i18nKey.
   */
  help?: WidgetHelp;
  /**
   * Stable widget identifier. When supplied alongside `dashboardId`, a
   * <PinButton> is rendered in the header so the user can pin this widget
   * to the top of the dashboard.
   */
  widgetId?: string;
  /** Dashboard ID — used as the pin context so pins are per-dashboard. */
  dashboardId?: string;
}

export function WidgetShell({
  title,
  icon,
  loading,
  error,
  children,
  noPadding,
  actions,
  query,
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
  help,
  widgetId,
  dashboardId,
}: WidgetShellProps) {
  // Pulse animation on data change
  const [justUpdated, setJustUpdated] = useState(false);
  const prevUpdatedAt = useRef<number | undefined>(undefined);

  // Resolve the effective updatedAt for the pulse-on-change effect: the
  // explicit prop wins, otherwise we fall back to the query's value.
  const effectiveUpdatedAt = updatedAt ?? query?.dataUpdatedAt;

  useEffect(() => {
    if (
      effectiveUpdatedAt &&
      effectiveUpdatedAt > 0 &&
      prevUpdatedAt.current !== undefined &&
      prevUpdatedAt.current !== effectiveUpdatedAt
    ) {
      setJustUpdated(true);
      const timer = setTimeout(() => setJustUpdated(false), 1500);
      prevUpdatedAt.current = effectiveUpdatedAt;
      return () => clearTimeout(timer);
    }
    prevUpdatedAt.current = effectiveUpdatedAt;
  }, [effectiveUpdatedAt]);

  if (loading) {
    return <Skeleton />;
  }
  if (error) {
    return (
      <View style={styles.errorWrap}>
        <WidgetQueryError />
      </View>
    );
  }

  const showFreshness = updatedAt !== undefined || query !== undefined;
  // Compact (dot-only) when widget has no title (typically 1×1 widgets)
  const freshnessCompact = !title;

  let freshnessEl: ReactNode = null;
  if (showFreshness) {
    if (updatedAt !== undefined) {
      freshnessEl = (
        <DataFreshness
          updatedAt={updatedAt > 0 ? updatedAt : null}
          isFetching={isFetching ?? false}
          isStale={isStale ?? false}
          isError={isError ?? false}
          onRefresh={onRefresh}
          compact={freshnessCompact}
        />
      );
    } else if (query) {
      freshnessEl = (
        <DataFreshnessAuto query={query} compact={freshnessCompact} />
      );
    }
  }

  return (
    <View
      style={[styles.shell, justUpdated ? styles.shellPulse : null]}
      testID="widget-shell">
      {title ? (
        <View style={styles.header}>
          <View style={styles.titleGroup}>
            {icon}
            <AppText
              accessibilityRole="header"
              numberOfLines={1}
              style={styles.title}>
              {title}
            </AppText>
            {help ? (
              <HelpTooltip
                text={help.text}
                i18nKey={help.i18nKey}
                defaultValue={help.defaultValue}
                learnMore={help.learnMore}
                ariaLabel={`More info about ${title}`}
              />
            ) : null}
          </View>
          <View style={styles.headerRight}>
            {freshnessEl}
            {widgetId && dashboardId ? (
              <PinButton
                itemType="widget"
                itemId={widgetId}
                context={dashboardId}
              />
            ) : null}
            {actions}
          </View>
        </View>
      ) : (
        <>
          {/* Overlay freshness indicator for title-less widgets */}
          {freshnessEl ? (
            <View style={styles.freshnessOverlay}>{freshnessEl}</View>
          ) : null}
          {actions ? <View style={styles.actionsRow}>{actions}</View> : null}
        </>
      )}
      <View
        style={[styles.body, noPadding ? styles.bodyNoPadding : styles.bodyPadded]}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
  },
  shellPulse: {
    shadowColor: '#22c55e',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: {width: 0, height: 0},
    elevation: 6,
  },
  header: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: spacing.sm,
    paddingHorizontal: 16,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  titleGroup: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 6,
  },
  title: {
    flexShrink: 1,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '500',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: spacing.sm,
  },
  actionsRow: {
    flexShrink: 0,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  freshnessOverlay: {
    position: 'absolute',
    top: 6,
    right: 6,
    zIndex: 5,
  },
  body: {
    flex: 1,
  },
  bodyPadded: {
    paddingHorizontal: 16,
    paddingBottom: spacing.md,
  },
  bodyNoPadding: {
    overflow: 'hidden',
  },
  skeleton: {
    flex: 1,
    minHeight: 96,
    borderRadius: 12,
    backgroundColor: colors.surfaceRaised,
  },
  errorWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    columnGap: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(244, 63, 94, 0.2)',
    backgroundColor: 'rgba(244, 63, 94, 0.05)',
    padding: 16,
  },
  errorIconChip: {
    marginTop: 2,
    borderRadius: 8,
    backgroundColor: 'rgba(244, 63, 94, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  errorIconGlyph: {
    color: '#fda4af',
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 16,
  },
  errorTextCol: {
    flex: 1,
  },
  errorTitle: {
    color: '#fda4af',
    fontWeight: '500',
    fontSize: 13,
    lineHeight: 18,
  },
  errorMessage: {
    marginTop: 2,
    color: 'rgba(253, 164, 175, 0.7)',
    fontSize: 12,
    lineHeight: 16,
  },
  freshness: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 4,
  },
  freshnessCompact: {
    columnGap: 2,
  },
  freshnessDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  freshnessLabel: {
    fontSize: 10,
    lineHeight: 12,
  },
  helpTrigger: {
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  helpGlyph: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '600',
    color: colors.textMuted,
  },
  helpBubble: {
    position: 'absolute',
    top: 20,
    left: 0,
    maxWidth: 220,
    padding: spacing.sm,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    zIndex: 10,
  },
  helpText: {
    fontSize: 11,
    lineHeight: 15,
    color: colors.textPrimary,
  },
  helpLink: {
    marginTop: 4,
  },
  helpLinkText: {
    fontSize: 11,
    lineHeight: 15,
    color: colors.textSecondary,
  },
  pinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 4,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 6,
  },
  pinBtnActive: {
    backgroundColor: 'rgba(251, 191, 36, 0.1)',
  },
  pinGlyph: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '600',
    letterSpacing: 0.4,
  },
  pinGlyphActive: {
    color: colors.warning,
  },
  pinGlyphIdle: {
    color: colors.textMuted,
  },
  pinLabel: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '500',
    color: colors.textSecondary,
  },
});
