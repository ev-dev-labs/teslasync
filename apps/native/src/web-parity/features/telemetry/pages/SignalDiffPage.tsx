// Native parity port of web/src/features/telemetry/pages/SignalDiffPage.tsx.
//
// SignalDiffPage — compare signal values between two snapshots in time. The
// operator picks a vehicle + two timestamps (Window A / Window B), the page
// reads the available signal list, asks the server for the changed-only diff,
// and renders it as a selectable, pinnable, filterable table with four summary
// StatCards and a bulk-actions toolbar (pin / unpin / copy CSV / add as alert
// rule). Pinned signals are persisted via the unified pinned_items API
// (item_type='widget', context `signal-diff:vehicle:{N}`).
//
// The web original composes the shared DOM page kit (PageContainer, GlassPanel,
// Select, CopyButton, Badge, StatCard, BulkActionsToolbar, SavedViewMenu,
// Skeleton), framer-motion FadeIn, lucide SVG icons (GitCompare, Bell, Pin,
// PinOff), react-router useNavigate, react-i18next, the app-level usePageTitle /
// useSavedViewUrl / useUrlNumber / useUrlString hooks, the @/lib/csvExport
// helpers (objectsToCSV / downloadCSV) and the sibling SignalCompareControls
// (+ its CATEGORY_PREFIXES / isoOrEmpty / toLocalDatetimeInput exports) and
// SignalDiffTable. React Native has no DOM, Tailwind, lucide SVGs, framer-motion,
// react-router, wired react-i18next, browser document.title, browser file
// download, or window.location, so this port reproduces the same behaviour with
// RN primitives + the established native parity building blocks:
//
//   - PageContainer (title / subtitle / actions) -> an inline ScrollView
//     scaffold: a persistent header (translated title + subtitle) plus a
//     header-actions slot. usePageTitle(t('signalDiff.title')) sets the browser
//     tab title, which has no native analogue, so the same translated string is
//     surfaced as the on-screen page header (documented in the sidecar).
//   - SignalCompareControls (sibling component, NOT in the native manifest — only
//     SignalDiffTable is converted under features/telemetry/components) is inlined
//     verbatim-by-behaviour, the same precedent the LiveSignalInspectorPage port
//     set for its non-manifest LiveSignalsTable. Its CATEGORY_PREFIXES (8 regex
//     buckets), DIFF_PRESETS (5 datetime presets), isoOrEmpty and
//     toLocalDatetimeInput are ported verbatim; the visual controls (vehicle
//     topSlot, Window A/B datetime fields + HelpTooltips, preset buttons, the
//     filter field + category chips + Clear) are reproduced with RN primitives.
//     The web `<Input type="datetime-local">` has no native datetime picker wired
//     in these ports, so each window becomes a TextInput accepting the SAME
//     `YYYY-MM-DDTHH:mm` local string — atA/atB state + the isoOrEmpty conversion
//     are preserved exactly (documented).
//   - Select (vehicle picker) -> the established native single-choice control: a
//     segmented radio pill group preserving the {value,label} options and the
//     exact onChange `setVehicleIdParam(Number(value))` contract.
//   - useUrlNumber('vehicle') / useUrlString('a'|'b'|'q'|'cat') have no native
//     router; they become useState preserving the exact keys, defaults and
//     setter contracts.
//   - useSavedViewUrl()'s `currentQuery` (the serialized URL query, used for the
//     permalink) is synthesized from the in-memory URL-state params; its `apply`
//     and the SavedViewMenu that consumes it are browser-only (URL-saved views)
//     and are omitted (documented).
//   - CopyButton (Share permalink) -> an inline ShareLinkButton using
//     navigator.clipboard.writeText when present (react-native-web); on
//     iOS/Android no clipboard module is bundled yet, so it surfaces an explicit
//     "unavailable" state rather than crashing (the established native CopyButton
//     idiom). window.location has no native analogue, so the share link is
//     synthesized from the canonical /telemetry/signal-diff route + currentQuery.
//   - StatCard x4 -> an inline native StatCard (label + value, loading-aware).
//   - BulkActionsToolbar -> the already-converted native BulkActionsToolbar
//     (imported); its BulkAction[] is preserved (pin / unpin / csv / alert). The
//     lucide Pin/PinOff icons become the SAME filled/outline star glyphs the
//     SignalDiffTable port uses; Bell becomes the SemanticIcon "notifications".
//     downloadCSV (browser file download) and useNavigate('/alert-studio…') have
//     no native analogue, so the CSV is still built via the ported objectsToCSV
//     and both actions surface a native notice carrying the exact filename / row
//     count / target route (documented). pin/unpin call the UNCHANGED native
//     usePinned/useTogglePin hooks, preserving the /pinned API path, the
//     `signal:{name}` item_id and the `signal-diff:vehicle:{N}` context verbatim.
//   - Skeleton (height=36 x6) -> inline SkeletonBar rows. Badge variant="neutral"
//     -> an inline native Badge. lucide GitCompare (empty state) -> SemanticIcon
//     "gitCompare". FadeIn (framer-motion) -> plain Views.
//
// State names (vehicleIdParam, atA, atB, signalFilter, activeCategoryRaw,
// selectedSignals, pinnedSignals), the vehicleId derivation + default-vehicle
// effect, the pinContext, every API path (via the unchanged native useVehicles /
// useSignals / useSignalDiffServer / usePinned / useTogglePin hooks), the
// snake_case diff row reads (value_a/value_b/source_a/source_b), the
// signalsCsv/atAIso/atBIso derivations, the filteredRows/filterActive logic and
// every i18n key/copy are preserved verbatim. No DOM, Recharts, Leaflet,
// react-router, lucide-react, framer-motion, @/lib/cn or old web UI components
// are imported. See the colocated .parity.json sidecar for the line-by-line map.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import {EmptyState} from '../../../../components/feedback/EmptyState';
import {SemanticIcon} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing, typography} from '../../../../theme/tokens';
import {usePinned, useTogglePin} from '../../../api/hooks/usePinned';
import {
  useSignalDiffServer,
  useSignals,
  type SignalDiffRow,
} from '../../../api/hooks/useTelemetry';
import {useVehicles} from '../../../api/hooks/useVehicles';
import {
  BulkActionsToolbar,
  type BulkAction,
} from '../../../components/data-display/BulkActionsToolbar';
import {HelpTooltip} from '../../../components/ui/HelpTooltip';
import {SignalDiffTable} from '../components/SignalDiffTable';

