/**
 * TelemetryPipelineCard — React Native parity port of
 * web/src/features/system/components/status/TelemetryPipelineCard.tsx.
 *
 * Operator-grade per-vehicle telemetry liveness. Renders (behaviour preserved
 * 1:1 from the source):
 *  - A compact fleet stats grid (vehicles · GPS positions · drives · charging
 *    sessions · signal log), each value run through the same fmtCount / fmtInt.
 *  - A liveness summary chip row (only when there are vehicles) counting how many
 *    vehicles are sending / slow / stale / offline, plus a Fleet-Telemetry MQTT
 *    connectivity chip and an informational polling-engine-state chip.
 *  - A per-vehicle list showing which vehicles are sending data right now, when
 *    each was last seen (the most recent of MQTT stream OR REST poll), the state
 *    badge, battery %, and the next scheduled poll — or an empty-state panel
 *    linking to the Tesla account page when no vehicles are configured.
 *  - A footer link row (Telemetry Coverage · MQTT Inspector · All vehicles).
 *
 * TeslaSync has TWO ingest paths and a vehicle can be live on either:
 *   1. Fleet Telemetry streaming → MQTT broker → `/telemetry` (useMQTTStatus)
 *      primary path for + deployments.
 *   2. Legacy REST polling engine → `/polling/status` (getPollingStatus)
 *      fallback for vehicles not enrolled in Fleet Telemetry.
 * Liveness is the MOST RECENT of {last MQTT message, last poll}. Threshold
 * ladder (applied to the union timestamp): < 5 min → sending (green), 5–30 min →
 * slow (amber), > 30 min → stale (red), no signal → offline (grey). The
 * "polling engine disabled" chip is informational (not a problem) when MQTT
 * streaming is healthy. All of this logic is ported verbatim.
 *
 * Browser-only / web-only dependencies are reduced explicitly and documented in
 * the .parity.json sidecar:
 *   - react-router-dom `Link` (web L28): React Native has no DOM anchor / browser
 *     history router, so every `<Link to="…">` becomes a Pressable (or, for the
 *     inline empty-state link, an onPress AppText) with accessibilityRole="link"
 *     whose navigation is delegated to an optional `onNavigate(to)` bridge prop
 *     wired up by the native navigation shell (the BackupActionsCard / QuickNav
 *     precedent). Every `to` path ("/tesla-account", `/vehicles/${id}`,
 *     "/admin/telemetry/coverage", "/mqtt-inspector", "/vehicles") is preserved
 *     verbatim.
 *   - `@tanstack/react-query` `useQuery` (web L29): kept verbatim — TanStack
 *     Query runs unchanged on React Native; the ['system-status','polling-status']
 *     read + refetchInterval are identical.
 *   - lucide-react Activity / Battery / Car / ExternalLink / Radio / Wifi /
 *     WifiOff (web L30): DOM SVG icons → decorative colour-inheriting AppText
 *     glyphs (📈 / 🔋 / 🚗 / ↗ / 📡 / 📶 / ✕), the established sibling-port
 *     convention; each implicit aria-hidden becomes
 *     importantForAccessibility="no-hide-descendants".
 *   - `@/api/polling` getPollingStatus + VehiclePollingStatus (web L32),
 *     `@/api/hooks/useTelemetry` useMQTTStatus (web L33) and `@/api/types`
 *     Vehicle (web L34): imported from the already-ported native parity modules.
 *   - `@/lib/numberFormat` `fmtInt` (web L35): reproduced locally as the faithful
 *     0-fraction-digit en-US `toLocaleString` (the XRayFieldsTable precedent).
 *   - Tailwind utility classes / CSS vars (livenessClasses, batteryColor, the
 *     grid/chip/list/footer markup): re-expressed as React Native StyleSheet
 *     rules + an explicit PALETTE matching the exact Tailwind shades so the
 *     visual intent (emerald/amber/red/cyan chips, glow dot, battery bar) is
 *     preserved.
 */

import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { AppText } from '../../../../../components/ui/AppText';
import { colors } from '../../../../../theme/tokens';
import {
  getPollingStatus,
  type VehiclePollingStatus,
} from '../../../../api/polling';
import { useMQTTStatus } from '../../../../api/hooks/useTelemetry';
import type { Vehicle } from '../../../../api/types';

