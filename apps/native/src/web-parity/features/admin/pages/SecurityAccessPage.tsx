// Native parity port of web/src/features/admin/pages/SecurityAccessPage.tsx.
//
// `SecurityAccessPage` is the admin Security & Access surface. It resolves the
// active vehicle, polls the latest SecurityEvent (`/security/latest`, 5s) and the
// security event history (`useSecurityEvents` -> `/security`), client-side filters
// the history by the page range, derives a set of security stats, and renders a
// data-not-secure alert, a digital twin, and eight stacked security sections. All
// state names, API paths, query keys, refetch interval, the range/selection
// precedence intent, and every i18n key are preserved verbatim from the source.
//
// Web-only dependencies with no native-parity surface are mapped per the
// conversion contract (rules 4/5/6/7):
//   - react-i18next `useTranslation` (L2) -> the standard web-parity i18n shim
//     returning the inline English fallback (apps/native lacks react-i18next), so
//     every `t('key', 'English')` call in the body is unchanged.
//   - @tanstack/react-query `useQuery` (L3) -> reused (the native app bundles
//     @tanstack/react-query). The inline security-latest query is kept verbatim.
//   - lucide-react `AlertTriangle` / `AlertCircle` (L4, SVG) have no native analog
//     -> a decorative '\u26A0\uFE0F' glyph (accessibilityElementsHidden); the
//     adjacent text carries the meaning, so the glyph is decorative for a11y.
//   - `PageContainer` (L6) -> the reused web-parity layout PageContainer; its
//     native contract shows the spinner while `loading` and the children
//     otherwise, matching the source `loading={isLoading}` intent.
//   - `GlassPanel` (L7) -> the shared native GlassPanel.
//   - `AlertBanner` from @/components/feedback (L8) is not ported -> a local danger
//     AlertBanner (the GDPRExportPage precedent), mapping red-500 to the SI danger
//     palette (dangerSurface/dangerBorder/danger).
//   - `RangePicker` / `VehicleSelect` from @/components/forms (L9) are not ported.
//     VehicleSelect is the global header vehicle picker and RangePicker a calendar
//     popover; neither has a native parity port yet, so each renders a native-safe
//     read-only chip (VehicleSelect shows the resolved vehicle name; RangePicker
//     shows the active `start \u2192 end`). Interactive selection is UNAVAILABLE on
//     native (documented in the sidecar); the page still threads `value`/`onChange`
//     so the source data flow is preserved.
//   - `FadeIn` from @/components/motion (L10) -> the reused web-parity motion FadeIn.
//   - `VehicleTwin` from @/components/vehicles (L11) is not ported and depends on
//     the shared `@/lib/vehicleState` (a separate conversion file), so the Digital
//     Twin renders a native-safe PendingSection placeholder gated by `latest`
//     exactly like the source `{latest && ...}`. `buildTwinStateFromAdmin` (L19)
//     and the `twinState` memo are therefore intentionally not ported here (they
//     belong to the vehicleState lib conversion); the twin's interactive 3D view
//     is UNAVAILABLE on native.
//   - app hooks: `usePageTitle` (L13) -> native-safe no-op (no DOM document.title;
//     the translated title is still computed and rendered by PageContainer);
//     `useRangeState` (L14) -> a local useState-backed shim resolving the source
//     `defaultPresetId: 'all'` (start 2015-01-01 .. today) — URL/localStorage
//     persistence and presets are UNAVAILABLE on native; `useSelectedVehicle`
//     (L15) -> a local shim returning the first vehicle in the fleet (via the
//     web-parity `useVehicles`) — URL/path-param/persisted-store selection is
//     UNAVAILABLE on native.
//   - `useVehicles` (L16) and `useSecurityEvents` (L17) -> the reused web-parity
//     hooks (same query keys + `/vehicles` and `/security` paths).
//   - `getErrorMessage` from @/lib/errorMessage (L18) -> inlined verbatim.
//   - `request` from @/api/client (L20) -> the reused web-parity api client.
//   - `type SecurityEvent` from @/types/admin (L21) -> the structurally-identical
//     camelCase `SecurityEvent` re-exported by the web-parity `useAdmin` hook.
//   - the eight security-access helpers (L23-32) -> inlined byte-for-byte from web
//     `../components/security-access/helpers` (no native helpers module yet,
//     contract rule 6), with their `WindowState`/`SentryDayBucket`/`TimelineEvent`/
//     `SecurityStats` types.
//   - the eight section components (L34-43) imported from the `../components/
//     security-access` barrel: native has no barrel and only `WindowStatusDetail`
//     and `EventTimeline` are ported, so those two are imported directly and
//     rendered for real; the other six render native-safe PendingSection
//     placeholders (each accepting its real props so the derived values are
//     consumed) until their own parity ports land.
//
// No DOM-only modules, browser HTML elements, Recharts, Leaflet, or old web UI
// components are imported — only React + react-native primitives (View /
// StyleSheet), the web-parity PageContainer / FadeIn / api client + hooks, the
// ported WindowStatusDetail / EventTimeline, the shared AppText / GlassPanel, and
// theme tokens. Tailwind maps to StyleSheet: the actions `flex flex-wrap gap-3
// justify-end` -> a wrapping row (gap 12, justify flex-end); the alert
// `border-red-500/30 bg-red-500/5 px-4 py-3 gap-3` -> a danger panel row; the page
// vertical rhythm (mb-4 / mb-6 on panels) -> a body View with gap 16;
// --text-primary/-muted -> colors.text*.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {StyleSheet, View} from 'react-native';
import {useQuery} from '@tanstack/react-query';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {request} from '../../../api/client';
import {useSecurityEvents, type SecurityEvent} from '../../../api/hooks/useAdmin';
import {useVehicles} from '../../../api/hooks/useVehicles';
import {PageContainer} from '../../../components/layout/PageContainer';
import {FadeIn} from '../../../components/motion';
import {EventTimeline} from '../components/security-access/EventTimeline';
import {WindowStatusDetail} from '../components/security-access/WindowStatusDetail';

