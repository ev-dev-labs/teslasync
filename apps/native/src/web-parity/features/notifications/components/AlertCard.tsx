// Native parity port of web/src/features/notifications/components/AlertCard.tsx.
//
// The web AlertCard is a single alert row used by AlertsListPage. It is
// presentation-only: the hosting page wires mark-read / acknowledge / reopen /
// open-detail via callbacks (preserved verbatim as props) and passes its
// react-i18next `t`. The card shows a severity-tinted type-icon box, a
// drill-through title + message, an unread status dot, and a wrapping meta row
// (relative time, severity badge, type label, optional "acknowledged by" badge,
// a "view context" drill link, and the ghost action buttons).
//
// None of the web imports are native-safe, so — mirroring the sibling native
// ports (RecentDrivesWidget, TimeMarker) — every web-only piece is rebuilt with
// React Native primitives, AppText, the repo SemanticIcon glyphs, the shared
// native GlassPanel and the design tokens:
//   * react-router-dom <Link to={drillHref}> -> Pressable + a module-level
//     navigation sink (alertCardNavigate / setAlertCardNavigator); the title and
//     the "View context" affordance call it with the same href the web Link used.
//   * i18next TFunction -> the local AlertCardTranslate type (i18next is not a
//     native dependency); every translation key + fallback + interpolation var is
//     forwarded to the host-provided `t` exactly as the source called it.
//   * @/lib/cn -> StyleSheet (no className concatenation in native).
//   * @/lib/tokens severityTokens/normalizeSeverity -> inlined native-color
//     severity maps + a value-identical normalizeSeverity.
//   * @/lib/alertDrillthrough getAlertDrillthroughHref -> inlined value-identical
//     SIGNAL_TO_PAGE / getAlertDrillthrough / href builder (URLSearchParams
//     replaced by a form-component encoder so no URL polyfill is required).
//   * @/lib/icons Icons.* -> getSemanticIconDefinition glyph stand-ins.
//   * @/components/ui GlassPanel -> the repo native GlassPanel; Badge/Button and
//     data-display SeverityBadge/StatusDot -> inlined native Pill / Dot /
//     GhostButton parity components.
//
// No DOM, no react-router-dom, no react-i18next, no lucide-react, no Recharts,
// no Leaflet, no framer-motion and no web UI components are imported.

