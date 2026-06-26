// Native parity port of
// web/src/features/settings/components/ActiveSessionsSection.tsx.
//
// The web component renders the "Active sessions / device management" security
// primitive (mounted under <section id="security"> on the Settings page) with
// three render branches that are preserved verbatim here:
//
//   1. Loading  — a GlassPanel housing a Spinner + "Loading sessions…" body
//      text, rendered INSIDE the panel chrome so the layout doesn't reflow.
//   2. Open mode — backend AUTH_MODE_OPEN placeholder (amber IconBox +
//      AlertTriangle, panel heading, helper copy explaining forward-auth).
//   3. Forward-auth — a DataTable of sessions (device / ip / signed-in /
//      last-seen / per-row "Sign out") plus a footer "Sign out all other
//      devices" button. Both destructive actions go through a ConfirmDialog
//      with NO silenceKey — security prompts must never be silenceable.
//
// React-Native-safe substitutions (documented in the parity sidecar):
//   - `@/components/ui` GlassPanel -> the already-ported native GlassPanel.
//   - `@/components/ui` Button -> the already-ported native parity Button
//     (variant/size/loading/disabled/icon/onPress all carry over).
//   - `@/components/feedback` Spinner -> the already-ported native Spinner.
//   - `@/components/ui` IconBox (colored ring container) -> inline native
//     IconBox reproduction (cyan/amber tints from theme tokens).
//   - `@/components/ui` Badge (variant="success") -> inline native Badge
//     reproduction (success surface/border/text from theme tokens).
//   - `@/components/ui` DataTable (a browser <table> with virtualization,
//     column menus, CSV export) -> inline native header row + data rows inside
//     a horizontal ScrollView (same approach the FlagsTable port took); the
//     `Column<T>` shape (key/header/align/render) + keyExtractor + emptyMessage
//     are preserved. Cell renders that returned raw strings on web are wrapped
//     in AppText so RN can render them.
//   - `@/components/ui` ConfirmDialog (DOM Modal + Button, Escape/focus-trap,
//     silenceKey) -> inline native <Modal> reproduction with a loading state
//     (same in-file precedent the UserImpersonateButton port used); only the
//     props these call sites pass (open/title/message/confirm+cancel label/
//     variant=danger/loading/onConfirm/onCancel) are wired.
//   - `@/components/ui` Heading/HelperText/ErrorText/Text typography roles ->
//     AppText with matching size/tone (panelTitle 16/semibold/primary,
//     helper 12/muted, error 12/danger, bodySm 12/secondary).
//   - `@/components/motion` FadeIn (framer-motion entrance) -> inline native
//     Animated fade+slide-up that honours reduced motion.
//   - lucide-react Laptop/AlertTriangle/LogOut/ShieldAlert -> decorative
//     Unicode glyphs (the visible labels carry the meaning), the same
//     lucide -> glyph approach the FlagsTable/UserImpersonateButton ports took.
//   - react-i18next useTranslation -> a local t() shim that returns the English
//     fallback and resolves `{{token}}` interpolation, so every `sessions.*`
//     key + copy is preserved verbatim.
//   - `@/hooks/useDateFormat` (settings locale/tz-aware) -> a local
//     useDateFormat shim that formats with the device locale/timezone via Intl,
//     mirroring the web formatDateTime field set (year/month/day/hour/minute).
//   - `@/api/hooks/useSessions` (useSessions / useRevokeSession /
//     useRevokeAllOtherSessions) -> the already-ported native hooks; the
//     revoke toasts live inside those hooks (single source of truth), exactly
//     as on web, so this component renders no revoke error banner of its own.

import React, {
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, shadows, spacing} from '../../../../theme/tokens';
import {
  useRevokeAllOtherSessions,
  useRevokeSession,
  useSessions,
  type ActiveSession,
} from '../../../api/hooks/useSessions';
import {Spinner} from '../../../components/feedback/Spinner';
import {Button} from '../../../components/ui/Button';

/* ─── i18n fallback shim with `{{token}}` interpolation ────────────────────── */

type TranslationValues = Record<string, string | number>;