/* ─── i18n fallback ───────────────────────────────────────────────────── */

// react-i18next is not wired in native. This shim returns the supplied English
// default, supporting both web call styles: t('key', 'Default') and
// t('key', { defaultValue: '…' }). Every web i18n key + copy is preserved.
type TVars = {defaultValue?: string};
type TFunc = (key: string, fallback?: string | TVars) => string;

function useT(): TFunc {
  return useCallback((key: string, fallback?: string | TVars) => {
    if (typeof fallback === 'string') {
      return fallback;
    }
    if (fallback && typeof fallback === 'object') {
      return fallback.defaultValue ?? key;
    }
    return key;
  }, []);
}

/* ─── Constants (ported from the sibling SignalCompareControls) ────────── */

// lucide Pin/PinOff -> filled / outline star toggle (BMP-safe), the SAME glyphs
// the SignalDiffTable native port uses so the telemetry feature stays in lockstep.
const STAR_FILLED = '\u2605'; // ★ — pin
const STAR_OUTLINE = '\u2606'; // ☆ — unpin

// The canonical web route, used to synthesize the share permalink (native has no
// window.location to read the origin/pathname from).
const ROUTE_PATH = '/telemetry/signal-diff';

interface CategoryPrefix {
  id: string;
  labelKey: string;
  defaultLabel: string;
  matches: (name: string) => boolean;
}

// Verbatim from SignalCompareControls.CATEGORY_PREFIXES — the 8 regex buckets.
export const CATEGORY_PREFIXES: CategoryPrefix[] = [
  {id: 'battery', labelKey: 'signalDiff.cat.battery', defaultLabel: 'Battery', matches: n => /battery|charge|soc|range|kwh/i.test(n)},
  {id: 'drive', labelKey: 'signalDiff.cat.drive', defaultLabel: 'Drive', matches: n => /speed|odometer|gear|drive|brake|throttle|steering/i.test(n)},
  {id: 'climate', labelKey: 'signalDiff.cat.climate', defaultLabel: 'Climate', matches: n => /climate|hvac|cabin|seat|temp/i.test(n)},
  {id: 'security', labelKey: 'signalDiff.cat.security', defaultLabel: 'Security', matches: n => /lock|sentry|alarm|valet|guard/i.test(n)},
  {id: 'motor', labelKey: 'signalDiff.cat.motor', defaultLabel: 'Motor', matches: n => /motor|inverter|torque|rpm/i.test(n)},
  {id: 'tire', labelKey: 'signalDiff.cat.tire', defaultLabel: 'Tire', matches: n => /tpms|tire|pressure/i.test(n)},
  {id: 'media', labelKey: 'signalDiff.cat.media', defaultLabel: 'Media', matches: n => /media|audio|volume|playback/i.test(n)},
  {id: 'safety', labelKey: 'signalDiff.cat.safety', defaultLabel: 'Safety', matches: n => /airbag|seatbelt|fcw|aeb|safety/i.test(n)},
];

type DiffPresetId =
  | 'now-vs-1h'
  | 'now-vs-1d'
  | 'last-drive'
  | 'before-after-charge'
  | 'today-vs-yesterday';

