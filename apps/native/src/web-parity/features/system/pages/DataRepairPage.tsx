// Native parity port of web/src/features/system/pages/DataRepairPage.tsx.
//
// `DataRepairPage` lists stale (open) charging sessions and drive records with
// per-row inline edit forms that can update, close, or discard each record. The
// page state names (`tab`, `expandedId`), the derived values (`staleCharging`,
// `staleDrives`, `totalStale`, `records`), the `['stale-sessions']` query key +
// `/data-repair/stale-sessions` path + 30s `refetchInterval`, every
// `/data-repair/{charging,drives}/{id}` PUT/POST-close/DELETE mutation path and
// body shape, the form field keys/state, the helper `hoursOpen`, and every i18n
// string are preserved verbatim from the web source.
//
// Web-only dependencies with no native-parity surface are mapped per the
// conversion contract (rules 4/5/6/7):
//   - react-i18next `useTranslation` (L9) -> a local i18n shim. The web calls use
//     the English copy AS the key (`t('Data Repair')`, `t('Session updated')`),
//     and i18next resolves a missing translation to its key, so the shim returns
//     `fallback ?? key` — preserving every string. The forms receive `t` as a
//     `(k: string) => string` prop exactly as the source types it.
//   - `cn` from @/lib/cn (L10) is dropped: React Native has no className, so the
//     conditional Tailwind class merges (active-tab tint, expanded-row tint)
//     move to native style arrays.
//   - `PageContainer` from @/components/layout (L11) -> the web-parity layout
//     PageContainer (reused; title/subtitle/loading/error props match).
//   - `GlassPanel` from @/components/ui (L12) -> the shared native GlassPanel.
//   - `Badge` from @/components/ui (L13) -> the web-parity Badge (reused;
//     variant="warning" size="sm"). The inline AlertTriangle inside the "Open"
//     badge becomes a leading warning glyph in the badge label (badge wraps a
//     single text child).
//   - `Button` from @/components/ui (L14) is not ported -> a local `Button`
//     (Pressable row: optional leading glyph / loading ActivityIndicator + label,
//     variant/size/disabled, `onClick` -> `onPress`) — the "own the unported
//     sibling locally" approach the GDPRExportPage / DevToolsPage ports use. It
//     maps string/number children to AppText and passes element children (the
//     count Badge) through, and accepts a `style` + `textColor` override so the
//     two ghost tab buttons can carry their amber active/secondary inactive tint
//     (the web `className` override).
//   - `Input` from @/components/ui (L15) is not ported -> a local labelled
//     `TextInput` (the GDPRExportPage Input precedent), reusing the ported Label.
//     The web DOM `onChange={(e)=>...e.target.value}` becomes RN `onChangeText`;
//     `type="number"` maps to `keyboardType="numeric"`.
//   - `MetricCard` from @/components/data-display (L16) is not ported -> a local
//     MetricCard reproducing the web layout (label + large value on the left, a
//     tinted ring icon box on the right) with the lucide icon mapped to a glyph
//     and the NeonColor mapped to the toned-down SI tint (amber/cyan/purple/
//     green/red).
//   - `EmptyState` from @/components/feedback (L17) -> the shared native
//     EmptyState (reused; title + message). The web CheckCircle icon is dropped
//     because the shared native EmptyState exposes no icon slot.
//   - `FadeIn` from @/components/motion (L18) -> the web-parity motion FadeIn
//     (reused) so each section re-animates on mount.
//   - `useToast` from @/components/feedback/Toast (L19) -> a local in-panel toast
//     shim preserving the `success(title)` / `error(title)` contract; its `node`
//     is rendered next to each edit form (the ActiveOrdersSection precedent).
//   - `usePageTitle` from @/hooks/usePageTitle (L20) writes `document.title`;
//     native has no DOM document, so it is a documented native-safe no-op (the
//     translated title still flows into PageContainer's on-screen header).
//   - `formatDateTime` from @/lib/dateFormat (L21) and `fmtInt` from
//     @/lib/numberFormat (L22) are inlined verbatim (the GDPRExportPage / TimeStamp
//     precedent) so the rendered strings match; `hoursOpen` (which calls fmtInt)
//     is ported unchanged.
//   - `request` from @/api/client (L23) -> the web-parity api/client `request`
//     (reused; same auto `/api/v1` prefix + options).
//   - `AIDataRepairSuggestions` from @/components/ai/... (L24) -> the web-parity
//     AI component (reused; self-hides when ai_mode='off').
//   - lucide-react icons (L25-28: Wrench/BatteryCharging/Route/AlertTriangle/
//     CheckCircle/X/Save/Clock/Trash2) have no native analog -> decorative emoji
//     glyphs; a label always carries the meaning, so each glyph is decorative.
//
// No DOM-only modules, browser HTML elements, Recharts, Leaflet, framer-motion,
// or old web UI components are imported — only React + react-native primitives
// (View / Pressable / TextInput / ActivityIndicator / StyleSheet), @tanstack/
// react-query (a native dependency, reused), the web-parity PageContainer /
// FadeIn / Badge / Label / api client / AI component, the shared native AppText /
// GlassPanel / EmptyState, and theme tokens. Tailwind maps to StyleSheet:
// gap-3 -> 12, gap-2 -> 8, gap-1 -> 4, gap-4 -> 16, p-4 -> 16, p-1 -> 4,
// rounded-xl -> 12, rounded-md -> 6, space-y-3/4 -> gap 12/16; the responsive
// grids resolve mobile-first (metrics `grid-cols-2 sm:grid-cols-4` -> a wrapping
// 2-up row; the edit `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` -> a single
// column); --text-primary/-secondary/-muted -> colors.text*; neon-amber tints ->
// rgba warning literals.

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';