type NativeTFunction = (
  key: string,
  fallback: string,
  values?: TranslationValues,
) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallback, values) => {
    if (!values) {
      return fallback;
    }
    return fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
      const value = values[name];
      return value === undefined ? '' : String(value);
    });
  }, []);
}

/* ─── date formatter shim (web `@/hooks/useDateFormat` formatDateTime) ──────── */

// Mirrors the web libFormatDateTime field set; the web hook threads the user's
// settings locale + timezone, which is not ported to native, so this uses the
// device locale/timezone via Intl (documented in the parity sidecar).
const DATE_TIME_FORMAT: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
};

function formatDateTimeNative(value: string | Date | null | undefined): string {
  if (value == null || value === '') {
    return '—';
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return typeof value === 'string' ? value : '—';
  }
  try {
    return new Intl.DateTimeFormat(undefined, DATE_TIME_FORMAT).format(date);
  } catch {
    return date.toISOString();
  }
}

function useDateFormat() {
  return {formatDateTime: formatDateTimeNative};
}

/* ─── decorative lucide glyphs (label carries the meaning) ─────────────────── */

const LAPTOP_GLYPH = '\uD83D\uDCBB'; // 💻 lucide Laptop
const WARNING_GLYPH = '\u26A0'; // ⚠ lucide AlertTriangle
const LOGOUT_GLYPH = '\uD83D\uDEAA'; // 🚪 lucide LogOut
const SHIELD_GLYPH = '\uD83D\uDEE1\uFE0F'; // 🛡️ lucide ShieldAlert
const DANGER_GLYPH = '\uD83D\uDED1'; // 🛑 ConfirmDialog danger severity icon

/**
 * Heuristic device label derived from the User-Agent string. Carried over
 * verbatim from the web source: a tiny `match` ladder covers the major
 * browsers + OSes and falls back to the raw UA on misses so the user can
 * still identify the row.
 */
function describeDevice(userAgent: string): string {
  const ua = userAgent.trim();
  if (!ua) {
    return 'Unknown device';
  }

  let browser = 'Browser';
  if (/Edg\//.test(ua)) {
    browser = 'Edge';
  } else if (/OPR\/|Opera/.test(ua)) {
    browser = 'Opera';
  } else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) {
    browser = 'Chrome';
  } else if (/Chromium/.test(ua)) {
    browser = 'Chromium';
  } else if (/Firefox\//.test(ua)) {
    browser = 'Firefox';
  } else if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) {
    browser = 'Safari';
  }

  let os = 'Unknown OS';
  if (/Windows NT/.test(ua)) {
    os = 'Windows';
  } else if (/Mac OS X/.test(ua) || /Macintosh/.test(ua)) {
    os = 'macOS';
  } else if (/Android/.test(ua)) {
    os = 'Android';
  } else if (/iPhone|iPad|iPod/.test(ua)) {
    os = 'iOS';
  } else if (/Linux/.test(ua)) {
    os = 'Linux';
  }

  return `${browser} on ${os}`;
}

/* ─── FadeIn (web `@/components/motion` FadeIn) ─────────────────────────────── */

function FadeIn({
  children,
  delay = 0,
  style,
}: {
  children: ReactNode;
  delay?: number;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(12)).current;

  useEffect(() => {
    let cancelled = false;
    let animation: Animated.CompositeAnimation | undefined;

    AccessibilityInfo.isReduceMotionEnabled().then(reduce => {
      if (cancelled) {
        return;
      }
      if (reduce) {
        opacity.setValue(1);
        translateY.setValue(0);
        return;
      }
      animation = Animated.parallel([
        Animated.timing(opacity, {
          delay: delay * 1000,
          duration: 400,
          easing: Easing.out(Easing.ease),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          delay: delay * 1000,
          duration: 400,
          easing: Easing.out(Easing.ease),
          toValue: 0,
          useNativeDriver: true,
        }),
      ]);
      animation.start();
    });

    return () => {
      cancelled = true;
      animation?.stop();
    };
  }, [delay, opacity, translateY]);

  return (
    <Animated.View style={[{opacity, transform: [{translateY}]}, style]}>
      {children}
    </Animated.View>
  );
}