interface DiffPreset {
  id: DiffPresetId;
  labelKey: string;
  defaultLabel: string;
  compute: () => {atA: Date; atB: Date};
}

// Verbatim from SignalCompareControls.DIFF_PRESETS — the 5 datetime presets.
const DIFF_PRESETS: DiffPreset[] = [
  {id: 'now-vs-1h', labelKey: 'signalDiff.preset.nowVs1h', defaultLabel: 'Now vs 1h ago', compute: () => {const n = new Date(); return {atA: new Date(n.getTime() - 3600 * 1000), atB: n};}},
  {id: 'now-vs-1d', labelKey: 'signalDiff.preset.nowVs1d', defaultLabel: 'Now vs 1 day ago', compute: () => {const n = new Date(); return {atA: new Date(n.getTime() - 86400 * 1000), atB: n};}},
  {id: 'before-after-charge', labelKey: 'signalDiff.preset.beforeAfterCharge', defaultLabel: 'Before vs after last charge', compute: () => {const n = new Date(); return {atA: new Date(n.getTime() - 4 * 3600 * 1000), atB: n};}},
  {id: 'last-drive', labelKey: 'signalDiff.preset.lastDrive', defaultLabel: 'Last drive start vs end', compute: () => {const n = new Date(); return {atA: new Date(n.getTime() - 90 * 60 * 1000), atB: new Date(n.getTime() - 5 * 60 * 1000)};}},
  {id: 'today-vs-yesterday', labelKey: 'signalDiff.preset.todayVsYesterday', defaultLabel: 'Today vs yesterday (same time)', compute: () => {const n = new Date(); return {atA: new Date(n.getTime() - 86400 * 1000), atB: n};}},
];

