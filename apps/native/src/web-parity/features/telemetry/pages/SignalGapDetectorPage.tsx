import {Glyph} from '../../../../components/icons/Glyph';
/**
 * Native parity port of
 * web/src/features/telemetry/pages/SignalGapDetectorPage.tsx.
 *
 * The web page is a thin wrapper around the shared `SignalCatalogPanel`: it sets
 * the page title, reads the globally-selected vehicle from the `useSelectedVehicle`
 * store, renders a `PageContainer` (title / subtitle / a `VehicleSelect` action),
 * and — when a vehicle is selected — renders the staleness-aware
 * `<SignalCatalogPanel vehicleId={vehicleId} />`; otherwise it shows an
 * `EmptyState` prompting the operator to pick a vehicle.
 *
 * This native port preserves that contract 1:1 — the same `vehicleId` selection,
 * the `!vehicleId || vehicleId <= 0` gate, and every i18n key + English fallback
 * (incl. the deliberate web quirk where `signalGap.title` resolves to "Signal
 * Gaps" for the page title but "Signal Gap Detector" for the container title) —
 * using React Native primitives, the existing native AppText / GlassPanel +
 * design tokens, and the already-ported native useVehicles / useSignalGaps hooks.
 *
 * Browser-only / not-yet-ported dependencies are reduced explicitly and
 * documented in the `.parity.json` sidecar:
 *   - react-i18next `useTranslation` (web L10): no native i18next runtime, so an
 *     inline native-safe `t(key, fallback?)` returns the English fallback (else
 *     the key). Every key + intent is preserved verbatim.
 *   - `@/components/layout/PageContainer` (web L12): reproduced locally as a
 *     native-safe ScrollView scaffold honouring title / subtitle / actions /
 *     children (the only props this page uses), the AnomalyDashboardPage precedent.
 *   - `@/components/forms` `VehicleSelect` (web L13): a Pressable chip selector
 *     wired to the shared selected-vehicle store (the AnomalyDashboardPage /
 *     SmartChargePage precedent).
 *   - `@/components/feedback` `EmptyState` (web L14): a native-safe centered
 *     icon + title + message empty state (the props this page passes).
 *   - lucide-react `Activity` (web L15) + the SignalCatalogPanel's ArrowUpDown /
 *     RefreshCw / AlertTriangle / Filter icons: DOM SVG icons → decorative
 *     AppText glyph stand-ins (the established native inline-icon precedent).
 *   - `@/hooks/usePageTitle` (web L16): document.title is browser-only → a
 *     documented no-op (the native navigator owns the header title).
 *   - `@/hooks/useSelectedVehicle` (web L17): the web hook layers react-router
 *     params over a zustand store; native has neither, so a native-safe hook
 *     derives the selection from the ported `useVehicles()` list via a shared
 *     module-level external store, preserving the `{ vehicleId }` contract.
 *   - `../components/SignalCatalogPanel` (web L19): no native parity port exists
 *     yet and the file-by-file loop commits exactly one source file + sidecar per
 *     step, so the read-only catalog this page renders (the `vehicleId`-only
 *     usage) is reproduced locally (the RedisSignalViewerPage / AnomalyDashboardPage
 *     "reproduce the un-ported dependency locally" precedent). It preserves the
 *     SignalCatalogPanel state names (search / filterMode / sortMode), the
 *     `useSignalGaps` hook + `/signals/{id}/live` path + 5s cadence, the verbatim
 *     `signals` / `filtered` derivations, the four summary StatCards, the
 *     getCatalogStalenessStyle / formatStaleness helpers, the 50/page DataTable
 *     pagination, and every catalog i18n key. The selection-enabled mode (used
 *     only by the not-yet-ported SignalsWorkspacePage) is omitted because this
 *     page never passes `selection`.
 *
 * No DOM / Recharts / Leaflet / lucide / react-router / old-web-UI imports remain.
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import {useSignalGaps} from '../../../api/hooks/useTelemetry';
import {useVehicles, type Vehicle} from '../../../api/hooks/useVehicles';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';

/* ------------------------------------------------------------------ */
/*  decorative glyph stand-ins (web lucide-react icons)               */
/* ------------------------------------------------------------------ */

