// AnalyticsPage — native parity port of
// web/src/features/analytics/pages/AnalyticsPage.tsx.
//
// Fleet Analytics dashboard: a hero metric strip (HeroGauges) over a 4-tab
// switcher (Overview / Driving / Charging / Battery), driven by a single
// date-range query (`useFleetAnalytics({ start, end })`). The tab building
// blocks + the TabKey union are imported from the native parity barrel
// (`../components/analytics`) exactly like the web page.
//
// Native adaptations vs. the web source (behavior/state/keys/API intent kept):
//   - react-i18next `useTranslation` (web L2/17) -> a native-safe
//     t(key, fallback, options?) fallback preserving every analytics.* key, the
//     English defaults, and {{m}}/{{h}}/{{d}}/{{w}}/{{state}}/{{label}}
//     interpolation.
//   - lucide-react `BarChart3`/`Car`/`Zap`/`Battery` tab icons (web L3/32-35) ->
//     emoji glyphs (📊/🚗/⚡/🔋) carrying the same visual intent; lucide-react is
//     browser-only.
//   - `@/components/layout` `PageContainer` (web L4/54-60) -> an inline RN
//     PageScaffold: a ScrollView with the same t() title + subtitle header, the
//     `actions` slot, and the same loading(spinner)/error(banner) body gating.
//     Its children are wrapped in a PageErrorBoundary mirroring the web
//     `<PageErrorBoundary pageName={title}>`.
//   - `@/components/ui` `TabNav` (web L5/64) -> an inline horizontally-scrolling
//     RN TabNav with the same {tabs, active, onChange} contract.
//   - `@/components/data-display` `DataFreshnessAuto` (web L6/42) -> an inline RN
//     FreshnessChip (same fresh/fetching/stale/error states + relative-time
//     label, tap-to-refetch, 30s tick).
//   - `@/components/forms` `RangePicker` (web L7/43-49) -> an inline RN
//     RangePicker: a trigger that opens a preset Modal. The web 2-month
//     react-day-picker calendar is DOM-only, so the custom-range calendar is
//     reduced to the preset chips the page actually exposes
//     (['7d','30d','90d','1y','all']); preset-click still applies immediately +
//     fires onChange + closes, exactly like the web contract. `align` +
//     `triggerTestId` are preserved.
//   - `@/hooks/useRangeState` (web L8/22-25) -> a native-safe useRangeState that
//     seeds [start,end] from `defaultPresetId` ('30d') and exposes setRange. The
//     web URL(react-router)/localStorage precedence is unavailable in RN, so
//     persistence is a documented no-op; the `persistKey` argument is preserved.
//   - `@/hooks/usePageTitle` (web L10/18) -> a native-safe no-op (RN has no
//     browser tab / document title); the call site + argument are preserved.
//
// No DOM/Recharts/Leaflet/react-router/framer-motion/lucide/old web-UI imports
// reach the native output — only react, react-native primitives, the canonical
// AppText + theme tokens, the native useFleetAnalytics hook, and the native
// analytics tab barrel.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';
import {useFleetAnalytics} from '../../../api/hooks/useAnalytics';
import {
  BatteryTab,
  ChargingTab,
  DrivingTab,
  HeroGauges,
  OverviewTab,
  type TabKey,
} from '../components/analytics';

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

// ---- Date-range presets (web @/lib/datePresets, subset) ---------------------
// Ported verbatim from web/src/lib/datePresets.ts for the presets this page
// uses: the useRangeState default ('30d') and the RangePicker chip set
// (['7d','30d','90d','1y','all']). `resolve(now)` uses the LOCAL calendar day so
// "today" matches wall-clock even late at night, exactly like the web helper.

interface RangeValue {
  start: string;
  end: string;
}

