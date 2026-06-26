// SoftwareUpdatesPage — native parity port of
// web/src/features/vehicle-systems/pages/SoftwareUpdatesPage.tsx.
//
// Track firmware versions and update history: three summary metric cards
// (current version / updates installed / total updates), an opt-in Helix
// changelog summarizer, and a vertical update timeline with per-update status
// dot, version chip, status badge, "release notes" link, vehicle name,
// installed/scheduled/created dates, and pagination. Every state name, the
// /software-updates API path + snake_case query params (vehicle_id, limit,
// offset, start, end), the pageSize, the persistKey/defaultPresetId range
// contract, the STATUS_CONFIG status→variant map, the i18n keys + English
// fallbacks, and the deterministic-baseline-plus-opt-in-AI layout are preserved
// verbatim from the web source.
//
// Native adaptations vs. the web source (behavior / state / keys / intent kept):
//   - react-i18next useTranslation (web L9) -> native-safe t(key, fallback?)
//     returning fallback ?? key (the web bare-English-key calls like
//     t('Software Updates') still resolve to their English text).
//   - lucide-react icons (web L10-13: Download, CheckCircle, Clock,
//     ArrowUpCircle, Smartphone, Calendar, ExternalLink, AlertCircle) -> inline
//     text/emoji glyphs (lucide is browser-only SVG).
//   - @/components/layout PageContainer (web L15) -> inline RN PageContainer
//     (ScrollView header + title/subtitle/actions; loading swaps children for a
//     centered ActivityIndicator, matching the web Spinner-only loading state).
//   - @/components/ui GlassPanel/Badge/Pagination (web L16) -> canonical native
//     GlassPanel + inline RN Badge + inline RN Pagination (first/prev/page/next/
//     last + "Showing X–Y of Z", always rendered like the web nav).
//   - @/components/data-display MetricCard (web L17) -> inline RN MetricCard
//     (label + value + colored icon box).
//   - @/components/feedback Skeleton/EmptyState/AlertBanner (web L18) -> inline
//     RN equivalents.
//   - @/lib/errorMessage getErrorMessage (web L19) -> ported inline.
//   - @/components/motion FadeIn (web L20, framer-motion) -> inline RN Animated
//     FadeIn (fade + slide-up, reduced-motion aware via AccessibilityInfo).
//   - @/components/forms RangePicker/VehicleSelect (web L21) -> inline RN
//     equivalents (preset sheet via Modal; read-only vehicle chip).
//   - @/components/ai/AISoftwareUpdateChangelogSummarizer (web L22) -> imported
//     from the already-converted native sibling (renders null unless the AI
//     feature flag is on, matching web).
//   - @/hooks useSelectedVehicle/usePageTitle/useRangeState (web L24-26) ->
//     inline native shims: vehicle from native useVehicles ({vehicleId,
//     vehicles}); usePageTitle no-op (RN has no document.title); useRangeState
//     resolves the preset window and keeps it in an in-memory module store keyed
//     by persistKey (RN has no react-router URL nor localStorage).
//   - @/lib/dateFormat formatDate (web L27) -> ported inline (null/invalid -> '—').
//   - @/lib/cn cn (web L28) -> dropped; RN has no className, styles compose via
//     StyleSheet + style arrays.
//   - @/api/client request (web L29) -> native parity ../../../api/client request
//     (same /software-updates path, auto /api/v1 prefix).
//   - The DOM <a href target="_blank"> release-notes link is replaced with
//     Linking.openURL of the same notateslaapp.com URL (rule 7).
//
// No DOM/Recharts/Leaflet/react-router/react-i18next/framer-motion/lucide/old
// web-UI import reaches the native output — only react, react-native primitives,
// the canonical AppText/GlassPanel + theme tokens, the native vehicles hook, the
// native API client, and the already-native AISoftwareUpdateChangelogSummarizer.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {useQuery} from '@tanstack/react-query';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {AISoftwareUpdateChangelogSummarizer} from '../../../components/ai/AISoftwareUpdateChangelogSummarizer';
import {request} from '../../../api/client';
import {useVehicles, type Vehicle} from '../../../api/hooks/useVehicles';

// ---- Native-safe i18n fallback (web react-i18next useTranslation) -----------

