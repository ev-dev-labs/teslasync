// Native parity port of
// web/src/features/notifications/components/NotificationGroupRow.tsx.
//
// Renders one server-aggregated notification thread (a group of repeated
// deliveries for the same alert rule + severity). The latest member always
// renders identically to a flat-view row via the composed `NotificationRow`;
// the grouping affordances live OUTSIDE that row:
//   - "+N similar" chip beside the latest row
//   - expand/collapse caret that inlines the rest of the thread
//   - "Mark group read" action that hits the backend's group_key path
// Singleton groups (group_key === null) render as a plain row with the grouping
// chrome hidden. Member fetching is lazy (`useGroupMembers` gated on `expanded`)
// so the inbox doesn't stampede the API with N expand-fetches up front.
//
// Native-safe substitutions (rule 7), documented in the parity sidecar:
//   • react-i18next useTranslation() -> a local useTranslation() whose
//     t(key, fallback?, values?) returns the English fallback (preserving every
//     key + default copy at the call site) and interpolates {{token}} +
//     {{count}} placeholders, matching the web copy exactly. A stable
//     useCallback identity keeps the handleMarkGroupRead useCallback dep array
//     honest, mirroring the source.
//   • @/components/feedback/Toast useToast() -> a local useToast() (the
//     BackupRestorePage / _toastHelpers precedent) backed by RN Alert.alert.
//     The full web ToastContextValue surface (toast/success/error/info/
//     warning/dismiss) is preserved; `duration` + queueing have no RN analog
//     and are dropped (Alert is modal + self-dismissing). A useMemo keeps the
//     toast identity stable for the useCallback dep array.
//   • The composed `./NotificationRow` sibling is NOT part of the native parity
//     manifest (and its own deps — react-router-dom <Link>, the data-display
//     <DateTime>, @/lib/alertDrillthrough, the shared <Button>, the <input>
//     checkbox — are browser-only), so it is inlined here as a local native
//     NotificationRow built from RN primitives + the ported SeverityBadge. This
//     keeps the conversion to the single required output file.
//   • lucide-react icons -> text-glyph stand-ins matching the sibling
//     NotificationBellPopover house style (ChevronRight ›, ChevronDown ⌄,
//     MailOpen/Mail ✉, Archive ⤓, ArchiveRestore ⤒, Check ✓, middot ·); the
//     spinning Loader2 -> RN <ActivityIndicator>.
//   • react-router-dom <Link to> drill-through -> a Pressable + an optional
//     onNavigate(to) callback prop (the VehicleHeroCard / EmptyState
//     precedent); getAlertDrillthroughHref is inlined verbatim (pure routing
//     logic, URLSearchParams replaced by a manual encoder for RN).
//   • The <input type="checkbox"> -> an accessibilityRole="checkbox" Pressable
//     box; the web <DateTime in="vehicle|user"> -> a local device-locale
//     timestamp formatter (per-vehicle IANA tz data is not wired in the native
//     parity shell, so both modes fall back to the device tz — the tzMode is
//     preserved for parity intent).
//   • cn()/Tailwind utility classes -> StyleSheet + native theme tokens; the
//     hover-reveal action cluster always renders on native (no hover model).
// No DOM elements, react-i18next, react-router-dom, lucide-react, Recharts,
// Leaflet, or web UI-kit modules are imported into the native output.

