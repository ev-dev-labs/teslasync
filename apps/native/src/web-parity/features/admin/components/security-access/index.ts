// Native parity port of
// web/src/features/admin/components/security-access/index.ts.
//
// The web module (8 lines) is a barrel that re-exports the eight Security &
// Access building blocks:
//   L1 `export { SummaryStatsRow }      from './SummaryStatsRow'`
//   L2 `export { SecurityStatusCards }  from './SecurityStatusCards'`
//   L3 `export { WindowStatusDetail }   from './WindowStatusDetail'`
//   L4 `export { LiveVehicleState }     from './LiveVehicleState'`
//   L5 `export { SentryModeChart }      from './SentryModeChart'`
//   L6 `export { SecurityStatistics }   from './SecurityStatistics'`
//   L7 `export { EventHistoryTable }    from './EventHistoryTable'`
//   L8 `export { EventTimeline }        from './EventTimeline'`
// All eight exported names are preserved by this native barrel.
//
// Like the established native devtools/index.ts + ingest-xray/index.ts barrels,
// this port is SELF-CONTAINED: the eight web siblings reach into a browser-only
// graph that is absent from the React Native parity tree — lucide-react icons,
// the @/components/ui GlassPanel/Badge/DataTable, @/components/data-display
// MetricCard/TimeStamp, @/components/feedback Skeleton/EmptyState,
// @/components/motion FadeIn, and the @/components/charts recharts BarChart
// stack. We therefore inline native-safe implementations that keep the public
// export surface, the prop contracts, the state/behavior, the i18n intent and
// the visual intent, and surface explicit unavailable states for the
// browser-only chart / sortable+paginated DataTable / framer-motion animations.
// The `.ts` extension keeps JSX out (trees are built with React.createElement),
// matching the sibling barrels.
//
// The window/door/sentry helper LOGIC the components consume (parseWindowState,
// doorClosed, allWindowsClosed, windowSummary, timeSince) is ported inline from
// the sibling helpers.ts so this barrel renders without depending on a separate
// helpers conversion; the page-orchestration helpers (buildSentryBuckets,
// computeSecurityStats, deriveTimeline, …) are NOT part of this barrel's export
// surface and stay with helpers.ts. `SecurityEvent` is imported from the already
// ported native web-parity api/hooks/useAdmin so there is a single source of
// truth (mirrors ingest-xray importing its types from useIngestXRay).

import React from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {MetricCard} from '../../../../../components/ui/MetricCard';
import {colors, spacing} from '../../../../../theme/tokens';
import type {SecurityEvent} from '../../../../api/hooks/useAdmin';

const el = React.createElement;

/* ─── native-safe i18n shim ───────────────────────────────────────────────
   The web siblings use react-i18next `t(key, fallback)`. The parity tree has no
   i18n provider, so we preserve the keys + English fallbacks (and {{var}}
   interpolation) and render the fallback string. */

type InterpolationValues = Record<string, string | number>;

function t(_key: string, fallback: string, vars?: InterpolationValues): string {
  if (!vars) {
    return fallback;
  }
  return fallback.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  );
}

/* ─── ported integer formatting (web/src/lib/numberFormat.ts: fmtInt) ─────── */

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Locale-aware integer (web `fmtInt` = `fmtNumber(v, 0)`). */
function fmtInt(value: unknown): string {
  try {
    return safeNumber(value).toLocaleString('en-US', {
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    });
  } catch {
    return String(Math.round(safeNumber(value)));
  }
}

/* ─── ported date labels (web/src/lib/dateFormat.ts + data-display TimeStamp) ── */

/** Short calendar label (web `formatDateShort`: month short + numeric day). */
function formatDateShort(iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
}

/** Absolute timestamp label (web `<TimeStamp value={…} />` default format). */
function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function range(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(i);
  }
  return out;
}

/* ─── ported type guard (web/src/lib/typeGuards.ts: asNonEmptyString) ─────── */

function asNonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/* ─── ported helper types (web security-access/helpers.ts) ────────────────── */

export type WindowState = 'Closed' | 'Venting' | 'Open' | 'Unknown';

export interface SentryDayBucket {
  date: string;
  sentryOn: number;
  sentryOff: number;
}

export interface SecurityStats {
  lockEvents: number;
  doorOpenCount: number;
  windowOpenCount: number;
  homelinkCount: number;
  guestCount: number;
  total: number;
}

export interface TimelineEvent {
  id: string;
  kind: 'lock' | 'sentry' | 'door';
  variant: 'positive' | 'negative' | 'neutral';
  detail: string;
  timestamp: string;
}

/* ─── ported helper logic the components consume (web helpers.ts) ─────────── */

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
  // Backend may emit DoorState as bool/number/object/string.
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

function windowSummary(ev: SecurityEvent | undefined): string {
  if (!ev) {
    return '—';
  }
  const states = [ev.fdWindow, ev.fpWindow, ev.rdWindow, ev.rpWindow].map(
    parseWindowState,
  );
  const allClosed = states.every(s => s === 'Closed');
  if (allClosed) {
    return 'All Closed';
  }
  const openCount = states.filter(s => s !== 'Closed').length;
  return `${openCount} Open/Venting`;
}