/* ── lucide-react glyph stand-ins (web L30) ── */
const ACTIVITY_GLYPH = '\uD83D\uDCC8'; // 📈 Activity
const BATTERY_GLYPH = '\uD83D\uDD0B'; // 🔋 Battery
const CAR_GLYPH = '\uD83D\uDE97'; // 🚗 Car
const EXTERNAL_LINK_GLYPH = '\u2197'; // ↗ ExternalLink
const RADIO_GLYPH = '\uD83D\uDCE1'; // 📡 Radio
const WIFI_GLYPH = '\uD83D\uDCF6'; // 📶 Wifi
const WIFI_OFF_GLYPH = '\u2715'; // ✕ WifiOff

interface TelemetryPipelineCardProps {
  vehicles: Vehicle[] | undefined;
  positionCount: number;
  drivesCount: number;
  chargingSessionsCount: number | undefined;
  signalLogCount: number | undefined;
  /** "now" passed in so the page-level tick re-renders the relative-time labels. */
  now: number;
  /**
   * Native bridge for the web react-router `<Link to="…">`. Invoked with the
   * destination path when a link is pressed. The web file takes no such prop;
   * this is the sole native-navigation addition. Without it a press is a no-op.
   */
  onNavigate?: (to: string) => void;
}

type Liveness = 'sending' | 'slow' | 'stale' | 'offline';
type LivenessSource = 'stream' | 'poll' | 'none';

const POLLING_REFRESH_MS = 15_000;

/* ── fmtInt (native-safe port of `@/lib/numberFormat` fmtInt) ── */
function fmtInt(v: unknown): string {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  return n.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function fmtCount(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) {
    return '—';
  }
  return fmtInt(n);
}

// Render an absolute-clock-skew-tolerant relative time using the shared
// `now` tick the page already drives.
function relativeTime(iso: string | undefined, now: number): string {
  if (!iso) {
    return '—';
  }
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) {
    return '—';
  }
  const diff = now - t;
  const past = diff >= 0;
  const abs = Math.abs(diff);
  const sec = Math.round(abs / 1000);
  if (sec < 60) {
    return past ? `${sec}s ago` : `in ${sec}s`;
  }
  const min = Math.round(sec / 60);
  if (min < 60) {
    return past ? `${min} min ago` : `in ${min} min`;
  }
  const hr = Math.round(min / 60);
  if (hr < 24) {
    return past ? `${hr}h ago` : `in ${hr}h`;
  }
  const day = Math.round(hr / 24);
  return past ? `${day}d ago` : `in ${day}d`;
}

// Parse an ISO timestamp into ms-since-epoch, returning undefined for
// null / empty / malformed input. Used to defensively union the polling
// and streaming last-seen timestamps before applying the age ladder.
function parseIso(iso: string | undefined | null): number | undefined {
  if (!iso) {
    return undefined;
  }
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : undefined;
}

/**
 * Derive per-vehicle liveness from the UNION of both ingest paths. Returns the
 * severity bucket and which source produced the freshest timestamp so the UI
 * can label the chip with "stream" or "poll".
 */
function liveness(
  lastPollIso: string | undefined,
  lastStreamIso: string | undefined,
  now: number,
): {
  level: Liveness;
  source: LivenessSource;
  lastSeenIso: string | undefined;
} {
  const pollMs = parseIso(lastPollIso);
  const streamMs = parseIso(lastStreamIso);

  let lastSeenMs: number | undefined;
  let source: LivenessSource = 'none';
  let lastSeenIso: string | undefined;

  if (pollMs != null && streamMs != null) {
    if (streamMs >= pollMs) {
      lastSeenMs = streamMs;
      source = 'stream';
      lastSeenIso = lastStreamIso;
    } else {
      lastSeenMs = pollMs;
      source = 'poll';
      lastSeenIso = lastPollIso;
    }
  } else if (streamMs != null) {
    lastSeenMs = streamMs;
    source = 'stream';
    lastSeenIso = lastStreamIso;
  } else if (pollMs != null) {
    lastSeenMs = pollMs;
    source = 'poll';
    lastSeenIso = lastPollIso;
  }

  if (lastSeenMs == null) {
    return { level: 'offline', source: 'none', lastSeenIso: undefined };
  }
  const ageMin = (now - lastSeenMs) / 60_000;
  if (ageMin < 5) {
    return { level: 'sending', source, lastSeenIso };
  }
  if (ageMin < 30) {
    return { level: 'slow', source, lastSeenIso };
  }
  return { level: 'stale', source, lastSeenIso };
}