type NativeTFunction = (key: string, fallback?: string) => string;

function useTranslation(): {t: NativeTFunction} {
  // The web source mixes namespaced keys with English fallbacks
  // (t('softwareUpdates.title', 'Software Updates')) and bare English keys
  // (t('Software Updates'), t('Scheduled')). Returning `fallback ?? key`
  // resolves both to their English text without an i18n runtime.
  const t = useCallback<NativeTFunction>((key, fallback) => fallback ?? key, []);
  return {t};
}

// ---- Native-safe usePageTitle (web @/hooks/usePageTitle) --------------------

function usePageTitle(title: string): void {
  useEffect(() => {
    // React Native has no browser tab / document.title to write; no-op. The
    // title dependency mirrors the web hook so the effect re-runs on changes.
  }, [title]);
}

// ---- errorMessage (web @/lib/errorMessage getErrorMessage) ------------------

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'string') {
    return err;
  }
  return 'An unexpected error occurred';
}

// ---- dateFormat (web @/lib/dateFormat formatDate) — subset this page uses ----

const FALLBACK = '—';

// Date only: "Apr 4, 2026". Mirrors the web formatter's null/invalid guard and
// its default (device) locale + en-US-shaped fields.
function formatDate(iso: string | Date | null | undefined): string {
  if (!iso) {
    return FALLBACK;
  }
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return FALLBACK;
  }
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ---- datePresets (web @/lib/datePresets) — subset useRangeState needs --------

interface DatePresetRange {
  start: string;
  end: string;
}

interface DatePreset {
  id: string;
  fallback: string;
  resolve: (now?: Date) => DatePresetRange;
}

function isoLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const DATE_PRESETS: DatePreset[] = [
  {
    id: 'today',
    fallback: 'Today',
    resolve: (now = new Date()) => ({start: isoLocal(now), end: isoLocal(now)}),
  },
  {
    id: '7d',
    fallback: 'Last 7 days',
    resolve: (now = new Date()) => {
      const s = new Date(now);
      s.setDate(s.getDate() - 6);
      return {start: isoLocal(s), end: isoLocal(now)};
    },
  },
  {
    id: '30d',
    fallback: 'Last 30 days',
    resolve: (now = new Date()) => {
      const s = new Date(now);
      s.setDate(s.getDate() - 29);
      return {start: isoLocal(s), end: isoLocal(now)};
    },
  },
  {
    id: '90d',
    fallback: 'Last 90 days',
    resolve: (now = new Date()) => {
      const s = new Date(now);
      s.setDate(s.getDate() - 89);
      return {start: isoLocal(s), end: isoLocal(now)};
    },
  },
  {
    id: 'mtd',
    fallback: 'Month to date',
    resolve: (now = new Date()) => ({
      start: isoLocal(new Date(now.getFullYear(), now.getMonth(), 1)),
      end: isoLocal(now),
    }),
  },
  {
    id: 'ytd',
    fallback: 'Year to date',
    resolve: (now = new Date()) => ({
      start: isoLocal(new Date(now.getFullYear(), 0, 1)),
      end: isoLocal(now),
    }),
  },
  {
    id: '1y',
    fallback: 'Last year',
    resolve: (now = new Date()) => {
      const s = new Date(now);
      s.setFullYear(s.getFullYear() - 1);
      return {start: isoLocal(s), end: isoLocal(now)};
    },
  },
  {
    id: 'all',
    fallback: 'All time',
    resolve: (now = new Date()) => ({start: '2015-01-01', end: isoLocal(now)}),
  },
];

function getDatePreset(id: string): DatePreset | undefined {
  return DATE_PRESETS.find(p => p.id === id);
}

function matchPresetId(start: string, end: string, now?: Date): string | undefined {
  for (const preset of DATE_PRESETS) {
    const r = preset.resolve(now);
    if (r.start === start && r.end === end) {
      return preset.id;
    }
  }
  return undefined;
}

// ---- useRangeState (web @/hooks/useRangeState) — native-safe -----------------

interface RangeValue {
  start: string;
  end: string;
}