import {AppText} from '../../../../components/ui/AppText';
import {EmptyState} from '../../../../components/feedback/EmptyState';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {request} from '../../../api/client';
import {AIDataRepairSuggestions} from '../../../components/ai/AIDataRepairSuggestions';
import {Badge} from '../../../components/ui/Badge';
import {Label} from '../../../components/ui/Label';
import {PageContainer} from '../../../components/layout/PageContainer';
import {FadeIn} from '../../../components/motion';

// ── Decorative glyphs (lucide SVG icons -> emoji; label-backed) ──────────────
const WRENCH_GLYPH = '\u{1F527}'; // 🔧 Wrench
const BATTERY_CHARGING_GLYPH = '\u{1F50B}'; // 🔋 BatteryCharging
const ROUTE_GLYPH = '\u{1F6E3}\u{FE0F}'; // 🛣️ Route
const ALERT_TRIANGLE_GLYPH = '\u{26A0}\u{FE0F}'; // ⚠️ AlertTriangle
const SAVE_GLYPH = '\u{1F4BE}'; // 💾 Save
const CLOCK_GLYPH = '\u{1F550}'; // 🕐 Clock
const TRASH_GLYPH = '\u{1F5D1}\u{FE0F}'; // 🗑️ Trash2
const X_GLYPH = '\u{2715}'; // ✕ X

// Toned-down amber (web text-amber-300 / neon-amber accents).
const AMBER_300 = '#fcd34d';

// ── i18n shim ────────────────────────────────────────────────────────────────
// react-i18next has no native parity module. The web source uses the English
// copy as the key (no fallback arg), and i18next resolves a missing translation
// to its key, so the shim returns `fallback ?? key` — every string is preserved.
type TFunc = (key: string, fallback?: string) => string;

function useTranslation(): {t: TFunc} {
  const t = useCallback<TFunc>(
    (key, fallback) => (typeof fallback === 'string' ? fallback : key),
    [],
  );
  return {t};
}

// ── usePageTitle shim ────────────────────────────────────────────────────────
// The web hook writes `document.title`. Native has no DOM document and the
// browser-tab title has no analog, so this is a documented native-safe no-op; the
// translated title is still computed and PageContainer renders it as the header.
function usePageTitle(title: string): void {
  useEffect(() => {
    return undefined;
  }, [title]);
}

// ── inlined formatters (web @/lib/numberFormat fmtInt + @/lib/dateFormat) ─────
// Inlined verbatim so the rendered strings match the web. fmtInt formats at 0
// decimals with locale separators; formatDateTime returns the universal "—"
// placeholder for nullish/invalid input.