function timeSince(iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) {
    return '—';
  }
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) {
    return 'just now';
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/* ─── semantic colors (web tailwind 400-shades → dynamic inline colors) ───── */

const SEMANTIC = {
  green: '#4ade80',
  red: '#f87171',
  amber: '#fbbf24',
  blue: '#60a5fa',
  purple: '#c084fc',
  cyan: '#22d3ee',
  muted: colors.textMuted,
} as const;

// recharts fills preserved verbatim from web SentryModeChart.
const SENTRY_ON_COLOR = '#3b82f6';
const SENTRY_OFF_COLOR = '#6b7280';

type MetricColor = 'green' | 'red' | 'amber' | 'blue' | 'purple' | 'cyan';

/** Map a web MetricCard `color` to the native MetricCard's 3-tone palette
 *  (its indicator dot stands in for the dropped lucide icon). */
function metricTone(color: MetricColor): 'accent' | 'danger' | 'neutral' {
  if (color === 'red') {
    return 'danger';
  }
  if (color === 'green' || color === 'cyan') {
    return 'accent';
  }
  return 'neutral';
}

function windowStateTextColor(state: WindowState): string {
  switch (state) {
    case 'Closed':
      return SEMANTIC.green;
    case 'Venting':
      return SEMANTIC.amber;
    case 'Open':
      return SEMANTIC.red;
    default:
      return SEMANTIC.muted;
  }
}

function windowStatePanel(state: WindowState): {
  backgroundColor: string;
  borderColor: string;
} {
  switch (state) {
    case 'Closed':
      return {backgroundColor: 'rgba(34,197,94,0.18)', borderColor: 'rgba(34,197,94,0.4)'};
    case 'Venting':
      return {backgroundColor: 'rgba(245,158,11,0.18)', borderColor: 'rgba(245,158,11,0.4)'};
    case 'Open':
      return {backgroundColor: 'rgba(239,68,68,0.18)', borderColor: 'rgba(239,68,68,0.4)'};
    default:
      return {backgroundColor: 'rgba(107,114,128,0.18)', borderColor: 'rgba(107,114,128,0.4)'};
  }
}

const chipPalette = {
  success: {bg: colors.successSurface, border: colors.successBorder, text: colors.success},
  danger: {bg: colors.dangerSurface, border: colors.dangerBorder, text: colors.danger},
  neutral: {bg: colors.surfaceRaised, border: colors.border, text: colors.textMuted},
} as const;

/** Native analog of the web `<Badge variant=… size="sm">` chip. */
function renderChip(
  label: string,
  variant: 'success' | 'danger' | 'neutral',
): React.ReactElement {
  const palette = chipPalette[variant];
  return el(
    View,
    {style: [styles.chip, {backgroundColor: palette.bg, borderColor: palette.border}]},
    el(AppText, {variant: 'caption', weight: 'semibold', style: {color: palette.text}}, label),
  );
}

/** Centered muted message — the message-only web `<EmptyState>` analog. */
function centeredEmpty(message: string): React.ReactElement {
  return el(
    View,
    {style: styles.centeredEmpty},
    el(AppText, {tone: 'muted'}, message),
  );
}

/** Section/panel heading (web `<h2 className="text-lg …">`). */
function renderPanelTitle(text: string): React.ReactElement {
  return el(
    AppText,
    {variant: 'title', weight: 'semibold', tone: 'secondary', style: styles.panelTitle},
    text,
  );
}

/* ─── SummaryStatsRow (web L1) ─────────────────────────────────────────────
   Four headline MetricCards: current secure/unsecure status, last lock change,
   sentry uptime %, total events. Loading → 4 skeleton blocks. */

export interface SummaryStatsRowProps {
  isSecure: boolean;
  lastLockChange: string | undefined;
  sentryUptime: number;
  totalEvents: number;
  isLoading: boolean;
}

export function SummaryStatsRow({
  isSecure,
  lastLockChange,
  sentryUptime,
  totalEvents,
  isLoading,
}: SummaryStatsRowProps): React.ReactElement {
  if (isLoading) {
    return el(
      View,
      {style: [styles.metricRow, styles.sectionGap]},
      ...range(4).map(i =>
        el(View, {key: `sk-${i}`, style: styles.metricSkeleton}),
      ),
    );
  }

  return el(
    View,
    {style: [styles.metricRow, styles.sectionGap]},
    el(MetricCard, {
      label: t('admin.security.stat.status', 'Current Status'),
      value: isSecure
        ? t('admin.security.secure', 'Secure')
        : t('admin.security.unsecure', 'Unsecure'),
      helper: '',
      tone: metricTone(isSecure ? 'green' : 'red'),
    }),
    el(MetricCard, {
      label: t('admin.security.stat.lastLock', 'Last Lock Change'),
      value: timeSince(lastLockChange),
      helper: '',
      tone: metricTone('cyan'),
    }),
    el(MetricCard, {
      label: t('admin.security.stat.sentryUptime', 'Sentry Uptime'),
      value: `${fmtInt(sentryUptime)}%`,
      helper: '',
      tone: metricTone('blue'),
    }),
    el(MetricCard, {
      label: t('admin.security.stat.totalEvents', 'Total Events'),
      value: totalEvents,
      helper: '',
      tone: metricTone('purple'),
    }),
  );
}

/* ─── SecurityStatusCards (web L2) ─────────────────────────────────────────
   Six status panels: lock, sentry, doors, windows, homelink, guest. A colored
   indicator dot stands in for each web lucide icon. Loading → 6 skeletons. */

interface StatusCardSpec {
  key: string;
  dotColor: string;
  title: string;
  value: string;
  valueColor: string;
  desc: string;
}

function renderStatusCard(spec: StatusCardSpec): React.ReactElement {
  return el(GlassPanel, {
    key: spec.key,
    style: styles.statusCard,
    children: el(
      React.Fragment,
      null,
      el(
        View,
        {style: styles.statusHeader},
        el(View, {style: [styles.statusDot, {backgroundColor: spec.dotColor}]}),
        el(AppText, {variant: 'caption', weight: 'semibold', tone: 'secondary'}, spec.title),
      ),
      el(
        AppText,
        {variant: 'title', weight: 'bold', style: [styles.statusValue, {color: spec.valueColor}]},
        spec.value,
      ),
      el(AppText, {variant: 'caption', tone: 'muted'}, spec.desc),
    ),
  });
}

export interface SecurityStatusCardsProps {
  latest: SecurityEvent | undefined;
  isLoading: boolean;
}

export function SecurityStatusCards({
  latest,
  isLoading,
}: SecurityStatusCardsProps): React.ReactElement {
  if (isLoading) {
    return el(
      View,
      {style: [styles.cardRow, styles.sectionGap]},
      ...range(6).map(i =>
        el(View, {key: `sk-${i}`, style: styles.statusSkeleton}),
      ),
    );
  }

  const doorIsClosed = doorClosed(latest?.doorState);
  const windowsClosed = allWindowsClosed(latest);

  const specs: StatusCardSpec[] = [
    {
      key: 'lock',
      dotColor: latest?.locked ? SEMANTIC.green : SEMANTIC.red,
      title: t('admin.security.card.lockStatus', 'Lock Status'),
      value: latest?.locked
        ? t('admin.security.locked', 'Locked')
        : t('admin.security.unlocked', 'Unlocked'),
      valueColor: latest?.locked ? SEMANTIC.green : SEMANTIC.red,
      desc: t('admin.security.card.lockDesc', 'Vehicle lock state'),
    },
    {
      key: 'sentry',
      dotColor: latest?.sentryMode ? SEMANTIC.blue : SEMANTIC.muted,
      title: t('admin.security.card.sentryMode', 'Sentry Mode'),
      value: latest?.sentryMode
        ? t('admin.security.active', 'Active')
        : t('admin.security.inactive', 'Inactive'),
      valueColor: latest?.sentryMode ? SEMANTIC.blue : SEMANTIC.muted,
      desc: t('admin.security.card.sentryDesc', 'Camera surveillance system'),
    },
    {
      key: 'doors',
      dotColor: doorIsClosed ? SEMANTIC.green : SEMANTIC.amber,
      title: t('admin.security.card.doors', 'Doors'),
      value: doorIsClosed
        ? t('admin.security.closed', 'Closed')
        : asNonEmptyString(latest?.doorState) ?? t('admin.security.open', 'Open'),
      valueColor: doorIsClosed ? SEMANTIC.green : SEMANTIC.amber,
      desc: t('admin.security.card.doorsDesc', 'All vehicle doors'),
    },
    {
      key: 'windows',
      dotColor: windowsClosed ? SEMANTIC.green : SEMANTIC.amber,
      title: t('admin.security.card.windows', 'Windows'),
      value: windowSummary(latest),
      valueColor: windowsClosed ? SEMANTIC.green : SEMANTIC.amber,
      desc: t('admin.security.card.windowsDesc', 'Window positions'),
    },
    {
      key: 'homelink',
      dotColor: latest?.homelinkNearby ? SEMANTIC.purple : SEMANTIC.muted,
      title: t('admin.security.card.homelink', 'HomeLink'),
      value: latest?.homelinkNearby
        ? t('admin.security.nearby', 'Nearby')
        : t('admin.security.away', 'Away'),
      valueColor: latest?.homelinkNearby ? SEMANTIC.purple : SEMANTIC.muted,
      desc: t('admin.security.card.homelinkDesc', 'Garage door opener'),
    },
    {
      key: 'guest',
      dotColor: latest?.guestMode ? SEMANTIC.amber : SEMANTIC.muted,
      title: t('admin.security.card.guestMode', 'Guest Mode'),
      value: latest?.guestMode
        ? t('admin.security.enabled', 'Enabled')
        : t('admin.security.disabled', 'Disabled'),
      valueColor: latest?.guestMode ? SEMANTIC.amber : SEMANTIC.muted,
      desc: t('admin.security.card.guestDesc', 'Temporary access mode'),
    },
  ];

  return el(
    View,
    {style: [styles.cardRow, styles.sectionGap]},
    ...specs.map(renderStatusCard),
  );
}

/* ─── WindowStatusDetail (web L3) ──────────────────────────────────────────
   Per-window (FD/FP/RD/RP) tinted panels showing the parsed window state. */

const WINDOW_KEYS: ReadonlyArray<{
  key: 'fdWindow' | 'fpWindow' | 'rdWindow' | 'rpWindow';
  i18nKey: string;
  fallback: string;
}> = [
  {key: 'fdWindow', i18nKey: 'admin.security.window.fd', fallback: 'Front Driver'},
  {key: 'fpWindow', i18nKey: 'admin.security.window.fp', fallback: 'Front Passenger'},
  {key: 'rdWindow', i18nKey: 'admin.security.window.rd', fallback: 'Rear Driver'},
  {key: 'rpWindow', i18nKey: 'admin.security.window.rp', fallback: 'Rear Passenger'},
];

export interface WindowStatusDetailProps {
  latest: SecurityEvent | undefined;
}

export function WindowStatusDetail({
  latest,
}: WindowStatusDetailProps): React.ReactElement {
  return el(
    View,
    {style: styles.sectionGap},
    el(
      AppText,
      {variant: 'title', weight: 'semibold', tone: 'secondary', style: styles.sectionTitle},
      t('admin.security.windowDetail', 'Window Status Detail'),
    ),
    el(
      View,
      {style: styles.cardRow},
      ...WINDOW_KEYS.map(win => {
        const state = parseWindowState(latest?.[win.key]);
        const panel = windowStatePanel(state);
        return el(GlassPanel, {
          key: win.key,
          style: [styles.windowCard, panel],
          children: el(
            React.Fragment,
            null,
            el(
              AppText,
              {variant: 'caption', tone: 'muted', style: styles.windowLabel},
              t(win.i18nKey, win.fallback),
            ),
            el(
              AppText,
              {variant: 'title', weight: 'bold', style: {color: windowStateTextColor(state)}},
              t(`admin.security.windowState.${state.toLowerCase()}`, state),
            ),
          ),
        });
      }),
    ),
  );
}

/* ─── LiveVehicleState (web L4) ────────────────────────────────────────────
   A grid of live signal chips derived from the latest event. The web lucide
   icon per signal becomes a colored activity dot. Empty → message. */

interface LiveSignal {
  key: string;
  label: string;
  value: string;
  active: boolean;
}

function buildLiveSignals(ev: SecurityEvent | undefined): LiveSignal[] {
  if (!ev) {
    return [];
  }
  const boolLabel = (val: boolean | null | undefined): string =>
    val == null ? '—' : val ? t('admin.security.on', 'On') : t('admin.security.off', 'Off');

  return [
    {
      key: 'hazards',
      label: t('admin.security.live.hazards', 'Hazards'),
      value: boolLabel(ev.lightsHazardsActive),
      active: !!ev.lightsHazardsActive,
    },
    {
      key: 'highBeams',
      label: t('admin.security.live.highBeams', 'High Beams'),
      value: boolLabel(ev.lightsHighBeams),
      active: !!ev.lightsHighBeams,
    },
    {
      key: 'turnSignal',
      label: t('admin.security.live.turnSignal', 'Turn Signal'),
      value: asNonEmptyString(ev.lightsTurnSignal) ?? '—',
      active: (() => {
        const s = asNonEmptyString(ev.lightsTurnSignal);
        return !!s && !s.toLowerCase().includes('off');
      })(),
    },
    {
      key: 'driverSeat',
      label: t('admin.security.live.driverSeat', 'Driver Seat'),
      value:
        ev.driverSeatOccupied == null
          ? '—'
          : ev.driverSeatOccupied
          ? t('admin.security.live.occupied', 'Occupied')
          : t('admin.security.live.empty', 'Empty'),
      active: !!ev.driverSeatOccupied,
    },
    {
      key: 'pairedKeys',
      label: t('admin.security.live.pairedKeys', 'Paired Keys'),
      value: ev.pairedPhoneKeyCount != null ? String(ev.pairedPhoneKeyCount) : '—',
      active: (ev.pairedPhoneKeyCount ?? 0) > 0,
    },
    {
      key: 'valetMode',
      label: t('admin.security.live.valetMode', 'Valet Mode'),
      value: boolLabel(ev.valetModeEnabled),
      active: !!ev.valetModeEnabled,
    },
    {
      key: 'serviceMode',
      label: t('admin.security.live.serviceMode', 'Service Mode'),
      value: boolLabel(ev.serviceMode),
      active: !!ev.serviceMode,
    },
    {
      key: 'speedLimit',
      label: t('admin.security.live.speedLimit', 'Speed Limit'),
      value:
        typeof ev.speedLimitMode === 'boolean'
          ? ev.speedLimitMode
            ? t('admin.security.on', 'On')
            : t('admin.security.off', 'Off')
          : asNonEmptyString(ev.speedLimitMode) ?? '—',
      active:
        typeof ev.speedLimitMode === 'boolean'
          ? ev.speedLimitMode
          : (() => {
              const s = asNonEmptyString(ev.speedLimitMode);
              return !!s && !s.toLowerCase().includes('off');
            })(),
    },
    {
      key: 'homelinkDevices',
      label: t('admin.security.live.homelinkDevices', 'HomeLink Devices'),
      value: ev.homelinkDeviceCount != null ? String(ev.homelinkDeviceCount) : '—',
      active: (ev.homelinkDeviceCount ?? 0) > 0,
    },
    {
      key: 'centerDisplay',
      label: t('admin.security.live.centerDisplay', 'Center Display'),
      value: asNonEmptyString(ev.centerDisplay) ?? '—',
      active: (() => {
        const s = asNonEmptyString(ev.centerDisplay);
        return !!s && !s.toLowerCase().includes('off');
      })(),
    },
  ];
}

export interface LiveVehicleStateProps {
  latest: SecurityEvent | undefined;
}

export function LiveVehicleState({
  latest,
}: LiveVehicleStateProps): React.ReactElement {
  const liveSignals = React.useMemo(() => buildLiveSignals(latest), [latest]);

  const header = el(
    View,
    {style: styles.liveHeader},
    el(
      AppText,
      {variant: 'title', weight: 'semibold', tone: 'secondary'},
      t('admin.security.liveState', 'Live Vehicle State'),
    ),
    latest
      ? el(
          View,
          {style: styles.liveIndicator},
          el(View, {style: [styles.statusDot, {backgroundColor: SEMANTIC.green}]}),
          el(
            AppText,
            {variant: 'caption', style: {color: SEMANTIC.green}},
            t('admin.security.live.indicator', 'Live'),
          ),
        )
      : null,
  );

  const body =
    liveSignals.length > 0
      ? el(
          View,
          {style: styles.liveGrid},
          ...liveSignals.map(sig =>
            el(GlassPanel, {
              key: sig.key,
              style: styles.liveCard,
              children: el(
                React.Fragment,
                null,
                el(
                  View,
                  {style: styles.liveCardHeader},
                  el(View, {
                    style: [
                      styles.liveDot,
                      {backgroundColor: sig.active ? SEMANTIC.cyan : SEMANTIC.muted},
                    ],
                  }),
                  el(
                    AppText,
                    {variant: 'caption', tone: 'muted', numberOfLines: 1, style: styles.liveLabel},
                    sig.label,
                  ),
                ),
                el(
                  AppText,
                  {
                    variant: 'caption',
                    weight: 'semibold',
                    numberOfLines: 1,
                    style: {color: sig.active ? colors.textPrimary : SEMANTIC.muted},
                  },
                  sig.value,
                ),
              ),
            }),
          ),
        )
      : centeredEmpty(t('admin.security.live.noData', 'No live state data available'));

  return el(GlassPanel, {
    style: [styles.panel, styles.sectionGap],
    children: el(React.Fragment, null, header, body),
  });
}

/* ─── SentryModeChart (web L5) ─────────────────────────────────────────────
   The recharts stacked BarChart (sentryOn/sentryOff per day) renders as
   proportional native stacked bars + a Date/On/Off accessible data table.
   Empty → common.noData message. PNG/CSV export, hover Tooltip and the
   CartesianGrid have no native analog (see capabilities.sentryChart). */

export interface SentryModeChartProps {
  sentryBuckets: SentryDayBucket[];
}

export function SentryModeChart({
  sentryBuckets,
}: SentryModeChartProps): React.ReactElement {
  const hasData = sentryBuckets.length > 0;
  const maxTotal = Math.max(
    ...sentryBuckets.map(b => b.sentryOn + b.sentryOff),
    1,
  );

  const legend = el(
    View,
    {style: styles.legend},
    el(
      View,
      {style: styles.legendItem},
      el(View, {style: [styles.legendSwatch, {backgroundColor: SENTRY_ON_COLOR}]}),
      el(AppText, {variant: 'caption', tone: 'muted'}, t('admin.security.chart.sentryOn', 'Sentry On')),
    ),
    el(
      View,
      {style: styles.legendItem},
      el(View, {style: [styles.legendSwatch, {backgroundColor: SENTRY_OFF_COLOR}]}),
      el(AppText, {variant: 'caption', tone: 'muted'}, t('admin.security.chart.sentryOff', 'Sentry Off')),
    ),
  );

  const bars = el(
    View,
    {style: styles.bars},
    ...sentryBuckets.map(bucket => {
      const onPct = (bucket.sentryOn / maxTotal) * 100;
      const offPct = (bucket.sentryOff / maxTotal) * 100;
      return el(
        View,
        {key: bucket.date, style: styles.barRow},
        el(
          AppText,
          {variant: 'caption', tone: 'muted', numberOfLines: 1, style: styles.barDate},
          formatDateShort(bucket.date),
        ),
        el(
          View,
          {style: styles.barTrack},
          el(View, {style: [styles.barSeg, {width: `${onPct}%`, backgroundColor: SENTRY_ON_COLOR}]}),
          el(View, {style: [styles.barSeg, {width: `${offPct}%`, backgroundColor: SENTRY_OFF_COLOR}]}),
        ),
        el(
          AppText,
          {variant: 'caption', tone: 'secondary', style: styles.barCounts},
          `${fmtInt(bucket.sentryOn)} / ${fmtInt(bucket.sentryOff)}`,
        ),
      );
    }),
  );

  const table = el(
    View,
    {
      accessible: true,
      accessibilityRole: 'summary',
      accessibilityLabel: t('admin.security.sentryChart', 'Sentry Mode Activity'),
      style: styles.table,
    },
    el(
      View,
      {style: [styles.tRow, styles.tHeaderRow]},
      el(AppText, {variant: 'caption', tone: 'muted', weight: 'semibold', style: styles.tCell}, t('admin.security.col.time', 'Time')),
      el(AppText, {variant: 'caption', tone: 'muted', weight: 'semibold', style: [styles.tCell, styles.cellRight]}, t('admin.security.chart.sentryOn', 'Sentry On')),
      el(AppText, {variant: 'caption', tone: 'muted', weight: 'semibold', style: [styles.tCell, styles.cellRight]}, t('admin.security.chart.sentryOff', 'Sentry Off')),
    ),
    ...sentryBuckets.map(bucket =>
      el(
        View,
        {key: `row-${bucket.date}`, style: styles.tRow},
        el(AppText, {variant: 'caption', tone: 'secondary', style: styles.tCell}, formatDateShort(bucket.date)),
        el(AppText, {variant: 'caption', style: [styles.tCell, styles.cellRight]}, fmtInt(bucket.sentryOn)),
        el(AppText, {variant: 'caption', style: [styles.tCell, styles.cellRight]}, fmtInt(bucket.sentryOff)),
      ),
    ),
  );

  const body = hasData
    ? el(React.Fragment, null, legend, bars, table)
    : centeredEmpty(t('common.noData', 'No data available'));

  return el(GlassPanel, {
    style: [styles.panel, styles.sectionGap],
    children: el(
      React.Fragment,
      null,
      renderPanelTitle(t('admin.security.sentryChart', 'Sentry Mode Activity')),
      body,
    ),
  });
}

/* ─── SecurityStatistics (web L6) ──────────────────────────────────────────
   Seven aggregate MetricCards. Loading → 7 skeletons. Null stats → message. */

export interface SecurityStatisticsProps {
  securityStats: SecurityStats | null;
  sentryUptime: number;
  isLoading: boolean;
}

export function SecurityStatistics({
  securityStats,
  sentryUptime,
  isLoading,
}: SecurityStatisticsProps): React.ReactElement {
  let body: React.ReactElement;
  if (isLoading) {
    body = el(
      View,
      {style: styles.metricRow},
      ...range(7).map(i => el(View, {key: `sk-${i}`, style: styles.statSkeleton})),
    );
  } else if (securityStats) {
    body = el(
      View,
      {style: styles.metricRow},
      el(MetricCard, {
        label: t('admin.security.stats.lockEvents', 'Lock/Unlock Events'),
        value: securityStats.lockEvents,
        helper: '',
        tone: metricTone('green'),
      }),
      el(MetricCard, {
        label: t('admin.security.stats.sentryUptime', 'Sentry Uptime'),
        value: `${fmtInt(sentryUptime)}%`,
        helper: '',
        tone: metricTone('blue'),
      }),
      el(MetricCard, {
        label: t('admin.security.stats.doorOpens', 'Door Open Events'),
        value: securityStats.doorOpenCount,
        helper: '',
        tone: metricTone('amber'),
      }),
      el(MetricCard, {
        label: t('admin.security.stats.windowOpens', 'Window Open Events'),
        value: securityStats.windowOpenCount,
        helper: '',
        tone: metricTone('amber'),
      }),
      el(MetricCard, {
        label: t('admin.security.stats.homelink', 'HomeLink Detections'),
        value: securityStats.homelinkCount,
        helper: '',
        tone: metricTone('purple'),
      }),
      el(MetricCard, {
        label: t('admin.security.stats.guestMode', 'Guest Mode Usage'),
        value: securityStats.guestCount,
        helper: '',
        tone: metricTone('amber'),
      }),
      el(MetricCard, {
        label: t('admin.security.stats.totalEvents', 'Total Events'),
        value: securityStats.total,
        helper: '',
        tone: metricTone('cyan'),
      }),
    );
  } else {
    body = centeredEmpty(t('common.noData', 'No data available'));
  }

  return el(GlassPanel, {
    style: [styles.panel, styles.sectionGap],
    children: el(
      React.Fragment,
      null,
      renderPanelTitle(t('admin.security.statsTitle', 'Security Statistics')),
      body,
    ),
  });
}

/* ─── EventHistoryTable (web L7) ───────────────────────────────────────────
   The shared sortable, paginated DataTable becomes a native static table with
   the same Time/Lock/Sentry/Doors/Windows columns + render logic. Loading →
   skeleton lines. Empty → message. Sort + pagination are simplified to the
   full list (see capabilities.eventTable). */

function renderEventRow(row: SecurityEvent): React.ReactElement {
  const doorIsClosed = doorClosed(row.doorState);
  const windowsClosed = allWindowsClosed(row);
  return el(
    View,
    {key: row.id, style: styles.tRow},
    el(
      View,
      {style: styles.tCell},
      el(AppText, {variant: 'caption', tone: 'muted'}, formatTimestamp(row.createdAt)),
    ),
    el(
      View,
      {style: styles.tCell},
      renderChip(
        row.locked ? t('admin.security.locked', 'Locked') : t('admin.security.unlocked', 'Unlocked'),
        row.locked ? 'success' : 'danger',
      ),
    ),
    el(
      View,
      {style: styles.tCell},
      renderChip(
        row.sentryMode ? t('admin.security.on', 'On') : t('admin.security.off', 'Off'),
        row.sentryMode ? 'success' : 'neutral',
      ),
    ),
    el(
      View,
      {style: styles.tCell},
      el(
        AppText,
        {variant: 'caption', style: {color: doorIsClosed ? SEMANTIC.green : SEMANTIC.amber}},
        asNonEmptyString(row.doorState) ??
          (doorIsClosed ? t('admin.security.closed', 'Closed') : '—'),
      ),
    ),
    el(
      View,
      {style: styles.tCell},
      el(
        AppText,
        {variant: 'caption', style: {color: windowsClosed ? SEMANTIC.green : SEMANTIC.amber}},
        windowSummary(row),
      ),
    ),
  );
}

export interface EventHistoryTableProps {
  history: SecurityEvent[];
  isLoading: boolean;
}

export function EventHistoryTable({
  history,
  isLoading,
}: EventHistoryTableProps): React.ReactElement {
  let body: React.ReactElement;
  if (isLoading) {
    body = el(
      View,
      {style: styles.skeletonWrap},
      ...range(8).map(i => el(View, {key: `sk-${i}`, style: styles.lineSkeleton})),
    );
  } else {
    const headerRow = el(
      View,
      {style: [styles.tRow, styles.tHeaderRow]},
      el(AppText, {variant: 'caption', tone: 'muted', weight: 'semibold', style: styles.tCell}, t('admin.security.col.time', 'Time')),
      el(AppText, {variant: 'caption', tone: 'muted', weight: 'semibold', style: styles.tCell}, t('admin.security.col.lock', 'Lock')),
      el(AppText, {variant: 'caption', tone: 'muted', weight: 'semibold', style: styles.tCell}, t('admin.security.col.sentry', 'Sentry')),
      el(AppText, {variant: 'caption', tone: 'muted', weight: 'semibold', style: styles.tCell}, t('admin.security.col.doors', 'Doors')),
      el(AppText, {variant: 'caption', tone: 'muted', weight: 'semibold', style: styles.tCell}, t('admin.security.col.windows', 'Windows')),
    );
    const rows =
      history.length === 0
        ? el(
            View,
            {style: styles.tEmpty},
            el(
              AppText,
              {tone: 'muted'},
              t('admin.security.noEvents', 'No security events recorded yet.'),
            ),
          )
        : el(View, null, ...history.map(renderEventRow));
    body = el(View, {style: styles.table}, headerRow, rows);
  }

  return el(GlassPanel, {
    style: styles.panel,
    children: el(
      React.Fragment,
      null,
      renderPanelTitle(t('admin.security.eventHistory', 'Security Event History')),
      body,
    ),
  });
}

/* ─── EventTimeline (web L8) ───────────────────────────────────────────────
   A scrollable list of derived state-change rows. Each web lucide icon becomes
   a colored circular badge tinted by the event variant. Empty → message. */

function timelineLabels(ev: TimelineEvent): {title: string; subtitle: string} {
  switch (ev.kind) {
    case 'lock':
      return {
        title:
          ev.variant === 'positive'
            ? t('admin.security.timeline.lock.positive', 'Vehicle Locked')
            : t('admin.security.timeline.lock.negative', 'Vehicle Unlocked'),
        subtitle:
          ev.variant === 'positive'
            ? t('admin.security.timeline.lock.positiveDesc', 'Doors secured')
            : t('admin.security.timeline.lock.negativeDesc', 'Doors accessible'),
      };
    case 'sentry':
      return {
        title:
          ev.variant === 'positive'
            ? t('admin.security.timeline.sentry.positive', 'Sentry Mode Activated')
            : t('admin.security.timeline.sentry.negative', 'Sentry Mode Deactivated'),
        subtitle:
          ev.variant === 'positive'
            ? t('admin.security.timeline.sentry.positiveDesc', 'Camera surveillance enabled')
            : t('admin.security.timeline.sentry.negativeDesc', 'Camera surveillance disabled'),
      };
    case 'door':
      return {
        title:
          ev.variant === 'positive'
            ? t('admin.security.timeline.door.positive', 'Doors Closed')
            : t('admin.security.timeline.door.negative', 'Door Opened'),
        subtitle: ev.detail,
      };
  }
}

function timelineVariantColors(variant: TimelineEvent['variant']): {
  dot: string;
  bg: string;
} {
  switch (variant) {
    case 'positive':
      return {dot: SEMANTIC.green, bg: 'rgba(34,197,94,0.18)'};
    case 'negative':
      return {dot: SEMANTIC.red, bg: 'rgba(239,68,68,0.18)'};
    default:
      return {dot: SEMANTIC.muted, bg: 'rgba(107,114,128,0.18)'};
  }
}

function renderTimelineRow(ev: TimelineEvent): React.ReactElement {
  const {title, subtitle} = timelineLabels(ev);
  const variantColors = timelineVariantColors(ev.variant);
  return el(
    View,
    {key: ev.id, style: styles.timelineRow},
    el(
      View,
      {style: [styles.timelineBadge, {backgroundColor: variantColors.bg}]},
      el(View, {style: [styles.timelineBadgeDot, {backgroundColor: variantColors.dot}]}),
    ),
    el(
      View,
      {style: styles.timelineContent},
      el(AppText, {variant: 'caption', weight: 'semibold', tone: 'secondary'}, title),
      el(AppText, {variant: 'caption', tone: 'muted'}, subtitle),
    ),
    el(
      AppText,
      {variant: 'caption', tone: 'muted', style: styles.timelineTime},
      formatTimestamp(ev.timestamp),
    ),
  );
}

export interface EventTimelineProps {
  timelineEvents: TimelineEvent[];
}

export function EventTimeline({
  timelineEvents,
}: EventTimelineProps): React.ReactElement {
  const body =
    timelineEvents.length > 0
      ? el(
          ScrollView,
          {style: styles.timelineScroll, nestedScrollEnabled: true},
          el(View, {style: styles.timelineList}, ...timelineEvents.map(renderTimelineRow)),
        )
      : centeredEmpty(
          t('admin.security.timeline.noEvents', 'No state changes detected in the history.'),
        );

  return el(GlassPanel, {
    style: styles.panel,
    children: el(
      React.Fragment,
      null,
      renderPanelTitle(t('admin.security.timeline.title', 'Security Event Timeline')),
      body,
    ),
  });
}

/* ─── capabilities (parity documentation, mirrors the sibling barrels) ────── */

export const nativeSecurityAccessBarrelCapabilities = {
  sentryChart: {
    available: false,
    reason:
      'The web SentryModeChart uses a recharts stacked BarChart (CartesianGrid/Tooltip/Legend/ResponsiveContainer); native renders proportional stacked bars + a Time/Sentry On/Sentry Off accessible data table.',
  },
  eventTable: {
    available: false,
    reason:
      'The web EventHistoryTable uses the shared sortable, paginated DataTable (defaultPageSize 50); native renders the full history as a static Time/Lock/Sentry/Doors/Windows table with the same render logic.',
  },
  animations: {
    available: false,
    reason:
      'The web sections are wrapped in framer-motion FadeIn (staggered delays); native renders statically (no motion primitive in the parity tree).',
  },
} as const;

const styles = StyleSheet.create({
  sectionGap: {
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    marginBottom: spacing.sm,
  },
  panel: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  panelTitle: {
    marginBottom: spacing.md,
  },
  metricRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  metricSkeleton: {
    flexGrow: 1,
    minWidth: 170,
    height: 88,
    borderRadius: 16,
    backgroundColor: colors.surfaceHover,
  },
  statSkeleton: {
    flexGrow: 1,
    minWidth: 150,
    height: 80,
    borderRadius: 16,
    backgroundColor: colors.surfaceHover,
  },
  cardRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  statusSkeleton: {
    flexGrow: 1,
    minWidth: 220,
    height: 120,
    borderRadius: 16,
    backgroundColor: colors.surfaceHover,
  },
  statusCard: {
    flexGrow: 1,
    minWidth: 220,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
  },
  statusValue: {
    marginVertical: spacing.xs,
  },
  windowCard: {
    flexGrow: 1,
    minWidth: 150,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  windowLabel: {
    marginBottom: spacing.xs,
  },
  liveHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  liveGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  liveCard: {
    flexGrow: 1,
    minWidth: 110,
    padding: spacing.md,
    gap: spacing.xs,
  },
  liveCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  liveLabel: {
    flexShrink: 1,
  },
  centeredEmpty: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  chip: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  legendSwatch: {
    width: 12,
    height: 12,
    borderRadius: 3,
  },
  bars: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  barDate: {
    width: 56,
  },
  barTrack: {
    flex: 1,
    height: 14,
    borderRadius: 6,
    backgroundColor: colors.surfaceRaised,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  barSeg: {
    height: '100%',
  },
  barCounts: {
    width: 72,
    textAlign: 'right',
  },
  table: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 8,
    overflow: 'hidden',
  },
  tRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  tHeaderRow: {
    borderTopWidth: 0,
    backgroundColor: colors.surfaceRaised,
  },
  tCell: {
    flex: 1,
  },
  cellRight: {
    textAlign: 'right',
  },
  tEmpty: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  skeletonWrap: {
    gap: spacing.sm,
  },
  lineSkeleton: {
    height: 14,
    borderRadius: 6,
    backgroundColor: colors.surfaceHover,
  },
  timelineScroll: {
    maxHeight: 384,
  },
  timelineList: {
    gap: spacing.md,
  },
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.02)',
    padding: spacing.md,
  },
  timelineBadge: {
    width: 32,
    height: 32,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  timelineBadgeDot: {
    width: 12,
    height: 12,
    borderRadius: 999,
  },
  timelineContent: {
    flex: 1,
  },
  timelineTime: {
    marginLeft: spacing.sm,
  },
});