// ── i18n shim ────────────────────────────────────────────────────────────────
// react-i18next has no native parity module; translations resolve to their inline
// English fallback. The hook shape mirrors the web `const { t } = useTranslation()`
// so the component bodies are unchanged.
type TFunc = (key: string, fallback: string) => string;
function useTranslation(): {t: TFunc} {
  return {t: (_key, fallback) => fallback};
}

// ── usePageTitle shim ────────────────────────────────────────────────────────
// The web hook writes `document.title`; native has no DOM document, so this is a
// documented native-safe no-op. The call site is kept so the translated title is
// still computed identically (and PageContainer renders it as the page header).
function usePageTitle(title: string): void {
  useEffect(() => {
    return undefined;
  }, [title]);
}

// ── getErrorMessage (inlined from web @/lib/errorMessage) ─────────────────────
// React Query errors are typed `unknown`; normalise Error objects, strings, and
// arbitrary values into a string (verbatim from the web util).
function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'string') {
    return err;
  }
  return 'An unexpected error occurred';
}

/* ------------------------------------------------------------------ */
/*  Security-access helpers (inlined verbatim from web ./helpers)      */
/* ------------------------------------------------------------------ */

type WindowState = 'Closed' | 'Venting' | 'Open' | 'Unknown';

interface SentryDayBucket {
  date: string;
  sentryOn: number;
  sentryOff: number;
}

interface TimelineEvent {
  id: string;
  kind: 'lock' | 'sentry' | 'door';
  variant: 'positive' | 'negative' | 'neutral';
  detail: string;
  timestamp: string;
}

interface SecurityStats {
  lockEvents: number;
  doorOpenCount: number;
  windowOpenCount: number;
  homelinkCount: number;
  guestCount: number;
  total: number;
}