// Verbatim from SignalCompareControls.toLocalDatetimeInput.
export function toLocalDatetimeInput(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Verbatim from SignalCompareControls.isoOrEmpty.
export function isoOrEmpty(localValue: string): string {
  if (!localValue) {
    return '';
  }
  const d = new Date(localValue);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

/* ─── CSV utilities (ported from @/lib/csvExport, native-safe) ─────────── */

type CsvCellValue = string | number | boolean | null | undefined | object;

// Verbatim escapeCell from @/lib/csvExport (RFC-4180 quoting).
function escapeCell(value: CsvCellValue): string {
  if (value === null || value === undefined) {
    return '';
  }
  let str: string;
  if (typeof value === 'string') {
    str = value;
  } else if (typeof value === 'number' || typeof value === 'boolean') {
    str = String(value);
  } else {
    try {
      str = JSON.stringify(value);
    } catch {
      str = String(value);
    }
  }
  if (/[",\r\n]/.test(str) || str !== str.trim()) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// Verbatim objectsToCSV from @/lib/csvExport (union-of-keys header + CRLF body).
function objectsToCSV(rows: ReadonlyArray<Record<string, CsvCellValue>>): string {
  const seen = new Set<string>();
  const headers: string[] = [];
  for (const row of rows) {
    for (const k of Object.keys(row)) {
      if (!seen.has(k)) {
        seen.add(k);
        headers.push(k);
      }
    }
  }
  const header = headers.map(escapeCell).join(',');
  const body = rows
    .map(row => headers.map(k => escapeCell(row[k])).join(','))
    .join('\r\n');
  return body.length > 0 ? `${header}\r\n${body}` : header;
}

/* ─── Native-safe clipboard (web CopyButton) ──────────────────────────── */

type CopyState = 'idle' | 'copied' | 'unavailable';

// Uses navigator.clipboard.writeText when present (react-native-web); on
// iOS/Android no clipboard module is bundled yet, so copy is reported
// unavailable rather than crashing. Mirrors the web CopyButton's
// navigator.clipboard.writeText.
async function writeClipboard(text: string): Promise<CopyState> {
  const nav = (
    globalThis as unknown as {
      navigator?: {clipboard?: {writeText?: (value: string) => Promise<void>}};
    }
  ).navigator;
  const clipboard = nav?.clipboard;
  if (clipboard == null || typeof clipboard.writeText !== 'function') {
    return 'unavailable';
  }
  try {
    await clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'idle';
  }
}

const COPY_RESET_MS = 2_000;

/* ─── ShareLinkButton (web CopyButton, size="sm") ─────────────────────── */

function ShareLinkButton({text, label}: {text: string; label: string}) {
  const t = useT();
  const [state, setState] = useState<CopyState>('idle');

  const handleCopy = useCallback(async () => {
    const outcome = await writeClipboard(text);
    setState(outcome);
    if (outcome === 'copied') {
      setTimeout(() => setState('idle'), COPY_RESET_MS);
    }
  }, [text]);

  const displayLabel =
    state === 'copied'
      ? t('signalDiff.shareCopied', 'Copied')
      : state === 'unavailable'
        ? t('signalDiff.shareUnavailable', 'Copy unavailable')
        : label;

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={8}
      onPress={() => {
        void handleCopy();
      }}
      style={({pressed}) => [styles.shareButton, pressed && styles.pressed]}
      testID="signal-diff-share">
      <AppText
        style={state === 'unavailable' ? styles.shareTextMuted : styles.shareText}
        variant="caption"
        weight="semibold">
        {displayLabel}
      </AppText>
    </Pressable>
  );
}

/* ─── StatCard (web @/components/data-display StatCard) ────────────────── */

function StatCard({label, value}: {label: string; value: string}) {
  return (
    <GlassPanel style={styles.statCard}>
      <AppText tone="muted" variant="caption" weight="semibold">
        {label}
      </AppText>
      <AppText numberOfLines={1} style={styles.statValue} weight="bold">
        {value}
      </AppText>
    </GlassPanel>
  );
}

/* ─── Badge (web @/components/ui Badge variant="neutral") ──────────────── */

function Badge({children}: {children: ReactNode}) {
  return (
    <View style={styles.badge}>
      <AppText style={styles.badgeText} variant="caption" weight="semibold">
        {children}
      </AppText>
    </View>
  );
}

/* ─── SkeletonBar (web @/components/feedback Skeleton height=36) ───────── */

function SkeletonBar() {
  return <View style={styles.skeletonBar} />;
}

/* ─── VehiclePicker (web @/components/ui Select) ──────────────────────── */

interface SelectOption {
  value: string;
  label: string;
}

function VehiclePicker({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (next: string) => void;
}) {
  return (
    <View style={styles.field}>
      <AppText style={styles.fieldLabel} tone="muted" variant="caption">
        {label}
      </AppText>
      <View
        accessibilityRole="radiogroup"
        style={styles.pillGroup}
        testID="signal-diff-vehicle-select">
        {options.map(opt => {
          const selected = value === opt.value;
          return (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{selected}}
              key={opt.value || '__placeholder__'}
              onPress={() => onChange(opt.value)}
              style={({pressed}) => [
                styles.pill,
                selected && styles.pillSelected,
                pressed && styles.pressed,
              ]}
              testID={`signal-diff-vehicle-option-${opt.value || 'none'}`}>
              <AppText
                numberOfLines={1}
                style={[styles.pillText, selected && styles.pillTextSelected]}
                weight={selected ? 'semibold' : 'regular'}>
                {opt.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/* ─── SignalCompareControls (web ../components/SignalCompareControls) ──── */

interface SignalCompareControlsProps {
  atA: string;
  atB: string;
  onChangeA: (value: string) => void;
  onChangeB: (value: string) => void;
  search: string;
  onSearchChange: (value: string) => void;
  category: string | null;
  onCategoryChange: (next: string | null) => void;
  topSlot?: ReactNode;
}

// Inlined verbatim-by-behaviour: SignalCompareControls is NOT in the native
// conversion manifest (only SignalDiffTable is converted under
// features/telemetry/components). The web `<Input type="datetime-local">` has no
// native picker wired, so each window is a TextInput taking the SAME
// `YYYY-MM-DDTHH:mm` local string — atA/atB state + isoOrEmpty are preserved.
function SignalCompareControls({
  atA,
  atB,
  onChangeA,
  onChangeB,
  search,
  onSearchChange,
  category,
  onCategoryChange,
  topSlot,
}: SignalCompareControlsProps) {
  const t = useT();

  const applyPreset = useCallback(
    (id: DiffPresetId) => {
      const preset = DIFF_PRESETS.find(p => p.id === id);
      if (!preset) {
        return;
      }
      const {atA: a, atB: b} = preset.compute();
      onChangeA(toLocalDatetimeInput(a));
      onChangeB(toLocalDatetimeInput(b));
    },
    [onChangeA, onChangeB],
  );

  return (
    <GlassPanel style={styles.controlsPanel} testID="signal-compare-controls">
      {topSlot ? <View>{topSlot}</View> : null}

      <View style={styles.windowGrid}>
        <View style={styles.windowField}>
          <View style={styles.windowLabelRow}>
            <AppText style={styles.windowLabelA} variant="caption">
              {t('signalDiff.windowA', 'Window A')}
            </AppText>
            <HelpTooltip
              ariaLabel={t('help.signal.snapshot.aria', {
                defaultValue: 'More info about signal snapshots',
              })}
              defaultValue="A snapshot is a point-in-time view of every signal value at a single timestamp. Falls back to signal_log within the last 30 days when the live layer doesn't have it."
              i18nKey="help.signal.snapshot"
            />
          </View>
          <TextInput
            accessibilityLabel={t('signalDiff.windowA', 'Window A')}
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={onChangeA}
            placeholder="YYYY-MM-DDTHH:mm"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            testID="signal-diff-window-a"
            value={atA}
          />
        </View>
        <View style={styles.windowField}>
          <View style={styles.windowLabelRow}>
            <AppText style={styles.windowLabelB} variant="caption">
              {t('signalDiff.windowB', 'Window B')}
            </AppText>
            <HelpTooltip
              ariaLabel={t('help.signal.diff.aria', {
                defaultValue: 'More info about signal diffs',
              })}
              defaultValue="Server-side comparison between two snapshots. Unchanged signals are omitted from the result to reduce noise."
              i18nKey="help.signal.diff"
            />
          </View>
          <TextInput
            accessibilityLabel={t('signalDiff.windowB', 'Window B')}
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={onChangeB}
            placeholder="YYYY-MM-DDTHH:mm"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            testID="signal-diff-window-b"
            value={atB}
          />
        </View>
      </View>

      <View style={styles.presetsRow}>
        <AppText style={styles.presetsLabel} tone="muted" variant="caption">
          {t('signalDiff.presetsLabel', 'Quick presets:')}
        </AppText>
        {DIFF_PRESETS.map(p => (
          <Pressable
            accessibilityRole="button"
            key={p.id}
            onPress={() => applyPreset(p.id)}
            style={({pressed}) => [styles.presetButton, pressed && styles.pressed]}
            testID={`signal-diff-preset-${p.id}`}>
            <AppText variant="caption" weight="semibold">
              {t(p.labelKey, p.defaultLabel)}
            </AppText>
          </Pressable>
        ))}
      </View>

      <View style={styles.filterRow}>
        <TextInput
          accessibilityLabel={t('signalDiff.filterPlaceholder', 'Filter signals…')}
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={onSearchChange}
          placeholder={t('signalDiff.filterPlaceholder', 'Filter signals\u2026')}
          placeholderTextColor={colors.textMuted}
          style={[styles.input, styles.filterInput]}
          testID="signal-diff-filter"
          value={search}
        />
        <View style={styles.categoryRow}>
          {CATEGORY_PREFIXES.map(c => {
            const active = category === c.id;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{selected: active}}
                key={c.id}
                onPress={() => onCategoryChange(active ? null : c.id)}
                style={({pressed}) => [
                  styles.categoryChip,
                  active && styles.categoryChipActive,
                  pressed && styles.pressed,
                ]}
                testID={`signal-diff-category-${c.id}`}>
                <AppText
                  style={[
                    styles.categoryChipText,
                    active && styles.categoryChipTextActive,
                  ]}
                  variant="caption"
                  weight="semibold">
                  {t(c.labelKey, c.defaultLabel)}
                </AppText>
              </Pressable>
            );
          })}
          {category ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => onCategoryChange(null)}
              style={({pressed}) => [styles.clearButton, pressed && styles.pressed]}
              testID="signal-diff-category-clear">
              <AppText tone="muted" variant="caption" weight="semibold">
                {t('signalDiff.clearCategory', 'Clear')}
              </AppText>
            </Pressable>
          ) : null}
        </View>
      </View>
    </GlassPanel>
  );
}

/* ─── Bulk-action icons (lucide Pin / PinOff / Bell) ──────────────────── */

function pinIcon(): ReactNode {
  return (
    <AppText allowFontScaling={false} style={styles.pinGlyph}>
      {STAR_FILLED}
    </AppText>
  );
}

function unpinIcon(): ReactNode {
  return (
    <AppText allowFontScaling={false} style={styles.unpinGlyph}>
      {STAR_OUTLINE}
    </AppText>
  );
}

function bellIcon(): ReactNode {
  return <SemanticIcon decorative name="notifications" size="sm" />;
}

/* ─── Page component ──────────────────────────────────────────────────── */

export default function SignalDiffPage() {
  const t = useT();
  // usePageTitle(t('signalDiff.title', 'Signal Diff')) drives the browser
  // document.title on web; native has no document, so the same translated string
  // is surfaced as the on-screen page header below.

  // Native notice surfaced for browser-only side effects (CSV file download,
  // useNavigate deep-link) that have no native analogue.
  const [notice, setNotice] = useState<string | null>(null);

  // Vehicle picker — kept page-local (not the global VehicleSelect) so saved
  // views can pin to a specific car independent of global selection.
  const {data: vehicles} = useVehicles();
  // useUrlNumber('vehicle', 0) has no native router -> useState, key/default kept.
  const [vehicleIdParam, setVehicleIdParam] = useState<number>(0);
  const vehicleId = vehicleIdParam || vehicles?.[0]?.id || 0;

  useEffect(() => {
    if (!vehicleIdParam && vehicles && vehicles.length > 0) {
      setVehicleIdParam(vehicles[0].id);
    }
  }, [vehicleIdParam, vehicles]);

  // Window inputs (URL-synced on web -> useState here).
  const defaultAtA = useMemo(
    () => toLocalDatetimeInput(new Date(Date.now() - 3600 * 1000)),
    [],
  );
  const defaultAtB = useMemo(() => toLocalDatetimeInput(new Date()), []);
  const [atA, setAtA] = useState<string>(defaultAtA);
  const [atB, setAtB] = useState<string>(defaultAtB);

  // Filters
  const [signalFilter, setSignalFilter] = useState<string>('');
  const [activeCategoryRaw, setActiveCategoryRaw] = useState<string>('');
  const activeCategory = activeCategoryRaw || null;
  const setActiveCategory = useCallback(
    (next: string | null) => setActiveCategoryRaw(next ?? ''),
    [],
  );

  // Selection state
  const [selectedSignals, setSelectedSignals] = useState<string[]>([]);

  // Pinned-signal state via pinned_items (item_type='widget')
  const pinContext = `signal-diff:vehicle:${vehicleId}`;
  const {data: pinnedItems = []} = usePinned('widget', pinContext);
  const pinnedSignals = useMemo(() => {
    const set = new Set<string>();
    for (const p of pinnedItems ?? []) {
      if (p.item_id?.startsWith('signal:')) {
        set.add(p.item_id.slice('signal:'.length));
      }
    }
    return set;
  }, [pinnedItems]);
  const togglePin = useTogglePin('widget');

  // Available signals for the diff fetch
  const {data: availableSignals} = useSignals(vehicleId);
  const signalsCsv = useMemo(
    () =>
      availableSignals && availableSignals.length > 0
        ? availableSignals.join(',')
        : '',
    [availableSignals],
  );

  // Server-side diff
  const atAIso = isoOrEmpty(atA);
  const atBIso = isoOrEmpty(atB);
  const {
    data: diffResp,
    isLoading,
    error,
  } = useSignalDiffServer(vehicleId, atAIso, atBIso, signalsCsv, {
    enabled: vehicleId > 0 && Boolean(atAIso) && Boolean(atBIso),
  });

  const allRows = useMemo<SignalDiffRow[]>(
    () => diffResp?.data ?? [],
    [diffResp],
  );
  const filteredRows = useMemo(() => {
    let rows = allRows;
    if (signalFilter.trim()) {
      const needle = signalFilter.trim().toLowerCase();
      rows = rows.filter(r => r.name.toLowerCase().includes(needle));
    }
    if (activeCategory) {
      const cat = CATEGORY_PREFIXES.find(c => c.id === activeCategory);
      if (cat) {
        rows = rows.filter(r => cat.matches(r.name));
      }
    }
    return rows;
  }, [allRows, signalFilter, activeCategory]);
  const filterActive =
    signalFilter.trim().length > 0 || activeCategory != null;

  // Bulk actions
  const bulkActions: BulkAction[] = useMemo(
    () => [
      {
        id: 'pin',
        label: t('signalDiff.bulk.pin', 'Pin selected'),
        icon: pinIcon(),
        onClick: async ids => {
          for (const id of ids) {
            const name = String(id);
            if (pinnedSignals.has(name)) {
              continue;
            }
            await togglePin.mutateAsync({
              itemId: `signal:${name}`,
              context: pinContext,
              pin: true,
            });
          }
        },
      },
      {
        id: 'unpin',
        label: t('signalDiff.bulk.unpin', 'Unpin selected'),
        icon: unpinIcon(),
        onClick: async ids => {
          for (const id of ids) {
            const name = String(id);
            if (!pinnedSignals.has(name)) {
              continue;
            }
            await togglePin.mutateAsync({
              itemId: `signal:${name}`,
              context: pinContext,
              pin: false,
            });
          }
        },
      },
      {
        id: 'csv',
        label: t('signalDiff.bulk.csv', 'Copy CSV'),
        onClick: async ids => {
          const idSet = new Set(ids.map(String));
          const rowsToExport = filteredRows.filter(r => idSet.has(r.name));
          const csv = objectsToCSV(
            rowsToExport.map(r => ({
              signal: r.name,
              window_a: String(r.value_a ?? ''),
              window_b: String(r.value_b ?? ''),
              source_a: String(r.source_a ?? ''),
              source_b: String(r.source_b ?? ''),
            })),
          );
          // downloadCSV triggers a browser file download with no native
          // analogue; the CSV is still built, and its filename/size are surfaced.
          const filename = `signal-diff-vehicle-${vehicleId}.csv`;
          setNotice(
            t('signalDiff.native.csvUnavailable', {
              defaultValue: `Prepared ${filename} (${rowsToExport.length} rows, ${csv.length} bytes). Native file download is unavailable in this parity screen.`,
            }),
          );
        },
      },
      {
        id: 'alert',
        label: t('signalDiff.bulk.addAlert', 'Add as alert rule'),
        icon: bellIcon(),
        onClick: async ids => {
          const csv = ids.map(String).join(',');
          // navigate('/alert-studio?…') has no native router; the same target
          // route is computed and surfaced as a notice.
          const route = `/alert-studio?signals=${encodeURIComponent(
            csv,
          )}&from=signal-diff`;
          setNotice(
            t('signalDiff.native.alertUnavailable', {
              defaultValue: `Open ${route} in the web app to add these signals as an alert rule. Native navigation to Alert Studio is unavailable in this parity screen.`,
            }),
          );
        },
      },
    ],
    [filteredRows, pinContext, pinnedSignals, togglePin, vehicleId, t],
  );

  // useSavedViewUrl().currentQuery — the serialized URL query, synthesized from
  // the in-memory URL-state params (native has no window.location). Its `apply`
  // and the SavedViewMenu that consumes it are browser-only and omitted.
  const currentQuery = useMemo(() => {
    const parts: Array<[string, string]> = [
      ['vehicle', vehicleId ? String(vehicleId) : ''],
      ['a', atA],
      ['b', atB],
      ['q', signalFilter],
      ['cat', activeCategoryRaw],
    ];
    return parts
      .filter(([, v]) => v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
  }, [vehicleId, atA, atB, signalFilter, activeCategoryRaw]);

  // Permalink — web reads window.location.origin + pathname; native synthesizes
  // it from the canonical route + the serialized current query.
  const permalinkUrl = useMemo(
    () => `${ROUTE_PATH}?${currentQuery}`,
    [currentQuery],
  );

  const vehicleOptions = useMemo<SelectOption[]>(
    () =>
      (vehicles ?? []).map(v => ({
        value: String(v.id),
        label: v.display_name || v.vin,
      })),
    [vehicles],
  );

  const windowSpan =
    atAIso && atBIso
      ? `${
          Math.abs(
            new Date(atBIso).getTime() - new Date(atAIso).getTime(),
          ) / 1000
        } s`
      : '\u2014';

  return (
    <View style={styles.page} testID="signal-diff-page">
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        style={styles.scroll}>
        {/* PageContainer header (title + subtitle + actions). */}
        <View style={styles.header}>
          <View style={styles.headerText}>
            <AppText accessibilityRole="header" style={styles.pageTitle}>
              {t('signalDiff.title', 'Signal Diff')}
            </AppText>
            <AppText style={styles.pageSubtitle} tone="muted">
              {t(
                'signalDiff.subtitle',
                'Compare signal values between two snapshots in time',
              )}
            </AppText>
          </View>
          <View style={styles.headerActions}>
            {/* SavedViewMenu is browser-only (URL-saved views) and omitted. */}
            {permalinkUrl ? (
              <ShareLinkButton
                label={t('signalDiff.share', 'Share')}
                text={permalinkUrl}
              />
            ) : null}
          </View>
        </View>

        <SignalCompareControls
          atA={atA}
          atB={atB}
          category={activeCategory}
          onCategoryChange={setActiveCategory}
          onChangeA={setAtA}
          onChangeB={setAtB}
          onSearchChange={setSignalFilter}
          search={signalFilter}
          topSlot={
            <VehiclePicker
              label={t('signalDiff.vehicle', 'Vehicle')}
              onChange={next => setVehicleIdParam(Number(next))}
              options={vehicleOptions}
              value={String(vehicleId || '')}
            />
          }
        />

        <View style={styles.statGrid}>
          <StatCard
            label={t('signalDiff.totalChanged', 'Changed signals')}
            value={isLoading ? '\u2014' : String(allRows.length)}
          />
          <StatCard
            label={t('signalDiff.visible', 'Visible after filter')}
            value={isLoading ? '\u2014' : String(filteredRows.length)}
          />
          <StatCard
            label={t('signalDiff.pinnedCount', 'Pinned')}
            value={String(pinnedSignals.size)}
          />
          <StatCard
            label={t('signalDiff.windowSpan', 'Window span')}
            value={windowSpan}
          />
        </View>

        <BulkActionsToolbar
          actions={bulkActions}
          onClear={() => setSelectedSignals([])}
          selectedIds={selectedSignals}
          total={filteredRows.length}
        />

        {notice ? (
          <GlassPanel style={styles.notice} testID="signal-diff-notice">
            <AppText style={styles.noticeText} tone="secondary" variant="caption">
              {notice}
            </AppText>
            <Pressable
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => setNotice(null)}
              style={({pressed}) => [styles.noticeDismiss, pressed && styles.pressed]}
              testID="signal-diff-notice-dismiss">
              <AppText tone="accent" variant="caption" weight="semibold">
                {t('signalDiff.dismiss', 'Dismiss')}
              </AppText>
            </Pressable>
          </GlassPanel>
        ) : null}

        <GlassPanel style={styles.tablePanel} testID="signal-diff-table-panel">
          {error ? (
            <View style={styles.errorBox} testID="signal-diff-error">
              <AppText style={styles.errorText} variant="caption">
                {t('signalDiff.error', 'Failed to load diff')}
              </AppText>
            </View>
          ) : null}
          {isLoading && !diffResp ? (
            <View style={styles.skeletonStack} testID="signal-diff-loading">
              {Array.from({length: 6}).map((_, i) => (
                <SkeletonBar key={i} />
              ))}
            </View>
          ) : allRows.length === 0 && !filterActive && atAIso && atBIso ? (
            <View style={styles.emptyWrap} testID="signal-diff-empty">
              <SemanticIcon decorative name="gitCompare" size="lg" />
              <EmptyState
                message={t(
                  'signalDiff.noChanges',
                  'No signals changed between the two snapshots',
                )}
                title={t('signalDiff.noChangesTitle', 'No changes')}
              />
            </View>
          ) : (
            <SignalDiffTable
              filterActive={filterActive}
              loading={false}
              onSelectionChange={setSelectedSignals}
              pinnedSignals={pinnedSignals}
              rows={filteredRows}
              selectedSignals={selectedSignals}
              vehicleId={vehicleId}
            />
          )}
          {pinnedSignals.size > 0 ? (
            <View style={styles.pinnedRow} testID="signal-diff-pinned">
              <AppText style={styles.pinnedLabel} tone="muted" variant="caption">
                {t('signalDiff.pinnedLabel', 'Pinned:')}
              </AppText>
              {Array.from(pinnedSignals)
                .sort()
                .map(s => (
                  <Badge key={s}>{s}</Badge>
                ))}
            </View>
          ) : null}
        </GlassPanel>
      </ScrollView>
    </View>
  );
}

/* ─── Styles ──────────────────────────────────────────────────────────── */

const HAIRLINE = 'rgba(255, 255, 255, 0.08)';

const styles = StyleSheet.create({
  badge: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  badgeText: {
    color: colors.textSecondary,
  },
  categoryChip: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  categoryChipActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  categoryChipText: {
    color: colors.textMuted,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  categoryChipTextActive: {
    color: colors.accent,
  },
  categoryRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  clearButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  controlsPanel: {
    gap: spacing.md,
    marginBottom: spacing.md,
    padding: spacing.lg,
  },
  emptyWrap: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  errorBox: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  errorText: {
    color: colors.danger,
  },
  field: {
    gap: spacing.xs,
  },
  fieldLabel: {
    color: colors.textMuted,
  },
  filterInput: {
    flexGrow: 1,
    minWidth: 180,
  },
  filterRow: {
    borderTopColor: HAIRLINE,
    borderTopWidth: 1,
    gap: spacing.sm,
    paddingTop: spacing.md,
  },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  headerActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  headerText: {
    flexShrink: 1,
    gap: spacing.xs,
    minWidth: 0,
  },
  input: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: typography.body,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  notice: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  noticeDismiss: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  noticeText: {
    flexShrink: 1,
  },
  page: {
    backgroundColor: colors.background,
    flex: 1,
  },
  pillGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  pill: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  pillSelected: {
    backgroundColor: colors.surfaceSelected,
    borderColor: colors.borderAccent,
  },
  pillText: {
    color: colors.textSecondary,
    maxWidth: 220,
  },
  pillTextSelected: {
    color: colors.accent,
  },
  pinGlyph: {
    color: colors.warning,
    fontSize: 14,
  },
  pinnedLabel: {
    color: colors.textMuted,
  },
  pinnedRow: {
    alignItems: 'center',
    borderTopColor: HAIRLINE,
    borderTopWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.md,
    paddingTop: spacing.md,
  },
  pressed: {
    opacity: 0.7,
  },
  presetButton: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  presetsLabel: {
    color: colors.textMuted,
  },
  presetsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  pageSubtitle: {
    fontSize: typography.body,
  },
  pageTitle: {
    color: colors.textPrimary,
    fontSize: typography.title,
    fontWeight: '800',
    lineHeight: 28,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  shareButton: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  shareText: {
    color: colors.textPrimary,
  },
  shareTextMuted: {
    color: colors.textMuted,
  },
  skeletonBar: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 8,
    height: 36,
  },
  skeletonStack: {
    gap: spacing.sm,
  },
  statCard: {
    flexBasis: '47%',
    flexGrow: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  statValue: {
    color: colors.textPrimary,
    fontSize: typography.title,
    lineHeight: 28,
  },
  tablePanel: {
    padding: spacing.md,
  },
  unpinGlyph: {
    color: colors.textMuted,
    fontSize: 14,
  },
  windowField: {
    flexBasis: '47%',
    flexGrow: 1,
    gap: spacing.xs,
  },
  windowGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  windowLabelA: {
    color: colors.accent,
  },
  windowLabelB: {
    color: colors.warning,
  },
  windowLabelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
});
