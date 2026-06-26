// Native parity port of web/src/features/vehicles/pages/VehicleAccessPage.tsx.
//
// VehicleAccessPage manages shared access to a single vehicle: a "Drivers"
// section (the Tesla-synced driver list, with a Refresh action and a per-row
// Remove affordance) and a "Share Invitations" section (pending/revoked share
// invites, with Refresh + "Invite Driver" actions and per-row Copy-link /
// Revoke affordances). Two danger ConfirmDialogs gate the destructive
// remove-driver and revoke-invitation flows.
//
// The web original composes the shared DOM page kit (PageContainer, GlassPanel,
// Button, Badge, CopyButton, DataTable + Column, ConfirmDialog), the
// data-display kit (StatusBadge, TimeStamp), feedback EmptyState, framer-motion
// FadeIn, usePageTitle, react-router useParams, react-i18next, and lucide SVG
// icons (RefreshCw, UserPlus, UserMinus, XCircle, Users, Mail, Shield). React
// Native has no DOM, no Tailwind, no lucide SVGs, no framer-motion, no
// react-router, no wired react-i18next, and no browser document.title, so this
// port reproduces the same behaviour with RN primitives + the established
// native parity building blocks and documents every adaptation in the sidecar:
//
//   - useParams<{id}>().id has no native router. The `vehicleId` name is
//     preserved: it comes from an optional `vehicleId` prop (the route param a
//     navigator would pass) and falls back to the first useVehicles() vehicle so
//     the page renders standalone (the DrivetrainHealthPage idiom). useVehicle
//     keeps its exact `useVehicle(vehicleId ?? '')` call; the breadcrumb label
//     value `vehicle?.display_name ?? `Vehicle #${vehicleId}`` is surfaced as a
//     header caption (native has no breadcrumb slot).
//   - PageContainer (title/subtitle + a `loading` gate that swaps the body for a
//     centered spinner) -> an inline ScrollView scaffold: a persistent header
//     (title + subtitle + vehicle caption) and a body that, exactly like the web
//     PageContainer, renders the sections only when `loading` is false and
//     otherwise shows a centered ActivityIndicator. usePageTitle(t('…title'))
//     sets the browser tab title (no native analogue) so the same translated
//     string is surfaced as the on-screen header.
//   - GlassPanel -> the shared native GlassPanel (data-tour="vehicle-access"
//     becomes testID on the drivers panel).
//   - Button (primary/ghost, sm, lucide icon, loading, aria-label) -> native
//     Pressable buttons preserving variant/loading/disabled; lucide glyphs map
//     to text (RefreshCw ↻, UserPlus +, UserMinus ⊖, XCircle ⊘).
//   - Badge variant="info" (role) / "neutral" (counts) -> inline pills.
//   - CopyButton (ghost iconOnly withToast) -> an inline native-safe copy
//     Pressable using the same navigator.clipboard strategy as MaskedValue
//     (reports "unavailable" when no clipboard is bundled) with a ⧉ -> ✓ toast
//     glyph swap.
//   - DataTable + Column (compact) -> a native table (header row + data rows)
//     driven by the SAME column definitions (key/header/render) the web builds
//     in useMemo, preserving every cell renderer and the keyExtractor.
//   - StatusBadge status={pending?'online':revoked?'offline':'asleep'} -> an
//     inline dot+label badge reproducing the web FSM badge-dot colours
//     (online=green, offline=red, asleep=purple) and the capitalised status
//     label, with the exact pending/revoked/else mapping preserved.
//   - TimeStamp value={expires_at} (format "auto") -> an inline timestamp:
//     "auto" resolves to the user's settings.time_format_default ('relative'
//     fallback, exactly like useTimeFormatPreference) and the formatRelative /
//     formatDateTime helpers are inlined verbatim from @/lib/dateFormat; the
//     hover tooltip (alternate format) has no native analogue and is dropped.
//   - EmptyState (icon + message) -> an inline icon+message block (the native
//     shared EmptyState requires a title the web variant does not supply), with
//     the lucide Users/Shield icons mapped to SemanticIcon users/security.
//   - ConfirmDialog (danger; default cancelLabel 'Cancel') -> an inline RN Modal
//     confirm dialog preserving title/message/confirmLabel/variant and the
//     onConfirm/onCancel + backdrop-close gating.
//   - FadeIn / FadeIn delay={0.05} (framer-motion) -> plain Views.
//   - react-i18next useTranslation -> a native key/English-default `t` that
//     keeps every vehicleAccess.* key + default verbatim (no interpolation vars
//     are used on this page).
//
// State names (removeTarget, revokeTarget, vehicleId), every hook
// (useVehicleDrivers/useVehicleInvitations/useRefreshVehicleDrivers/
// useRefreshVehicleInvitations/useRemoveVehicleDriver/useCreateVehicleInvitation/
// useRevokeVehicleInvitation/useVehicle), the handleRemoveDriver /
// handleRevokeInvitation guards + mutate shapes ({vehicleId, shareUserId} with
// onSettled, {vehicleId, invitationId} with onSettled), the driversList /
// invitationsList ?? [] fallbacks, the isLoading = driversLoading ||
// invitationsLoading gate, and every VehicleDriver / VehicleInvitation field
// read are preserved verbatim. All API paths are unchanged because the
// unmodified native useVehicleAccess hooks are reused. No DOM, Recharts, Leaflet,
// framer-motion, react-router, lucide-react, or old web UI components are
// imported.