// `asNonEmptyString` inlined from web @/lib/typeGuards (no native typeGuards
// module). Returns `v` only when it is a non-empty string; `null` otherwise.
function asNonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function parseWindowState(val: unknown): WindowState {
  const raw = asNonEmptyString(val);
  if (!raw) {
    return 'Unknown';
  }
  const lower = raw.toLowerCase();
  if (lower === 'closed' || lower === '0') {
    return 'Closed';
  }
  if (lower.includes('vent')) {
    return 'Venting';
  }
  if (lower.includes('open') || lower !== '0') {
    return 'Open';
  }
  return 'Unknown';
}

function doorClosed(state: unknown): boolean {
  // Backend may emit DoorState as bool/object.
  if (state == null) {
    return true;
  }
  if (typeof state === 'boolean') {
    return !state;
  }
  if (typeof state === 'number') {
    return state === 0;
  }
  if (typeof state === 'object' && !Array.isArray(state)) {
    return Object.values(state as Record<string, unknown>).every(
      v => v === false || v == null,
    );
  }
  const raw = asNonEmptyString(state);
  if (!raw) {
    return true;
  }
  const lower = raw.trim().toLowerCase();
  if (
    lower === '' ||
    lower === 'closed' ||
    lower === 'closedall' ||
    lower === '0' ||
    lower === 'false'
  ) {
    return true;
  }
  if (lower.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return Object.values(parsed).every(v => v === false || v == null);
    } catch {
      /* fall through */
    }
  }
  return false;
}

function allWindowsClosed(ev: SecurityEvent | undefined): boolean {
  if (!ev) {
    return true;
  }
  return [ev.fdWindow, ev.fpWindow, ev.rdWindow, ev.rpWindow]
    .map(parseWindowState)
    .every(s => s === 'Closed');
}

/** Returns true if the SentryMode value means armed (any non-Off state).
 *  Accepts native bool and string enum values. */
function isSentryActive(val: unknown): boolean {
  if (typeof val === 'boolean') {
    return val;
  }
  const raw = asNonEmptyString(val);
  if (!raw) {
    return false;
  }
  return !raw.toLowerCase().includes('off');
}

function buildSentryBuckets(events: SecurityEvent[]): SentryDayBucket[] {
  const bucketMap = new Map<string, {on: number; off: number}>();

  for (const ev of events) {
    const dateKey = (ev.createdAt ?? '').slice(0, 10);
    const bucket = bucketMap.get(dateKey) ?? {on: 0, off: 0};
    if (isSentryActive(ev.sentryMode)) {
      bucket.on += 1;
    } else {
      bucket.off += 1;
    }
    bucketMap.set(dateKey, bucket);
  }

  return Array.from(bucketMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, counts]) => ({
      date,
      sentryOn: counts.on,
      sentryOff: counts.off,
    }));
}

function computeSentryUptime(events: SecurityEvent[]): number {
  if (events.length === 0) {
    return 0;
  }
  const sentryOnCount = events.filter(e => isSentryActive(e.sentryMode)).length;
  return (sentryOnCount / events.length) * 100;
}

function findLastLockChange(events: SecurityEvent[]): string | undefined {
  for (let i = 1; i < events.length; i++) {
    if (events[i].locked !== events[i - 1].locked) {
      return events[i - 1].createdAt;
    }
  }
  return events[0]?.createdAt;
}

function computeSecurityStats(history: SecurityEvent[]): SecurityStats | null {
  if (history.length === 0) {
    return null;
  }
  let lockEvents = 0;
  for (let i = 1; i < history.length; i++) {
    if (history[i].locked !== history[i - 1].locked) {
      lockEvents++;
    }
  }
  const doorOpenCount = history.filter(e => !doorClosed(e.doorState)).length;
  const windowOpenCount = history.filter(e => !allWindowsClosed(e)).length;
  const homelinkCount = history.filter(e => e.homelinkNearby).length;
  const guestCount = history.filter(e => e.guestMode).length;
  return {
    lockEvents,
    doorOpenCount,
    windowOpenCount,
    homelinkCount,
    guestCount,
    total: history.length,
  };
}