FadeIn.displayName = 'FadeIn';

/* ─── IconBox (web `@/components/ui` IconBox) ───────────────────────────────── */

function IconBox({
  color,
  glyph,
}: {
  color: 'cyan' | 'amber';
  glyph: string;
}): React.ReactElement {
  return (
    <View
      style={[styles.iconBox, color === 'amber' ? styles.iconBoxAmber : styles.iconBoxCyan]}>
      <AppText
        importantForAccessibility="no"
        style={[styles.iconGlyph, color === 'amber' ? styles.iconGlyphAmber : styles.iconGlyphCyan]}>
        {glyph}
      </AppText>
    </View>
  );
}

IconBox.displayName = 'IconBox';

/* ─── Badge (web `@/components/ui` Badge, variant="success") ────────────────── */

function Badge({
  children,
  testID,
}: {
  children: ReactNode;
  testID?: string;
}): React.ReactElement {
  return (
    <View style={styles.badge} testID={testID}>
      <AppText style={styles.badgeText} variant="caption" weight="semibold">
        {children}
      </AppText>
    </View>
  );
}

Badge.displayName = 'Badge';

/* ─── DataTable reproduction (web `@/components/ui` DataTable) ──────────────── */

interface Column<T> {
  key: string;
  header: string;
  align?: 'left' | 'center' | 'right';
  render: (row: T) => ReactNode;
}

const COLUMN_WIDTHS: Record<string, number> = {
  device: 220,
  ip: 140,
  createdAt: 184,
  lastSeenAt: 184,
  actions: 150,
};

const DEFAULT_WIDTH = 160;

function columnWidth(key: string): number {
  return COLUMN_WIDTHS[key] ?? DEFAULT_WIDTH;
}

function tableWidth(columns: {key: string}[]): number {
  return columns.reduce(
    (sum, column) => sum + columnWidth(column.key) + spacing.md,
    0,
  );
}

function SessionsTable<T>({
  columns,
  data,
  keyExtractor,
  emptyMessage,
  testID,
}: {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (row: T) => string;
  emptyMessage: string;
  testID?: string;
}): React.ReactElement {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} testID={testID}>
      <View style={styles.table}>
        <View style={styles.headerRow}>
          {columns.map(column => (
            <View
              key={column.key}
              style={[
                styles.headerCell,
                {width: columnWidth(column.key)},
                column.align === 'right' ? styles.cellRight : null,
              ]}>
              <AppText
                style={styles.headerText}
                tone="muted"
                variant="caption"
                weight="semibold">
                {column.header}
              </AppText>
            </View>
          ))}
        </View>

        {data.length === 0 ? (
          <View style={[styles.emptyRow, {width: tableWidth(columns)}]}>
            <AppText tone="muted" variant="caption">
              {emptyMessage}
            </AppText>
          </View>
        ) : (
          data.map(row => (
            <View key={keyExtractor(row)} style={styles.row}>
              {columns.map(column => (
                <View
                  key={column.key}
                  style={[
                    styles.cell,
                    {width: columnWidth(column.key)},
                    column.align === 'right' ? styles.cellRight : null,
                  ]}>
                  {column.render(row)}
                </View>
              ))}
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

SessionsTable.displayName = 'SessionsTable';

/* ─── ConfirmDialog (web `@/components/ui` ConfirmDialog) ───────────────────── */

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning';
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  testID?: string;
}

function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  loading = false,
  onConfirm,
  onCancel,
  testID,
}: ConfirmDialogProps): React.ReactElement {
  const isWarning = variant === 'warning';
  const handleCancel = loading ? undefined : onCancel;

  return (
    <Modal
      animationType="fade"
      onRequestClose={handleCancel}
      transparent
      visible={open}>
      <View
        accessibilityLabel={title}
        accessibilityRole="alert"
        accessible
        style={styles.overlay}>
        <Pressable
          accessibilityElementsHidden
          disabled={loading}
          importantForAccessibility="no-hide-descendants"
          onPress={handleCancel}
          style={styles.backdrop}
        />

        <View style={styles.dialog} testID={testID}>
          <AppText style={styles.dialogTitle} variant="title" weight="bold">
            {title}
          </AppText>

          <View
            style={[
              styles.messageBox,
              isWarning ? styles.warningBox : styles.dangerBox,
            ]}>
            <AppText
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[
                styles.messageIcon,
                isWarning ? styles.warningIcon : styles.dangerIcon,
              ]}>
              {isWarning ? WARNING_GLYPH : DANGER_GLYPH}
            </AppText>
            <AppText style={styles.messageText}>{message}</AppText>
          </View>

          <View style={styles.actionRow}>
            <Button disabled={loading} onPress={onCancel} variant="secondary">
              {cancelLabel}
            </Button>
            <Button
              loading={loading}
              onPress={onConfirm}
              variant={isWarning ? 'primary' : 'danger'}>
              {confirmLabel}
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  );
}

