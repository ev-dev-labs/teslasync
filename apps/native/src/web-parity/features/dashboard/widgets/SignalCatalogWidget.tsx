// Native parity port of
// web/src/features/dashboard/widgets/SignalCatalogWidget.tsx.
//
// A dashboard widget that lists the telemetry signal catalog. The compact
// (cols <= 1) layout is a title-less shell with a centred big primary-text
// count over a small secondary "signals available" label. The standard / wide
// layout gets the "Signal Catalog" title + book icon, a search box that filters
// the catalog by name / description / source_module, and a scrollable list of
// the matching signals grouped by `source_module` (categories sorted
// alphabetically); each row shows the monospaced signal name, an optional unit
// Badge, and the per-signal observation count. When the catalog is empty an
// EmptyState ("No signals in catalog") renders inside the shell; when the
// search filters everything out a second EmptyState ("No matching signals")
// renders instead — the section is never hidden.
//
// Following the established dashboard idiom (OdometerCounterWidget /
// ChargingOptimizerWidget / BatteryHealthAnalyticsWidget), every not-yet-ported
// web dependency is reproduced inline native-safe with RN primitives + the
// shared native AppText / EmptyState / tokens, and documented in the sidecar:
//
//   - @/components/ui Input -> inline `SearchInput` (RN TextInput): web's
//     `onChange(e) => setSearch(e.target.value)` maps onto `onChangeText`, the
//     web `placeholder` + min-h-[44px] + md (px-3 py-2 text-sm) rounded glass
//     field is reproduced with tokens (border, surface, primary text, muted
//     placeholder via placeholderTextColor).
//   - @/components/ui Badge variant="neutral" -> inline `UnitBadge`: the web
//     rounded-full gray neutral chip (dark: bg-gray-700 text-gray-200, px-2
//     py-0.5 text-[10px] font-medium) reproduced as a rounded pill.
//   - @/components/feedback EmptyState -> shared native EmptyState
//     (../../../../components/feedback/EmptyState): the web single `message`
//     becomes the native `title` (message=''); the web BookOpen `icon` +
//     `className="py-4"` have no native EmptyState slot and are dropped — the
//     catalog signal is preserved by the shell header glyph in the non-compact
//     layout.
//   - lucide-react BookOpen -> `BookGlyph`: no native icon font, so it is
//     reduced to a representative tintable glyph ('\u2630', the list/catalog
//     trigram) tinted neon cyan (colors.accent) to preserve the web
//     `text-neon-cyan` signal in the shell header.
//   - @/lib/numberFormat fmtInt -> inlined `fmtInt` (safeNumber guard +
//     fmtNumber with 0 decimals, en-US grouping), verbatim behaviour.
//   - ./WidgetShell -> inline `WidgetShell` subset: loading -> a skeleton block;
//     error -> a centred error box + retry Pressable mirroring the web
//     <QueryError> (this widget never passes an `error`, so it is inert but
//     preserved); a titled header (BookGlyph + uppercase muted title +
//     WidgetFreshness) over the body, or — when title-less (the compact branch)
//     — the body with WidgetFreshness overlaid top-right, exactly like the web
//     shell. Only the props this widget passes (title, icon, loading, updatedAt,
//     isFetching, isStale, isError, onRefresh) are honoured.
//   - DataFreshness (the web WidgetShell's 4-state chip) -> inline
//     `WidgetFreshness`: same isError>fetching>stale>fresh precedence, dot
//     colour tiers (emerald-400 / sky-400 / amber-400 / red-400), the "just now
//     / Nm/Nh/Nd/Nw ago" relative ladder, "updating…"/"error" labels, a 30s
//     re-render tick, and onRefresh wired to a Pressable.
//   - ./types WidgetProps -> local `WidgetProps`/`WidgetSize` (vehicleId +
//     size.cols read here).
//   - react-i18next useTranslation('dashboard') -> a module-level English-
//     default `t(key, fallback, vars?)` that keeps every
//     widget.signalCatalog.* / freshness.* key + the {{var}} interpolation
//     intact.
//
// The data hooks are called unchanged: useVehicles(), useSignalCatalog(), and
// useSignalObservations(id) via the native web-parity hooks, so the API paths
// (/vehicles, /signals/catalog, /signals/observations?vehicle_id=…), the
// snake_case fields (entry.name / source_module / unit / description,
// obs.signal_name) and refetch semantics are preserved. State names (vehicles,
// id, catalog, catalogLoading, catalogFetching, catalogStale, catalogError,
// catalogUpdatedAt, refetchCatalog, observations, search, isCompact, entries,
// observationCounts, filtered, grouped) are preserved verbatim. No DOM,
// lucide-react, Recharts, Leaflet, or old web UI components are imported.