function deriveTimeline(events: SecurityEvent[]): TimelineEvent[] {
  if (events.length === 0) {
    return [];
  }

  const sorted = [...events].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const timeline: TimelineEvent[] = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const curr = sorted[i];
    const prev = sorted[i + 1];

    if (curr.locked !== prev.locked) {
      timeline.push({
        id: `lock-${curr.id}`,
        kind: 'lock',
        detail: asNonEmptyString(curr.doorState) ?? '\u2014',
        timestamp: curr.createdAt,
        variant: curr.locked ? 'positive' : 'negative',
      });
    }

    if (curr.sentryMode !== prev.sentryMode) {
      timeline.push({
        id: `sentry-${curr.id}`,
        kind: 'sentry',
        detail: '',
        timestamp: curr.createdAt,
        variant: isSentryActive(curr.sentryMode) ? 'positive' : 'negative',
      });
    }

    if (curr.doorState !== prev.doorState) {
      const closed = doorClosed(curr.doorState);
      timeline.push({
        id: `door-${curr.id}`,
        kind: 'door',
        detail: asNonEmptyString(curr.doorState) ?? (closed ? 'Closed' : 'Open'),
        timestamp: curr.createdAt,
        variant: closed ? 'positive' : 'negative',
      });
    }

    if (timeline.length >= 50) {
      break;
    }
  }

  return timeline.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
}

/* ------------------------------------------------------------------ */
/*  useRangeState shim (native-safe; resolves the source 'all' preset) */
/* ------------------------------------------------------------------ */

interface RangeValue {
  start: string;
  end: string;
}

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// The web hook syncs the range to the URL + localStorage and supports presets.
// Native has no DOM URL/localStorage, so this is a useState-backed shim that
// resolves the source `defaultPresetId: 'all'` window (resolveAllTimeStart's
// 2015-01-01 lower bound .. today). `setRange` stays functional for source
// compatibility; URL/localStorage persistence and presets are unavailable.
function useRangeState(_opts: {
  persistKey?: string;
  defaultPresetId?: string;
}): {start: string; end: string; setRange: (range: RangeValue) => void} {
  const [range, setRangeState] = useState<RangeValue>(() => ({
    start: '2015-01-01',
    end: todayIso(),
  }));
  const setRange = useCallback(
    (next: RangeValue) => setRangeState(next),
    [],
  );
  return {start: range.start, end: range.end, setRange};
}

/* ------------------------------------------------------------------ */
/*  useSelectedVehicle shim (native-safe; first vehicle in the fleet)  */
/* ------------------------------------------------------------------ */

// The web hook resolves URL path/query > persisted store > first vehicle. Native
// has no DOM URL and no cross-page selected-vehicle store in the web-parity tree,
// so selection falls back to the first vehicle in the fleet. The VehicleSelect
// chip below is non-interactive on native (documented in the sidecar).
function useSelectedVehicle(): {vehicleId: number | null} {
  const {data: vehicles} = useVehicles();
  const vehicleId =
    vehicles && vehicles.length > 0 ? vehicles[0].id : null;
  return {vehicleId};
}

/* ------------------------------------------------------------------ */
/*  Local native-safe substitutes for unported web components          */
/* ------------------------------------------------------------------ */

// Local danger AlertBanner (web @/components/feedback AlertBanner not ported).
interface AlertBannerProps {
  glyph?: string;
  children: ReactNode;
}
function AlertBanner({glyph, children}: AlertBannerProps) {
  return (
    <View accessibilityRole="alert" style={styles.alert}>
      {glyph ? (
        <AppText
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.alertGlyph}>
          {glyph}
        </AppText>
      ) : null}
      <AppText style={styles.alertText}>{children}</AppText>
    </View>
  );
}