interface LivenessStyle {
  dotColor: string;
  glow: boolean;
  label: string;
  chipBg: string;
  chipText: string;
  chipBorder: string;
}

// Native re-expression of the web `livenessClasses` Tailwind map.
function livenessStyle(l: Liveness): LivenessStyle {
  switch (l) {
    case 'sending':
      return {
        dotColor: PALETTE.emeraldDot,
        glow: true,
        label: 'sending',
        chipBg: PALETTE.emeraldChipBg,
        chipText: PALETTE.emeraldText,
        chipBorder: PALETTE.emeraldChipBorder,
      };
    case 'slow':
      return {
        dotColor: PALETTE.amberDot,
        glow: false,
        label: 'slow',
        chipBg: PALETTE.amberChipBg,
        chipText: PALETTE.amberText,
        chipBorder: PALETTE.amberChipBorder,
      };
    case 'stale':
      return {
        dotColor: PALETTE.redDot,
        glow: false,
        label: 'stale',
        chipBg: PALETTE.redChipBg,
        chipText: PALETTE.redText,
        chipBorder: PALETTE.redChipBorder,
      };
    case 'offline':
    default:
      return {
        dotColor: PALETTE.offlineDot,
        glow: false,
        label: 'offline',
        chipBg: PALETTE.neutralChipBg,
        chipText: colors.textMuted,
        chipBorder: PALETTE.neutralChipBorder,
      };
  }
}

function vinTail(vin: string | undefined | null): string {
  if (!vin) {
    return '????';
  }
  const t = vin.trim();
  if (t.length <= 4) {
    return t;
  }
  return t.slice(-4);
}

function batteryColor(pct: number): string {
  if (pct >= 50) {
    return PALETTE.batteryHigh;
  }
  if (pct >= 20) {
    return PALETTE.batteryMid;
  }
  return PALETTE.batteryLow;
}

function vehicleStateBadge(state: string | undefined): string {
  if (!state) {
    return 'unknown';
  }
  const s = state.toLowerCase();
  if (s === 'online' || s === 'driving' || s === 'charging') {
    return s;
  }
  if (s === 'asleep' || s === 'sleeping') {
    return 'asleep';
  }
  if (s === 'offline') {
    return 'offline';
  }
  return s;
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statCell}>
      <AppText style={styles.statLabel}>{label}</AppText>
      <AppText style={styles.statValue}>{value}</AppText>
    </View>
  );
}