import {
  Pressable,
  StyleSheet,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {
  getSemanticIconDefinition,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import { AppText } from '../../../../components/ui/AppText';
import { GlassPanel } from '../../../../components/ui/GlassPanel';
import { colors, spacing } from '../../../../theme/tokens';
import type { Alert } from '../../../api/types';

/* ------------------------------------------------------------------ */
/*  i18next TFunction port                                             */
/* ------------------------------------------------------------------ */

// The web card received i18next's TFunction as a prop. i18next is not a native
// dependency, so this local type mirrors exactly how the source calls `t`:
//   t(key)                          -> t('Unread'), t('Mark read')
//   t(key, fallback)                -> t('alerts.viewContext', 'View context')
//   t(key, fallback, vars)          -> t('alerts.ack.ackedBy', '…{{actor}}', {…})
export type AlertCardTranslate = (
  key: string,
  fallback?: string,
  vars?: Record<string, string | number>,
) => string;

/* ------------------------------------------------------------------ */
/*  @/lib/tokens severity port (native colors)                        */
/* ------------------------------------------------------------------ */

type Severity = 'info' | 'warn' | 'critical' | 'success';

// Value-identical to web/src/lib/tokens.ts normalizeSeverity: folds the legacy
// 'warning'/'error'/'fatal'/'ok' aliases onto the canonical union, defaulting to
// 'info' for null/unknown input.
function normalizeSeverity(s: string | null | undefined): Severity {
  if (!s) {
    return 'info';
  }
  const v = s.toLowerCase();
  if (v === 'warning') {
    return 'warn';
  }
  if (v === 'error' || v === 'fatal') {
    return 'critical';
  }
  if (v === 'ok' || v === 'success') {
    return 'success';
  }
  if (v === 'info' || v === 'warn' || v === 'critical') {
    return v;
  }
  return 'info';
}

/* ------------------------------------------------------------------ */
/*  @/lib/alertDrillthrough port (value-identical)                    */
/* ------------------------------------------------------------------ */

// Telemetry signal name -> destination route, mirrored field-for-field from
// web/src/lib/alertDrillthrough.ts SIGNAL_TO_PAGE.
const SIGNAL_TO_PAGE: Record<string, string> = {
  BatteryLevel: '/battery',
  RatedRange: '/battery',
  ChargeLimitSoc: '/battery',
  EstBatteryRange: '/battery',
  IdealBatteryRange: '/battery',

  ChargeState: '/charging',
  DetailedChargeState: '/charging',
  DCChargingPower: '/charging',
  ACChargingPower: '/charging',
  ChargeAmps: '/charging',
  ChargerVoltage: '/charging',
  ChargerActualCurrent: '/charging',
  ChargingCableType: '/charging',

  Gear: '/drives',
  VehicleSpeed: '/drives',
  Power: '/drives',
  Odometer: '/drives',

  InsideTemp: '/climate-control',
  OutsideTemp: '/climate-control',
  HvacPower: '/climate-control',
  ClimateKeeperMode: '/climate-control',

  TpmsPressureFl: '/tire-pressure',
  TpmsPressureFr: '/tire-pressure',
  TpmsPressureRl: '/tire-pressure',
  TpmsPressureRr: '/tire-pressure',
  TpmsHardWarnings: '/tire-pressure',
  TpmsSoftWarnings: '/tire-pressure',
  TpmsLastSeenPressureTimeFl: '/tire-pressure',
  TpmsLastSeenPressureTimeFr: '/tire-pressure',
  TpmsLastSeenPressureTimeRl: '/tire-pressure',
  TpmsLastSeenPressureTimeRr: '/tire-pressure',

  Locked: '/security-access',
  SentryMode: '/security-access',
  DoorState: '/security-access',
  WindowState: '/security-access',
  SunroofInstalled: '/security-access',

  SoftwareUpdateVersion: '/software-updates',
  SoftwareUpdateDownloadPercentComplete: '/software-updates',
  SoftwareUpdateInstallationPercentComplete: '/software-updates',
  SoftwareUpdateExpectedDurationMinutes: '/software-updates',

  LocatedAtHome: '/navigation',
  LocatedAtWork: '/navigation',
  LocatedAtFavorite: '/navigation',
  DestinationName: '/navigation',
  DestinationLocation: '/navigation',
};

const SIGNAL_EXPLORER_FALLBACK = '/signal-explorer';

// application/x-www-form-urlencoded component encoder. Replaces the web
// `new URLSearchParams(query).toString()` so the href builds without needing a
// URL polyfill in the native runtime; matches URLSearchParams for the conventional
// vehicle_id / ISO timestamp / signal values (space -> '+', ':' -> '%3A', …).
function encodeFormComponent(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, '+');
}

// Value-identical to getAlertDrillthrough + getAlertDrillthroughHref: resolves the
// destination route (falling back to the Signal Explorer) and appends the
// vehicle_id / t / signal context query in insertion order.
function getAlertDrillthroughHref(alert: Alert): string {
  const signal = alert.rule_signal ?? null;
  const vehicleId =
    alert.vehicle_id && alert.vehicle_id > 0 ? alert.vehicle_id : null;
  const ts = alert.created_at;

  const query: Record<string, string> = {};
  if (vehicleId != null) {
    query.vehicle_id = String(vehicleId);
  }
  if (ts) {
    query.t = ts;
  }
  if (signal) {
    query.signal = signal;
  }

  const path =
    signal && SIGNAL_TO_PAGE[signal]
      ? SIGNAL_TO_PAGE[signal]
      : SIGNAL_EXPLORER_FALLBACK;

  const search = Object.keys(query)
    .map(k => `${encodeFormComponent(k)}=${encodeFormComponent(query[k])}`)
    .join('&');

  return search ? `${path}?${search}` : path;
}

/* ------------------------------------------------------------------ */
/*  Native navigation sink (react-router-dom Link port)               */
/* ------------------------------------------------------------------ */

// The web used react-router's <Link to={drillHref}>. The native parity tree
// mounts no router here, so drill taps default to a no-op a host can override.
// Both the title and the "View context" affordance call this with the same
// drill-through href the web Link used.
type AlertCardNavigate = (to: string) => void;
let alertCardNavigate: AlertCardNavigate = () => {};

export function setAlertCardNavigator(fn: AlertCardNavigate): void {
  alertCardNavigate = fn;
}

/* ------------------------------------------------------------------ */
/*  @/lib/icons Icons.* -> SemanticIcon glyph stand-ins               */
/* ------------------------------------------------------------------ */

// alert.type -> the repo SemanticIcon name whose web Icons.* counterpart the
// source mapped (Icons.location == 'location', Icons.battery == 'battery', …).
const TYPE_ICONS: Record<string, SemanticIconName> = {
  geofence_exit: 'location',
  geofence_enter: 'location',
  low_battery: 'battery',
  battery_low: 'battery',
  battery_high: 'battery',
  charging_complete: 'charging',
  charging_cost: 'charging',
  sentry_event: 'security',
  speed_limit: 'speed',
  temperature: 'climate',
  software_update: 'settingsAlt',
  vampire_drain: 'trendDown',
  tire_pressure_low: 'droplets',
  idle_unlocked: 'locked',
  efficiency_drop: 'analytics',
  system_database: 'database',
  system_mqtt: 'wifi',
  system_redis: 'hardDrive',
  system_tesla_api: 'radio',
  system_worker: 'efficiency',
};

function glyphFor(name: SemanticIconName): string {
  return getSemanticIconDefinition(name).glyph;
}

// Fixed meta-row / action glyphs (web Icons.clock/next/notifications/refresh/
// success/show).
const CLOCK_GLYPH = glyphFor('clock');
const NEXT_GLYPH = glyphFor('next');
const NOTIFICATIONS_GLYPH = glyphFor('notifications');
const REFRESH_GLYPH = glyphFor('refresh');
const SUCCESS_GLYPH = glyphFor('success');
const SHOW_GLYPH = glyphFor('show');

/* ------------------------------------------------------------------ */
/*  getTimeAgo (ported verbatim)                                       */
/* ------------------------------------------------------------------ */

function getTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) {
    return `${mins}m ago`;
  }
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return `${Math.floor(hours / 24)}d ago`;
}