// Generic native-safe placeholder for sibling components whose own parity ports
// have not landed yet (contract rule 7). Swapped for the real import when each
// sibling is converted.
interface PendingSectionProps {
  title: string;
  message: string;
}
function PendingSection({title, message}: PendingSectionProps) {
  return (
    <GlassPanel style={styles.pending}>
      <AppText accessibilityRole="header" style={styles.pendingTitle}>
        {title}
      </AppText>
      <AppText style={styles.pendingMessage} tone="muted">
        {message}
      </AppText>
    </GlassPanel>
  );
}

const UNAVAILABLE_KEY = 'admin.security.section.unavailableOnNative';
const UNAVAILABLE_FALLBACK =
  'This section is not yet available in the native app.';

interface SummaryStatsRowProps {
  isSecure: boolean;
  lastLockChange: string | undefined;
  sentryUptime: number;
  totalEvents: number;
  isLoading: boolean;
}
function SummaryStatsRow(_props: SummaryStatsRowProps) {
  const {t} = useTranslation();
  return (
    <PendingSection
      title={t('admin.security.summary.title', 'Security Summary')}
      message={t(UNAVAILABLE_KEY, UNAVAILABLE_FALLBACK)}
    />
  );
}

interface SecurityStatusCardsProps {
  latest: SecurityEvent | undefined;
  isLoading: boolean;
}
function SecurityStatusCards(_props: SecurityStatusCardsProps) {
  const {t} = useTranslation();
  return (
    <PendingSection
      title={t('admin.security.statusCards.title', 'Security Status')}
      message={t(UNAVAILABLE_KEY, UNAVAILABLE_FALLBACK)}
    />
  );
}

interface LiveVehicleStateProps {
  latest: SecurityEvent | undefined;
}
function LiveVehicleState(_props: LiveVehicleStateProps) {
  const {t} = useTranslation();
  return (
    <PendingSection
      title={t('admin.security.liveState', 'Live Vehicle State')}
      message={t(UNAVAILABLE_KEY, UNAVAILABLE_FALLBACK)}
    />
  );
}

interface SentryModeChartProps {
  sentryBuckets: SentryDayBucket[];
}
function SentryModeChart(_props: SentryModeChartProps) {
  const {t} = useTranslation();
  return (
    <PendingSection
      title={t('admin.security.sentryChart', 'Sentry Mode Activity')}
      message={t(UNAVAILABLE_KEY, UNAVAILABLE_FALLBACK)}
    />
  );
}

interface SecurityStatisticsProps {
  securityStats: SecurityStats | null;
  sentryUptime: number;
  isLoading: boolean;
}
function SecurityStatistics(_props: SecurityStatisticsProps) {
  const {t} = useTranslation();
  return (
    <PendingSection
      title={t('admin.security.statsTitle', 'Security Statistics')}
      message={t(UNAVAILABLE_KEY, UNAVAILABLE_FALLBACK)}
    />
  );
}

interface EventHistoryTableProps {
  history: SecurityEvent[];
  isLoading: boolean;
}
function EventHistoryTable(_props: EventHistoryTableProps) {
  const {t} = useTranslation();
  return (
    <PendingSection
      title={t('admin.security.eventHistory', 'Security Event History')}
      message={t(UNAVAILABLE_KEY, UNAVAILABLE_FALLBACK)}
    />
  );
}

// VehicleTwin (web @/components/vehicles) + buildTwinStateFromAdmin are not ported
// (the twin depends on the shared vehicleState lib, a separate conversion file).
// The Digital Twin renders a native-safe placeholder; the interactive 3D view is
// unavailable on native.
function VehicleTwinPanel() {
  const {t} = useTranslation();
  return (
    <PendingSection
      title={t('admin.security.twin.title', 'Vehicle Digital Twin')}
      message={t(
        'admin.security.twin.unavailableOnNative',
        'The interactive vehicle digital twin is not yet available in the native app.',
      )}
    />
  );
}