const ICON_ACTIVITY = '\uD83D\uDCC8'; // 📈 (Activity)
const ICON_ARROW_UP_DOWN = '\u21C5'; // ⇅ (ArrowUpDown)
const ICON_REFRESH = '\u21BB'; // ↻ (RefreshCw)
const ICON_ALERT = '\u26A0'; // ⚠ (AlertTriangle)
const ICON_FILTER = '\u2261'; // ≡ (Filter)

const EM_DASH = '\u2014';

const MONO_FONT = 'monospace';

/* Tailwind tints used by the web getCatalogStalenessStyle text colours. */
const GREEN_400 = '#4ade80'; // text-green-400
const AMBER_400 = '#fbbf24'; // text-amber-400
const RED_400 = '#f87171'; // text-red-400

/* ------------------------------------------------------------------ */
/*  native-safe i18n (react-i18next has no native runtime, web L10)   */
/* ------------------------------------------------------------------ */

type NativeTFunction = (key: string, fallback?: string) => string;

/** Mirrors `t(key, default?)`: the English default else the key. */
function useNativeTranslation(): NativeTFunction {
  return useMemo<NativeTFunction>(() => (key, fallback) => fallback ?? key, []);
}

/* ------------------------------------------------------------------ */
/*  native-safe usePageTitle (web document.title is browser-only)     */
/* ------------------------------------------------------------------ */

function usePageTitle(_title: string): void {
  // The web hook writes document.title; on native the navigator owns the header
  // title, so the resolved title is intentionally not applied here.
}

