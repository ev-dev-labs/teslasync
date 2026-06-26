// Native parity port of
// web/src/features/notifications/components/NotificationRow.tsx.
//
// NotificationRow renders one inbox row:
//   - selection checkbox
//   - severity badge (color from the rule severity when known)
//   - timestamp (vehicle-tz when the vehicle is known, else user-tz)
//   - title (stronger weight while unread)
//   - vehicle name + rule name (when known)
//   - per-row quick actions (mark read/unread, archive/unarchive)
//   - drill-through link (uses `getAlertDrillthroughHref`)
//
// Every prop name (`log`/`rule`/`vehicle`/`selected`/`onSelectionChange`/
// `onActivate`/`onArchive`/`onUnarchive`/`onMarkRead`/`onMarkUnread`), the
// `synthetic` Alert shape, the read/archived derivations, the severity default
// (`rule?.severity ?? 'info'`), the `tzMode` selection, the drill-through href,
// and every `t('key','English')` i18n intent are preserved verbatim.
//
// Web modules with no native-parity surface are mapped per the conversion
// contract (rules 4-7); each is documented in the parity sidecar:
//   - react-i18next `useTranslation` -> a local key-preserving shim supporting
//     `t(key,'English')` and `t(key,'English',{opts})` with `{{token}}`
//     interpolation (apps/native deps lack react-i18next).
//   - react-router-dom `<Link to=…>` -> a native shim whose `navigate(href)`
//     calls `Linking.openURL` (internal SPA routes resolve only when a deep-link
//     handler is registered; the same seam the other page ports use).
//   - lucide-react icons (Archive/ArchiveRestore/ChevronRight/MailOpen/Mail) ->
//     decorative AppText glyphs (accessibility-hidden); the adjacent
//     accessibilityLabel always carries the meaning.
//   - `@/lib/cn` -> dropped; RN has no className, conditional styling uses
//     StyleSheet arrays.
//   - `@/components/data-display` `DateTime` -> the shared native `TimeStamp`
//     port (identical `value` + `in` props; preserves the tz-mode intent).
//   - `@/components/data-display` `SeverityBadge` -> a local severity pill that
//     mirrors the web tokens (bg/border/fg per severity), matching the web call
//     `<SeverityBadge severity size="sm" showIcon={false}>`.
//   - `@/components/ui` `Button` (icon ghost variant) -> a local Pressable
//     `IconButton`; the native checkbox replaces the web `<input type=checkbox>`.
//   - `@/lib/alertDrillthrough` `getAlertDrillthroughHref` -> inlined verbatim
//     (manual query-string build; RN has no guaranteed URLSearchParams).
//
// The web DOM bubbling guard (don't activate when the click lands on a button /
// link / input / label) is handled structurally on native: each inner control is
// its own Pressable, so a tap on a control never reaches the row's `onPress`.
// The web `onKeyDown` (Enter/Space activation) is covered by the row's
// `accessibilityRole="button"` + `onPress`. No DOM-only modules, browser HTML
// elements, Recharts, Leaflet, or old web UI components are imported.

import React, { useCallback } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '../../../../components/ui/AppText';
import { colors, spacing } from '../../../../theme/tokens';
import { TimeStamp, type TzMode } from '../../../components/data-display/TimeStamp';
import type { Alert, AlertRule, NotificationLog, Vehicle } from '../../../api/types';

// ─── i18n shim ────────────────────────────────────────────────────────────────
type TOptions = Record<string, string | number>;
type TFunc = (key: string, fallback: string, opts?: TOptions) => string;

function interpolate(template: string, opts: TOptions): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = opts[key];
    return value === undefined ? '' : String(value);
  });
}

function useTranslation(): { t: TFunc } {
  const t = useCallback<TFunc>((_key, fallback, opts) => {
    return opts ? interpolate(fallback, opts) : fallback;
  }, []);
  return { t };
}

// ─── navigation shim ──────────────────────────────────────────────────────────
// react-router-dom `<Link to=href>` -> open the drill-through href via Linking.
// Internal SPA routes resolve only when a deep-link handler is registered; the
// call site (`navigate(href)`) is otherwise unchanged.
function useNavigate(): (href: string) => void {
  return useCallback((href: string) => {
    void Linking.openURL(href).catch(() => {
      // No deep-link handler registered for this internal route; native-safe no-op.
    });
  }, []);
}

// ─── lucide -> glyph map ──────────────────────────────────────────────────────
// Decorative stand-ins for the lucide SVG icons. Always paired with an
// accessibilityLabel so meaning never depends on the glyph.
const GLYPH = {
  mailOpen: '\u2709', // MailOpen
  mail: '\u2709', // Mail
  archive: '\u{1F5C4}', // Archive
  restore: '\u21A9', // ArchiveRestore
  chevronRight: '\u203A', // ChevronRight
} as const;