/** web safeNumber: finite number or 0. */
function safeNumber(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

/** web fmtInt(v) -> integer with locale separators (precision 0). */
function fmtInt(v: unknown): string {
  return safeNumber(v).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

/** web formatDateTime: "Apr 4, 2026, 2:30 AM" (browser locale + timezone). */
function formatDateTime(iso: string | null | undefined): string {
  if (!iso) {
    return '\u2014';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '\u2014';
  }
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface ChargingSession {
  id: number;
  vehicle_id: number;
  start_ts: string;
  start_battery_pct: number;
  end_battery_pct?: number;
  total_energy_added_wh?: number;
  peak_power_w?: number;
  duration_min?: number;
  cost?: number;
}

interface Drive {
  id: number;
  vehicle_id: number;
  start_ts: string;
  start_battery_pct?: number;
  end_battery_pct?: number;
  distance_m?: number;
  duration_s?: number;
  max_speed_mps?: number;
}

interface StaleData {
  stale_charging: ChargingSession[];
  stale_drives: Drive[];
}

type Tab = 'charging' | 'drives';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hoursOpen(startDate: string): string {
  const h = (Date.now() - new Date(startDate).getTime()) / 3600000;
  if (h < 24) {
    return `${fmtInt(h)}h`;
  }
  const d = Math.floor(h / 24);
  return `${d}d ${fmtInt(h % 24)}h`;
}

// ─── useToast (web @/components/feedback/Toast useToast) ──────────────────────
// Lightweight in-panel banner host preserving the `success(title)` /
// `error(title)` contract; auto-dismisses after a few seconds.
interface ActiveToast {
  id: number;
  type: 'success' | 'error';
  title: string;
}

function useToast() {
  const [active, setActive] = useState<ActiveToast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  const show = useCallback((next: ActiveToast) => {
    if (timer.current) {
      clearTimeout(timer.current);
    }
    setActive(next);
    timer.current = setTimeout(
      () => setActive(null),
      next.type === 'error' ? 6000 : 5000,
    );
  }, []);

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    },
    [],
  );

  const success = useCallback(
    (title: string) => {
      seq.current += 1;
      show({id: seq.current, type: 'success', title});
    },
    [show],
  );

  const error = useCallback(
    (title: string) => {
      seq.current += 1;
      show({id: seq.current, type: 'error', title});
    },
    [show],
  );

  const node = active ? (
    <View style={styles.toastWrap}>
      <GlassPanel
        style={[
          styles.toast,
          active.type === 'error' ? styles.toastError : styles.toastSuccess,
        ]}>
        <AppText style={styles.toastTitle} weight="semibold">
          {active.title}
        </AppText>
      </GlassPanel>
    </View>
  ) : null;

  return {success, error, node};
}

// ─── Input (web @/components/ui Input, labelled single-line) ──────────────────
interface InputProps {
  label: string;
  value: string;
  placeholder?: string;
  type?: 'text' | 'number';
  onChangeText: (text: string) => void;
}

function Input({label, value, placeholder, type, onChangeText}: InputProps) {
  return (
    <View style={styles.inputWrap}>
      <Label style={styles.inputLabel}>{label}</Label>
      <TextInput
        keyboardType={type === 'number' ? 'numeric' : 'default'}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        value={value}
      />
    </View>
  );
}

// ─── Button (web @/components/ui Button, glyph/loading + label) ───────────────
type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

interface ButtonVariantStyle {
  bg: string;
  text: string;
  border?: string;
}

// Dark-surface mapping of the web Tailwind variant classes.
const BUTTON_VARIANTS: Record<ButtonVariant, ButtonVariantStyle> = {
  primary: {bg: '#2563eb', text: '#ffffff'}, // bg-blue-600 text-white
  secondary: {bg: '#374151', text: '#f3f4f6'}, // dark:bg-gray-700 dark:text-gray-100
  danger: {bg: '#dc2626', text: '#ffffff'}, // bg-red-600 text-white
  ghost: {bg: 'transparent', text: colors.textSecondary}, // bg-transparent
};

interface ButtonSizeStyle {
  minHeight: number;
  paddingHorizontal: number;
  fontSize: number;
}

const BUTTON_SIZES: Record<'sm' | 'md', ButtonSizeStyle> = {
  sm: {minHeight: 32, paddingHorizontal: 12, fontSize: 12}, // h-8 px-3 text-xs
  md: {minHeight: 40, paddingHorizontal: 16, fontSize: 14}, // h-10 px-4 text-sm
};

interface ButtonProps {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  onPress?: () => void;
  loading?: boolean;
  disabled?: boolean;
  glyph?: string;
  children?: ReactNode;
  /** Native container override (the web `className` active-tab tint). */
  style?: StyleProp<ViewStyle>;
  /** Native label colour override (the web active/inactive tab text colour). */
  textColor?: string;
}

function Button({
  variant = 'primary',
  size = 'md',
  onPress,
  loading,
  disabled,
  glyph,
  children,
  style,
  textColor,
}: ButtonProps) {
  const isDisabled = Boolean(disabled) || Boolean(loading);
  const v = BUTTON_VARIANTS[variant];
  const s = BUTTON_SIZES[size];
  const labelColor = textColor ?? v.text;
  const labelStyle: TextStyle = {
    color: labelColor,
    fontSize: s.fontSize,
    fontWeight: '500',
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{disabled: isDisabled, busy: Boolean(loading)}}
      disabled={isDisabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.button,
        {
          minHeight: s.minHeight,
          paddingHorizontal: s.paddingHorizontal,
          backgroundColor: v.bg,
          borderColor: v.border ?? 'transparent',
          borderWidth: v.border ? 1 : 0,
        },
        isDisabled ? styles.buttonDisabled : null,
        pressed && !isDisabled ? styles.buttonPressed : null,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={labelColor} size="small" />
      ) : glyph ? (
        <AppText
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.buttonGlyph, {color: labelColor}]}>
          {glyph}
        </AppText>
      ) : null}
      {React.Children.map(children, child => {
        if (child == null || typeof child === 'boolean') {
          return null;
        }
        if (typeof child === 'string' || typeof child === 'number') {
          return <AppText style={labelStyle}>{child}</AppText>;
        }
        return child;
      })}
    </Pressable>
  );
}