import React, {useCallback, useId, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  Alert as RNAlert,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import {
  useBulkMarkRead,
  useGroupMembers,
  type AlertRule,
  type NotificationFilters,
  type NotificationLog,
  type NotificationLogGroup,
} from '../../../api/hooks/useNotifications';
import type {Vehicle} from '../../../api/types';
import {SeverityBadge} from '../../../components/data-display/SeverityBadge';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';

/* ─── i18n fallback (web react-i18next useTranslation) ─────────────────── */

type TranslationValues = Record<string, string | number>;

type TFunc = (
  key: string,
  fallback?: string,
  values?: TranslationValues,
) => string;

// Native stand-in for react-i18next's useTranslation: the parity bundle ships no
// i18n runtime, so `t` returns the English fallback (or the key) while preserving
// every key + default copy at the call site and interpolating {{token}}
// placeholders. The stable useCallback identity keeps the handleMarkGroupRead
// useCallback dep array honest, matching the source.
function useTranslation(): {t: TFunc} {
  const t = useCallback<TFunc>((key, fallback, values) => {
    const base = fallback ?? key;
    if (!values) {
      return base;
    }
    return base.replace(/\{\{(\w+)\}\}/g, (match, token: string) =>
      values[token] === undefined ? match : String(values[token]),
    );
  }, []);
  return {t};
}

/* ─── useToast (web @/components/feedback/Toast) ───────────────────────── */

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastOptions {
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

interface ToastApi {
  toast: (opts: ToastOptions) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
  dismiss: (id: string) => void;
}

// Web toast queue -> native Alert.alert (the BackupRestorePage / _toastHelpers
// precedent). The full ToastContextValue surface is preserved; `duration` +
// queueing have no RN analog (Alert is modal + self-dismissing) and are dropped.
// useMemo keeps the identity stable so the handleMarkGroupRead useCallback dep
// array stays honest.
function useToast(): ToastApi {
  return useMemo<ToastApi>(
    () => ({
      toast: opts => RNAlert.alert(opts.title, opts.message),
      success: (title, message) => RNAlert.alert(title, message),
      error: (title, message) => RNAlert.alert(title, message),
      info: (title, message) => RNAlert.alert(title, message),
      warning: (title, message) => RNAlert.alert(title, message),
      dismiss: () => {
        // no-op: RN Alert dismisses itself; there is no toast queue to clear.
      },
    }),
    [],
  );
}

/* ─── text-glyph stand-ins for the lucide icons ────────────────────────── */

// Matches the sibling NotificationBellPopover house glyph map (native ships no
// SVG icon set). The badge/label color carries the meaning; the glyph is
// decorative (aria-hidden in the web source).
const GLYPH = {
  chevronRight: '\u203A', // ChevronRight ›
  chevronDown: '\u2304', // ChevronDown ⌄
  mailOpen: '\u2709', // MailOpen ✉
  mail: '\u2709', // Mail ✉
  archive: '\u2913', // Archive ⤓ (down-to-bar = file away)
  unarchive: '\u2912', // ArchiveRestore ⤒ (up-from-bar = restore)
} as const;

/* ─── inlined @/lib/alertDrillthrough getAlertDrillthroughHref ──────────── */

// Minimal alert context consumed by the pure drill-through router below. The
// web synthetic Alert carries many fields, but getAlertDrillthrough only reads
// rule_signal, vehicle_id, and created_at — so only those are reproduced.
interface DrillAlertContext {
  rule_signal: string | null;
  vehicle_id: number;
  created_at: string;
}

// Map of telemetry signal names → destination page route (mirrors the web
// SIGNAL_TO_PAGE; routes match web/src/App.tsx). Unknown signals fall through to
// the Signal Explorer.
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

// Compute the drill-through href for an alert. URLSearchParams (DOM) is replaced
// by a manual encoder so the logic runs under React Native.
function getAlertDrillthroughHref(alert: DrillAlertContext): string {
  const signal = alert.rule_signal ?? null;
  // vehicle_id may be 0 when the rule was un-scoped; treat 0 as "no vehicle".
  const vehicleId =
    alert.vehicle_id && alert.vehicle_id > 0 ? alert.vehicle_id : null;
  const ts = alert.created_at;

  const params: string[] = [];
  if (vehicleId != null) {
    params.push(`vehicle_id=${encodeURIComponent(String(vehicleId))}`);
  }
  if (ts) {
    params.push(`t=${encodeURIComponent(ts)}`);
  }
  if (signal) {
    params.push(`signal=${encodeURIComponent(signal)}`);
  }

  const path =
    signal && SIGNAL_TO_PAGE[signal]
      ? SIGNAL_TO_PAGE[signal]
      : SIGNAL_EXPLORER_FALLBACK;
  const search = params.join('&');
  return search ? `${path}?${search}` : path;
}

/* ─── inlined data-display <DateTime> timestamp formatter ──────────────── */

// Web <DateTime value in="vehicle|user"> renders the timestamp formatted in the
// resolved IANA timezone. The native parity shell has no per-vehicle tz data, so
// both modes fall back to the device locale + tz; the tzMode is still threaded
// for parity intent. Mirrors the BackupRestorePage formatDateFallback style.
function formatRowTimestamp(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return '\u2014';
  }
  try {
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return d.toISOString();
  }
}

/* ─── inlined ./NotificationRow (one inbox row) ────────────────────────── */

interface NotificationRowProps {
  log: NotificationLog;
  rule?: AlertRule;
  vehicle?: Vehicle;
  selected: boolean;
  onSelectionChange: (id: number, selected: boolean) => void;
  /** Fires when the user taps the row body (not on controls). */
  onActivate?: (log: NotificationLog) => void;
  /** Quick per-row archive/unarchive. */
  onArchive?: (id: number) => void;
  onUnarchive?: (id: number) => void;
  /** Quick per-row mark read/unread. */
  onMarkRead?: (id: number) => void;
  onMarkUnread?: (id: number) => void;
  /** Native nav replacement for the react-router-dom drill-through <Link>. */
  onNavigate?: (to: string) => void;
}

// Native row: selection checkbox, severity badge, time, title, vehicle/rule
// labels, message, and the per-row action cluster. Unread rows get a left-edge
// accent bar + a slightly stronger background, mirroring the web row.
function NotificationRow({
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
  onNavigate,
}: NotificationRowProps) {
  const {t} = useTranslation();
  const isRead = !!log.read_at;
  const isArchived = !!log.archived_at;
  const severity = rule?.severity ?? 'info';

  const drillHref = rule
    ? getAlertDrillthroughHref({
        rule_signal: rule.signal_name ?? null,
        vehicle_id: vehicle?.id ?? rule.vehicle_id ?? 0,
        created_at: log.created_at,
      })
    : null;
  // tzMode preserved for parity; both branches format in the device tz on native.
  const tzMode: 'vehicle' | 'user' = vehicle ? 'vehicle' : 'user';
  void tzMode;

  return (
    <View
      accessibilityRole="text"
      accessibilityState={{selected}}
      style={[styles.row, !isRead && styles.rowUnread, isRead && styles.rowRead]}>
      <Pressable
        accessibilityLabel={t('notifications.inbox.row.select', 'Select notification')}
        accessibilityRole="checkbox"
        accessibilityState={{checked: selected}}
        onPress={() => onSelectionChange(log.id, !selected)}
        style={[styles.checkbox, selected && styles.checkboxChecked]}>
        {selected ? (
          <AppText style={styles.checkboxGlyph} weight="bold">
            {'\u2713'}
          </AppText>
        ) : null}
      </Pressable>

      <Pressable
        accessibilityRole="button"
        onPress={() => onActivate?.(log)}
        style={styles.rowBody}>
        <View style={styles.metaRow}>
          <SeverityBadge severity={severity} showIcon={false} size="sm">
            {severity}
          </SeverityBadge>
          <AppText style={styles.metaText} variant="caption">
            {formatRowTimestamp(log.created_at)}
          </AppText>
          {vehicle ? (
            <AppText
              numberOfLines={1}
              style={styles.metaText}
              variant="caption">
              {`\u00B7 ${vehicle.display_name || `#${vehicle.id}`}`}
            </AppText>
          ) : null}
          {rule?.name ? (
            <AppText
              numberOfLines={1}
              style={styles.metaText}
              variant="caption">
              {`\u00B7 ${rule.name}`}
            </AppText>
          ) : null}
        </View>
        <View style={styles.titleRow}>
          <AppText
            numberOfLines={1}
            style={[styles.title, isRead ? styles.titleRead : styles.titleUnread]}
            weight={isRead ? 'regular' : 'semibold'}>
            {log.title}
          </AppText>
        </View>
        {log.message ? (
          <AppText numberOfLines={1} style={styles.message} variant="caption">
            {log.message}
          </AppText>
        ) : null}
      </Pressable>

      <View style={styles.actions}>
        {!isRead && onMarkRead ? (
          <Pressable
            accessibilityLabel={t('notifications.inbox.row.markRead', 'Mark as read')}
            accessibilityRole="button"
            onPress={() => onMarkRead(log.id)}
            style={({pressed}) => [styles.iconButton, pressed && styles.pressed]}>
            <AppText style={styles.iconGlyph}>{GLYPH.mailOpen}</AppText>
          </Pressable>
        ) : null}
        {isRead && onMarkUnread ? (
          <Pressable
            accessibilityLabel={t('notifications.inbox.row.markUnread', 'Mark as unread')}
            accessibilityRole="button"
            onPress={() => onMarkUnread(log.id)}
            style={({pressed}) => [styles.iconButton, pressed && styles.pressed]}>
            <AppText style={styles.iconGlyph}>{GLYPH.mail}</AppText>
          </Pressable>
        ) : null}
        {!isArchived && onArchive ? (
          <Pressable
            accessibilityLabel={t('notifications.inbox.row.archive', 'Archive')}
            accessibilityRole="button"
            onPress={() => onArchive(log.id)}
            style={({pressed}) => [styles.iconButton, pressed && styles.pressed]}>
            <AppText style={styles.iconGlyph}>{GLYPH.archive}</AppText>
          </Pressable>
        ) : null}
        {isArchived && onUnarchive ? (
          <Pressable
            accessibilityLabel={t('notifications.inbox.row.unarchive', 'Restore')}
            accessibilityRole="button"
            onPress={() => onUnarchive(log.id)}
            style={({pressed}) => [styles.iconButton, pressed && styles.pressed]}>
            <AppText style={styles.iconGlyph}>{GLYPH.unarchive}</AppText>
          </Pressable>
        ) : null}
        {drillHref ? (
          <Pressable
            accessibilityLabel={t('alerts.viewContext', 'View context')}
            accessibilityRole="link"
            onPress={() => onNavigate?.(drillHref)}
            style={({pressed}) => [styles.drillLink, pressed && styles.pressed]}>
            <AppText style={styles.drillLabel} variant="caption" weight="semibold">
              {t('alerts.viewContext', 'View context')}
            </AppText>
            <AppText style={styles.drillGlyph}>{GLYPH.chevronRight}</AppText>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/* ─── NotificationGroupRow ─────────────────────────────────────────────── */

export interface NotificationGroupRowProps {
  group: NotificationLogGroup;
  /** Lookup map for resolving alert_id → rule (for severity coloring + name). */
  ruleMap: Record<number, AlertRule>;
  /** Lookup map for resolving rule.vehicle_id → vehicle (for tz + display name). */
  vehicleMap: Record<number, Vehicle>;
  /** Filters from the parent inbox so members fetch with the same window. */
  filters: NotificationFilters;
  /**
   * Per-row selection set (member ids). The latest row and any expanded member
   * rows look themselves up in this set to render their checkbox state.
   * Optional for callers that still want a read-only group display.
   */
  selectedIds?: Set<number>;
  /** Per-row selection toggle fired by the checkbox in any member row. */
  onSelectionChange?: (id: number, selected: boolean) => void;
  /** Per-row activate (used to mark single rows read on tap). */
  onActivate?: (log: NotificationLog) => void;
  /** Per-row archive/restore. */
  onArchive?: (id: number) => void;
  onUnarchive?: (id: number) => void;
  /** Per-row mark read/unread (only used inside the expanded member list). */
  onMarkRead?: (id: number) => void;
  onMarkUnread?: (id: number) => void;
  /** Whether the parent is in archived mode (alters the per-row swipe action). */
  archived: boolean;
  /**
   * Native nav replacement for the react-router-dom drill-through <Link>,
   * threaded down to each member row. Optional — unwired callers get a no-op.
   */
  onNavigate?: (to: string) => void;
}

export function NotificationGroupRow({
  group,
  ruleMap,
  vehicleMap,
  filters,
  selectedIds,
  onSelectionChange,
  onActivate,
  onArchive,
  onUnarchive,
  onMarkRead,
  onMarkUnread,
  archived,
  onNavigate,
}: NotificationGroupRowProps) {
  const {t} = useTranslation();
  const toast = useToast();
  const bulkMarkRead = useBulkMarkRead();
  const [expanded, setExpanded] = useState(false);
  const regionId = useId();

  const isSingleton = group.group_key == null;
  const extraCount = Math.max(0, group.count - 1);

  // Fetch members lazily on expand. Reuse parent filters so the expanded list
  // mirrors the same window — anything the group's `count` did NOT include
  // won't surface here either.
  const {
    data: members = [],
    isLoading: membersLoading,
    error: membersError,
  } = useGroupMembers(group.group_key ?? null, filters, {
    enabled: expanded && !isSingleton,
  });

  // Latest member is what the parent renders by default; the expanded list omits
  // it to avoid duplicating the same row above and below the chevron.
  const latest = group.latest;
  const latestRule = latest.alert_id != null ? ruleMap[latest.alert_id] : undefined;
  const latestVehicleId = latestRule?.vehicle_id ?? undefined;
  const latestVehicle =
    latestVehicleId != null ? vehicleMap[latestVehicleId] : undefined;

  const otherMembers = members.filter(m => m.id !== latest.id);

  const handleMarkGroupRead = useCallback(async () => {
    const gk = group.group_key;
    if (!gk) {
      return;
    }
    try {
      const res = await bulkMarkRead.mutateAsync({group_key: gk});
      toast.toast({
        type: 'success',
        title: t(
          'notifications.group.markReadSuccess',
          'Marked {{count}} thread members as read',
          {count: res.updated},
        ),
        duration: 4000,
      });
    } catch (e) {
      toast.error(
        t('notifications.group.markReadError', 'Could not mark group as read'),
        e instanceof Error ? e.message : undefined,
      );
    }
  }, [bulkMarkRead, group.group_key, toast, t]);

  // Selection is per-member. When the parent doesn't wire a handler we fall back
  // to a no-op so the checkbox simply renders unchecked and inert.
  const noopSelection = useCallback((_id: number, _on: boolean) => {
    // intentional fallback when the parent doesn't wire selection
  }, []);
  const rowSelectionHandler = onSelectionChange ?? noopSelection;
  const isMemberSelected = useCallback(
    (id: number) => (selectedIds ? selectedIds.has(id) : false),
    [selectedIds],
  );

  const expandLabel = expanded
    ? t('notifications.group.collapse', 'Hide similar')
    : t('notifications.group.expand', 'Show {{count}} similar', {
        count: extraCount,
      });

  return (
    <View style={styles.root} testID="notification-group-row">
      <View style={styles.headerRow}>
        <View style={styles.flex1}>
          <NotificationRow
            log={latest}
            rule={latestRule}
            vehicle={latestVehicle}
            selected={isMemberSelected(latest.id)}
            onSelectionChange={rowSelectionHandler}
            onActivate={onActivate}
            onArchive={onArchive}
            onUnarchive={onUnarchive}
            onMarkRead={onMarkRead}
            onMarkUnread={onMarkUnread}
            onNavigate={onNavigate}
          />
          {!isSingleton && (extraCount > 0 || group.unread_count > 1) ? (
            <View style={styles.chipRow}>
              {extraCount > 0 ? (
                <Pressable
                  accessibilityLabel={expandLabel}
                  accessibilityRole="button"
                  accessibilityState={{expanded}}
                  onPress={() => setExpanded(v => !v)}
                  style={({pressed}) => [
                    styles.expandChip,
                    pressed && styles.pressed,
                  ]}
                  testID="group-expand-toggle">
                  <AppText style={styles.expandGlyph}>
                    {expanded ? GLYPH.chevronDown : GLYPH.chevronRight}
                  </AppText>
                  <AppText style={styles.expandLabel} variant="caption">
                    {t('notifications.group.similar', '+{{count}} similar', {
                      count: extraCount,
                    })}
                  </AppText>
                </Pressable>
              ) : null}
              {group.unread_count > 0 ? (
                <View style={styles.unreadChip} testID="group-unread-count">
                  <AppText style={styles.unreadChipText} variant="caption">
                    {String(group.unread_count)}
                  </AppText>
                </View>
              ) : null}
              {group.vehicle_ids.length > 0 ? (
                <AppText
                  style={styles.vehicleCount}
                  testID="group-vehicle-count"
                  variant="caption">
                  {t(
                    'notifications.group.vehicleAffected',
                    '{{count}} vehicles affected',
                    {count: group.vehicle_ids.length},
                  )}
                </AppText>
              ) : null}
              {group.unread_count > 0 && !archived ? (
                <Pressable
                  accessibilityLabel={t('notifications.group.markRead', 'Mark group read')}
                  accessibilityRole="button"
                  accessibilityState={{disabled: bulkMarkRead.isPending}}
                  disabled={bulkMarkRead.isPending}
                  onPress={handleMarkGroupRead}
                  style={({pressed}) => [
                    styles.markReadBtn,
                    pressed && styles.pressed,
                    bulkMarkRead.isPending && styles.disabled,
                  ]}
                  testID="group-mark-read">
                  <AppText style={styles.markReadGlyph}>{GLYPH.mailOpen}</AppText>
                  <AppText style={styles.markReadLabel} variant="caption">
                    {t('notifications.group.markRead', 'Mark group read')}
                  </AppText>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
      </View>

      {expanded && !isSingleton ? (
        <View
          accessibilityLabel={t('notifications.group.collapse', 'Hide similar')}
          nativeID={regionId}
          style={styles.membersRegion}
          testID="group-members-region">
          {membersLoading ? (
            <View
              accessibilityLiveRegion="polite"
              accessibilityRole="text"
              style={styles.loadingRow}>
              <ActivityIndicator color={colors.textMuted} size="small" />
              <AppText style={styles.mutedText} variant="caption">
                {t('notifications.group.loadingMembers', 'Loading thread members…')}
              </AppText>
            </View>
          ) : null}
          {!membersLoading && membersError ? (
            <AppText
              accessibilityRole="alert"
              style={styles.errorText}
              testID="group-members-error"
              variant="caption">
              {t('notifications.group.membersError', 'Could not load thread members')}
            </AppText>
          ) : null}
          {!membersLoading && !membersError && otherMembers.length === 0 ? (
            <AppText style={styles.mutedText} variant="caption">
              {t('notifications.group.noMembers', 'No thread members found')}
            </AppText>
          ) : null}
          {!membersLoading && !membersError
            ? otherMembers.map(m => {
                const rule = m.alert_id != null ? ruleMap[m.alert_id] : undefined;
                const vehicle =
                  rule?.vehicle_id != null ? vehicleMap[rule.vehicle_id] : undefined;
                return (
                  <NotificationRow
                    key={m.id}
                    log={m}
                    onActivate={onActivate}
                    onArchive={onArchive}
                    onMarkRead={!m.read_at ? onMarkRead : undefined}
                    onMarkUnread={m.read_at ? onMarkUnread : undefined}
                    onNavigate={onNavigate}
                    onSelectionChange={rowSelectionHandler}
                    onUnarchive={onUnarchive}
                    rule={rule}
                    selected={isMemberSelected(m.id)}
                    vehicle={vehicle}
                  />
                );
              })
            : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    borderRadius: 8,
  },
  headerRow: {
    alignItems: 'stretch',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  flex1: {
    flex: 1,
    minWidth: 0,
  },
  chipRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  expandChip: {
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  expandGlyph: {
    color: colors.accent,
    fontSize: 12,
  },
  expandLabel: {
    color: colors.accent,
  },
  unreadChip: {
    backgroundColor: colors.warningSurface,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  unreadChipText: {
    color: colors.warning,
  },
  vehicleCount: {
    color: colors.textMuted,
  },
  markReadBtn: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    marginLeft: 'auto',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  markReadGlyph: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  markReadLabel: {
    color: colors.textSecondary,
  },
  membersRegion: {
    borderLeftColor: colors.border,
    borderLeftWidth: 2,
    gap: spacing.xs,
    marginLeft: spacing.md,
    marginTop: spacing.xs,
    paddingLeft: spacing.md,
  },
  loadingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  mutedText: {
    color: colors.textMuted,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  errorText: {
    color: colors.danger,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  // NotificationRow
  row: {
    alignItems: 'flex-start',
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  rowUnread: {
    backgroundColor: colors.surfaceRaised,
    borderLeftColor: colors.accent,
    borderLeftWidth: 2,
  },
  rowRead: {
    opacity: 0.9,
  },
  checkbox: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 4,
    borderWidth: 1,
    height: 16,
    justifyContent: 'center',
    marginTop: spacing.xs,
    width: 16,
  },
  checkboxChecked: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  checkboxGlyph: {
    color: colors.accent,
    fontSize: 11,
    lineHeight: 14,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  metaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  metaText: {
    color: colors.textMuted,
  },
  titleRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  title: {
    flexShrink: 1,
    fontSize: 14,
  },
  titleRead: {
    color: colors.textSecondary,
  },
  titleUnread: {
    color: colors.textPrimary,
  },
  message: {
    color: colors.textMuted,
    marginTop: 2,
  },
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: 6,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  iconGlyph: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  drillLink: {
    alignItems: 'center',
    borderRadius: 4,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  drillLabel: {
    color: colors.accent,
  },
  drillGlyph: {
    color: colors.accent,
    fontSize: 12,
  },
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.5,
  },
});