// ─── alertDrillthrough (inlined from web/src/lib/alertDrillthrough.ts) ────────
// Maps an Alert to a navigable href on the relevant context page. RN has no
// guaranteed URLSearchParams, so the query string is built manually.
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

function getAlertDrillthroughHref(alert: Alert): string {
  const signal = alert.rule_signal ?? null;
  const vehicleId = alert.vehicle_id && alert.vehicle_id > 0 ? alert.vehicle_id : null;
  const ts = alert.created_at;

  const params: string[] = [];
  if (vehicleId != null) params.push(`vehicle_id=${encodeURIComponent(String(vehicleId))}`);
  if (ts) params.push(`t=${encodeURIComponent(ts)}`);
  if (signal) params.push(`signal=${encodeURIComponent(signal)}`);

  const path = signal && SIGNAL_TO_PAGE[signal] ? SIGNAL_TO_PAGE[signal] : SIGNAL_EXPLORER_FALLBACK;
  const search = params.join('&');
  return search ? `${path}?${search}` : path;
}

// ─── severity tokens (mirrors @/lib/tokens severityTokens) ────────────────────
interface SeverityToken {
  bg: string;
  border: string;
  fg: string;
}
const SEVERITY_TOKENS: Record<string, SeverityToken> = {
  info: { bg: colors.accentSoft, border: colors.borderAccent, fg: colors.accent },
  warn: { bg: colors.warningSurface, border: colors.warningBorder, fg: colors.warning },
  warning: { bg: colors.warningSurface, border: colors.warningBorder, fg: colors.warning },
  critical: { bg: colors.dangerSurface, border: colors.dangerBorder, fg: colors.danger },
  success: { bg: colors.successSurface, border: colors.successBorder, fg: colors.success },
};

function severityToken(severity: string): SeverityToken {
  return SEVERITY_TOKENS[severity] ?? SEVERITY_TOKENS.info;
}

// ─── glyph ────────────────────────────────────────────────────────────────────
function Glyph({ glyph, style }: { glyph: string; style?: object }) {
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.glyph, style]}>
      {glyph}
    </AppText>
  );
}

// ─── SeverityBadge (local mirror of web/src/components/data-display) ───────────
function SeverityBadge({ severity }: { severity: string }) {
  const tokens = severityToken(severity);
  return (
    <View style={[styles.severityBadge, { backgroundColor: tokens.bg, borderColor: tokens.border }]}>
      <AppText style={[styles.severityText, { color: tokens.fg }]} variant="caption" weight="semibold">
        {severity}
      </AppText>
    </View>
  );
}

// ─── Checkbox (native replacement for <input type="checkbox">) ────────────────
function Checkbox({
  checked,
  onToggle,
  label,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      hitSlop={8}
      onPress={onToggle}
      style={[styles.checkbox, checked && styles.checkboxOn]}>
      {checked ? <AppText style={styles.checkboxTick}>{'\u2713'}</AppText> : null}
    </Pressable>
  );
}

// ─── IconButton (native mirror of the web ghost-icon Button) ──────────────────
function IconButton({
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
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
      <Glyph glyph={glyph} />
    </Pressable>
  );
}

// ─── NotificationRow ──────────────────────────────────────────────────────────
export interface NotificationRowProps {
  log: NotificationLog;
  rule?: AlertRule;
  vehicle?: Vehicle;
  selected: boolean;
  onSelectionChange: (id: number, selected: boolean) => void;
  /** Fires when the user taps the row body (not on controls). */
  onActivate?: (log: NotificationLog) => void;
  /** Quick per-row archive/unarchive button. */
  onArchive?: (id: number) => void;
  onUnarchive?: (id: number) => void;
  /** Quick per-row mark read/unread button. */
  onMarkRead?: (id: number) => void;
  onMarkUnread?: (id: number) => void;
}