// Web persists the last-selected range to localStorage and syncs it to the URL.
// React Native has neither, so an in-memory module store keyed by `persistKey`
// preserves the "remember my range across remounts" intent within the session.
const rangeMemory = new Map<string, RangeValue>();

function useRangeState(opts: {
  persistKey?: string;
  defaultPresetId?: string;
}): {start: string; end: string; setRange: (range: RangeValue) => void} {
  const {persistKey, defaultPresetId = '30d'} = opts;

  const fallback = useMemo<RangeValue>(() => {
    const preset = getDatePreset(defaultPresetId) ?? getDatePreset('30d');
    return preset ? preset.resolve() : DATE_PRESETS[2].resolve();
  }, [defaultPresetId]);

  const [range, setRangeState] = useState<RangeValue>(() => {
    if (persistKey) {
      const stored = rangeMemory.get(persistKey);
      if (stored) {
        return stored;
      }
    }
    return fallback;
  });

  const setRange = useCallback(
    (next: RangeValue) => {
      if (persistKey) {
        rangeMemory.set(persistKey, next);
      }
      setRangeState(next);
    },
    [persistKey],
  );

  return {start: range.start, end: range.end, setRange};
}

// ---- useSelectedVehicle (web @/hooks/useSelectedVehicle) — native -----------

function useSelectedVehicle(): {vehicleId: number | null; vehicles: Vehicle[]} {
  const {data} = useVehicles();
  const vehicles = data ?? [];
  const vehicleId = vehicles.length > 0 ? vehicles[0].id : null;
  return {vehicleId, vehicles};
}

// ---- Accent palette (web @/lib/tokens neon colours, toned for body) ---------

type Accent = 'cyan' | 'green' | 'amber' | 'red' | 'purple' | 'neutral';

const ACCENT_HEX: Record<Accent, string> = {
  cyan: '#22d3ee',
  green: '#10b981',
  amber: '#f59e0b',
  red: '#ef4444',
  purple: '#a855f7',
  neutral: '#94a3b8',
};

// ---- Small shared primitives ------------------------------------------------

function Glyph({
  glyph,
  color,
  size = 13,
}: {
  glyph: string;
  color?: string;
  size?: number;
}): React.ReactElement {
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[styles.glyph, {fontSize: size, color: color ?? colors.textMuted}]}>
      {glyph}
    </AppText>
  );
}

// ---- FadeIn (web @/components/motion FadeIn — framer-motion) -----------------

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
        styles.section,
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

// ---- PageContainer (web @/components/layout PageContainer) -------------------