interface RangePreset {
  id: string;
  i18nKey: string;
  fallback: string;
  resolve: (now?: Date) => RangeValue;
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const RANGE_PRESETS: RangePreset[] = [
  {
    id: '7d',
    i18nKey: 'date.preset.last7',
    fallback: 'Last 7 days',
    resolve: (now = new Date()) => {
      const s = new Date(now);
      s.setDate(s.getDate() - 6);
      return {start: isoDate(s), end: isoDate(now)};
    },
  },
  {
    id: '30d',
    i18nKey: 'date.preset.last30',
    fallback: 'Last 30 days',
    resolve: (now = new Date()) => {
      const s = new Date(now);
      s.setDate(s.getDate() - 29);
      return {start: isoDate(s), end: isoDate(now)};
    },
  },
  {
    id: '90d',
    i18nKey: 'date.preset.last90',
    fallback: 'Last 90 days',
    resolve: (now = new Date()) => {
      const s = new Date(now);
      s.setDate(s.getDate() - 89);
      return {start: isoDate(s), end: isoDate(now)};
    },
  },
  {
    id: '1y',
    i18nKey: 'date.preset.last1y',
    fallback: 'Last year',
    resolve: (now = new Date()) => {
      const s = new Date(now);
      s.setFullYear(s.getFullYear() - 1);
      return {start: isoDate(s), end: isoDate(now)};
    },
  },
  {
    id: 'all',
    i18nKey: 'date.preset.all',
    fallback: 'All time',
    resolve: (now = new Date()) => ({start: '2015-01-01', end: isoDate(now)}),
  },
];

function getRangePreset(id: string): RangePreset | undefined {
  return RANGE_PRESETS.find(p => p.id === id);
}

/** web datePresets `matchPresetId` — id whose resolved range equals [start,end]. */
function matchRangePresetId(start: string, end: string): string | undefined {
  for (const preset of RANGE_PRESETS) {
    const r = preset.resolve();
    if (r.start === start && r.end === end) {
      return preset.id;
    }
  }
  return undefined;
}

// ---- Native-safe useRangeState (web @/hooks/useRangeState) -------------------

interface UseRangeStateOptions {
  persistKey?: string;
  defaultPresetId?: string;
}

interface UseRangeStateReturn {
  start: string;
  end: string;
  setRange: (range: RangeValue) => void;
}

/**
 * Web `useRangeState` resolves [start,end] with precedence
 * URL > localStorage > default preset and persists every change to
 * localStorage[persistKey]. React Native has neither react-router URL params nor
 * localStorage, so this native port seeds from `defaultPresetId` and keeps the
 * range in component state. The `persistKey` argument is preserved (and threaded
 * through the effect deps) so a future AsyncStorage wire-up drops in here without
 * touching the call site.
 */
function useRangeState(opts: UseRangeStateOptions = {}): UseRangeStateReturn {
  const {persistKey, defaultPresetId = '30d'} = opts;

  const [range, setRangeState] = useState<RangeValue>(() => {
    const preset = getRangePreset(defaultPresetId) ?? getRangePreset('30d');
    return preset
      ? preset.resolve()
      : {start: isoDate(new Date()), end: isoDate(new Date())};
  });

  useEffect(() => {
    // Web persists the effective range to localStorage[persistKey] on every
    // change. RN has no localStorage; persistence is a documented native no-op.
    // The persistKey + range deps mirror the web effect's shape.
  }, [persistKey, range.start, range.end]);

  const setRange = useCallback((next: RangeValue) => {
    setRangeState(next);
  }, []);

  return {start: range.start, end: range.end, setRange};
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
      <View
        style={[styles.freshnessDot, {backgroundColor: FRESHNESS_DOT[status]}]}
      />
      {label ? (
        <AppText style={styles.freshnessText} variant="caption">
          {label}
        </AppText>
      ) : null}
    </Pressable>
  );
}

// ---- Inline RangePicker (web forms RangePicker) -----------------------------

interface RangePickerProps {
  value: RangeValue;
  onChange: (value: RangeValue, presetId?: string) => void;
  presetIds?: readonly string[];
  align?: 'start' | 'end';
  triggerTestId?: string;
  t: NativeTFunction;
}