/* ------------------------------------------------------------------ */
/*  ported formatters (web @/lib/numberFormat + @/lib/dateFormat)      */
/* ------------------------------------------------------------------ */

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** fmtInt — locale integer (web fmtInt = fmtNumber(v, 0)). */
function fmtInt(v: unknown): string {
  try {
    return safeNumber(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
  } catch {
    return String(Math.round(safeNumber(v)));
  }
}

/** formatDateTime — "Apr 4, 2026, 02:30 AM" else em-dash (web formatDateTime). */
function formatDateTimeNative(value: string | null | undefined): string {
  if (!value) {
    return EM_DASH;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return EM_DASH;
  }
  try {
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return date.toISOString();
  }
}

/** formatStaleness — "12s ago" / "3m ago" / "1h 4m ago" (web formatStaleness). */
function formatStaleness(seconds: number): string {
  if (!Number.isFinite(seconds)) {
    return EM_DASH;
  }
  if (seconds < 60) {
    return `${fmtInt(seconds)}s ago`;
  }
  if (seconds < 3600) {
    return `${fmtInt(seconds / 60)}m ago`;
  }
  const h = Math.floor(seconds / 3600);
  const m = (seconds % 3600) / 60;
  return `${h}h ${fmtInt(m)}m ago`;
}

/** formatRelative — web `<TimeStamp format="relative" />` for last-refreshed. */
function formatRelativeNative(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) {
    return 'Just now';
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ago`;
  }
  if (seconds < 86_400) {
    return `${Math.floor(seconds / 3600)}h ago`;
  }
  return formatDateTimeNative(date.toISOString());
}

/* ------------------------------------------------------------------ */
/*  catalog types + staleness helpers (web SignalCatalogPanel)         */
/* ------------------------------------------------------------------ */

type CatalogFilterMode = 'all' | 'stale' | 'active';
type CatalogSortMode = 'staleness' | 'alpha' | 'category';
type CatalogBadgeVariant = 'success' | 'warning' | 'danger' | 'neutral';

interface SignalRow {
  name: string;
  value: string;
  timestamp: string | null;
  staleness: number;
  category: 'active' | 'stale' | 'never';
}

interface StalenessStyle {
  label: string;
  color: string;
  variant: CatalogBadgeVariant;
}

function getCatalogStalenessStyle(
  seconds: number,
  hasTimestamp: boolean,
): StalenessStyle {
  if (!hasTimestamp) {
    return {
      label: 'Never received',
      color: colors.textMuted,
      variant: 'neutral',
    };
  }
  if (seconds < 30) {
    return { label: 'Active', color: GREEN_400, variant: 'success' };
  }
  if (seconds < 300) {
    return { label: 'Aging', color: AMBER_400, variant: 'warning' };
  }
  return { label: 'Stale', color: RED_400, variant: 'danger' };
}

/* ------------------------------------------------------------------ */
/*  native-safe useSelectedVehicle (web @/hooks/useSelectedVehicle)    */
/* ------------------------------------------------------------------ */

interface SelectedVehicleResult {
  vehicleId: number | null;
  vehicles: Vehicle[];
  setVehicleId: (id: number | null) => void;
}

// Module-level shared selection store (the AnomalyDashboardPage precedent). The
// web hook persists the picker choice in a zustand store so the header
// VehicleSelect and the page body stay in sync; native reproduces that single
// source of truth with a tiny external store. Router precedence is dropped.
let selectedVehicleOverride: number | null = null;
const selectedVehicleListeners = new Set<() => void>();

function getSelectedVehicleOverride(): number | null {
  return selectedVehicleOverride;
}

function subscribeSelectedVehicle(listener: () => void): () => void {
  selectedVehicleListeners.add(listener);
  return () => {
    selectedVehicleListeners.delete(listener);
  };
}

function setSelectedVehicleOverride(id: number | null): void {
  if (selectedVehicleOverride === id) {
    return;
  }
  selectedVehicleOverride = id;
  selectedVehicleListeners.forEach(listener => listener());
}

function useSelectedVehicle(): SelectedVehicleResult {
  const { data } = useVehicles();
  const vehicles = data ?? [];
  const override = useSyncExternalStore(
    subscribeSelectedVehicle,
    getSelectedVehicleOverride,
    getSelectedVehicleOverride,
  );
  const firstVehicleId = vehicles.length > 0 ? vehicles[0].id : null;
  const vehicleId = override ?? firstVehicleId;
  const setVehicleId = useCallback(
    (id: number | null) => setSelectedVehicleOverride(id),
    [],
  );
  return { vehicleId, vehicles, setVehicleId };
}

/* ------------------------------------------------------------------ */
/*  small native primitives                                            */
/* ------------------------------------------------------------------ */

function GlyphLegacyUnused({
  char,
  style,
}: {
  char: string;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={style}
    >
      {char}
    </AppText>
  );
}

const BADGE_TINTS: Record<
  CatalogBadgeVariant,
  { bg: string; border: string; color: string }
> = {
  success: {
    bg: colors.successSurface,
    border: colors.successBorder,
    color: colors.success,
  },
  warning: {
    bg: colors.warningSurface,
    border: colors.warningBorder,
    color: colors.warning,
  },
  danger: {
    bg: colors.dangerSurface,
    border: colors.dangerBorder,
    color: colors.danger,
  },
  neutral: {
    bg: colors.surfaceRaised,
    border: colors.border,
    color: colors.textMuted,
  },
};

function StatusBadge({
  variant,
  label,
}: {
  variant: CatalogBadgeVariant;
  label: string;
}) {
  const tint = BADGE_TINTS[variant];
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: tint.bg, borderColor: tint.border },
      ]}
    >
      <View style={[styles.badgeDot, { backgroundColor: tint.color }]} />
      <AppText style={[styles.badgeLabel, { color: tint.color }]}>
        {label}
      </AppText>
    </View>
  );
}

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: ReactNode;
}) {
  return (
    <GlassPanel style={styles.statCard}>
      <View style={styles.statHeader}>
        <AppText style={styles.statValue} variant="title" weight="bold">
          {fmtInt(value)}
        </AppText>
        <View style={styles.statIcon}>{icon}</View>
      </View>
      <AppText style={styles.statLabel} tone="muted" variant="caption">
        {label}
      </AppText>
    </GlassPanel>
  );
}

/* ------------------------------------------------------------------ */
/*  native EmptyState (web @/components/feedback EmptyState)            */
/* ------------------------------------------------------------------ */

function EmptyState({
  icon,
  title,
  message,
  testID,
}: {
  icon?: ReactNode;
  title?: string;
  message: string;
  testID?: string;
}) {
  return (
    <View style={styles.emptyState} testID={testID}>
      {icon ? <View style={styles.emptyStateIcon}>{icon}</View> : null}
      {title ? (
        <AppText style={styles.emptyStateTitle} weight="semibold">
          {title}
        </AppText>
      ) : null}
      <AppText style={styles.emptyStateMessage} tone="muted" variant="caption">
        {message}
      </AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native VehicleSelect (web @/components/forms VehicleSelect)         */
/* ------------------------------------------------------------------ */

function VehicleSelect() {
  const { vehicleId, vehicles, setVehicleId } = useSelectedVehicle();

  if (vehicles.length === 0) {
    return null;
  }

  return (
    <View style={styles.vehicleSelect} testID="vehicle-select">
      {vehicles.map(v => {
        const active = v.id === vehicleId;
        const label = v.display_name || v.vin || `Vehicle ${v.id}`;
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            hitSlop={4}
            key={v.id}
            onPress={() => setVehicleId(v.id)}
            style={[styles.vehicleChip, active && styles.vehicleChipActive]}
          >
            <AppText
              numberOfLines={1}
              style={[
                styles.vehicleChipText,
                active && styles.vehicleChipTextActive,
              ]}
              variant="caption"
            >
              {label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native PageContainer (web @/components/layout PageContainer)        */
/* ------------------------------------------------------------------ */

function PageContainer({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <ScrollView
      contentContainerStyle={styles.scaffold}
      testID="signal-gap-detector-page"
    >
      <View style={styles.scaffoldHeader}>
        <View style={styles.scaffoldHeaderText}>
          <AppText style={styles.scaffoldTitle} variant="title" weight="bold">
            {title}
          </AppText>
          {subtitle ? (
            <AppText style={styles.scaffoldSubtitle} tone="muted">
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {actions ? <View style={styles.scaffoldActions}>{actions}</View> : null}
      </View>
      <View style={styles.scaffoldBody}>{children}</View>
    </ScrollView>
  );
}

/* ------------------------------------------------------------------ */
/*  native SignalCatalogPanel (web ../components/SignalCatalogPanel)    */
/* ------------------------------------------------------------------ */

const CATALOG_PAGE_SIZE = 50; // web DataTable pagination={{ defaultPageSize: 50 }}

const FILTER_MODES: CatalogFilterMode[] = ['all', 'stale', 'active'];
const SORT_MODES: CatalogSortMode[] = ['staleness', 'alpha', 'category'];

function SignalCatalogPanel({ vehicleId }: { vehicleId: number }) {
  const t = useNativeTranslation();
  const { data: liveData, isLoading, dataUpdatedAt } = useSignalGaps(vehicleId);

  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState<CatalogFilterMode>('all');
  const [sortMode, setSortMode] = useState<CatalogSortMode>('staleness');
  const [page, setPage] = useState(0);

  const now = Date.now();
  const signals: SignalRow[] = useMemo(() => {
    if (!liveData) {
      return [];
    }
    return Object.entries(liveData).map(([name, entry]) => {
      const raw =
        entry && typeof entry === 'object'
          ? (entry as { value?: unknown; timestamp?: string | null })
          : { value: entry, timestamp: null };
      const ts = raw.timestamp ?? null;
      const staleness = ts
        ? (now - new Date(ts).getTime()) / 1000
        : Number.POSITIVE_INFINITY;
      const category: SignalRow['category'] = !ts
        ? 'never'
        : staleness > 300
        ? 'stale'
        : 'active';
      const value = raw.value;
      return {
        name,
        value: value != null ? String(value) : EM_DASH,
        timestamp: ts,
        staleness,
        category,
      };
    });
  }, [liveData, now]);

  const filtered = useMemo(() => {
    let list = signals;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(s => s.name.toLowerCase().includes(q));
    }
    if (filterMode === 'stale') {
      list = list.filter(s => s.category === 'stale' || s.category === 'never');
    }
    if (filterMode === 'active') {
      list = list.filter(s => s.category === 'active');
    }
    list = [...list].sort((a, b) => {
      if (sortMode === 'staleness') {
        return b.staleness - a.staleness;
      }
      if (sortMode === 'alpha') {
        return a.name.localeCompare(b.name);
      }
      const order = { never: 0, stale: 1, active: 2 } as const;
      return order[a.category] - order[b.category];
    });
    return list;
  }, [signals, search, filterMode, sortMode]);

  const activeCount = signals.filter(s => s.category === 'active').length;
  const staleCount = signals.filter(s => s.category === 'stale').length;
  const neverCount = signals.filter(s => s.category === 'never').length;

  // Reset to the first page whenever the result set changes (web DataTable parity).
  useEffect(() => {
    setPage(0);
  }, [search, filterMode, sortMode]);

  const totalPages = Math.max(
    1,
    Math.ceil(filtered.length / CATALOG_PAGE_SIZE),
  );
  const safePage = Math.min(page, totalPages - 1);
  const paged = filtered.slice(
    safePage * CATALOG_PAGE_SIZE,
    safePage * CATALOG_PAGE_SIZE + CATALOG_PAGE_SIZE,
  );

  const filterLabel = (mode: CatalogFilterMode): string =>
    mode === 'all'
      ? t('signalGap.all', 'All')
      : mode === 'stale'
      ? t('signalGap.staleOnly', 'Stale Only')
      : t('signalGap.activeOnly', 'Active Only');

  const sortLabel = (mode: CatalogSortMode): string =>
    mode === 'staleness'
      ? t('signalGap.mostStale', 'Most Stale')
      : mode === 'alpha'
      ? t('signalGap.az', 'A-Z')
      : t('signalGap.category', 'Category');

  return (
    <View style={styles.catalogRoot}>
      <View style={styles.statGrid}>
        <View style={styles.statCell}>
          <StatCard
            label={t('signalGap.totalSignals', 'Total Signals')}
            value={signals.length}
            icon={<Glyph char={ICON_ARROW_UP_DOWN} style={styles.statGlyph} />}
          />
        </View>
        <View style={styles.statCell}>
          <StatCard
            label={t('signalGap.active', 'Active (<30s)')}
            value={activeCount}
            icon={<Glyph char={ICON_REFRESH} style={styles.statGlyph} />}
          />
        </View>
        <View style={styles.statCell}>
          <StatCard
            label={t('signalGap.stale', 'Stale (>5min)')}
            value={staleCount}
            icon={<Glyph char={ICON_ALERT} style={styles.statGlyph} />}
          />
        </View>
        <View style={styles.statCell}>
          <StatCard
            label={t('signalGap.neverReceived', 'Never Received')}
            value={neverCount}
            icon={<Glyph char={ICON_ALERT} style={styles.statGlyph} />}
          />
        </View>
      </View>

      <GlassPanel style={styles.panel}>
        <View style={styles.panelHeader}>
          <View style={styles.refreshNote}>
            <Glyph char={ICON_REFRESH} style={styles.refreshGlyph} />
            <AppText style={styles.refreshText} tone="muted" variant="caption">
              {t('signalGap.refreshInterval', 'Refreshes every 5s')}
            </AppText>
          </View>
        </View>

        <TextInput
          accessibilityLabel={t('signalGap.filterLabel', 'Filter signals')}
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setSearch}
          placeholder={t(
            'signalGap.filterPlaceholder',
            'Filter by signal name...',
          )}
          placeholderTextColor={colors.textMuted}
          style={styles.searchInput}
          testID="signal-gap-search"
          value={search}
        />

        <View style={styles.controlRow}>
          <Glyph char={ICON_FILTER} style={styles.controlGlyph} />
          {FILTER_MODES.map(mode => {
            const active = filterMode === mode;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                key={mode}
                onPress={() => setFilterMode(mode)}
                style={[styles.chipBtn, active && styles.chipBtnActiveFilter]}
              >
                <AppText
                  style={[
                    styles.chipBtnText,
                    active && styles.chipBtnTextFilterActive,
                  ]}
                  variant="caption"
                >
                  {filterLabel(mode)}
                </AppText>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.controlRow}>
          <Glyph char={ICON_ARROW_UP_DOWN} style={styles.controlGlyph} />
          {SORT_MODES.map(mode => {
            const active = sortMode === mode;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                key={mode}
                onPress={() => setSortMode(mode)}
                style={[styles.chipBtn, active && styles.chipBtnActiveSort]}
              >
                <AppText
                  style={[
                    styles.chipBtnText,
                    active && styles.chipBtnTextSortActive,
                  ]}
                  variant="caption"
                >
                  {sortLabel(mode)}
                </AppText>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.tableRegion}>
          {isLoading ? (
            <View style={styles.skeletonStack} testID="signal-gap-loading">
              {Array.from({ length: 8 }).map((_, i) => (
                <View key={i} style={styles.skeletonRow} />
              ))}
            </View>
          ) : filtered.length > 0 ? (
            <View style={styles.tableWrap}>
              {paged.map(signal => {
                const style = getCatalogStalenessStyle(
                  signal.staleness,
                  !!signal.timestamp,
                );
                return (
                  <View
                    key={signal.name}
                    style={styles.rowCard}
                    testID={`signal-gap-row-${signal.name}`}
                  >
                    <View style={styles.rowTop}>
                      <StatusBadge
                        label={style.label}
                        variant={style.variant}
                      />
                      <AppText numberOfLines={1} style={styles.rowName}>
                        {signal.name}
                      </AppText>
                    </View>
                    <View style={styles.rowMeta}>
                      <View style={styles.metaItem}>
                        <AppText
                          style={styles.metaLabel}
                          tone="muted"
                          variant="caption"
                        >
                          {t('signalGap.lastValue', 'Last Value')}
                        </AppText>
                        <AppText
                          numberOfLines={1}
                          style={styles.metaValueMono}
                          tone="secondary"
                          variant="caption"
                        >
                          {signal.value}
                        </AppText>
                      </View>
                      <View style={styles.metaItem}>
                        <AppText
                          style={styles.metaLabel}
                          tone="muted"
                          variant="caption"
                        >
                          {t('signalGap.lastUpdated', 'Last Updated')}
                        </AppText>
                        <AppText
                          style={styles.metaValue}
                          tone="secondary"
                          variant="caption"
                        >
                          {signal.timestamp
                            ? formatDateTimeNative(signal.timestamp)
                            : EM_DASH}
                        </AppText>
                      </View>
                      <View style={styles.metaItem}>
                        <AppText
                          style={styles.metaLabel}
                          tone="muted"
                          variant="caption"
                        >
                          {t('signalGap.timeSince', 'Time Since')}
                        </AppText>
                        <AppText
                          style={[styles.metaValueMono, { color: style.color }]}
                          variant="caption"
                        >
                          {signal.timestamp
                            ? formatStaleness(signal.staleness)
                            : EM_DASH}
                        </AppText>
                      </View>
                    </View>
                  </View>
                );
              })}

              {totalPages > 1 ? (
                <View style={styles.pagination}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ disabled: safePage <= 0 }}
                    disabled={safePage <= 0}
                    onPress={() => setPage(p => Math.max(0, p - 1))}
                    style={[
                      styles.pageBtn,
                      safePage <= 0 && styles.pageBtnDisabled,
                    ]}
                  >
                    <AppText style={styles.pageBtnText} variant="caption">
                      {t('pagination.prev', 'Prev')}
                    </AppText>
                  </Pressable>
                  <AppText
                    style={styles.pageIndicator}
                    tone="muted"
                    variant="caption"
                  >
                    {`${safePage + 1} / ${totalPages}`}
                  </AppText>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{
                      disabled: safePage >= totalPages - 1,
                    }}
                    disabled={safePage >= totalPages - 1}
                    onPress={() =>
                      setPage(p => Math.min(totalPages - 1, p + 1))
                    }
                    style={[
                      styles.pageBtn,
                      safePage >= totalPages - 1 && styles.pageBtnDisabled,
                    ]}
                  >
                    <AppText style={styles.pageBtnText} variant="caption">
                      {t('pagination.next', 'Next')}
                    </AppText>
                  </Pressable>
                </View>
              ) : null}
            </View>
          ) : (
            <AppText
              style={styles.noMatch}
              tone="muted"
              testID="signal-gap-empty"
            >
              {signals.length === 0
                ? t('signalGap.noData', 'No signal data available')
                : t('signalGap.noMatch', 'No signals match current filters')}
            </AppText>
          )}

          {dataUpdatedAt > 0 ? (
            <AppText
              style={styles.lastRefreshed}
              tone="muted"
              variant="caption"
            >
              {`${t(
                'signalGap.lastRefreshed',
                'Last refreshed',
              )}: ${formatRelativeNative(new Date(dataUpdatedAt))}`}
            </AppText>
          ) : null}
        </View>
      </GlassPanel>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Page (web L21-44)                                                  */
/* ------------------------------------------------------------------ */

export default function SignalGapDetectorPage() {
  const t = useNativeTranslation();
  usePageTitle(t('signalGap.title', 'Signal Gaps'));
  const { vehicleId } = useSelectedVehicle();

  return (
    <PageContainer
      title={t('signalGap.title', 'Signal Gap Detector')}
      subtitle={t(
        'signalGap.subtitle',
        'Identify signals that have stopped arriving or have gaps',
      )}
      actions={<VehicleSelect />}
    >
      {!vehicleId || vehicleId <= 0 ? (
        // no-action: vehicle picker is in the page header; no inline CTA needed.
        <EmptyState
          icon={<Glyph char={ICON_ACTIVITY} style={styles.emptyGlyph} />}
          title={t('signalGap.noVehicle', 'Select a vehicle to begin')}
          message={t(
            'signalGap.noVehicleDesc',
            'Pick a vehicle from the picker above to inspect its signal freshness.',
          )}
        />
      ) : (
        <SignalCatalogPanel vehicleId={vehicleId} />
      )}
    </PageContainer>
  );
}

const styles = StyleSheet.create({
  /* PageContainer scaffold */
  scaffold: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  scaffoldHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  scaffoldHeaderText: {
    flexShrink: 1,
    gap: spacing.xs,
  },
  scaffoldTitle: {
    color: colors.textPrimary,
  },
  scaffoldSubtitle: {
    maxWidth: 520,
  },
  scaffoldActions: {
    flexShrink: 1,
  },
  scaffoldBody: {
    gap: spacing.lg,
  },
  /* EmptyState */
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  emptyStateIcon: {
    opacity: 0.8,
  },
  emptyGlyph: {
    fontSize: 30,
    lineHeight: 36,
    color: colors.textSecondary,
  },
  emptyStateTitle: {
    color: colors.textPrimary,
    textAlign: 'center',
  },
  emptyStateMessage: {
    textAlign: 'center',
    maxWidth: 320,
  },
  /* VehicleSelect */
  vehicleSelect: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    justifyContent: 'flex-end',
  },
  vehicleChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surfaceRaised,
  },
  vehicleChipActive: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.surfaceSelected,
  },
  vehicleChipText: {
    color: colors.textSecondary,
  },
  vehicleChipTextActive: {
    color: colors.accent,
  },
  /* Catalog */
  catalogRoot: {
    gap: spacing.md,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  badgeLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  statCell: {
    flexBasis: '47%',
    flexGrow: 1,
  },
  statCard: {
    padding: spacing.md,
    gap: spacing.xs,
  },
  statHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statValue: {
    color: colors.textPrimary,
  },
  statIcon: {
    opacity: 0.85,
  },
  statGlyph: {
    fontSize: 16,
    lineHeight: 20,
    color: colors.accent,
  },
  statLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  panel: {
    padding: spacing.md,
    gap: spacing.md,
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  refreshNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  refreshGlyph: {
    fontSize: 12,
    lineHeight: 16,
    color: colors.textMuted,
  },
  refreshText: {
    fontSize: 10,
  },
  searchInput: {
    color: colors.textPrimary,
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 13,
  },
  controlRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
  },
  controlGlyph: {
    fontSize: 13,
    lineHeight: 16,
    color: colors.textMuted,
    marginRight: spacing.xs,
  },
  chipBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: 'transparent',
  },
  chipBtnActiveFilter: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.accentSoft,
  },
  chipBtnActiveSort: {
    borderColor: colors.violetBorder,
    backgroundColor: colors.violetSurface,
  },
  chipBtnText: {
    color: colors.textMuted,
  },
  chipBtnTextFilterActive: {
    color: colors.accent,
  },
  chipBtnTextSortActive: {
    color: colors.violet,
  },
  tableRegion: {
    gap: spacing.sm,
  },
  tableWrap: {
    gap: spacing.sm,
  },
  rowCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: spacing.md,
    gap: spacing.sm,
    backgroundColor: colors.surfaceRaised,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rowName: {
    flex: 1,
    color: colors.textPrimary,
    fontFamily: MONO_FONT,
    fontSize: 13,
  },
  rowMeta: {
    gap: spacing.xs,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  metaLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    fontSize: 10,
  },
  metaValue: {
    flexShrink: 1,
    textAlign: 'right',
  },
  metaValueMono: {
    flexShrink: 1,
    textAlign: 'right',
    fontFamily: MONO_FONT,
  },
  skeletonStack: {
    gap: spacing.sm,
  },
  skeletonRow: {
    height: 48,
    borderRadius: 12,
    backgroundColor: colors.surfaceRaised,
  },
  noMatch: {
    textAlign: 'center',
    paddingVertical: spacing.xl,
  },
  lastRefreshed: {
    fontSize: 10,
    textAlign: 'right',
  },
  pagination: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  pageBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surfaceRaised,
  },
  pageBtnDisabled: {
    opacity: 0.4,
  },
  pageBtnText: {
    color: colors.textSecondary,
  },
  pageIndicator: {
    minWidth: 48,
    textAlign: 'center',
  },
});