function PageContainer({
  title,
  subtitle,
  actions,
  loading,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  loading?: boolean;
  children?: ReactNode;
}): React.ReactElement {
  return (
    <ScrollView style={styles.pageRoot} contentContainerStyle={styles.pageContent}>
      <View style={styles.pageHeader}>
        <View style={styles.pageHeaderText}>
          <AppText variant="display" weight="bold">
            {title}
          </AppText>
          {subtitle ? (
            <AppText style={styles.pageSubtitle} tone="muted" variant="caption">
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {actions ? <View style={styles.pageActions}>{actions}</View> : null}
      </View>
      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : (
        children
      )}
    </ScrollView>
  );
}

// ---- MetricCard (web @/components/data-display MetricCard) -------------------

function MetricCard({
  glyph,
  label,
  value,
  color = 'cyan',
}: {
  glyph: string;
  label: string;
  value: string | number;
  color?: Accent;
}): React.ReactElement {
  const hex = ACCENT_HEX[color];
  return (
    <View style={styles.metricCard}>
      <View style={styles.metricCardLeft}>
        <AppText
          variant="caption"
          tone="muted"
          style={styles.metricLabel}
          numberOfLines={1}>
          {label}
        </AppText>
        <AppText weight="bold" style={styles.metricValue} numberOfLines={1}>
          {value}
        </AppText>
      </View>
      <View
        style={[
          styles.metricIconBox,
          {borderColor: `${hex}33`, backgroundColor: `${hex}1a`},
        ]}>
        <Glyph glyph={glyph} color={hex} size={15} />
      </View>
    </View>
  );
}

// ---- Badge (web @/components/ui Badge) ---------------------------------------

type BadgeVariant = 'success' | 'info' | 'warning' | 'neutral';

const BADGE_ACCENT: Record<BadgeVariant, Accent> = {
  success: 'green',
  info: 'cyan',
  warning: 'amber',
  neutral: 'neutral',
};

function Badge({
  variant,
  children,
}: {
  variant: BadgeVariant;
  children: ReactNode;
}): React.ReactElement {
  const hex = ACCENT_HEX[BADGE_ACCENT[variant]];
  return (
    <View style={[styles.badge, {borderColor: `${hex}55`, backgroundColor: `${hex}1a`}]}>
      <AppText variant="caption" weight="semibold" style={{color: hex}}>
        {children}
      </AppText>
    </View>
  );
}

// ---- feedback (web @/components/feedback) ------------------------------------

function Skeleton({height = 80}: {height?: number}): React.ReactElement {
  return <View style={[styles.skeleton, {height}]} />;
}

function EmptyState({
  glyph,
  title,
  message,
}: {
  glyph?: string;
  title?: string;
  message: string;
}): React.ReactElement {
  return (
    <View accessibilityRole="summary" style={styles.emptyState}>
      {glyph ? <Glyph glyph={glyph} size={30} /> : null}
      {title ? (
        <AppText weight="semibold" style={styles.emptyTitle}>
          {title}
        </AppText>
      ) : null}
      <AppText tone="muted" variant="caption" style={styles.emptyMessage}>
        {message}
      </AppText>
    </View>
  );
}

function AlertBanner({
  variant,
  glyph,
  children,
}: {
  variant: 'info' | 'success' | 'warning' | 'danger';
  glyph?: string;
  children: ReactNode;
}): React.ReactElement {
  const hex =
    variant === 'danger'
      ? ACCENT_HEX.red
      : variant === 'warning'
      ? ACCENT_HEX.amber
      : variant === 'success'
      ? ACCENT_HEX.green
      : ACCENT_HEX.cyan;
  return (
    <View
      style={[styles.alertBanner, {borderColor: `${hex}33`, backgroundColor: `${hex}0d`}]}>
      {glyph ? <Glyph glyph={glyph} color={hex} size={16} /> : null}
      <AppText variant="caption" style={[styles.alertText, {color: hex}]}>
        {children}
      </AppText>
    </View>
  );
}

// ---- VehicleSelect (web @/components/forms VehicleSelect) — read-only chip ---

function VehicleSelect(): React.ReactElement {
  const {data} = useVehicles();
  const current = data && data.length > 0 ? data[0] : null;
  return (
    <View style={styles.vehicleSelect}>
      <Glyph glyph="🚗" />
      <AppText variant="caption" weight="semibold" style={styles.vehicleSelectText}>
        {current?.display_name ?? FALLBACK}
      </AppText>
    </View>
  );
}

// ---- RangePicker (web @/components/forms RangePicker) ------------------------

function RangePicker({
  value,
  onChange,
  triggerTestId,
}: {
  value: {start: string; end: string};
  onChange: (r: {start: string; end: string}) => void;
  align?: 'start' | 'end';
  triggerTestId?: string;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const activeId = matchPresetId(value.start, value.end);
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        testID={triggerTestId}
        style={styles.rangeTrigger}>
        <Glyph glyph="📅" />
        <AppText variant="caption" weight="semibold">
          {activeId
            ? getDatePreset(activeId)?.fallback ?? `${value.start} – ${value.end}`
            : `${value.start} – ${value.end}`}
        </AppText>
      </Pressable>
      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <AppText weight="semibold" style={styles.modalTitle}>
              Date range
            </AppText>
            {DATE_PRESETS.map(p => {
              const r = p.resolve();
              const isActive = r.start === value.start && r.end === value.end;
              return (
                <Pressable
                  key={p.id}
                  onPress={() => {
                    setOpen(false);
                    onChange(r);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{selected: isActive}}
                  style={[styles.modalRow, isActive && styles.modalRowActive]}>
                  <AppText weight={isActive ? 'semibold' : 'regular'}>
                    {p.fallback}
                  </AppText>
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

// ---- Pagination (web @/components/ui Pagination) -----------------------------

function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (p: number) => void;
}): React.ReactElement {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  const atFirst = page <= 1;
  const atLast = page >= totalPages;
  return (
    <View style={styles.pagination}>
      <AppText variant="caption" tone="muted">
        {`Showing ${total > 0 ? start : 0}–${end} of ${total}`}
      </AppText>
      <View style={styles.pageControls}>
        <Pressable
          disabled={atFirst}
          onPress={() => onPageChange(1)}
          accessibilityRole="button"
          accessibilityLabel="First page"
          style={[styles.pageBtn, atFirst && styles.pageBtnDisabled]}>
          <AppText variant="caption" weight="semibold">
            «
          </AppText>
        </Pressable>
        <Pressable
          disabled={atFirst}
          onPress={() => onPageChange(page - 1)}
          accessibilityRole="button"
          accessibilityLabel="Previous page"
          style={[styles.pageBtn, atFirst && styles.pageBtnDisabled]}>
          <AppText variant="caption" weight="semibold">
            ‹
          </AppText>
        </Pressable>
        <AppText variant="caption" tone="secondary" style={styles.pageIndicator}>
          {`${page} / ${totalPages}`}
        </AppText>
        <Pressable
          disabled={atLast}
          onPress={() => onPageChange(page + 1)}
          accessibilityRole="button"
          accessibilityLabel="Next page"
          style={[styles.pageBtn, atLast && styles.pageBtnDisabled]}>
          <AppText variant="caption" weight="semibold">
            ›
          </AppText>
        </Pressable>
        <Pressable
          disabled={atLast}
          onPress={() => onPageChange(totalPages)}
          accessibilityRole="button"
          accessibilityLabel="Last page"
          style={[styles.pageBtn, atLast && styles.pageBtnDisabled]}>
          <AppText variant="caption" weight="semibold">
            »
          </AppText>
        </Pressable>
      </View>
    </View>
  );
}

// ---- Types ------------------------------------------------------------------

interface SoftwareUpdate {
  id: number;
  vehicle_id: number;
  version: string;
  status: string;
  installed_at: string | null;
  scheduled_at: string | null;
  created_at: string;
}

// ---- Status config ----------------------------------------------------------

interface StatusConfig {
  color: string;
  glyph: string;
  badgeVariant: BadgeVariant;
  label: string;
}

const STATUS_CONFIG: Record<string, StatusConfig> = {
  installed: {color: ACCENT_HEX.green, glyph: '✓', badgeVariant: 'success', label: 'Installed'},
  installing: {color: ACCENT_HEX.cyan, glyph: '↓', badgeVariant: 'info', label: 'Installing'},
  downloading: {color: ACCENT_HEX.cyan, glyph: '↓', badgeVariant: 'info', label: 'Downloading'},
  available: {color: ACCENT_HEX.amber, glyph: '⬆', badgeVariant: 'warning', label: 'Available'},
  scheduled: {color: colors.textMuted, glyph: '🕘', badgeVariant: 'neutral', label: 'Scheduled'},
};

function getStatus(status: string): StatusConfig {
  return STATUS_CONFIG[status] ?? STATUS_CONFIG.available;
}

// ---- Page -------------------------------------------------------------------

export default function SoftwareUpdatesPage(): React.ReactElement {
  const {t} = useTranslation();
  usePageTitle(t('softwareUpdates.title', 'Software Updates'));

  const {vehicleId, vehicles} = useSelectedVehicle();
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const {start, end, setRange} = useRangeState({
    persistKey: 'software-updates.range',
    defaultPresetId: 'all',
  });

  const {
    data: updates,
    isLoading,
    error: dataError,
  } = useQuery({
    queryKey: ['software-updates', vehicleId, page, start, end],
    queryFn: () => {
      const params = new URLSearchParams({
        vehicle_id: String(vehicleId),
        limit: String(pageSize),
        offset: String((page - 1) * pageSize),
        start,
        end,
      });
      return request<SoftwareUpdate[]>(`/software-updates?${params.toString()}`);
    },
    enabled: vehicleId !== null,
  });

  const anyError = dataError as Error | undefined;

  const vehicleMap = useMemo(() => {
    const m = new Map<number, Vehicle>();
    vehicles?.forEach(v => m.set(v.id, v));
    return m;
  }, [vehicles]);

  const latestVersion = updates?.[0]?.version ?? t('Unknown');
  const installedCount = updates?.filter(u => u.status === 'installed').length ?? 0;
  const totalUpdates = updates?.length ?? 0;

  return (
    <PageContainer
      title={t('Software Updates')}
      subtitle={t('Track firmware versions and update history')}
      loading={isLoading}
      actions={
        <View style={styles.headerActions}>
          <VehicleSelect />
          <RangePicker
            value={{start, end}}
            onChange={r => {
              setRange(r);
              if (page !== 1) {
                setPage(1);
              }
            }}
            align="end"
            triggerTestId="software-updates-range"
          />
        </View>
      }>
      {anyError ? (
        <AlertBanner variant="danger" glyph="⚠">
          {`${t('error.loadFailed', 'Failed to load data')}: ${getErrorMessage(anyError)}`}
        </AlertBanner>
      ) : null}

      {/* ── Summary cards ────────────────────────────────────────── */}
      <FadeIn>
        <View style={styles.summaryGrid}>
          <MetricCard
            glyph="📱"
            label={t('Current Version')}
            value={latestVersion}
            color="cyan"
          />
          <MetricCard
            glyph="✓"
            label={t('Updates Installed')}
            value={installedCount}
            color="green"
          />
          <MetricCard
            glyph="↓"
            label={t('Total Updates')}
            value={totalUpdates}
            color="purple"
          />
        </View>
      </FadeIn>

      {/*
        AI software-update changelog summarizer.
        Conditionally renders an opt-in Helix narrator above the
        deterministic update timeline. Returns null in off mode
        (per ADR-015 §I5 + §I6) so the section is entirely absent
        from the tree, leaving the baseline timeline + raw release
        notes links unchanged for every user.
      */}
      <FadeIn>
        <AISoftwareUpdateChangelogSummarizer vehicleId={vehicleId ?? undefined} />
      </FadeIn>

      {/* ── Update Timeline ──────────────────────────────────────── */}
      <FadeIn>
        <GlassPanel style={styles.panel}>
          <AppText weight="semibold" style={styles.timelineTitle}>
            {t('Update Timeline')}
          </AppText>
          {isLoading ? (
            <View style={styles.skeletonStack}>
              {[1, 2, 3, 4].map(i => (
                <Skeleton key={i} height={80} />
              ))}
            </View>
          ) : !updates?.length ? (
            <EmptyState
              glyph="📱"
              title={t('No update history')}
              message={t('No software update history available')}
            />
          ) : (
            <>
              <View style={styles.timeline}>
                <View style={styles.timelineLine} />
                <View style={styles.timelineStack}>
                  {updates.map(u => {
                    const s = getStatus(u.status);
                    const vName =
                      vehicleMap.get(u.vehicle_id)?.display_name ??
                      `${t('Vehicle')} ${u.vehicle_id}`;
                    return (
                      <View key={u.id} style={styles.timelineItem}>
                        <View
                          style={[
                            styles.timelineDot,
                            {backgroundColor: `${s.color}1a`},
                          ]}>
                          <Glyph glyph={s.glyph} color={s.color} size={11} />
                        </View>
                        <GlassPanel style={styles.updateCard}>
                          <View style={styles.updateRow}>
                            <View style={styles.updateLeft}>
                              <View style={styles.versionRow}>
                                <AppText weight="semibold" style={styles.versionText}>
                                  {u.version}
                                </AppText>
                                <Badge variant={s.badgeVariant}>{t(s.label)}</Badge>
                                <Pressable
                                  onPress={() =>
                                    Linking.openURL(
                                      `https://www.notateslaapp.com/software-updates/version/${encodeURIComponent(
                                        u.version,
                                      )}/release-notes`,
                                    )
                                  }
                                  accessibilityRole="link"
                                  accessibilityLabel={t('View release notes')}
                                  hitSlop={8}>
                                  <Glyph glyph="↗" size={13} />
                                </Pressable>
                              </View>
                              <AppText variant="caption" tone="muted">
                                {vName}
                              </AppText>
                            </View>
                            <View style={styles.updateRight}>
                              {u.installed_at ? (
                                <View style={styles.dateRow}>
                                  <Glyph glyph="📅" size={11} />
                                  <AppText
                                    variant="caption"
                                    tone="secondary"
                                    style={styles.dateText}>
                                    {formatDate(u.installed_at)}
                                  </AppText>
                                </View>
                              ) : null}
                              {u.scheduled_at && !u.installed_at ? (
                                <View style={styles.dateRow}>
                                  <Glyph
                                    glyph="🕘"
                                    color={ACCENT_HEX.amber}
                                    size={11}
                                  />
                                  <AppText
                                    variant="caption"
                                    style={[styles.dateText, {color: ACCENT_HEX.amber}]}>
                                    {`${t('Scheduled')}: ${formatDate(u.scheduled_at)}`}
                                  </AppText>
                                </View>
                              ) : null}
                              <AppText
                                tone="muted"
                                style={styles.createdText}>
                                {formatDate(u.created_at)}
                              </AppText>
                            </View>
                          </View>
                        </GlassPanel>
                      </View>
                    );
                  })}
                </View>
              </View>
              <Pagination
                page={page}
                pageSize={pageSize}
                total={
                  updates.length < pageSize
                    ? (page - 1) * pageSize + updates.length
                    : page * pageSize + 1
                }
                onPageChange={setPage}
              />
            </>
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}

const styles = StyleSheet.create({
  pageRoot: {
    backgroundColor: colors.background,
    flex: 1,
  },
  pageContent: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  pageHeaderText: {
    flex: 1,
    minWidth: 180,
    gap: spacing.xs,
  },
  pageSubtitle: {
    color: colors.textMuted,
  },
  pageActions: {
    alignItems: 'flex-end',
  },
  headerActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  loadingWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
  },
  section: {
    gap: spacing.md,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  metricCard: {
    flex: 1,
    minWidth: 150,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: colors.surfaceRaised,
    padding: spacing.md,
  },
  metricCardLeft: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  metricLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  metricValue: {
    color: colors.textPrimary,
    fontSize: 20,
  },
  metricIconBox: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 34,
    height: 34,
    borderWidth: 1,
    borderRadius: 12,
  },
  panel: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  timelineTitle: {
    color: colors.textPrimary,
  },
  skeletonStack: {
    gap: spacing.md,
  },
  skeleton: {
    borderRadius: 16,
    backgroundColor: colors.surfaceRaised,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  emptyTitle: {
    color: colors.textPrimary,
  },
  emptyMessage: {
    textAlign: 'center',
    maxWidth: 320,
  },
  alertBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: 16,
    padding: spacing.md,
  },
  alertText: {
    flex: 1,
  },
  vehicleSelect: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    backgroundColor: colors.surfaceRaised,
  },
  vehicleSelectText: {
    color: colors.textPrimary,
  },
  rangeTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    backgroundColor: colors.surfaceRaised,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalSheet: {
    width: '100%',
    maxWidth: 360,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  modalTitle: {
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  modalRow: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 12,
  },
  modalRowActive: {
    backgroundColor: colors.surfaceSelected,
  },
  timeline: {
    position: 'relative',
  },
  timelineLine: {
    position: 'absolute',
    left: 11,
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: colors.border,
  },
  timelineStack: {
    gap: spacing.md,
  },
  timelineItem: {
    position: 'relative',
    paddingLeft: 40,
  },
  timelineDot: {
    position: 'absolute',
    left: 2,
    top: 6,
    width: 22,
    height: 22,
    borderRadius: 999,
    borderWidth: 4,
    borderColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  updateCard: {
    padding: spacing.md,
  },
  updateRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  updateLeft: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  versionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  versionText: {
    color: colors.textPrimary,
  },
  updateRight: {
    alignItems: 'flex-end',
    gap: 2,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  dateText: {
    color: colors.textSecondary,
  },
  createdText: {
    fontSize: 10,
    color: colors.textMuted,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  pagination: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingTop: spacing.md,
  },
  pageControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  pageIndicator: {
    paddingHorizontal: spacing.sm,
  },
  pageBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    backgroundColor: colors.surfaceRaised,
  },
  pageBtnDisabled: {
    opacity: 0.3,
  },
  glyph: {
    color: colors.textMuted,
  },
});