/* ------------------------------------------------------------------ */
/*  Inlined data-display parity components                             */
/* ------------------------------------------------------------------ */

// web <SeverityBadge size="sm" showIcon={false}> / <Badge variant="success">:
// a severity-tinted rounded-full pill with a small colored label.
function Pill({
  severity,
  children,
}: {
  severity: Severity;
  children: string;
}) {
  return (
    <View style={[styles.pill, surfaceStyles[severity]]}>
      <AppText
        style={[styles.pillText, colorStyles[severity]]}
        weight="semibold"
      >
        {children}
      </AppText>
    </View>
  );
}

// web <StatusDot>: a tiny severity-colored dot marking an unread alert. The web
// `animate-pulse` is a decorative-only affordance with no native animation here.
function Dot({ severity, label }: { severity: Severity; label: string }) {
  return (
    <View
      accessibilityLabel={label}
      accessibilityRole="image"
      style={[styles.dot, dotStyles[severity]]}
    />
  );
}

// web <Button variant="ghost" size="sm" icon={…}>: a bordered ghost row with a
// leading glyph and a label.
function GhostButton({
  glyph,
  label,
  onPress,
}: {
  glyph: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [
        styles.ghostButton,
        pressed && styles.ghostButtonPressed,
      ]}
    >
      <AppText style={styles.ghostButtonGlyph} weight="bold">
        {glyph}
      </AppText>
      <AppText style={styles.ghostButtonLabel} weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/*  AlertCard                                                          */
/* ------------------------------------------------------------------ */

export interface AlertCardProps {
  alert: Alert;
  onMarkRead: () => void;
  onAcknowledge: () => void;
  onOpenDetail: () => void;
  onReopen: () => void;
  t: AlertCardTranslate;
}

export function AlertCard({
  alert,
  onMarkRead,
  onAcknowledge,
  onOpenDetail,
  onReopen,
  t,
}: AlertCardProps) {
  const sev = normalizeSeverity(alert.severity);
  const iconGlyph = glyphFor(TYPE_ICONS[alert.type] || 'notifications');
  const timeAgo = getTimeAgo(alert.created_at);
  const drillHref = getAlertDrillthroughHref(alert);
  const isAcked = Boolean(alert.acknowledged_at);

  return (
    <GlassPanel style={[styles.panel, !alert.is_read && surfaceStyles[sev]]}>
      <View style={styles.iconColumn}>
        <View style={[styles.iconBox, surfaceStyles[sev]]}>
          <AppText style={[styles.iconGlyph, colorStyles[sev]]} weight="bold">
            {iconGlyph}
          </AppText>
        </View>
      </View>
      <View style={styles.body}>
        <View style={styles.topRow}>
          <Pressable
            accessibilityLabel={t('alerts.viewContext', 'View context')}
            accessibilityRole="link"
            onPress={() => alertCardNavigate(drillHref)}
            style={({ pressed }) => [
              styles.titleLink,
              pressed && styles.titleLinkPressed,
            ]}
          >
            <AppText
              style={styles.title}
              tone={alert.is_read ? 'secondary' : 'primary'}
            >
              {alert.title}
            </AppText>
            <AppText numberOfLines={2} style={styles.message} tone="muted">
              {alert.message}
            </AppText>
          </Pressable>
          {!alert.is_read ? <Dot label={t('Unread')} severity={sev} /> : null}
        </View>
        <View style={styles.metaRow}>
          <View style={styles.metaInline}>
            <AppText style={styles.clockGlyph} tone="muted" weight="bold">
              {CLOCK_GLYPH}
            </AppText>
            <AppText style={styles.metaText} tone="muted">
              {timeAgo}
            </AppText>
          </View>
          <Pill severity={sev}>{alert.severity}</Pill>
          <AppText style={styles.metaText} tone="muted">
            {(alert.type ?? 'notification').replace(/_/g, ' ')}
          </AppText>
          {isAcked ? (
            <Pill severity="success">
              {alert.acknowledged_by
                ? t('alerts.ack.ackedBy', 'Acknowledged by {{actor}}', {
                    actor: alert.acknowledged_by,
                  })
                : t('alerts.ack.ackedByAnonymous', 'Acknowledged')}
            </Pill>
          ) : null}
          <Pressable
            accessibilityRole="link"
            onPress={() => alertCardNavigate(drillHref)}
            style={styles.viewContext}
          >
            <AppText
              style={styles.viewContextText}
              tone="accent"
              weight="semibold"
            >
              {t('alerts.viewContext', 'View context')}
            </AppText>
            <AppText
              style={styles.viewContextGlyph}
              tone="accent"
              weight="bold"
            >
              {NEXT_GLYPH}
            </AppText>
          </Pressable>
          <GhostButton
            glyph={NOTIFICATIONS_GLYPH}
            label={t('alerts.timeline.title', 'Audit timeline')}
            onPress={onOpenDetail}
          />
          {isAcked ? (
            <GhostButton
              glyph={REFRESH_GLYPH}
              label={t('alerts.timeline.kindAnonymous.reopened', 'Reopened')}
              onPress={onReopen}
            />
          ) : (
            <GhostButton
              glyph={SUCCESS_GLYPH}
              label={t('alerts.ack.button', 'Acknowledge')}
              onPress={onAcknowledge}
            />
          )}
          {!alert.is_read ? (
            <GhostButton
              glyph={SHOW_GLYPH}
              label={t('Mark read')}
              onPress={onMarkRead}
            />
          ) : null}
        </View>
      </View>
    </GlassPanel>
  );
}

export default AlertCard;

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  panel: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
    padding: 16,
  },
  iconColumn: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  iconBox: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconGlyph: {
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.4,
  },
  body: {
    flex: 1,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  titleLink: {
    flex: 1,
    borderRadius: 6,
    padding: 4,
    margin: -4,
  },
  titleLinkPressed: {
    backgroundColor: colors.surfaceHover,
  },
  title: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  message: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 16,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 6,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  metaInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  clockGlyph: {
    fontSize: 9,
    lineHeight: 12,
    color: colors.textMuted,
  },
  metaText: {
    fontSize: 10,
    lineHeight: 14,
  },
  pill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  pillText: {
    fontSize: 11,
    lineHeight: 14,
  },
  viewContext: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginLeft: 'auto',
  },
  viewContextText: {
    fontSize: 11,
    lineHeight: 14,
  },
  viewContextGlyph: {
    fontSize: 10,
    lineHeight: 14,
  },
  ghostButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  ghostButtonPressed: {
    opacity: 0.82,
  },
  ghostButtonGlyph: {
    fontSize: 10,
    lineHeight: 14,
    color: colors.textSecondary,
  },
  ghostButtonLabel: {
    fontSize: 12,
    lineHeight: 16,
    color: colors.textSecondary,
  },
});

const surfaceStyles = StyleSheet.create<Record<Severity, ViewStyle>>({
  info: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  warn: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
  critical: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  success: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
});

const colorStyles = StyleSheet.create<Record<Severity, TextStyle>>({
  info: {
    color: colors.accent,
  },
  warn: {
    color: colors.warning,
  },
  critical: {
    color: colors.danger,
  },
  success: {
    color: colors.success,
  },
});

const dotStyles = StyleSheet.create<Record<Severity, ViewStyle>>({
  info: {
    backgroundColor: colors.accent,
  },
  warn: {
    backgroundColor: colors.warning,
  },
  critical: {
    backgroundColor: colors.danger,
  },
  success: {
    backgroundColor: colors.success,
  },
});