// ─── MetricCard (web @/components/data-display MetricCard) ────────────────────
type MetricColor = 'amber' | 'cyan' | 'purple' | 'green' | 'red';

interface MetricTint {
  bg: string;
  ring: string;
  text: string;
}

// web NeonColor -> toned-down SI tint (icon box bg/ring + glyph colour).
const METRIC_TINTS: Record<MetricColor, MetricTint> = {
  amber: {bg: 'rgba(251, 191, 36, 0.12)', ring: 'rgba(251, 191, 36, 0.3)', text: AMBER_300},
  cyan: {bg: 'rgba(53, 213, 255, 0.12)', ring: 'rgba(53, 213, 255, 0.3)', text: '#67e8f9'},
  purple: {bg: 'rgba(167, 139, 250, 0.12)', ring: 'rgba(167, 139, 250, 0.3)', text: '#c4b5fd'},
  green: {bg: 'rgba(52, 211, 153, 0.12)', ring: 'rgba(52, 211, 153, 0.3)', text: '#6ee7b7'},
  red: {bg: 'rgba(251, 113, 133, 0.12)', ring: 'rgba(251, 113, 133, 0.3)', text: '#fda4af'},
};

interface MetricCardProps {
  label: string;
  value: string | number;
  glyph: string;
  color: MetricColor;
}

function MetricCard({label, value, glyph, color}: MetricCardProps) {
  const tint = METRIC_TINTS[color];
  return (
    <View style={styles.metricCard}>
      <View style={styles.metricBody}>
        <View style={styles.metricText}>
          <AppText numberOfLines={1} style={styles.metricLabel}>
            {label}
          </AppText>
          <AppText style={styles.metricValue}>{value}</AppText>
        </View>
        <View
          style={[styles.metricIcon, {backgroundColor: tint.bg, borderColor: tint.ring}]}>
          <AppText
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[styles.metricGlyph, {color: tint.text}]}>
            {glyph}
          </AppText>
        </View>
      </View>
    </View>
  );
}

// ─── Charging Edit Form ──────────────────────────────────────────────────────