// VehicleSelect (web @/components/forms) is the global header vehicle picker; not
// ported. Native shows a read-only chip with the resolved vehicle name (selection
// is fixed to the first vehicle on native — see useSelectedVehicle).
function VehicleSelect() {
  const {t} = useTranslation();
  const {data: vehicles} = useVehicles();
  const first = vehicles && vehicles.length > 0 ? vehicles[0] : undefined;
  const name =
    first?.display_name ?? first?.displayName ?? t('vehicle.none', 'No vehicle');
  return (
    <View accessibilityRole="text" style={styles.chip}>
      <AppText style={styles.chipLabel} tone="muted">
        {t('vehicle.label', 'Vehicle')}
      </AppText>
      <AppText style={styles.chipValue}>{name}</AppText>
    </View>
  );
}

// RangePicker (web @/components/forms) is a calendar popover; not ported. Native
// shows the active range read-only (`start \u2192 end`). The `onChange`/`align`
// props are threaded for source-data-flow parity but interactive selection is
// unavailable on native.
interface RangePickerProps {
  value: RangeValue;
  onChange: (range: RangeValue) => void;
  align?: 'start' | 'end';
  triggerTestId?: string;
}
function RangePicker({value, triggerTestId}: RangePickerProps) {
  const {t} = useTranslation();
  return (
    <View accessibilityRole="text" style={styles.chip} testID={triggerTestId}>
      <AppText style={styles.chipLabel} tone="muted">
        {t('common.range.label', 'Range')}
      </AppText>
      <AppText style={styles.chipValue}>
        {`${value.start} \u2192 ${value.end}`}
      </AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function SecurityAccessPage() {
  const {t} = useTranslation();
  usePageTitle(t('admin.security.title', 'Security & Access'));

  /* ---- Vehicle selection (persisted across pages) ---- */
  const {vehicleId} = useSelectedVehicle();
  const activeId = vehicleId != null ? String(vehicleId) : '';

  /* Surface useVehicles errors via the same vehiclesError binding the
     legacy code used so the AlertBanner below keeps reporting list-load
     failures. React Query dedupes by queryKey so this is a free piggy-back. */
  const {error: vehiclesError} = useVehicles();

  /* ---- Latest security state (polled) ---- */
  const {
    data: latest,
    isLoading: loadingLatest,
    error: latestError,
  } = useQuery({
    queryKey: ['security-latest', activeId],
    queryFn: () =>
      request<SecurityEvent>(`/security/latest?vehicle_id=${activeId}`),
    enabled: !!activeId,
    refetchInterval: 5000,
  });

  /* ---- Security event history ---- */
  const {
    data: rawHistory = [],
    isLoading: loadingHistory,
    error: historyError,
  } = useSecurityEvents(activeId);

  /* ---- Range filter (client-side on history) ---- */
  const {start, end, setRange} = useRangeState({
    persistKey: 'security-access.range',
    defaultPresetId: 'all',
  });
  const history = useMemo(() => {
    if (!rawHistory.length) {
      return rawHistory;
    }
    const startMs = new Date(`${start}T00:00:00`).getTime();
    const endMs = new Date(`${end}T23:59:59.999`).getTime();
    return rawHistory.filter(e => {
      if (!e.createdAt) {
        return false;
      }
      const ts = new Date(e.createdAt).getTime();
      return ts >= startMs && ts <= endMs;
    });
  }, [rawHistory, start, end]);

  const anyError = [vehiclesError, latestError, historyError].find(Boolean);
  const isLoading = loadingLatest || loadingHistory;

  /* ---- Computed stats ---- */
  const isSecure = useMemo(() => {
    if (!latest) {
      return true;
    }
    return (
      !!latest.locked && doorClosed(latest.doorState) && allWindowsClosed(latest)
    );
  }, [latest]);

  const sentryUptime = useMemo(() => computeSentryUptime(history), [history]);
  const lastLockChange = useMemo(() => findLastLockChange(history), [history]);
  const sentryBuckets = useMemo(() => buildSentryBuckets(history), [history]);
  const securityStats = useMemo(() => computeSecurityStats(history), [history]);
  const timelineEvents = useMemo(() => deriveTimeline(history), [history]);

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <PageContainer
      title={t('admin.security.title', 'Security & Access')}
      subtitle={t(
        'admin.security.subtitle',
        'Lock status, sentry mode, doors, and windows',
      )}
      loading={isLoading}
      error={null}
      actions={
        <View style={styles.actions}>
          <VehicleSelect />
          <RangePicker
            value={{start, end}}
            onChange={setRange}
            align="end"
            triggerTestId="security-access-range"
          />
        </View>
      }>
      <View style={styles.body}>
        {anyError ? (
          <AlertBanner glyph={'\u26A0\uFE0F'}>
            {t('error.loadFailed', 'Failed to load data')}:{' '}
            {getErrorMessage(anyError)}
          </AlertBanner>
        ) : null}

        {/* Alert banner */}
        {!isSecure && latest ? (
          <FadeIn>
            <GlassPanel style={styles.notSecurePanel}>
              <View style={styles.notSecureRow}>
                <AppText
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  style={styles.notSecureGlyph}>
                  {'\u26A0\uFE0F'}
                </AppText>
                <AppText style={styles.notSecureText}>
                  {t(
                    'admin.security.alert',
                    '\u26A0 Vehicle may not be secure \u2014 check lock, door, and window status.',
                  )}
                </AppText>
              </View>
            </GlassPanel>
          </FadeIn>
        ) : null}

        {/* Digital Twin */}
        {latest ? (
          <FadeIn>
            <VehicleTwinPanel />
          </FadeIn>
        ) : null}

        <SummaryStatsRow
          isSecure={isSecure}
          lastLockChange={lastLockChange}
          sentryUptime={sentryUptime}
          totalEvents={history.length}
          isLoading={loadingLatest}
        />

        <SecurityStatusCards latest={latest} isLoading={loadingLatest} />
        <WindowStatusDetail latest={latest} />
        <LiveVehicleState latest={latest} />
        <SentryModeChart sentryBuckets={sentryBuckets} />
        <SecurityStatistics
          securityStats={securityStats}
          sentryUptime={sentryUptime}
          isLoading={loadingHistory}
        />
        <EventHistoryTable history={history} isLoading={loadingHistory} />
        <EventTimeline timelineEvents={timelineEvents} />
      </View>
    </PageContainer>
  );
}

const styles = StyleSheet.create({
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md, // gap-3
    justifyContent: 'flex-end', // justify-end
  },
  body: {
    gap: 16, // mb-4 / mb-6 vertical rhythm
  },
  alert: {
    alignItems: 'flex-start',
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  alertGlyph: {
    color: colors.danger,
    fontSize: 16,
    lineHeight: 22,
  },
  alertText: {
    color: colors.danger,
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  notSecurePanel: {
    backgroundColor: colors.dangerSurface, // bg-red-500/5
    borderColor: colors.dangerBorder, // border-red-500/30
  },
  notSecureRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md, // gap-3
    paddingHorizontal: 16, // px-4
    paddingVertical: 12, // py-3
  },
  notSecureGlyph: {
    color: colors.danger, // text-red-400
    fontSize: 18,
    lineHeight: 22,
  },
  notSecureText: {
    color: colors.danger, // text-red-400
    flex: 1,
    fontSize: 14, // text-sm
    fontWeight: '600', // font-semibold
    lineHeight: 20,
  },
  chip: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 36,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  chipLabel: {
    fontSize: 12,
    lineHeight: 16,
  },
  chipValue: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  pending: {
    gap: spacing.sm,
    padding: spacing.lg,
  },
  pendingTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
  },
  pendingMessage: {
    fontSize: 14,
    lineHeight: 20,
  },
});