import React, {useEffect, useMemo, useState} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import {EmptyState} from '../../../../components/feedback/EmptyState';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';
import {
  useSignalCatalog,
  useSignalObservations,
  type SignalCatalogEntry,
} from '../../../api/hooks/useTelemetry';
import {useVehicles} from '../../../api/hooks/useVehicles';

/* ─── i18n fallback (mirrors i18next default-value + {{var}} interpolation) ─── */

type TVars = Record<string, string | number>;

// react-i18next is not wired in native; i18next returns the supplied English
// default when a translation is missing, so this fallback returns that default
// while keeping every widget.signalCatalog.* / freshness.* key verbatim and
// applying the same {{var}} interpolation as the web `t`
// (useTranslation('dashboard')).
function t(key: string, fallback: string, vars?: TVars): string {
  let out = fallback ?? key;
  if (vars) {
    for (const varKey of Object.keys(vars)) {
      out = out.split(`{{${varKey}}}`).join(String(vars[varKey]));
    }
  }
  return out;
}

/* ─── Inlined formatters (web @/lib/numberFormat) ─────────────────────────── */

// Mirrors web lib/numberFormat.safeNumber: nullish / non-finite -> 0.
function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

// web fmtNumber — locale-grouped, fixed precision.
function fmtNumber(v: unknown, decimals = 2): string {
  return safeNumber(v).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// web fmtInt — integer (0-decimal) formatting.
function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

/* ─── WidgetFreshness (web data-display DataFreshness 4-state chip) ────────── */

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

function WidgetFreshness({
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
}: {
  updatedAt?: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
}) {
  useThirtySecondTick(!!updatedAt && updatedAt > 0);

  const status: FreshnessStatus = isError
    ? 'error'
    : isFetching
      ? 'fetching'
      : isStale
        ? 'stale'
        : 'fresh';

  const relativeTime =
    updatedAt && updatedAt > 0 && !isFetching
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
          : t('a11y.dataFreshness', 'Data freshness: {{state}}', {
              state: status,
            })
      }
      accessibilityState={{disabled: !refreshable}}
      disabled={!refreshable}
      onPress={() => {
        if (refreshable) {
          onRefresh?.();
        }
      }}
      testID="signal-catalog-freshness"
      style={styles.freshness}>
      <View
        style={[styles.freshnessDot, {backgroundColor: FRESHNESS_DOT[status]}]}
        testID="signal-catalog-freshness-dot"
      />
      {relativeTime ? (
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

/* ─── BookGlyph (web header lucide BookOpen, text-neon-cyan) ───────────────── */

function BookGlyph() {
  return (
    <View style={styles.bookGlyph} accessibilityElementsHidden>
      <AppText variant="caption" weight="bold" style={styles.bookGlyphText}>
        {'\u2630'}
      </AppText>
    </View>
  );
}

/* ─── UnitBadge (web @/components/ui Badge variant="neutral") ──────────────── */

function UnitBadge({children}: {children: string}) {
  return (
    <View style={styles.badge}>
      <AppText numberOfLines={1} style={styles.badgeText}>
        {children}
      </AppText>
    </View>
  );
}

/* ─── WidgetShell (web .../WidgetShell.tsx subset) ────────────────────────── */

function WidgetShell({
  title,
  icon,
  loading,
  error,
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
  children,
}: {
  title?: string;
  icon?: React.ReactNode;
  loading?: boolean;
  error?: string | null;
  updatedAt?: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
  children: React.ReactNode;
}) {
  if (loading) {
    return <View style={styles.skeleton} testID="signal-catalog-loading" />;
  }

  if (error) {
    return (
      <View style={styles.errorBox} testID="signal-catalog-error">
        <AppText tone="danger" weight="semibold" numberOfLines={3}>
          {error}
        </AppText>
        {onRefresh ? (
          <Pressable
            accessibilityRole="button"
            onPress={onRefresh}
            testID="signal-catalog-error-retry">
            <AppText variant="caption" tone="accent">
              {t('common.retry', 'Retry')}
            </AppText>
          </Pressable>
        ) : null}
      </View>
    );
  }

  const freshness = (
    <WidgetFreshness
      updatedAt={updatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={onRefresh}
    />
  );

  // Title-less widgets (the compact branch) overlay the freshness chip in the
  // top-right corner, exactly like the web shell.
  if (!title) {
    return (
      <View style={styles.shell} testID="signal-catalog-widget">
        <View style={styles.freshnessOverlay}>{freshness}</View>
        <View style={styles.shellBody}>{children}</View>
      </View>
    );
  }

  return (
    <View style={styles.shell} testID="signal-catalog-widget">
      <View style={styles.shellHeader}>
        <View style={styles.shellTitleRow}>
          {icon}
          <AppText
            accessibilityRole="header"
            numberOfLines={1}
            style={styles.shellTitle}>
            {title}
          </AppText>
        </View>
        {freshness}
      </View>
      <View style={styles.shellBody}>{children}</View>
    </View>
  );
}

/* ─── Widget contract types (web .../types.ts subset) ─────────────────────── */

interface WidgetSize {
  cols: number;
  rows: number;
}

export interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: Record<string, unknown>;
}

/* ─── SignalCatalogWidget (web .../SignalCatalogWidget.tsx) ───────────────── */

export default function SignalCatalogWidget({vehicleId, size}: WidgetProps) {
  const {data: vehicles} = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const {
    data: catalog,
    isLoading: catalogLoading,
    isFetching: catalogFetching,
    isStale: catalogStale,
    isError: catalogError,
    dataUpdatedAt: catalogUpdatedAt,
    refetch: refetchCatalog,
  } = useSignalCatalog();

  const {data: observations} = useSignalObservations(id);

  const [search, setSearch] = useState('');
  const isCompact = size.cols <= 1;

  const entries = useMemo(() => catalog ?? [], [catalog]);

  const observationCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const obs of observations ?? []) {
      counts.set(obs.signal_name, (counts.get(obs.signal_name) ?? 0) + 1);
    }
    return counts;
  }, [observations]);

  const filtered = useMemo(() => {
    if (!search.trim()) {
      return entries;
    }
    const q = search.toLowerCase();
    return entries.filter(
      s =>
        s.name.toLowerCase().includes(q) ||
        (s.description ?? '').toLowerCase().includes(q) ||
        (s.source_module ?? '').toLowerCase().includes(q),
    );
  }, [entries, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, SignalCatalogEntry[]>();
    for (const entry of filtered) {
      const cat =
        entry.source_module ||
        t('widget.signalCatalog.uncategorized', 'Uncategorized');
      const list = map.get(cat) ?? [];
      list.push(entry);
      map.set(cat, list);
    }
    // Sort categories alphabetically
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  return (
    <WidgetShell
      title={
        isCompact
          ? undefined
          : t('widget.signalCatalog.title', 'Signal Catalog')
      }
      icon={<BookGlyph />}
      loading={catalogLoading}
      updatedAt={catalogUpdatedAt}
      isFetching={catalogFetching}
      isStale={catalogStale}
      isError={catalogError}
      onRefresh={() => refetchCatalog()}>
      {entries.length === 0 ? (
        // no-action: transient empty state — surfaces when source data is
        // missing; no specific recovery action available.
        <View testID="signal-catalog-empty">
          <EmptyState
            title={t('widget.signalCatalog.noData', 'No signals in catalog')}
            message=""
          />
        </View>
      ) : isCompact ? (
        /* ── Compact layout (1-col) ── */
        <View style={styles.compactView} testID="signal-catalog-compact">
          <AppText
            weight="bold"
            numberOfLines={1}
            style={styles.compactValue}
            testID="signal-catalog-count">
            {fmtInt(entries.length)}
          </AppText>
          <AppText variant="caption" tone="secondary" numberOfLines={1}>
            {t('widget.signalCatalog.signalsAvailable', 'signals available')}
          </AppText>
        </View>
      ) : (
        /* ── Standard / Wide layout ── */
        <View style={styles.standardView}>
          <TextInput
            accessibilityLabel={t(
              'widget.signalCatalog.searchPlaceholder',
              'Search signals\u2026',
            )}
            placeholder={t(
              'widget.signalCatalog.searchPlaceholder',
              'Search signals\u2026',
            )}
            placeholderTextColor={colors.textMuted}
            value={search}
            onChangeText={setSearch}
            style={styles.searchInput}
            testID="signal-catalog-search"
          />

          {filtered.length === 0 ? (
            // no-action: transient empty state — surfaces when source data is
            // missing; no specific recovery action available.
            <View testID="signal-catalog-no-results">
              <EmptyState
                title={t(
                  'widget.signalCatalog.noResults',
                  'No matching signals',
                )}
                message=""
              />
            </View>
          ) : (
            <ScrollView
              style={styles.list}
              contentContainerStyle={styles.listContent}
              testID="signal-catalog-list">
              {grouped.map(([category, signals]) => (
                <View
                  key={category}
                  style={styles.group}
                  testID={`signal-catalog-group-${category}`}>
                  <AppText
                    numberOfLines={1}
                    style={styles.groupHeader}
                    accessibilityRole="header">
                    {category}
                    <AppText style={styles.groupCount}>
                      {` (${signals.length})`}
                    </AppText>
                  </AppText>
                  <View style={styles.groupRows}>
                    {signals.map(sig => (
                      <View
                        key={sig.name}
                        style={styles.signalRow}
                        testID={`signal-catalog-signal-${sig.name}`}>
                        <AppText
                          numberOfLines={1}
                          style={styles.signalName}>
                          {sig.name}
                        </AppText>
                        {sig.unit ? <UnitBadge>{sig.unit}</UnitBadge> : null}
                        <AppText numberOfLines={1} style={styles.signalCount}>
                          {fmtInt(observationCounts.get(sig.name) ?? 0)}
                        </AppText>
                      </View>
                    ))}
                  </View>
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      )}
    </WidgetShell>
  );
}

SignalCatalogWidget.displayName = 'SignalCatalogWidget';

const styles = StyleSheet.create({
  shell: {
    flex: 1,
  },
  shellHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  shellTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 6,
    flexShrink: 1,
  },
  shellTitle: {
    flexShrink: 1,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '500',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  shellBody: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  freshnessOverlay: {
    position: 'absolute',
    top: 6,
    right: 6,
    zIndex: 5,
  },
  skeleton: {
    flex: 1,
    minHeight: 96,
    borderRadius: 12,
    backgroundColor: colors.surfaceRaised,
  },
  errorBox: {
    flex: 1,
    minHeight: 96,
    alignItems: 'center',
    justifyContent: 'center',
    rowGap: spacing.sm,
    padding: spacing.md,
  },
  freshness: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 4,
    flexShrink: 0,
  },
  freshnessDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  freshnessLabel: {
    fontSize: 10,
    lineHeight: 14,
  },
  bookGlyph: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  bookGlyphText: {
    color: colors.accent,
  },
  compactView: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    rowGap: 4,
  },
  compactValue: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  standardView: {
    flex: 1,
    minHeight: 0,
    rowGap: spacing.sm,
  },
  searchInput: {
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    color: colors.textPrimary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 14,
  },
  list: {
    flex: 1,
    minHeight: 0,
  },
  listContent: {
    rowGap: spacing.md,
    paddingBottom: spacing.xs,
  },
  group: {
    rowGap: 4,
  },
  groupHeader: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  groupCount: {
    fontSize: 10,
    lineHeight: 14,
    color: colors.textMuted,
  },
  groupRows: {
    rowGap: 2,
  },
  signalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: spacing.sm,
    minHeight: 32,
    paddingHorizontal: 4,
    borderRadius: 6,
  },
  signalName: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: 'monospace',
    color: colors.textPrimary,
  },
  signalCount: {
    flexShrink: 0,
    minWidth: 36,
    textAlign: 'right',
    fontSize: 10,
    lineHeight: 14,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
  },
  badge: {
    flexShrink: 0,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '500',
    color: colors.textSecondary,
  },
});