export function TelemetryPipelineCard({
  vehicles,
  positionCount,
  drivesCount,
  chargingSessionsCount,
  signalLogCount,
  now,
  onNavigate,
}: TelemetryPipelineCardProps) {
  const { data: pollingStatus } = useQuery({
    queryKey: ['system-status', 'polling-status'],
    queryFn: getPollingStatus,
    refetchInterval: POLLING_REFRESH_MS,
  });

  // Fleet Telemetry streaming status — same source the MQTT Inspector page uses.
  // Without this, vehicles that stream via MQTT but are not REST-polled would
  // render as "offline" even when they're actively sending 240+ signals/minute.
  const { data: mqttStatus } = useMQTTStatus();

  const list = vehicles ?? [];
  const pollingMap: Record<string, VehiclePollingStatus> =
    pollingStatus?.vehicles ?? {};
  const pollingEnabled = pollingStatus?.enabled !== false;

  // Index streaming vehicles by VIN so we can join against the vehicle list.
  const streamMap: Record<
    string,
    { lastReceived?: string; signalsPerSecond?: number; signalCount?: number }
  > = {};
  const mqttVehicles = mqttStatus?.vehicles ?? [];
  for (const sv of mqttVehicles) {
    if (!sv?.vin) {
      continue;
    }
    streamMap[sv.vin] = {
      lastReceived: sv.lastReceived ?? sv.last_received,
      signalsPerSecond: sv.signalsPerSecond ?? sv.signals_per_second,
      signalCount: sv.signalCount ?? sv.signal_count,
    };
  }
  const mqttConnected = mqttStatus?.connected === true;

  // Fleet-wide liveness summary used in the sub-header.
  const counts = list.reduce(
    (acc, v) => {
      const ps = pollingMap[v.vin];
      const ss = streamMap[v.vin];
      const { level } = liveness(ps?.last_poll_time, ss?.lastReceived, now);
      acc[level] = (acc[level] ?? 0) + 1;
      return acc;
    },
    { sending: 0, slow: 0, stale: 0, offline: 0 } as Record<Liveness, number>,
  );

  return (
    <View style={styles.container} testID="telemetry-pipeline-card-root">
      {/* Fleet rollup grid */}
      <View style={styles.statGrid}>
        <StatCell
          label="Vehicles"
          value={
            list.length > 0 ? `${list.length} connected` : 'none configured'
          }
        />
        <StatCell label="GPS positions" value={fmtCount(positionCount)} />
        <StatCell label="Drives" value={fmtCount(drivesCount)} />
        <StatCell
          label="Charging sessions"
          value={fmtCount(chargingSessionsCount)}
        />
        <StatCell label="Signal log" value={fmtCount(signalLogCount)} />
      </View>

      {/* Liveness summary chips (only when there are any vehicles) */}
      {list.length > 0 && (
        <View style={styles.summaryRow} testID="telemetry-liveness-summary">
          <AppText style={styles.summaryLabel}>Liveness:</AppText>
          {(['sending', 'slow', 'stale', 'offline'] as Liveness[])
            .filter(k => counts[k] > 0)
            .map(k => {
              const s = livenessStyle(k);
              return (
                <View
                  key={k}
                  style={[
                    styles.chip,
                    { backgroundColor: s.chipBg, borderColor: s.chipBorder },
                  ]}
                >
                  <View
                    importantForAccessibility="no-hide-descendants"
                    style={[
                      styles.chipDot,
                      { backgroundColor: s.dotColor },
                      s.glow && styles.dotGlow,
                    ]}
                  />
                  <AppText style={[styles.chipText, { color: s.chipText }]}>
                    {counts[k]} {s.label}
                  </AppText>
                </View>
              );
            })}
          {/* MQTT broker connectivity — neutral when connected, warning when not */}
          {mqttConnected ? (
            <View
              style={[
                styles.chip,
                {
                  backgroundColor: PALETTE.cyanChipBg,
                  borderColor: PALETTE.cyanChipBorder,
                },
              ]}
              testID="telemetry-mqtt-connected"
            >
              <AppText
                importantForAccessibility="no-hide-descendants"
                style={[styles.chipGlyph, { color: PALETTE.cyanText }]}
              >
                {RADIO_GLYPH}
              </AppText>
              <AppText style={[styles.chipText, { color: PALETTE.cyanText }]}>
                Fleet Telemetry connected
              </AppText>
            </View>
          ) : (
            <View
              style={[
                styles.chip,
                {
                  backgroundColor: PALETTE.amberChipBg,
                  borderColor: PALETTE.amberChipBorder,
                },
              ]}
              testID="telemetry-mqtt-disconnected"
            >
              <AppText
                importantForAccessibility="no-hide-descendants"
                style={[styles.chipGlyph, { color: PALETTE.amberText }]}
              >
                {WIFI_OFF_GLYPH}
              </AppText>
              <AppText style={[styles.chipText, { color: PALETTE.amberText }]}>
                MQTT broker disconnected
              </AppText>
            </View>
          )}
          {/* Polling-engine state — informational when MQTT is healthy, warning otherwise */}
          {!pollingEnabled &&
            (mqttConnected ? (
              <View
                style={[
                  styles.chip,
                  {
                    backgroundColor: PALETTE.neutralChipBg,
                    borderColor: PALETTE.neutralChipBorder,
                  },
                ]}
                testID="telemetry-polling-off"
              >
                <AppText style={[styles.chipText, { color: colors.textMuted }]}>
                  polling engine off (streaming-only)
                </AppText>
              </View>
            ) : (
              <View
                style={[
                  styles.chip,
                  {
                    backgroundColor: PALETTE.amberChipBg,
                    borderColor: PALETTE.amberChipBorder,
                  },
                ]}
                testID="telemetry-polling-disabled"
              >
                <AppText
                  importantForAccessibility="no-hide-descendants"
                  style={[styles.chipGlyph, { color: PALETTE.amberText }]}
                >
                  {WIFI_OFF_GLYPH}
                </AppText>
                <AppText
                  style={[styles.chipText, { color: PALETTE.amberText }]}
                >
                  polling engine disabled
                </AppText>
              </View>
            ))}
        </View>
      )}

      {/* Per-vehicle list */}
      {list.length === 0 ? (
        <View style={styles.emptyState} testID="telemetry-empty-state">
          <AppText style={styles.emptyText}>
            No vehicles configured yet. Add a vehicle from the{' '}
            <AppText
              accessibilityRole="link"
              onPress={() => onNavigate?.('/tesla-account')}
              style={styles.inlineLink}
              testID="telemetry-link-tesla-account"
            >
              Tesla account
            </AppText>{' '}
            page to see per-vehicle telemetry status.
          </AppText>
        </View>
      ) : (
        <View style={styles.vehicleList} testID="telemetry-vehicle-list">
          {list.map((v, idx) => {
            const ps = pollingMap[v.vin];
            const ss = streamMap[v.vin];
            const { level, source, lastSeenIso } = liveness(
              ps?.last_poll_time,
              ss?.lastReceived,
              now,
            );
            const s = livenessStyle(level);
            const stateLabel = vehicleStateBadge(v.state);
            const battery = ps?.battery_level ?? null;
            const sourceLabel =
              source === 'stream'
                ? 'stream'
                : source === 'poll'
                ? 'poll'
                : null;
            return (
              <View
                key={v.id}
                style={[styles.vehicleRow, idx > 0 && styles.vehicleRowDivider]}
                testID={`telemetry-vehicle-${v.id}`}
              >
                {/* Status pip + name */}
                <View style={styles.vehicleIdentity}>
                  <View
                    accessibilityLabel={`telemetry status: ${s.label}`}
                    style={[
                      styles.pip,
                      { backgroundColor: s.dotColor },
                      s.glow && styles.dotGlow,
                    ]}
                  />
                  <AppText
                    importantForAccessibility="no-hide-descendants"
                    style={styles.carGlyph}
                  >
                    {CAR_GLYPH}
                  </AppText>
                  <View style={styles.identityText}>
                    <AppText
                      accessibilityRole="link"
                      numberOfLines={1}
                      onPress={() => onNavigate?.(`/vehicles/${v.id}`)}
                      style={styles.vehicleName}
                      testID={`telemetry-vehicle-link-${v.id}`}
                      weight="semibold"
                    >
                      {v.display_name || `Vehicle ${v.id}`}
                    </AppText>
                    <View style={styles.metaRow}>
                      <AppText style={styles.metaMono}>
                        {`VIN ···${vinTail(v.vin)}`}
                      </AppText>
                      <AppText
                        importantForAccessibility="no-hide-descendants"
                        style={styles.metaText}
                      >
                        ·
                      </AppText>
                      <AppText style={styles.metaText}>{stateLabel}</AppText>
                    </View>
                  </View>
                </View>

                {/* Battery */}
                <View style={styles.batteryRow}>
                  <AppText
                    importantForAccessibility="no-hide-descendants"
                    style={styles.batteryGlyph}
                  >
                    {BATTERY_GLYPH}
                  </AppText>
                  {battery != null ? (
                    <>
                      <View
                        accessibilityLabel={`battery ${Math.round(battery)}%`}
                        accessibilityRole="progressbar"
                        accessibilityValue={{
                          min: 0,
                          max: 100,
                          now: Math.round(battery),
                        }}
                        style={styles.batteryTrack}
                      >
                        <View
                          style={[
                            styles.batteryFill,
                            {
                              width: `${Math.min(100, Math.max(0, battery))}%`,
                              backgroundColor: batteryColor(battery),
                            },
                          ]}
                        />
                      </View>
                      <AppText style={styles.batteryPct}>
                        {Math.round(battery)}%
                      </AppText>
                    </>
                  ) : (
                    <AppText style={styles.metaText}>—</AppText>
                  )}
                </View>

                {/* Liveness chip + last/next poll */}
                <View style={styles.livenessCol}>
                  <View
                    style={[
                      styles.chip,
                      { backgroundColor: s.chipBg, borderColor: s.chipBorder },
                    ]}
                  >
                    <AppText
                      importantForAccessibility="no-hide-descendants"
                      style={[styles.chipGlyph, { color: s.chipText }]}
                    >
                      {source === 'stream' ? RADIO_GLYPH : WIFI_GLYPH}
                    </AppText>
                    <AppText style={[styles.chipText, { color: s.chipText }]}>
                      {s.label}
                    </AppText>
                    {sourceLabel && (
                      <AppText
                        style={[styles.sourceLabel, { color: s.chipText }]}
                      >
                        {sourceLabel.toUpperCase()}
                      </AppText>
                    )}
                  </View>
                  <AppText style={styles.pollMeta}>
                    last: {relativeTime(lastSeenIso, now)}
                    {ps?.next_poll_after
                      ? `  ·  next: ${relativeTime(ps.next_poll_after, now)}`
                      : ''}
                  </AppText>
                </View>
              </View>
            );
          })}
        </View>
      )}

      {/* Footer links */}
      <View style={styles.footer}>
        <Pressable
          accessibilityLabel="Open Telemetry Coverage"
          accessibilityRole="link"
          onPress={() => onNavigate?.('/admin/telemetry/coverage')}
          style={({ pressed }) => [
            styles.footerPrimary,
            pressed && styles.footerPrimaryPressed,
          ]}
          testID="telemetry-link-coverage"
        >
          <AppText style={styles.footerPrimaryText} weight="semibold">
            Open Telemetry Coverage
          </AppText>
          <AppText
            importantForAccessibility="no-hide-descendants"
            style={styles.footerPrimaryGlyph}
          >
            {EXTERNAL_LINK_GLYPH}
          </AppText>
        </Pressable>
        <Pressable
          accessibilityLabel="MQTT Inspector"
          accessibilityRole="link"
          onPress={() => onNavigate?.('/mqtt-inspector')}
          style={({ pressed }) => [
            styles.footerLink,
            pressed && styles.footerLinkPressed,
          ]}
          testID="telemetry-link-mqtt"
        >
          <AppText
            importantForAccessibility="no-hide-descendants"
            style={styles.footerLinkGlyph}
          >
            {RADIO_GLYPH}
          </AppText>
          <AppText style={styles.footerLinkText}>MQTT Inspector</AppText>
        </Pressable>
        <Pressable
          accessibilityLabel="All vehicles"
          accessibilityRole="link"
          onPress={() => onNavigate?.('/vehicles')}
          style={({ pressed }) => [
            styles.footerLink,
            pressed && styles.footerLinkPressed,
          ]}
          testID="telemetry-link-vehicles"
        >
          <AppText
            importantForAccessibility="no-hide-descendants"
            style={styles.footerLinkGlyph}
          >
            {ACTIVITY_GLYPH}
          </AppText>
          <AppText style={styles.footerLinkText}>All vehicles</AppText>
        </Pressable>
      </View>
    </View>
  );
}