export function NotificationRow({
  log,
  rule,
  vehicle,
  selected,
  onSelectionChange,
  onActivate,
  onArchive,
  onUnarchive,
  onMarkRead,
  onMarkUnread,
}: NotificationRowProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isRead = !!log.read_at;
  const isArchived = !!log.archived_at;
  const severity = rule?.severity ?? 'info';

  const synthetic: Alert = {
    id: log.id,
    vehicle_id: vehicle?.id ?? rule?.vehicle_id ?? 0,
    type: rule?.name ?? log.title,
    severity: severity as Alert['severity'],
    title: log.title,
    message: log.message,
    is_read: isRead,
    created_at: log.created_at,
    rule_id: rule?.id,
    rule_signal: rule?.signal_name,
    rule_severity: rule?.severity,
  };

  const drillHref = rule ? getAlertDrillthroughHref(synthetic) : null;
  const tzMode: TzMode = vehicle ? 'vehicle' : 'user';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={() => onActivate?.(log)}
      style={({ pressed }) => [
        styles.row,
        !isRead && styles.rowUnread,
        isRead && styles.rowRead,
        pressed && styles.rowPressed,
      ]}>
      <Checkbox
        checked={selected}
        onToggle={() => onSelectionChange(log.id, !selected)}
        label={t('notifications.inbox.row.select', 'Select notification')}
      />

      <View style={styles.rowMain}>
        <View style={styles.rowMeta}>
          <SeverityBadge severity={severity} />
          <TimeStamp value={log.created_at} in={tzMode} style={styles.metaMuted} />
          {vehicle ? (
            <AppText numberOfLines={1} style={styles.metaMuted} variant="caption">
              {`\u00B7 ${vehicle.display_name || `#${vehicle.id}`}`}
            </AppText>
          ) : null}
          {rule?.name ? (
            <AppText numberOfLines={1} style={styles.metaMuted} variant="caption">
              {`\u00B7 ${rule.name}`}
            </AppText>
          ) : null}
        </View>
        <AppText
          numberOfLines={1}
          style={[styles.rowTitle, isRead ? styles.rowTitleRead : styles.rowTitleUnread]}>
          {log.title}
        </AppText>
        {log.message ? (
          <AppText numberOfLines={1} style={styles.rowMessage} tone="muted" variant="caption">
            {log.message}
          </AppText>
        ) : null}
      </View>

      <View style={styles.rowActions}>
        {!isRead && onMarkRead ? (
          <IconButton
            glyph={GLYPH.mailOpen}
            label={t('notifications.inbox.row.markRead', 'Mark as read')}
            onPress={() => onMarkRead(log.id)}
          />
        ) : null}
        {isRead && onMarkUnread ? (
          <IconButton
            glyph={GLYPH.mail}
            label={t('notifications.inbox.row.markUnread', 'Mark as unread')}
            onPress={() => onMarkUnread(log.id)}
          />
        ) : null}
        {!isArchived && onArchive ? (
          <IconButton
            glyph={GLYPH.archive}
            label={t('notifications.inbox.row.archive', 'Archive')}
            onPress={() => onArchive(log.id)}
          />
        ) : null}
        {isArchived && onUnarchive ? (
          <IconButton
            glyph={GLYPH.restore}
            label={t('notifications.inbox.row.unarchive', 'Restore')}
            onPress={() => onUnarchive(log.id)}
          />
        ) : null}
        {drillHref ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={t('alerts.viewContext', 'View context')}
            hitSlop={6}
            onPress={() => navigate(drillHref)}
            style={({ pressed }) => [styles.drillLink, pressed && styles.pressed]}>
            <AppText style={styles.drillLinkText} variant="caption" weight="semibold">
              {t('alerts.viewContext', 'View context')}
            </AppText>
            <Glyph glyph={GLYPH.chevronRight} style={styles.drillLinkGlyph} />
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.82,
  },
  glyph: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 18,
  },

  // checkbox
  checkbox: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 4,
    borderWidth: 1,
    height: 20,
    justifyContent: 'center',
    marginTop: 2,
    width: 20,
  },
  checkboxOn: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  checkboxTick: {
    color: colors.accent,
    fontSize: 13,
    lineHeight: 16,
  },

  // icon button
  iconButton: {
    alignItems: 'center',
    borderRadius: 8,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },

  // severity badge (pill)
  severityBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  severityText: {
    textTransform: 'capitalize',
  },

  // row
  row: {
    alignItems: 'flex-start',
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  rowUnread: {
    backgroundColor: colors.surfaceRaised,
    borderLeftColor: colors.borderAccent,
    borderLeftWidth: 2,
  },
  rowRead: {
    opacity: 0.92,
  },
  rowPressed: {
    backgroundColor: colors.surfaceHover,
  },
  rowMain: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  rowMeta: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  metaMuted: {
    color: colors.textMuted,
    fontSize: 12,
  },
  rowTitle: {
    fontSize: 14,
    lineHeight: 18,
  },
  rowTitleRead: {
    color: colors.textSecondary,
  },
  rowTitleUnread: {
    color: colors.textPrimary,
    fontWeight: '600',
  },
  rowMessage: {
    color: colors.textMuted,
  },
  rowActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 0,
    gap: 2,
  },
  drillLink: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 2,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  drillLinkText: {
    color: colors.accent,
  },
  drillLinkGlyph: {
    color: colors.accent,
    fontSize: 13,
  },
});