function RangePicker({
  value,
  onChange,
  presetIds,
  align = 'start',
  triggerTestId,
  t,
}: RangePickerProps): React.ReactElement {
  const [open, setOpen] = useState(false);

  const presets = useMemo(() => {
    const ids = presetIds ?? RANGE_PRESETS.map(p => p.id);
    return ids
      .map(getRangePreset)
      .filter((p): p is RangePreset => p !== undefined);
  }, [presetIds]);

  const activeId = matchRangePresetId(value.start, value.end);
  const activePreset = activeId ? getRangePreset(activeId) : undefined;
  const triggerLabel = activePreset
    ? t(activePreset.i18nKey, activePreset.fallback)
    : `${value.start} – ${value.end}`;

  const handleSelect = (preset: RangePreset) => {
    const r = preset.resolve();
    onChange({start: r.start, end: r.end}, preset.id);
    setOpen(false);
  };

  return (
    <>
      <Pressable
        accessibilityLabel={t('rangePicker.trigger', 'Date range: {{label}}', {
          label: triggerLabel,
        })}
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        style={styles.rangeTrigger}
        testID={triggerTestId}>
        <AppText style={styles.rangeTriggerGlyph} variant="caption">
          🗓
        </AppText>
        <AppText style={styles.rangeTriggerText} variant="caption" weight="semibold">
          {triggerLabel}
        </AppText>
        <AppText style={styles.rangeChevron}>▾</AppText>
      </Pressable>
      <Modal
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        transparent
        visible={open}>
        <View
          style={[
            styles.overlay,
            align === 'end' ? styles.overlayEnd : styles.overlayStart,
          ]}>
          <Pressable
            accessibilityLabel={t('rangePicker.dismiss', 'Dismiss')}
            onPress={() => setOpen(false)}
            style={styles.backdrop}
          />
          <View style={styles.modalCard}>
            <AppText style={styles.modalTitle} weight="semibold">
              {t('rangePicker.title', 'Select range')}
            </AppText>
            {presets.map(preset => {
              const selected = preset.id === activeId;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{selected}}
                  key={preset.id}
                  onPress={() => handleSelect(preset)}
                  style={({pressed}) => [
                    styles.presetRow,
                    selected && styles.presetRowActive,
                    pressed && styles.pressed,
                  ]}>
                  <AppText
                    style={selected ? styles.presetLabelActive : styles.presetLabel}>
                    {t(preset.i18nKey, preset.fallback)}
                  </AppText>
                  {selected ? (
                    <AppText style={styles.presetCheck}>✓</AppText>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </View>
      </Modal>
    </>
  );
}

// ---- Inline TabNav (web ui TabNav) ------------------------------------------

interface TabDescriptor {
  key: string;
  label: string;
  icon?: ReactNode;
}

function TabNav({
  tabs,
  active,
  onChange,
}: {
  tabs: TabDescriptor[];
  active: string;
  onChange: (key: string) => void;
}): React.ReactElement {
  return (
    <ScrollView
      contentContainerStyle={styles.tabBarContent}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.tabBar}>
      {tabs.map(tab => {
        const isActive = active === tab.key;
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{selected: isActive}}
            key={tab.key}
            onPress={() => onChange(tab.key)}
            style={({pressed}) => [
              styles.tab,
              isActive && styles.tabActive,
              pressed && styles.pressed,
            ]}>
            {tab.icon}
            <AppText
              style={isActive ? styles.tabLabelActive : styles.tabLabel}
              variant="caption"
              weight="semibold">
              {tab.label}
            </AppText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// ---- Inline PageErrorBoundary (web feedback PageErrorBoundary) ---------------

interface PageErrorBoundaryProps {
  pageName: string;
  children: ReactNode;
}

interface PageErrorBoundaryState {
  hasError: boolean;
}

/**
 * Mirrors the web `<PageErrorBoundary pageName={title}>` that PageContainer
 * wraps its children in: a render failure inside a tab doesn't blank the whole
 * app, and the `[ErrorBoundary:page:{name}]` log keeps the web name correlation.
 */
class PageErrorBoundary extends React.Component<
  PageErrorBoundaryProps,
  PageErrorBoundaryState
> {
  state: PageErrorBoundaryState = {hasError: false};

  static getDerivedStateFromError(): PageErrorBoundaryState {
    return {hasError: true};
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[ErrorBoundary:page:${this.props.pageName}]`, {
      error: error.message,
      componentStack: info.componentStack,
    });
  }

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }
    return (
      <View accessibilityRole="alert" style={styles.pageError}>
        <AppText style={styles.pageErrorGlyph}>⚠</AppText>
        <AppText style={styles.pageErrorText} variant="caption">
          This page failed to render.
        </AppText>
      </View>
    );
  }
}

// ---- Page scaffold (web layout PageContainer) -------------------------------

function PageScaffold({
  title,
  subtitle,
  actions,
  loading,
  error,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  loading?: boolean;
  error?: Error | null;
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
          {subtitle ? (
            <AppText style={styles.pageSubtitle} tone="muted" variant="caption">
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {actions ? <View style={styles.headerActions}>{actions}</View> : null}
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : error ? (
        <View accessibilityRole="alert" style={styles.errorBox}>
          <AppText style={styles.errorText} variant="caption">
            {error.message}
          </AppText>
        </View>
      ) : (
        <PageErrorBoundary pageName={title}>{children}</PageErrorBoundary>
      )}
    </ScrollView>
  );
}

// ---- Page --------------------------------------------------------------------

export default function AnalyticsPage(): React.ReactElement {
  const t = useNativeTranslationFallback();
  usePageTitle(t('analytics.title', 'Fleet Analytics'));

  const [activeTab, setActiveTab] = useState<TabKey>('overview');

  const {start, end, setRange} = useRangeState({
    persistKey: 'analytics.range',
    defaultPresetId: '30d',
  });

  const fleetQuery = useFleetAnalytics({start, end});
  const {data, isLoading, error} = fleetQuery;

  const tabs = useMemo<TabDescriptor[]>(
    () => [
      {
        key: 'overview',
        label: t('analytics.tabs.overview', 'Overview'),
        icon: <AppText style={styles.tabIcon}>📊</AppText>,
      },
      {
        key: 'driving',
        label: t('analytics.tabs.driving', 'Driving'),
        icon: <AppText style={styles.tabIcon}>🚗</AppText>,
      },
      {
        key: 'charging',
        label: t('analytics.tabs.charging', 'Charging'),
        icon: <AppText style={styles.tabIcon}>⚡</AppText>,
      },
      {
        key: 'battery',
        label: t('analytics.tabs.battery', 'Battery'),
        icon: <AppText style={styles.tabIcon}>🔋</AppText>,
      },
    ],
    [t],
  );

  const headerActions = (
    <>
      <FreshnessChip query={fleetQuery} t={t} />
      <RangePicker
        align="end"
        onChange={setRange}
        presetIds={['7d', '30d', '90d', '1y', 'all']}
        t={t}
        triggerTestId="analytics-range"
        value={{start, end}}
      />
    </>
  );

  const resolvedError =
    error instanceof Error
      ? error
      : error
        ? new Error(String(error))
        : null;

  return (
    <PageScaffold
      actions={headerActions}
      error={resolvedError}
      loading={isLoading}
      subtitle={t(
        'analytics.subtitle',
        'Comprehensive fleet performance insights',
      )}
      title={t('analytics.title', 'Fleet Analytics')}>
      <View style={styles.content}>
        <HeroGauges data={data} />

        <TabNav
          active={activeTab}
          onChange={k => setActiveTab(k as TabKey)}
          tabs={tabs}
        />

        {activeTab === 'overview' && <OverviewTab data={data} />}
        {activeTab === 'driving' && <DrivingTab data={data} />}
        {activeTab === 'charging' && <ChargingTab data={data} />}
        {activeTab === 'battery' && <BatteryTab data={data} />}
      </View>
    </PageScaffold>
  );
}

const styles = StyleSheet.create({
  scroll: {
    backgroundColor: colors.background,
    flex: 1,
  },
  scrollContent: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  pageHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  pageHeaderText: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 180,
  },
  pageTitle: {
    color: colors.textPrimary,
  },
  pageSubtitle: {
    color: colors.textMuted,
  },
  headerActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
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
  rangeTrigger: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rangeTriggerGlyph: {
    color: colors.textSecondary,
  },
  rangeTriggerText: {
    color: colors.textPrimary,
  },
  rangeChevron: {
    color: colors.textMuted,
    fontSize: 12,
  },
  overlay: {
    backgroundColor: 'rgba(2, 4, 9, 0.72)',
    flex: 1,
    padding: spacing.lg,
  },
  overlayStart: {
    justifyContent: 'flex-start',
  },
  overlayEnd: {
    justifyContent: 'flex-end',
  },
  backdrop: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 20,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.lg,
  },
  modalTitle: {
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  presetRow: {
    alignItems: 'center',
    borderColor: 'transparent',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  presetRowActive: {
    backgroundColor: colors.surfaceSelected,
    borderColor: colors.borderAccent,
  },
  presetLabel: {
    color: colors.textSecondary,
  },
  presetLabelActive: {
    color: colors.textPrimary,
  },
  presetCheck: {
    color: colors.accent,
  },
  pressed: {
    opacity: 0.7,
  },
  content: {
    gap: spacing.md,
  },
  tabBar: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    flexGrow: 0,
  },
  tabBarContent: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    padding: spacing.xs,
  },
  tab: {
    alignItems: 'center',
    borderRadius: 10,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  tabActive: {
    backgroundColor: colors.surfaceHover,
  },
  tabIcon: {
    fontSize: 14,
    lineHeight: 18,
  },
  tabLabel: {
    color: colors.textMuted,
  },
  tabLabelActive: {
    color: colors.textPrimary,
  },
  loadingWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
  },
  errorBox: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderRadius: 16,
    borderWidth: 1,
    padding: spacing.lg,
  },
  errorText: {
    color: colors.danger,
  },
  pageError: {
    alignItems: 'center',
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderRadius: 16,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.lg,
  },
  pageErrorGlyph: {
    color: colors.danger,
  },
  pageErrorText: {
    color: colors.danger,
  },
});