// Exact Tailwind shades used by the source (emerald/amber/red-500 chip family,
// cyan Fleet-Telemetry chip, neutral white overlays, battery bar) re-expressed
// as RN colour literals so the visual intent survives the port.
const PALETTE = {
  emeraldDot: '#34d399', // emerald-400
  emeraldText: '#6ee7b7', // emerald-300
  emeraldChipBg: 'rgba(16, 185, 129, 0.15)', // emerald-500/15
  emeraldChipBorder: 'rgba(16, 185, 129, 0.3)', // emerald-500/30
  amberDot: '#fbbf24', // amber-400
  amberText: '#fcd34d', // amber-300
  amberChipBg: 'rgba(245, 158, 11, 0.15)', // amber-500/15
  amberChipBorder: 'rgba(245, 158, 11, 0.3)', // amber-500/30
  redDot: '#ef4444', // red-500
  redText: '#fca5a5', // red-300
  redChipBg: 'rgba(239, 68, 68, 0.15)', // red-500/15
  redChipBorder: 'rgba(239, 68, 68, 0.3)', // red-500/30
  offlineDot: 'rgba(148, 163, 184, 0.45)', // var(--surface-2) stand-in
  neutralChipBg: 'rgba(255, 255, 255, 0.06)', // white/[0.06]
  neutralChipBorder: 'rgba(255, 255, 255, 0.1)', // white/10
  cyanChipBg: 'rgba(6, 182, 212, 0.1)', // cyan-500/10
  cyanChipBorder: 'rgba(34, 211, 238, 0.2)', // cyan-400/20
  cyanText: '#67e8f9', // cyan-300
  cyanTextStrong: '#a5f3fc', // cyan-200
  panelBg: 'rgba(255, 255, 255, 0.03)', // white/[0.03]
  divider: 'rgba(255, 255, 255, 0.06)', // white/[0.06]
  batteryTrack: 'rgba(255, 255, 255, 0.08)', // white/[0.08]
  batteryHigh: 'rgba(52, 211, 153, 0.7)', // emerald-400/70
  batteryMid: 'rgba(251, 191, 36, 0.7)', // amber-400/70
  batteryLow: 'rgba(239, 68, 68, 0.7)', // red-500/70
  footerPrimaryBg: 'rgba(6, 182, 212, 0.15)', // cyan-500/15
  footerPrimaryBorder: 'rgba(34, 211, 238, 0.3)', // cyan-400/30
} as const;