import React, {useCallback, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {SemanticIcon} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, shadows, spacing} from '../../../../theme/tokens';
import {useSettings} from '../../../api/hooks/useSettings';
import {
  useCreateVehicleInvitation,
  useRefreshVehicleDrivers,
  useRefreshVehicleInvitations,
  useRemoveVehicleDriver,
  useRevokeVehicleInvitation,
  useVehicleDrivers,
  useVehicleInvitations,
  type VehicleDriver,
  type VehicleInvitation,
} from '../../../api/hooks/useVehicleAccess';
import {useVehicle, useVehicles} from '../../../api/hooks/useVehicles';

/* ─── i18n fallback ───────────────────────────────────────────────────── */

// react-i18next is not wired in native; i18next returns the supplied default
// when a translation is missing, so this fallback returns the English default
// while keeping every vehicleAccess.* key verbatim. The page passes no
// interpolation vars, so a plain key/default resolver is sufficient.
type TFunc = (key: string, fallback: string) => string;

const t: TFunc = (_key, fallback) => fallback;

/* ─── Inlined date formatters (web @/lib/dateFormat) ──────────────────── */

const FALLBACK = '\u2014'; // — universal missing-value placeholder

// web formatDate — "Apr 4, 2026" (host locale/timezone), — on nullish/NaN.
function formatDate(value: string | number | Date | null | undefined): string {
  if (!value) {
    return FALLBACK;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return FALLBACK;
  }
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// web formatDateTime — "Apr 4, 2026, 2:30 AM", — on nullish/NaN.
function formatDateTime(
  value: string | number | Date | null | undefined,
): string {
  if (!value) {
    return FALLBACK;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return FALLBACK;
  }
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// web formatRelative — just now / Nm ago / Nh ago / Nd ago, absolute date >7d,
// — on nullish/NaN. Negative diffs (future timestamps) fall under `seconds < 60`
// and render "just now", matching the web helper verbatim.
function formatRelative(
  value: string | number | Date | null | undefined,
): string {
  if (!value) {
    return FALLBACK;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return FALLBACK;
  }
  const diff = Date.now() - d.getTime();
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
  if (days < 7) {
    return `${days}d ago`;
  }
  return formatDate(value);
}

/* ─── Glyphs (lucide → text) ──────────────────────────────────────────── */

const REFRESH_GLYPH = '\u21BB'; // ↻ — lucide RefreshCw
const INVITE_GLYPH = '+'; // lucide UserPlus
const REMOVE_GLYPH = '\u2296'; // ⊖ — lucide UserMinus (remove driver)
const REVOKE_GLYPH = '\u2298'; // ⊘ — lucide XCircle (revoke invitation)
const COPY_GLYPH = '\u29C9'; // ⧉ — lucide CopyButton
const COPIED_GLYPH = '\u2713'; // ✓ — copied confirmation (withToast parity)

/* ─── Native-safe clipboard (shared with MaskedValue's strategy) ──────── */

type CopyState = 'idle' | 'copied' | 'unavailable';

// Uses navigator.clipboard.writeText when present (react-native-web); on
// iOS/Android (no bundled clipboard module yet) reports "unavailable" so the
// CopyButton surfaces an explicit degraded state rather than silently
// "succeeding".
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

/* ─── Generic table column + renderer (web DataTable + Column) ─────────── */

interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  flex?: number;
  width?: number;
  align?: 'center';
}

function cellStyle<T>(col: Column<T>): StyleProp<ViewStyle> {
  return [
    styles.cell,
    col.width != null ? {width: col.width, flexGrow: 0} : {flex: col.flex ?? 1},
    col.align === 'center' ? styles.cellCenter : null,
  ];
}

function DataTable<T>({
  columns,
  data,
  keyExtractor,
  rowTestID,
  testID,
}: {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (row: T) => string;
  rowTestID?: (row: T) => string;
  testID?: string;
}) {
  return (
    <View style={styles.table} testID={testID}>
      <View style={styles.tableHeaderRow}>
        {columns.map(col => (
          <View key={col.key} style={cellStyle(col)}>
            {col.header ? (
              <AppText style={styles.headerCellText} variant="caption">
                {col.header}
              </AppText>
            ) : null}
          </View>
        ))}
      </View>
      {data.map(row => (
        <View
          key={keyExtractor(row)}
          style={styles.tableRow}
          testID={rowTestID?.(row)}>
          {columns.map(col => (
            <View key={col.key} style={cellStyle(col)}>
              {col.render(row)}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

/* ─── Cell badges (web Badge / StatusBadge) ───────────────────────────── */

// web Badge variant="info" (role) — blue chip.
function RoleBadge({label}: {label: string}) {
  return (
    <View style={[styles.badge, styles.badgeInfo]}>
      <AppText style={[styles.badgeText, styles.badgeInfoText]} variant="caption">
        {label}
      </AppText>
    </View>
  );
}

// web Badge variant="neutral" (section counts) — gray chip.
function CountBadge({count}: {count: number}) {
  return (
    <View style={[styles.badge, styles.badgeNeutral]}>
      <AppText style={styles.badgeText} variant="caption">
        {count}
      </AppText>
    </View>
  );
}

// web StatusBadge — reproduces getStateDefinition('vehicle', status).badgeDot
// (online=bg-green-400, offline=bg-red-400, asleep=bg-purple-500) + the
// capitalised status text. The invitation status is mapped exactly as the
// source: pending -> online, revoked -> offline, else -> asleep.
function InvitationStatusBadge({status}: {status: string}) {
  const mapped =
    status === 'pending' ? 'online' : status === 'revoked' ? 'offline' : 'asleep';
  const dotColor =
    mapped === 'online'
      ? colors.success
      : mapped === 'offline'
      ? colors.danger
      : colors.violet;
  const label = `${mapped.charAt(0).toUpperCase()}${mapped.slice(1)}`;
  return (
    <View style={styles.statusBadge}>
      <View style={[styles.statusDot, {backgroundColor: dotColor}]} />
      <AppText style={styles.statusLabel} tone="secondary" variant="caption">
        {label}
      </AppText>
    </View>
  );
}

// web TimeStamp value={expires_at} (format "auto"). "auto" resolves to the
// user's time_format_default preference ('relative' fallback). The web hover
// tooltip (alternate format) has no native analogue and is dropped.
function TimeStampText({
  value,
  pref,
}: {
  value: string | number | Date | null | undefined;
  pref: 'relative' | 'absolute';
}) {
  if (value == null) {
    return <AppText style={styles.cellMuted}>{FALLBACK}</AppText>;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return <AppText style={styles.cellMuted}>{FALLBACK}</AppText>;
  }
  const primary = pref === 'relative' ? formatRelative(value) : formatDateTime(value);
  return (
    <AppText style={styles.cellSecondary} variant="caption">
      {primary}
    </AppText>
  );
}

/* ─── Buttons (web Button) ────────────────────────────────────────────── */

// web Button (primary / ghost, sm) with an optional leading lucide glyph,
// `loading` spinner and accessibility label.
function ActionButton({
  glyph,
  label,
  loading = false,
  onPress,
  testID,
  variant,
}: {
  glyph: string;
  label: string;
  loading?: boolean;
  onPress: () => void;
  testID?: string;
  variant: 'primary' | 'ghost';
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{busy: loading, disabled: loading}}
      disabled={loading}
      onPress={onPress}
      style={({pressed}) => [
        styles.actionButton,
        variant === 'primary' ? styles.actionPrimary : styles.actionGhost,
        loading && styles.buttonDisabled,
        pressed && !loading && styles.buttonPressed,
      ]}
      testID={testID}>
      {loading ? (
        <ActivityIndicator
          color={variant === 'primary' ? colors.background : colors.textPrimary}
          size="small"
        />
      ) : (
        <>
          <AppText
            style={[
              styles.actionGlyph,
              variant === 'primary'
                ? styles.actionPrimaryText
                : styles.actionGhostText,
            ]}>
            {glyph}
          </AppText>
          <AppText
            style={
              variant === 'primary'
                ? styles.actionPrimaryText
                : styles.actionGhostText
            }
            weight="semibold">
            {label}
          </AppText>
        </>
      )}
    </Pressable>
  );
}

// web Button variant="ghost" size="sm" iconOnly — the per-row remove/revoke
// danger affordance.
function IconGhostButton({
  glyph,
  label,
  onPress,
  testID,
}: {
  glyph: string;
  label: string;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={6}
      onPress={onPress}
      style={({pressed}) => [styles.iconGhost, pressed && styles.buttonPressed]}
      testID={testID}>
      <AppText style={styles.iconGhostGlyph}>{glyph}</AppText>
    </Pressable>
  );
}

// web CopyButton (ghost, iconOnly, withToast) for the invite link.
function CopyLinkButton({
  label,
  testID,
  text,
}: {
  label: string;
  testID?: string;
  text: string;
}) {
  const [copyState, setCopyState] = useState<CopyState>('idle');

  const handleCopy = useCallback(async () => {
    const outcome = await writeClipboard(text);
    setCopyState(outcome);
  }, [text]);

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={6}
      onPress={handleCopy}
      style={({pressed}) => [styles.copyButton, pressed && styles.buttonPressed]}
      testID={testID}>
      <AppText
        style={[
          styles.copyGlyph,
          copyState === 'copied' && styles.copyGlyphCopied,
          copyState === 'unavailable' && styles.copyGlyphUnavailable,
        ]}>
        {copyState === 'copied' ? COPIED_GLYPH : COPY_GLYPH}
      </AppText>
    </Pressable>
  );
}

/* ─── Section header + empty (web GlassPanel header / EmptyState) ──────── */

function SectionHeader({
  actions,
  count,
  icon,
  title,
}: {
  actions: React.ReactNode;
  count: number;
  icon: 'users' | 'send';
  title: string;
}) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionTitleGroup}>
        <SemanticIcon decorative name={icon} size="sm" />
        <AppText style={styles.sectionTitle} weight="semibold">
          {title}
        </AppText>
        {count > 0 ? <CountBadge count={count} /> : null}
      </View>
      <View style={styles.sectionActions}>{actions}</View>
    </View>
  );
}

// web EmptyState icon + message. The shared native EmptyState requires a title
// the web variant does not supply, so an inline icon+message block stands in.
function EmptySection({
  icon,
  message,
  testID,
}: {
  icon: 'users' | 'security';
  message: string;
  testID?: string;
}) {
  return (
    <View style={styles.empty} testID={testID}>
      {/* no-action: transient empty state — surfaces when source data is
          missing; no specific recovery action available. */}
      <SemanticIcon decorative name={icon} size="lg" />
      <AppText style={styles.emptyText} tone="muted">
        {message}
      </AppText>
    </View>
  );
}

/* ─── ConfirmDialog (web ui ConfirmDialog, variant="danger") ──────────── */

function ConfirmDialog({
  confirmLabel,
  message,
  onCancel,
  onConfirm,
  open,
  testID,
  title,
}: {
  confirmLabel: string;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
  testID?: string;
  title: string;
}) {
  return (
    <Modal
      animationType="fade"
      onRequestClose={onCancel}
      transparent
      visible={open}>
      <View style={styles.overlay}>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={onCancel}
          style={styles.backdrop}
        />
        <View style={styles.dialog} testID={testID}>
          <AppText style={styles.dialogTitle} variant="title" weight="bold">
            {title}
          </AppText>
          <AppText style={styles.dialogMessage} tone="secondary">
            {message}
          </AppText>
          <View style={styles.dialogActions}>
            <Pressable
              accessibilityLabel={t('common.cancel', 'Cancel')}
              accessibilityRole="button"
              onPress={onCancel}
              style={({pressed}) => [
                styles.actionButton,
                styles.actionGhost,
                pressed && styles.buttonPressed,
              ]}
              testID={testID ? `${testID}-cancel` : undefined}>
              <AppText style={styles.actionGhostText} weight="semibold">
                {t('common.cancel', 'Cancel')}
              </AppText>
            </Pressable>
            <Pressable
              accessibilityLabel={confirmLabel}
              accessibilityRole="button"
              onPress={onConfirm}
              style={({pressed}) => [
                styles.actionButton,
                styles.actionDanger,
                pressed && styles.buttonPressed,
              ]}
              testID={testID ? `${testID}-confirm` : undefined}>
              <AppText style={styles.actionDangerText} weight="semibold">
                {confirmLabel}
              </AppText>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/* ─── Page component ──────────────────────────────────────────────────── */

interface VehicleAccessPageProps {
  vehicleId?: string;
}

export default function VehicleAccessPage({
  vehicleId: vehicleIdProp,
}: VehicleAccessPageProps = {}) {
  // useParams<{id}>().id has no native router; preserve `vehicleId` from the
  // optional route prop, falling back to the first vehicle so the page renders
  // standalone (the DrivetrainHealthPage idiom).
  const {data: vehicles} = useVehicles();
  const vehicleId =
    vehicleIdProp ??
    (vehicles && vehicles.length > 0 ? String(vehicles[0].id) : undefined);

  // usePageTitle(t('vehicleAccess.title')) sets document.title on web; surfaced
  // as the on-screen header here.

  const {data: vehicle} = useVehicle(vehicleId ?? '');

  const {data: drivers, isLoading: driversLoading} =
    useVehicleDrivers(vehicleId);
  const {data: invitations, isLoading: invitationsLoading} =
    useVehicleInvitations(vehicleId);

  const refreshDrivers = useRefreshVehicleDrivers();
  const refreshInvitations = useRefreshVehicleInvitations();
  const removeDriver = useRemoveVehicleDriver();
  const createInvitation = useCreateVehicleInvitation();
  const revokeInvitation = useRevokeVehicleInvitation();

  const [removeTarget, setRemoveTarget] = useState<VehicleDriver | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<VehicleInvitation | null>(
    null,
  );

  const isLoading = driversLoading || invitationsLoading;

  // web TimeStamp "auto" honours settings.time_format_default ('relative'
  // fallback, exactly like useTimeFormatPreference).
  const {data: settings} = useSettings();
  const timePref: 'relative' | 'absolute' =
    settings?.time_format_default === 'absolute' ? 'absolute' : 'relative';

  const handleRemoveDriver = useCallback(() => {
    if (!removeTarget?.share_user_id || !vehicleId) {
      return;
    }
    removeDriver.mutate(
      {vehicleId, shareUserId: removeTarget.share_user_id},
      {onSettled: () => setRemoveTarget(null)},
    );
  }, [removeTarget, vehicleId, removeDriver]);

  const handleRevokeInvitation = useCallback(() => {
    if (!revokeTarget || !vehicleId) {
      return;
    }
    revokeInvitation.mutate(
      {vehicleId, invitationId: revokeTarget.invitation_id},
      {onSettled: () => setRevokeTarget(null)},
    );
  }, [revokeTarget, vehicleId, revokeInvitation]);

  const driversList = drivers ?? [];
  const invitationsList = invitations ?? [];

  // ── Driver columns ──────────────────────────────────────────────

  const driverColumns: Column<VehicleDriver>[] = useMemo(
    () => [
      {
        key: 'name',
        header: t('vehicleAccess.drivers.name', 'Name'),
        flex: 2,
        render: row => (
          <AppText style={styles.cellPrimary} weight="semibold">
            {row.driver_name ?? FALLBACK}
          </AppText>
        ),
      },
      {
        key: 'email',
        header: t('vehicleAccess.drivers.email', 'Email'),
        flex: 2.4,
        render: row => (
          <AppText numberOfLines={1} style={styles.cellSecondary} variant="caption">
            {row.driver_email ?? FALLBACK}
          </AppText>
        ),
      },
      {
        key: 'role',
        header: t('vehicleAccess.drivers.role', 'Role'),
        flex: 1.3,
        render: row =>
          row.role ? (
            <RoleBadge label={row.role} />
          ) : (
            <AppText style={styles.cellMuted}>{FALLBACK}</AppText>
          ),
      },
      {
        key: 'actions',
        header: '',
        width: 44,
        align: 'center',
        render: row =>
          row.share_user_id != null ? (
            <IconGhostButton
              glyph={REMOVE_GLYPH}
              label={t('vehicleAccess.drivers.remove', 'Remove driver')}
              onPress={() => setRemoveTarget(row)}
              testID={`vehicle-access-driver-remove-${row.id}`}
            />
          ) : null,
      },
    ],
    [],
  );

  // ── Invitation columns ──────────────────────────────────────────

  const invitationColumns: Column<VehicleInvitation>[] = useMemo(
    () => [
      {
        key: 'status',
        header: t('vehicleAccess.invitations.status', 'Status'),
        flex: 1.4,
        render: row => <InvitationStatusBadge status={row.status} />,
      },
      {
        key: 'createdBy',
        header: t('vehicleAccess.invitations.createdBy', 'Created By'),
        flex: 1.6,
        render: row => (
          <AppText numberOfLines={1} style={styles.cellSecondary} variant="caption">
            {row.created_by ?? FALLBACK}
          </AppText>
        ),
      },
      {
        key: 'expires',
        header: t('vehicleAccess.invitations.expires', 'Expires'),
        flex: 1.6,
        render: row => <TimeStampText pref={timePref} value={row.expires_at} />,
      },
      {
        key: 'link',
        header: t('vehicleAccess.invitations.link', 'Link'),
        width: 44,
        align: 'center',
        render: row =>
          row.invite_url ? (
            <CopyLinkButton
              label={t('vehicleAccess.invitations.copyLink', 'Copy invite link')}
              testID={`vehicle-access-invitation-copy-${row.id}`}
              text={row.invite_url}
            />
          ) : (
            <AppText style={styles.cellMuted}>{FALLBACK}</AppText>
          ),
      },
      {
        key: 'actions',
        header: '',
        width: 44,
        align: 'center',
        render: row =>
          row.status === 'pending' ? (
            <IconGhostButton
              glyph={REVOKE_GLYPH}
              label={t('vehicleAccess.invitations.revoke', 'Revoke invitation')}
              onPress={() => setRevokeTarget(row)}
              testID={`vehicle-access-invitation-revoke-${row.id}`}
            />
          ) : null,
      },
    ],
    [timePref],
  );

  const vehicleLabel =
    vehicle?.display_name ?? `Vehicle #${vehicleId ?? FALLBACK}`;

  return (
    <View style={styles.page} testID="vehicle-access-page">
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        style={styles.scroll}>
        {/* ── Header (PageContainer title / subtitle + breadcrumb) ── */}
        <View style={styles.header}>
          <AppText accessibilityRole="header" style={styles.pageTitle}>
            {t('vehicleAccess.title', 'Vehicle Access')}
          </AppText>
          <AppText style={styles.pageSubtitle} tone="muted">
            {t('vehicleAccess.subtitle', 'Manage drivers and share invitations')}
          </AppText>
          {vehicleId ? (
            <AppText style={styles.pageBreadcrumb} tone="muted" variant="caption">
              {vehicleLabel}
            </AppText>
          ) : null}
        </View>

        {/* ── Body: PageContainer renders children only when not loading ── */}
        {isLoading ? (
          <View style={styles.loading} testID="vehicle-access-loading">
            <ActivityIndicator color={colors.accent} size="large" />
          </View>
        ) : (
          <View style={styles.body}>
            {/* ── Drivers Section ───────────────────────────────── */}
            <GlassPanel style={styles.panel} testID="vehicle-access-drivers">
              <SectionHeader
                actions={
                  <ActionButton
                    glyph={REFRESH_GLYPH}
                    label={t('vehicleAccess.refresh', 'Refresh')}
                    loading={refreshDrivers.isPending}
                    onPress={() =>
                      vehicleId && refreshDrivers.mutate(vehicleId)
                    }
                    testID="vehicle-access-drivers-refresh"
                    variant="ghost"
                  />
                }
                count={driversList.length}
                icon="users"
                title={t('vehicleAccess.drivers.title', 'Drivers')}
              />
              {driversList.length > 0 ? (
                <DataTable
                  columns={driverColumns}
                  data={driversList}
                  keyExtractor={row => String(row.id)}
                  rowTestID={row => `vehicle-access-driver-row-${row.id}`}
                  testID="vehicle-access-drivers-table"
                />
              ) : (
                <EmptySection
                  icon="users"
                  message={t(
                    'vehicleAccess.drivers.empty',
                    'No drivers found. Refresh to sync from Tesla.',
                  )}
                  testID="vehicle-access-drivers-empty"
                />
              )}
            </GlassPanel>

            {/* ── Invitations Section ───────────────────────────── */}
            <GlassPanel style={styles.panel} testID="vehicle-access-invitations">
              <SectionHeader
                actions={
                  <>
                    <ActionButton
                      glyph={REFRESH_GLYPH}
                      label={t('vehicleAccess.refresh', 'Refresh')}
                      loading={refreshInvitations.isPending}
                      onPress={() =>
                        vehicleId && refreshInvitations.mutate(vehicleId)
                      }
                      testID="vehicle-access-invitations-refresh"
                      variant="ghost"
                    />
                    <ActionButton
                      glyph={INVITE_GLYPH}
                      label={t(
                        'vehicleAccess.invitations.createBtn',
                        'Invite Driver',
                      )}
                      loading={createInvitation.isPending}
                      onPress={() =>
                        vehicleId && createInvitation.mutate(vehicleId)
                      }
                      testID="vehicle-access-invitations-create"
                      variant="primary"
                    />
                  </>
                }
                count={invitationsList.length}
                icon="send"
                title={t(
                  'vehicleAccess.invitations.title',
                  'Share Invitations',
                )}
              />
              {invitationsList.length > 0 ? (
                <DataTable
                  columns={invitationColumns}
                  data={invitationsList}
                  keyExtractor={row => String(row.id)}
                  rowTestID={row => `vehicle-access-invitation-row-${row.id}`}
                  testID="vehicle-access-invitations-table"
                />
              ) : (
                <EmptySection
                  icon="security"
                  message={t(
                    'vehicleAccess.invitations.empty',
                    'No invitations yet. Create one to share vehicle access.',
                  )}
                  testID="vehicle-access-invitations-empty"
                />
              )}
            </GlassPanel>
          </View>
        )}
      </ScrollView>

      {/* ── Confirm Dialogs ───────────────────────────────────── */}
      <ConfirmDialog
        confirmLabel={t('vehicleAccess.drivers.removeConfirm', 'Remove')}
        message={t(
          'vehicleAccess.drivers.removeMessage',
          "Are you sure you want to remove this driver's access? This action cannot be undone.",
        )}
        onCancel={() => setRemoveTarget(null)}
        onConfirm={handleRemoveDriver}
        open={removeTarget !== null}
        testID="vehicle-access-remove-dialog"
        title={t('vehicleAccess.drivers.removeTitle', 'Remove Driver')}
      />
      <ConfirmDialog
        confirmLabel={t('vehicleAccess.invitations.revokeConfirm', 'Revoke')}
        message={t(
          'vehicleAccess.invitations.revokeMessage',
          'Are you sure you want to revoke this invitation? The invite link will no longer work.',
        )}
        onCancel={() => setRevokeTarget(null)}
        onConfirm={handleRevokeInvitation}
        open={revokeTarget !== null}
        testID="vehicle-access-revoke-dialog"
        title={t('vehicleAccess.invitations.revokeTitle', 'Revoke Invitation')}
      />
    </View>
  );
}

VehicleAccessPage.displayName = 'VehicleAccessPage';

/* ─── Styles ──────────────────────────────────────────────────────────── */

const dialogShadow = shadows.panel as StyleProp<ViewStyle>;

const styles = StyleSheet.create({
  page: {
    backgroundColor: colors.background,
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
    rowGap: spacing.xl,
  },
  header: {
    rowGap: spacing.xs,
  },
  pageTitle: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 30,
  },
  pageSubtitle: {
    fontSize: 14,
    lineHeight: 20,
  },
  pageBreadcrumb: {
    letterSpacing: 0.2,
  },
  body: {
    rowGap: spacing.xl,
  },
  loading: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl + spacing.xl,
  },
  panel: {
    padding: spacing.lg,
    rowGap: spacing.md,
  },
  /* ── Section header ── */
  sectionHeader: {
    alignItems: 'center',
    columnGap: spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: spacing.sm,
  },
  sectionTitleGroup: {
    alignItems: 'center',
    columnGap: spacing.sm,
    flexDirection: 'row',
    flexShrink: 1,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: 17,
    lineHeight: 22,
  },
  sectionActions: {
    alignItems: 'center',
    columnGap: spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.xs,
  },
  /* ── Table ── */
  table: {
    rowGap: 0,
  },
  tableHeaderRow: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    columnGap: spacing.sm,
    flexDirection: 'row',
    paddingBottom: spacing.xs,
  },
  tableRow: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    columnGap: spacing.sm,
    flexDirection: 'row',
    paddingVertical: spacing.sm,
  },
  cell: {
    justifyContent: 'center',
  },
  cellCenter: {
    alignItems: 'center',
  },
  headerCellText: {
    color: colors.textMuted,
    letterSpacing: 0.3,
  },
  cellPrimary: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 18,
  },
  cellSecondary: {
    color: colors.textSecondary,
  },
  cellMuted: {
    color: colors.textMuted,
  },
  /* ── Badges ── */
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeInfo: {
    backgroundColor: colors.accentSoft,
  },
  badgeNeutral: {
    backgroundColor: colors.surfaceRaised,
  },
  badgeText: {
    color: colors.textSecondary,
    fontWeight: '600',
  },
  badgeInfoText: {
    color: colors.accent,
  },
  /* ── Status badge ── */
  statusBadge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    columnGap: 5,
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  statusDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  statusLabel: {
    textTransform: 'capitalize',
  },
  /* ── Buttons ── */
  actionButton: {
    alignItems: 'center',
    borderRadius: 12,
    columnGap: spacing.xs,
    flexDirection: 'row',
    justifyContent: 'center',
    minHeight: 38,
    paddingHorizontal: spacing.md,
  },
  actionPrimary: {
    backgroundColor: colors.accent,
  },
  actionGhost: {
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderWidth: 1,
  },
  actionDanger: {
    backgroundColor: colors.danger,
  },
  actionGlyph: {
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 18,
  },
  actionPrimaryText: {
    color: colors.background,
  },
  actionGhostText: {
    color: colors.textPrimary,
  },
  actionDangerText: {
    color: colors.background,
  },
  buttonDisabled: {
    opacity: 0.48,
  },
  buttonPressed: {
    opacity: 0.82,
  },
  iconGhost: {
    alignItems: 'center',
    borderRadius: 10,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  iconGhostGlyph: {
    color: colors.danger,
    fontSize: 17,
    lineHeight: 20,
  },
  copyButton: {
    alignItems: 'center',
    borderRadius: 10,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  copyGlyph: {
    color: colors.accent,
    fontSize: 16,
    lineHeight: 20,
  },
  copyGlyphCopied: {
    color: colors.success,
  },
  copyGlyphUnavailable: {
    color: colors.textMuted,
  },
  /* ── Empty ── */
  empty: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    rowGap: spacing.sm,
  },
  emptyText: {
    textAlign: 'center',
  },
  /* ── Confirm dialog ── */
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    flex: 1,
    justifyContent: 'center',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  dialog: {
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderAccent,
    borderRadius: 24,
    borderWidth: 1,
    margin: spacing.lg,
    maxWidth: 480,
    padding: spacing.lg,
    rowGap: spacing.md,
    width: '92%',
    ...(dialogShadow as object),
  },
  dialogTitle: {
    color: colors.textPrimary,
  },
  dialogMessage: {
    fontSize: 14,
    lineHeight: 20,
  },
  dialogActions: {
    columnGap: spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    rowGap: spacing.sm,
  },
});