ConfirmDialog.displayName = 'ConfirmDialog';

/* ─── ActiveSessionsSection ────────────────────────────────────────────────── */

export function ActiveSessionsSection(): React.ReactElement {
  const t = useNativeTranslationFallback();
  const {formatDateTime: formatTimestamp} = useDateFormat();

  const sessions = useSessions();
  const revokeMut = useRevokeSession();
  const revokeAllOthersMut = useRevokeAllOtherSessions();

  // Local UI state for the two confirm dialogs. Kept as discrete bits rather
  // than a single discriminated union (the per-row confirm carries a session
  // reference while the all-others confirm doesn't).
  const [revokeTarget, setRevokeTarget] = React.useState<ActiveSession | null>(
    null,
  );
  const [showAllOthersConfirm, setShowAllOthersConfirm] = React.useState(false);

  // ── Loading / first paint ───────────────────────────────────────
  if (sessions.isLoading) {
    return (
      <FadeIn delay={0.05}>
        <GlassPanel style={styles.panelLoading} testID="active-sessions-loading">
          <Spinner />
          <AppText tone="secondary" variant="caption">
            {t('sessions.loading', 'Loading sessions…')}
          </AppText>
        </GlassPanel>
      </FadeIn>
    );
  }

  // ── Open mode placeholder ───────────────────────────────────────
  if (!sessions.data || sessions.data.mode === 'open') {
    return (
      <FadeIn delay={0.05}>
        <GlassPanel style={styles.panelOpen} testID="active-sessions-open-mode">
          <View style={styles.openHeader}>
            <IconBox color="amber" glyph={WARNING_GLYPH} />
            <AppText style={styles.panelTitle} weight="semibold">
              {t('sessions.openMode.title', 'Active sessions')}
            </AppText>
          </View>
          <AppText tone="muted" variant="caption">
            {t(
              'sessions.openMode.message',
              'Active session tracking requires forward-auth mode. Configure your reverse proxy to inject X-Forwarded-User then reload.',
            )}
          </AppText>
        </GlassPanel>
      </FadeIn>
    );
  }

  // ── Forward-auth: list + actions ───────────────────────────────
  const rows = sessions.data.sessions;
  const hasOthers = rows.some(r => !r.current);

  const columns: Column<ActiveSession>[] = [
    {
      key: 'device',
      header: t('sessions.columns.device', 'Device'),
      render: row => (
        <View style={styles.deviceCell}>
          <AppText style={styles.deviceName} variant="caption">
            {describeDevice(row.user_agent)}
          </AppText>
          {row.current ? (
            <Badge testID={`active-sessions-current-pill-${row.id}`}>
              {t('sessions.current', 'This device')}
            </Badge>
          ) : null}
        </View>
      ),
    },
    {
      key: 'ip',
      header: t('sessions.columns.ip', 'IP address'),
      render: row => (
        <AppText tone="secondary" variant="caption">
          {row.ip || '—'}
        </AppText>
      ),
    },
    {
      key: 'createdAt',
      header: t('sessions.columns.createdAt', 'Signed in'),
      render: row => (
        <AppText tone="secondary" variant="caption">
          {formatTimestamp(row.created_at)}
        </AppText>
      ),
    },
    {
      key: 'lastSeenAt',
      header: t('sessions.columns.lastSeenAt', 'Last seen'),
      render: row => (
        <AppText tone="secondary" variant="caption">
          {formatTimestamp(row.last_seen_at)}
        </AppText>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: row =>
        row.current ? null : (
          <Button
            accessibilityLabel={t('sessions.row.revokeAria', 'Sign out {{device}}', {
              device: describeDevice(row.user_agent),
            })}
            disabled={revokeMut.isPending && revokeMut.variables === row.id}
            icon={
              <AppText importantForAccessibility="no" style={styles.buttonGlyph}>
                {LOGOUT_GLYPH}
              </AppText>
            }
            onPress={() => setRevokeTarget(row)}
            size="sm"
            testID={`active-sessions-revoke-${row.id}`}
            variant="ghost">
            {t('sessions.row.revoke', 'Sign out')}
          </Button>
        ),
    },
  ];

  return (
    <>
      <FadeIn delay={0.05}>
        <GlassPanel style={styles.panel} testID="active-sessions-section">
          <View style={styles.panelHeader}>
            <View style={styles.panelHeaderLeft}>
              <IconBox color="cyan" glyph={LAPTOP_GLYPH} />
              <View style={styles.panelHeaderText}>
                <AppText style={styles.panelTitle} weight="semibold">
                  {t('sessions.title', 'Active sessions')}
                </AppText>
                <AppText style={styles.helperText} tone="muted" variant="caption">
                  {t(
                    'sessions.subtitle',
                    "Devices currently signed in to TeslaSync. Revoking a session signs that browser out on its next request — your upstream identity provider's session is unaffected.",
                  )}
                </AppText>
              </View>
            </View>
            {hasOthers ? (
              <Button
                disabled={revokeAllOthersMut.isPending}
                icon={
                  <AppText importantForAccessibility="no" style={styles.buttonGlyph}>
                    {SHIELD_GLYPH}
                  </AppText>
                }
                onPress={() => setShowAllOthersConfirm(true)}
                testID="active-sessions-revoke-all-others"
                variant="secondary">
                {revokeAllOthersMut.isPending
                  ? t('sessions.revokeAllOthersBusy', 'Signing out…')
                  : t('sessions.revokeAllOthers', 'Sign out all other devices')}
              </Button>
            ) : null}
          </View>

          {sessions.isError ? (
            <AppText
              accessibilityRole="alert"
              testID="active-sessions-error"
              tone="danger"
              variant="caption">
              {t('sessions.errors.load', 'Failed to load active sessions.')}
            </AppText>
          ) : null}

          <SessionsTable<ActiveSession>
            columns={columns}
            data={rows}
            emptyMessage={t(
              'sessions.empty',
              'No active sessions for this account.',
            )}
            keyExtractor={row => row.id}
            testID="settings-active-sessions"
          />
        </GlassPanel>
      </FadeIn>

      {/*
       * Per-row revoke confirm. NO silenceKey — security primitives must always
       * confirm. The upstream RequireSudo gate triggers the reauth flow when the
       * mutation fires.
       */}
      <ConfirmDialog
        cancelLabel={t('sessions.confirm.revokeCancel', 'Keep signed in')}
        confirmLabel={t('sessions.confirm.revokeConfirm', 'Sign out')}
        loading={revokeMut.isPending}
        message={t(
          'sessions.confirm.revokeMessage',
          '{{device}} will be signed out on its next request. Your other devices will stay signed in.',
          {
            device: revokeTarget ? describeDevice(revokeTarget.user_agent) : '',
          },
        )}
        onCancel={() => setRevokeTarget(null)}
        onConfirm={() => {
          if (!revokeTarget) {
            return;
          }
          const id = revokeTarget.id;
          revokeMut.mutate(id, {
            onSettled: () => setRevokeTarget(null),
          });
        }}
        open={revokeTarget != null}
        testID="active-sessions-revoke-confirm"
        title={t('sessions.confirm.revokeTitle', 'Sign out this device?')}
        variant="danger"
      />

      {/*
       * "Sign out all other devices" confirm. Same NO-silenceKey rule. The
       * all-others mutation excludes the current session automatically based on
       * the inbound cookie, so the user doesn't lock themselves out of this tab.
       */}
      <ConfirmDialog
        cancelLabel={t('sessions.confirm.allOthersCancel', 'Cancel')}
        confirmLabel={t('sessions.confirm.allOthersConfirm', 'Sign out all others')}
        loading={revokeAllOthersMut.isPending}
        message={t(
          'sessions.confirm.allOthersMessage',
          'Every browser other than this one will be signed out on its next request. You can sign back in immediately.',
        )}
        onCancel={() => setShowAllOthersConfirm(false)}
        onConfirm={() => {
          revokeAllOthersMut.mutate(undefined, {
            onSettled: () => setShowAllOthersConfirm(false),
          });
        }}
        open={showAllOthersConfirm}
        testID="active-sessions-all-others-confirm"
        title={t('sessions.confirm.allOthersTitle', 'Sign out all other devices?')}
        variant="danger"
      />
    </>
  );
}

ActiveSessionsSection.displayName = 'ActiveSessionsSection';

export default ActiveSessionsSection;

/* ─── styles ────────────────────────────────────────────────────────────────── */

// Toned-down danger severity tints for the ConfirmDialog message box, preserved
// as literals (the web ConfirmDialog danger severity maps to red-500 surface/
// border with a red-300 icon).
const RED_300 = '#fca5a5';
const RED_500_SURFACE = 'rgba(239, 68, 68, 0.1)';
const RED_500_BORDER = 'rgba(239, 68, 68, 0.3)';
const AMBER_300 = '#fcd34d';
const AMBER_500_SURFACE = 'rgba(245, 158, 11, 0.1)';
const AMBER_500_BORDER = 'rgba(245, 158, 11, 0.3)';

const styles = StyleSheet.create({
  actionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: {
    color: colors.success,
  },
  buttonGlyph: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 16,
  },
  cell: {
    justifyContent: 'center',
    paddingRight: spacing.md,
  },
  cellRight: {
    alignItems: 'flex-end',
  },
  dangerBox: {
    backgroundColor: RED_500_SURFACE,
    borderColor: RED_500_BORDER,
  },
  dangerIcon: {
    color: RED_300,
  },
  deviceCell: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  deviceName: {
    color: colors.textPrimary,
  },
  dialog: {
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderAccent,
    borderRadius: 24,
    borderWidth: 1,
    gap: spacing.lg,
    margin: spacing.lg,
    maxWidth: 480,
    padding: spacing.lg,
    width: '92%',
    ...shadows.panel,
  },
  dialogTitle: {
    color: colors.textPrimary,
  },
  emptyRow: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  headerCell: {
    justifyContent: 'center',
    paddingRight: spacing.md,
  },
  headerRow: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    paddingBottom: spacing.sm,
  },
  headerText: {
    letterSpacing: 0.3,
  },
  helperText: {
    marginTop: 2,
  },
  iconBox: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  iconBoxAmber: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
  iconBoxCyan: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  iconGlyph: {
    fontSize: 18,
    lineHeight: 22,
  },
  iconGlyphAmber: {
    color: colors.warning,
  },
  iconGlyphCyan: {
    color: colors.accent,
  },
  messageBox: {
    alignItems: 'flex-start',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  messageIcon: {
    fontSize: 18,
    lineHeight: 22,
    marginTop: 1,
  },
  messageText: {
    color: colors.textPrimary,
    flex: 1,
  },
  openHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    flex: 1,
    justifyContent: 'center',
  },
  panel: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  panelHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  panelHeaderLeft: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: spacing.md,
    minWidth: 220,
  },
  panelHeaderText: {
    flex: 1,
  },
  panelLoading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
  },
  panelOpen: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  panelTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 22,
  },
  row: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    paddingVertical: spacing.sm,
  },
  table: {
    flexDirection: 'column',
  },
  warningBox: {
    backgroundColor: AMBER_500_SURFACE,
    borderColor: AMBER_500_BORDER,
  },
  warningIcon: {
    color: AMBER_300,
  },
});