function ChargingEditForm({
  session,
  onClose,
  t,
}: {
  session: ChargingSession;
  onClose: () => void;
  t: (k: string) => string;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({
    end_ts: '',
    total_energy_added_wh: String(session.total_energy_added_wh ?? ''),
    end_battery_pct: String(session.end_battery_pct ?? ''),
    peak_power_w: String(session.peak_power_w ?? ''),
    duration_min: String(session.duration_min ?? ''),
    cost: String(session.cost ?? ''),
  });

  const updateMut = useMutation({
    mutationFn: () => {
      const data: Record<string, unknown> = {};
      if (form.end_ts) {
        data.end_ts = form.end_ts;
      }
      if (form.total_energy_added_wh) {
        data.total_energy_added_wh = Number(form.total_energy_added_wh);
      }
      if (form.end_battery_pct) {
        data.end_battery_pct = Number(form.end_battery_pct);
      }
      if (form.peak_power_w) {
        data.peak_power_w = Number(form.peak_power_w);
      }
      if (form.duration_min) {
        data.duration_min = Number(form.duration_min);
      }
      if (form.cost) {
        data.cost = Number(form.cost);
      }
      return request(`/data-repair/charging/${session.id}`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      toast.success(t('Session updated'));
      qc.invalidateQueries({queryKey: ['stale-sessions']});
      onClose();
    },
    onError: () => toast.error(t('Failed to update session')),
  });

  const closeMut = useMutation({
    mutationFn: () =>
      request(`/data-repair/charging/${session.id}/close`, {method: 'POST'}),
    onSuccess: () => {
      toast.success(t('Session closed'));
      qc.invalidateQueries({queryKey: ['stale-sessions']});
      onClose();
    },
    onError: () => toast.error(t('Failed to close session')),
  });

  const discardMut = useMutation({
    mutationFn: () =>
      request(`/data-repair/charging/${session.id}`, {method: 'DELETE'}),
    onSuccess: () => {
      toast.success(t('Session discarded'));
      qc.invalidateQueries({queryKey: ['stale-sessions']});
      onClose();
    },
    onError: () => toast.error(t('Failed to discard session')),
  });

  return (
    <>
      <GlassPanel style={styles.editPanel}>
        <View style={styles.editGrid}>
          <Input
            label={t('End Date (ISO)')}
            value={form.end_ts}
            placeholder="2026-03-30T04:00:00Z"
            onChangeText={value => setForm(f => ({...f, end_ts: value}))}
          />
          <Input
            label={t('Energy Added (kWh)')}
            type="number"
            value={form.total_energy_added_wh}
            onChangeText={value =>
              setForm(f => ({...f, total_energy_added_wh: value}))
            }
          />
          <Input
            label={t('End Battery %')}
            type="number"
            value={form.end_battery_pct}
            onChangeText={value => setForm(f => ({...f, end_battery_pct: value}))}
          />
          <Input
            label={t('Charger Power (kW)')}
            type="number"
            value={form.peak_power_w}
            onChangeText={value => setForm(f => ({...f, peak_power_w: value}))}
          />
          <Input
            label={t('Duration (min)')}
            type="number"
            value={form.duration_min}
            onChangeText={value => setForm(f => ({...f, duration_min: value}))}
          />
          <Input
            label={t('Cost ($)')}
            type="number"
            value={form.cost}
            onChangeText={value => setForm(f => ({...f, cost: value}))}
          />
        </View>
        <View style={styles.editActions}>
          <Button
            variant="secondary"
            size="sm"
            onPress={() => updateMut.mutate()}
            loading={updateMut.isPending}
            glyph={SAVE_GLYPH}>
            {t('Save')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onPress={() => closeMut.mutate()}
            loading={closeMut.isPending}
            glyph={CLOCK_GLYPH}>
            {t('Close Session')}
          </Button>
          <Button
            variant="danger"
            size="sm"
            onPress={() => discardMut.mutate()}
            loading={discardMut.isPending}
            glyph={TRASH_GLYPH}>
            {t('Discard')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onPress={onClose}
            glyph={X_GLYPH}
            style={styles.cancelButton}>
            {t('Cancel')}
          </Button>
        </View>
      </GlassPanel>
      {toast.node}
    </>
  );
}

// ─── Drive Edit Form ─────────────────────────────────────────────────────────

function DriveEditForm({
  drive,
  onClose,
  t,
}: {
  drive: Drive;
  onClose: () => void;
  t: (k: string) => string;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({
    end_ts: '',
    distance_m: String(drive.distance_m ?? ''),
    duration_s: String(drive.duration_s ?? ''),
    end_battery_pct: String(drive.end_battery_pct ?? ''),
    max_speed_mps: String(drive.max_speed_mps ?? ''),
  });

  const updateMut = useMutation({
    mutationFn: () => {
      const data: Record<string, unknown> = {};
      if (form.end_ts) {
        data.end_ts = form.end_ts;
      }
      if (form.distance_m) {
        data.distance_m = Number(form.distance_m);
      }
      if (form.duration_s) {
        data.duration_s = Number(form.duration_s);
      }
      if (form.end_battery_pct) {
        data.end_battery_pct = Number(form.end_battery_pct);
      }
      if (form.max_speed_mps) {
        data.max_speed_mps = Number(form.max_speed_mps);
      }
      return request(`/data-repair/drives/${drive.id}`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      toast.success(t('Drive updated'));
      qc.invalidateQueries({queryKey: ['stale-sessions']});
      onClose();
    },
    onError: () => toast.error(t('Failed to update drive')),
  });

  const closeMut = useMutation({
    mutationFn: () =>
      request(`/data-repair/drives/${drive.id}/close`, {method: 'POST'}),
    onSuccess: () => {
      toast.success(t('Drive closed'));
      qc.invalidateQueries({queryKey: ['stale-sessions']});
      onClose();
    },
    onError: () => toast.error(t('Failed to close drive')),
  });

  const discardMut = useMutation({
    mutationFn: () =>
      request(`/data-repair/drives/${drive.id}`, {method: 'DELETE'}),
    onSuccess: () => {
      toast.success(t('Drive discarded'));
      qc.invalidateQueries({queryKey: ['stale-sessions']});
      onClose();
    },
    onError: () => toast.error(t('Failed to discard drive')),
  });

  return (
    <>
      <GlassPanel style={styles.editPanel}>
        <View style={styles.editGrid}>
          <Input
            label={t('End Date (ISO)')}
            value={form.end_ts}
            placeholder="2026-03-30T04:00:00Z"
            onChangeText={value => setForm(f => ({...f, end_ts: value}))}
          />
          <Input
            label={t('Distance (m)')}
            type="number"
            value={form.distance_m}
            onChangeText={value => setForm(f => ({...f, distance_m: value}))}
          />
          <Input
            label={t('Duration (s)')}
            type="number"
            value={form.duration_s}
            onChangeText={value => setForm(f => ({...f, duration_s: value}))}
          />
          <Input
            label={t('End Battery %')}
            type="number"
            value={form.end_battery_pct}
            onChangeText={value => setForm(f => ({...f, end_battery_pct: value}))}
          />
          <Input
            label={t('Max Speed (m/s)')}
            type="number"
            value={form.max_speed_mps}
            onChangeText={value => setForm(f => ({...f, max_speed_mps: value}))}
          />
        </View>
        <View style={styles.editActions}>
          <Button
            variant="secondary"
            size="sm"
            onPress={() => updateMut.mutate()}
            loading={updateMut.isPending}
            glyph={SAVE_GLYPH}>
            {t('Save')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onPress={() => closeMut.mutate()}
            loading={closeMut.isPending}
            glyph={CLOCK_GLYPH}>
            {t('Close Drive')}
          </Button>
          <Button
            variant="danger"
            size="sm"
            onPress={() => discardMut.mutate()}
            loading={discardMut.isPending}
            glyph={TRASH_GLYPH}>
            {t('Discard')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onPress={onClose}
            glyph={X_GLYPH}
            style={styles.cancelButton}>
            {t('Cancel')}
          </Button>
        </View>
      </GlassPanel>
      {toast.node}
    </>
  );
}

// ─── Stale row (shared chrome for a charging session / drive list item) ───────
interface StaleRowProps {
  id: number;
  startTs: string;
  batteryLabel: string;
  vehicleId: number;
  expanded: boolean;
  onToggle: () => void;
  t: TFunc;
}

function StaleRow({
  id,
  startTs,
  batteryLabel,
  vehicleId,
  expanded,
  onToggle,
  t,
}: StaleRowProps) {
  return (
    <Pressable onPress={onToggle}>
      <GlassPanel
        style={[styles.rowPanel, expanded ? styles.rowPanelActive : null]}>
        <View style={styles.rowInner}>
          <AppText style={[styles.cell, styles.cellId]}>{`#${id}`}</AppText>
          <AppText numberOfLines={1} style={[styles.cell, styles.cellDate]}>
            {formatDateTime(startTs)}
          </AppText>
          <AppText style={[styles.cell, styles.cellBattery]}>
            {batteryLabel}
          </AppText>
          <AppText style={[styles.cell, styles.cellVehicle]}>
            {`${t('Vehicle')} ${vehicleId}`}
          </AppText>
          <AppText style={[styles.cell, styles.cellHours]}>
            {hoursOpen(startTs)}
          </AppText>
          <Badge variant="warning" size="sm">
            {`${ALERT_TRIANGLE_GLYPH} ${t('Open')}`}
          </Badge>
        </View>
      </GlassPanel>
    </Pressable>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function DataRepairPage() {
  const {t} = useTranslation();
  usePageTitle(t('Data Repair'));

  const [tab, setTab] = useState<Tab>('charging');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const {data, isLoading, error} = useQuery({
    queryKey: ['stale-sessions'],
    queryFn: () => request<StaleData>('/data-repair/stale-sessions'),
    refetchInterval: 30_000,
  });

  const staleCharging = data?.stale_charging ?? [];
  const staleDrives = data?.stale_drives ?? [];
  const totalStale = staleCharging.length + staleDrives.length;

  const records = tab === 'charging' ? staleCharging : staleDrives;

  return (
    <PageContainer
      title={t('Data Repair')}
      subtitle={
        totalStale > 0
          ? `${totalStale} ${t('incomplete session')}${
              totalStale !== 1 ? 's' : ''
            } ${t('found')}`
          : t('Fix incomplete or stale sessions')
      }
      loading={isLoading}
      error={error as Error | null}>
      {/* ── Stats ────────────────────────────────────────────────── */}
      <FadeIn>
        <View style={styles.metricsGrid}>
          <MetricCard
            label={t('Total Stale')}
            value={totalStale}
            glyph={ALERT_TRIANGLE_GLYPH}
            color="amber"
          />
          <MetricCard
            label={t('Stale Charging')}
            value={staleCharging.length}
            glyph={BATTERY_CHARGING_GLYPH}
            color="cyan"
          />
          <MetricCard
            label={t('Stale Drives')}
            value={staleDrives.length}
            glyph={ROUTE_GLYPH}
            color="purple"
          />
          <MetricCard
            label={t('Status')}
            value={totalStale === 0 ? t('Clean') : t('Needs Repair')}
            glyph={WRENCH_GLYPH}
            color={totalStale === 0 ? 'green' : 'red'}
          />
        </View>
      </FadeIn>

      {/* ── AI repair suggestions (opt-in, hidden when ai_mode='off') ── */}
      <FadeIn>
        <AIDataRepairSuggestions />
      </FadeIn>

      {/* ── Tab buttons ──────────────────────────────────────────── */}
      <FadeIn>
        <View style={styles.tabBar}>
          <Button
            variant="ghost"
            size="sm"
            glyph={BATTERY_CHARGING_GLYPH}
            onPress={() => {
              setTab('charging');
              setExpandedId(null);
            }}
            style={tab === 'charging' ? styles.tabActive : styles.tabInactive}
            textColor={tab === 'charging' ? colors.warning : colors.textSecondary}>
            {t('Charging Sessions')}
            {staleCharging.length > 0 && (
              <Badge variant="warning" size="sm" style={styles.tabBadge}>
                {staleCharging.length}
              </Badge>
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            glyph={ROUTE_GLYPH}
            onPress={() => {
              setTab('drives');
              setExpandedId(null);
            }}
            style={tab === 'drives' ? styles.tabActive : styles.tabInactive}
            textColor={tab === 'drives' ? colors.warning : colors.textSecondary}>
            {t('Drives')}
            {staleDrives.length > 0 && (
              <Badge variant="warning" size="sm" style={styles.tabBadge}>
                {staleDrives.length}
              </Badge>
            )}
          </Button>
        </View>
      </FadeIn>

      {/* ── Content ──────────────────────────────────────────────── */}
      <FadeIn>
        {records.length === 0 ? (
          <EmptyState
            title={t('All sessions are complete')}
            message={t(
              tab === 'charging'
                ? 'No stale charging sessions found.'
                : 'No stale drives found.',
            )}
          />
        ) : (
          <View style={styles.list}>
            {tab === 'charging'
              ? staleCharging.map(s => (
                  <View key={s.id}>
                    <StaleRow
                      id={s.id}
                      startTs={s.start_ts}
                      batteryLabel={`${s.start_battery_pct}%`}
                      vehicleId={s.vehicle_id}
                      expanded={expandedId === s.id}
                      onToggle={() =>
                        setExpandedId(expandedId === s.id ? null : s.id)
                      }
                      t={t}
                    />
                    {expandedId === s.id && (
                      <ChargingEditForm
                        session={s}
                        onClose={() => setExpandedId(null)}
                        t={t}
                      />
                    )}
                  </View>
                ))
              : staleDrives.map(d => (
                  <View key={d.id}>
                    <StaleRow
                      id={d.id}
                      startTs={d.start_ts}
                      batteryLabel={
                        d.start_battery_pct != null
                          ? `${d.start_battery_pct}%`
                          : '\u2014'
                      }
                      vehicleId={d.vehicle_id}
                      expanded={expandedId === d.id}
                      onToggle={() =>
                        setExpandedId(expandedId === d.id ? null : d.id)
                      }
                      t={t}
                    />
                    {expandedId === d.id && (
                      <DriveEditForm
                        drive={d}
                        onClose={() => setExpandedId(null)}
                        t={t}
                      />
                    )}
                  </View>
                ))}
          </View>
        )}
      </FadeIn>
    </PageContainer>
  );
}

const styles = StyleSheet.create({
  // ── Metrics grid (grid-cols-2 sm:grid-cols-4 gap-3) ──
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  metricCard: {
    flexGrow: 1,
    flexBasis: '46%',
    minWidth: 150,
    padding: 12, // p-3
    borderRadius: 12, // rounded-xl
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
  },
  metricBody: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  metricText: {
    flex: 1,
    minWidth: 0,
  },
  metricLabel: {
    fontSize: 10,
    lineHeight: 14,
    marginBottom: 4,
    color: colors.textMuted,
  },
  metricValue: {
    fontSize: 20, // text-xl
    lineHeight: 26,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  metricIcon: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8, // rounded-lg
    borderWidth: 1,
    padding: 6, // p-1.5
    minWidth: 28,
    minHeight: 28,
  },
  metricGlyph: {
    fontSize: 14, // h-4 w-4
    lineHeight: 18,
  },

  // ── Tab bar (rounded-xl bg-white/[0.03] p-1 ring-white/[0.06] w-fit) ──
  tabBar: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    alignItems: 'center',
    gap: 4, // gap-1
    padding: 4, // p-1
    borderRadius: 12, // rounded-xl
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    flexWrap: 'wrap',
  },
  tabActive: {
    backgroundColor: 'rgba(251, 191, 36, 0.15)', // bg-neon-amber/15
    borderWidth: 1,
    borderColor: 'rgba(251, 191, 36, 0.2)', // border-neon-amber/20
  },
  tabInactive: {
    borderWidth: 1,
    borderColor: 'transparent', // border-transparent
    backgroundColor: 'transparent',
  },
  tabBadge: {
    marginLeft: 4, // ml-1
  },

  // ── Shared Button chrome ──
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8, // gap-2
    borderRadius: 6, // rounded-md
  },
  buttonGlyph: {
    fontSize: 14,
    lineHeight: 18,
  },
  buttonDisabled: {
    opacity: 0.5, // disabled:opacity-50
  },
  buttonPressed: {
    opacity: 0.82,
  },
  cancelButton: {
    marginLeft: 'auto', // ml-auto
  },

  // ── Edit form panel (bg-neon-amber/[0.03] border-neon-amber/20 p-4 space-y-4) ──
  editPanel: {
    marginTop: 12,
    padding: 16, // p-4
    gap: 16, // space-y-4
    borderRadius: 16,
    borderColor: 'rgba(251, 191, 36, 0.2)',
    backgroundColor: 'rgba(251, 191, 36, 0.03)',
  },
  editGrid: {
    gap: 12, // gap-3 (grid-cols-1 mobile-first)
  },
  editActions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8, // gap-2
    paddingTop: 8, // pt-2
  },

  // ── Input ──
  inputWrap: {
    gap: 4, // space-y-1
  },
  inputLabel: {
    fontSize: 14, // text-sm
    fontWeight: '500', // font-medium
    color: colors.textSecondary,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border, // var(--glass-border)
    borderRadius: 6, // rounded-md
    backgroundColor: colors.surface, // var(--surface-1)
    color: colors.textPrimary,
    paddingHorizontal: 12, // px-3
    paddingVertical: 8, // py-2
    fontSize: 14, // text-sm
    minHeight: 40,
  },

  // ── List + rows ──
  list: {
    gap: 12, // space-y-3
  },
  rowPanel: {
    padding: 16, // p-4
    borderRadius: 16,
  },
  rowPanelActive: {
    backgroundColor: 'rgba(251, 191, 36, 0.06)', // bg-neon-amber/[0.06]
    borderColor: 'rgba(251, 191, 36, 0.2)', // border-neon-amber/20
  },
  rowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 16, // gap-4
  },
  cell: {
    fontSize: 12, // text-xs
    lineHeight: 16,
    flexShrink: 0,
  },
  cellId: {
    width: 48, // w-12
    color: colors.textMuted,
  },
  cellDate: {
    width: 160, // w-40
    color: colors.textSecondary,
  },
  cellBattery: {
    width: 64, // w-16
    color: colors.textPrimary,
  },
  cellVehicle: {
    width: 64, // w-16
    color: colors.textMuted,
  },
  cellHours: {
    width: 64, // w-16
    color: AMBER_300, // text-amber-300
    fontWeight: '500',
  },

  // ── Toast ──
  toastWrap: {
    marginTop: spacing.md,
  },
  toast: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  toastSuccess: {
    borderColor: colors.successBorder,
  },
  toastError: {
    borderColor: colors.dangerBorder,
  },
  toastTitle: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textPrimary,
  },
});