const MONO_FONT = Platform.select({ ios: 'Menlo', default: 'monospace' });

const styles = StyleSheet.create({
  container: {
    gap: 16, // space-y-4
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 16, // gap-x-4
    rowGap: 8, // gap-y-2
  },
  statCell: {
    flexBasis: '45%',
    flexGrow: 1,
    minWidth: 110,
  },
  statLabel: {
    color: colors.textMuted,
    fontSize: 12, // text-xs
    lineHeight: 16,
    marginBottom: 2,
  },
  statValue: {
    color: colors.textPrimary,
    fontSize: 14, // text-sm
    fontVariant: ['tabular-nums'],
    lineHeight: 18,
  },
  summaryRow: {
    alignItems: 'center',
    columnGap: 6, // gap-1.5
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 6,
  },
  summaryLabel: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  chip: {
    alignItems: 'center',
    borderRadius: 6, // rounded-md
    borderWidth: 1, // ring-1
    columnGap: 4, // gap-1
    flexDirection: 'row',
    paddingHorizontal: 6, // px-1.5
    paddingVertical: 2, // py-0.5
  },
  chipDot: {
    borderRadius: 3,
    height: 6, // h-1.5
    width: 6, // w-1.5
  },
  dotGlow: {
    elevation: 2,
    shadowColor: '#34d399',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 4,
  },
  chipText: {
    fontSize: 12, // text-xs / text-[11px]
    lineHeight: 16,
  },
  chipGlyph: {
    fontSize: 11, // h-3 w-3
    lineHeight: 14,
  },
  sourceLabel: {
    fontSize: 10, // text-[10px]
    letterSpacing: 0.5, // tracking-wide
    lineHeight: 14,
    marginLeft: 4, // ml-1
    opacity: 0.7,
  },
  emptyState: {
    backgroundColor: PALETTE.panelBg,
    borderRadius: 12, // rounded-lg
    padding: 16, // p-4
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 14, // text-sm
    lineHeight: 20,
  },
  inlineLink: {
    color: PALETTE.cyanText, // text-cyan-300
    fontSize: 14,
    lineHeight: 20,
  },
  vehicleList: {
    backgroundColor: PALETTE.panelBg,
    borderRadius: 12, // rounded-lg
    overflow: 'hidden',
  },
  vehicleRow: {
    gap: 8, // flex-col gap-2
    padding: 12, // p-3
  },
  vehicleRowDivider: {
    borderTopColor: PALETTE.divider, // divide-y divide-white/[0.06]
    borderTopWidth: 1,
  },
  vehicleIdentity: {
    alignItems: 'center',
    columnGap: 10, // gap-2.5
    flexDirection: 'row',
  },
  pip: {
    borderRadius: 5,
    height: 10, // h-2.5
    width: 10, // w-2.5
  },
  carGlyph: {
    color: colors.textMuted,
    fontSize: 14, // h-4 w-4
    lineHeight: 18,
  },
  identityText: {
    flex: 1,
    flexShrink: 1, // min-w-0
  },
  vehicleName: {
    color: colors.textPrimary,
    fontSize: 14, // text-sm font-medium
    lineHeight: 18,
  },
  metaRow: {
    alignItems: 'center',
    columnGap: 8, // gap-2
    flexDirection: 'row',
    marginTop: 1,
  },
  metaMono: {
    color: colors.textMuted,
    fontFamily: MONO_FONT, // font-mono
    fontSize: 11, // text-[11px]
    lineHeight: 15,
  },
  metaText: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 15,
  },
  batteryRow: {
    alignItems: 'center',
    columnGap: 8, // gap-2
    flexDirection: 'row',
  },
  batteryGlyph: {
    color: colors.textMuted,
    fontSize: 13, // h-3.5 w-3.5
    lineHeight: 16,
  },
  batteryTrack: {
    backgroundColor: PALETTE.batteryTrack,
    borderRadius: 9999,
    height: 6, // h-1.5
    overflow: 'hidden',
    width: 48, // w-12
  },
  batteryFill: {
    borderRadius: 9999,
    height: '100%',
  },
  batteryPct: {
    color: colors.textPrimary,
    fontSize: 12, // text-xs
    fontVariant: ['tabular-nums'],
    lineHeight: 16,
    minWidth: 36, // w-9
    textAlign: 'right',
  },
  livenessCol: {
    alignItems: 'flex-start',
    gap: 2, // gap-0.5
  },
  pollMeta: {
    color: colors.textMuted,
    fontSize: 11, // text-[11px]
    fontVariant: ['tabular-nums'],
    lineHeight: 15,
  },
  footer: {
    alignItems: 'center',
    borderTopColor: PALETTE.divider,
    borderTopWidth: 1,
    columnGap: 8, // gap-2
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingTop: 8, // pt-2
    rowGap: 8,
  },
  footerPrimary: {
    alignItems: 'center',
    backgroundColor: PALETTE.footerPrimaryBg,
    borderColor: PALETTE.footerPrimaryBorder,
    borderRadius: 8, // rounded-md
    borderWidth: 1, // ring-1
    columnGap: 6, // gap-1.5
    flexDirection: 'row',
    minHeight: 36,
    paddingHorizontal: 12, // px-3
    paddingVertical: 6, // py-1.5
  },
  footerPrimaryPressed: {
    opacity: 0.85,
  },
  footerPrimaryText: {
    color: PALETTE.cyanTextStrong, // text-cyan-200
    fontSize: 12, // text-xs
    lineHeight: 16,
  },
  footerPrimaryGlyph: {
    color: PALETTE.cyanTextStrong,
    fontSize: 13, // h-3.5 w-3.5
    lineHeight: 16,
  },
  footerLink: {
    alignItems: 'center',
    borderRadius: 8, // rounded-md
    columnGap: 6, // gap-1.5
    flexDirection: 'row',
    minHeight: 36,
    paddingHorizontal: 12, // px-3
    paddingVertical: 6, // py-1.5
  },
  footerLinkPressed: {
    backgroundColor: colors.surfaceHover, // hover:bg-white/[0.04]
  },
  footerLinkGlyph: {
    color: PALETTE.cyanText, // text-cyan-300
    fontSize: 13,
    lineHeight: 16,
  },
  footerLinkText: {
    color: PALETTE.cyanText,
    fontSize: 12, // text-xs
    lineHeight: 16,
  },
});
