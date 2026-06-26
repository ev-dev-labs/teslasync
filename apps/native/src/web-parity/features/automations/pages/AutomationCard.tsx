// Native parity port of web/src/features/automations/pages/AutomationCard.tsx.
//
// `AutomationCard` renders a single automation row inside a glass panel: a header
// (name + status Badge + optional "Firing" pulse, plus a pin affordance, an
// enable/disable switch, and a kebab actions menu), a vehicle row, a stats row
// (last run / runs / fails / next fire), an auto-disabled warning, and a
// conflicts list, plus a delete confirmation dialog. Every state name
// (`menuOpen`, `confirmDelete`), the `uiStatus` memo, the `handleToggle`
// re-enable-vs-toggle branch, all callback props (`onToggle`/`onReEnable`/
// `onDelete`/`onTestRun`), and every i18n key + English fallback are preserved
// verbatim from the 285-line source.
//
// Source line coverage (contract rule 1 — read line-by-line):
//   L1-13   imports -> native-safe mappings (below).
//   L15-26  `timeAgo` helper -> ported byte-for-byte (pure JS, no DOM).
//   L28-42  `AutomationUIStatus` / `getUIStatus` / `statusStyles` -> ported
//           verbatim; the Badge `variant` union ('success'|'neutral'|'danger')
//           is exactly the subset the native web-parity Badge accepts.
//   L44-54  `AutomationCardProps` -> ported verbatim (same prop names/types).
//   L56-82  component signature + hooks (`useState`/`useMemo`/`useCallback`),
//           `conflicts` fallback, `handleToggle` -> ported verbatim.
//   L84-187 header row (title/badge/firing, pin/toggle/kebab menu) -> RN Views.
//   L189-202 vehicle row.  L204-238 stats row.  L240-246 auto-disabled warning.
//   L248-270 conflicts list.  L273-282 ConfirmDialog.  L283-285 close.
//
// Web modules with no native surface, mapped per contract rules 4/5/6/7:
//   - `useState`/`useMemo`/`useCallback` (L4) -> reused from React.
//   - react-i18next `useTranslation` (L5) -> the standard web-parity local i18n
//     shim returning the inline English fallback (apps/native has no
//     react-i18next). The shim also resolves the `{ name, defaultValue }`
//     interpolation form used by `automations.deleteMessage` (L276) by
//     substituting `{{name}}`, so the rendered string is byte-identical.
//   - `cn` from @/lib/cn (L6) only merged Tailwind class strings; RN has no
//     className, so every conditional class becomes a conditional StyleSheet
//     entry / inline style object (the sibling AchievementBadge/admin precedent).
//   - `@/components/ui` (L7): `GlassPanel` -> the shared native GlassPanel;
//     `Badge` -> the web-parity native Badge (same variant prop); `Button`
//     (ghost, icon-only / menu rows) -> native `Pressable`s; `Toggle` -> the RN
//     core `Switch` primitive (role=switch, accessible, onValueChange ->
//     onChange(checked)); `ConfirmDialog` -> a local RN `Modal`-backed
//     `ConfirmDialog` implementing the props this call site uses (open/title/
//     message/confirmLabel/cancelLabel/variant/onConfirm/onCancel); `PinButton`
//     -> a local native equivalent backed by the already-ported `usePinned` /
//     `useTogglePin` hooks (real pin behaviour preserved — the shared PinButton
//     gets its own dedicated parity file later; the web-only `Tooltip` wrapper
//     and CSS hover have no native analog and are dropped).
//   - lucide-react icons (L8-11, SVG) have no native analog -> small decorative
//     glyphs rendered in `AppText` (the SecurityAccessPage '\u26A0\uFE0F'
//     precedent). Each glyph is decorative (accessibilityElementsHidden) because
//     the adjacent text carries the meaning; the icon-only kebab/switch/pin
//     instead carry their own accessibilityLabel. The CSS `animate-pulse` on the
//     firing badge and `transition-all duration-normal` have no RN analog and
//     are dropped (documented in the sidecar).
//   - `type Automation` from @/api/types (L12) -> the structurally-identical
//     web-parity `Automation` (+ `AutomationConflict`).
//   - `formatDateTime` from @/lib/dateFormat (L13) -> inlined verbatim (the
//     GDPRExportPage precedent) so the rendered "Next" string is byte-identical.
//
// Tailwind -> StyleSheet (1 spacing unit = 4px): p-4 -> 16, gap-2/3 -> 8/12,
// gap-1/1.5 -> 4/6, mt-3 -> 12, mt-2/mt-0.5 -> 8/2, px-3 -> 12, py-2/1.5 -> 8/6,
// rounded-lg/md -> 8/6, w-44 -> 176, text-base -> 16, text-sm -> 14, text-xs ->
// 12. `--text-primary/-secondary/-muted` -> colors.text*; red-500/10 ->
// dangerSurface, red-300/400 -> #fca5a5/#f87171, cyan-300 -> #67e8f9, amber-300
// -> #fcd34d, blue-500/10 + blue-300 -> rgba(59,130,246,0.12)/#93c5fd, gray-900
// menu -> #111827, neon-cyan/70 next -> rgba(53,213,255,0.72). No DOM-only
// modules, browser HTML elements, Recharts, Leaflet, or old web UI components are
// imported.

import React, {useCallback, useMemo, useState} from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Switch,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, shadows, spacing} from '../../../../theme/tokens';
import {
  usePinned,
  useTogglePin,
  type PinnedItemType,
} from '../../../api/hooks/usePinned';
import type {Automation} from '../../../api/types';
import {Badge} from '../../../components/ui/Badge';

// ── i18n shim ──────────────────────────────────────────────────────────────
// react-i18next has no native parity module; translations resolve to their
// inline English fallback. The hook shape mirrors the web
// `const { t } = useTranslation()` so the component body is unchanged. The
// object form `t(key, { name, defaultValue })` (used by automations.deleteMessage)
// resolves `defaultValue` and substitutes `{{name}}`-style placeholders.
type TInterpolation = {defaultValue: string} & Record<string, string | number>;
type TFunc = (key: string, fallback: string | TInterpolation) => string;
function useTranslation(): {t: TFunc} {
  return {
    t: (_key, fallback) => {
      if (typeof fallback === 'string') {
        return fallback;
      }
      const {defaultValue, ...vars} = fallback;
      return defaultValue.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, name: string) =>
        name in vars ? String(vars[name]) : `{{${name}}}`,
      );
    },
  };
}

// ── Time-ago helper (verbatim from web) ─────────────────────────────────────

function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ── formatDateTime (inlined from web @/lib/dateFormat) ──────────────────────
// "Apr 4, 2026, 2:30 AM" — byte-identical to the web formatter for the values
// this card renders (the "Next" fire time).
function formatDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ── Status helpers (verbatim from web) ──────────────────────────────────────

type AutomationUIStatus = 'active' | 'disabled' | 'auto-disabled';

function getUIStatus(a: Automation): AutomationUIStatus {
  if (a.auto_disabled) return 'auto-disabled';
  if (!a.enabled) return 'disabled';
  return 'active';
}

const statusStyles: Record<
  AutomationUIStatus,
  {label: string; variant: 'success' | 'neutral' | 'danger'}
> = {
  active: {label: 'Active', variant: 'success'},
  disabled: {label: 'Disabled', variant: 'neutral'},
  'auto-disabled': {label: 'Auto-Disabled', variant: 'danger'},
};

// ── Decorative glyph (lucide icon → native-safe text glyph) ─────────────────

function Glyph({
  glyph,
  style,
}: {
  glyph: string;
  style?: StyleProp<TextStyle>;
}): React.ReactElement {
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.glyph, style]}>
      {glyph}
    </AppText>
  );
}

// ── PinButton (native equivalent of @/components/ui PinButton) ──────────────
// Backed by the already-ported usePinned/useTogglePin hooks so pin state and the
// pin/unpin toggle behave exactly like the web. The web Tooltip wrapper and CSS
// hover states have no native analog and are dropped.
function PinButton({
  itemType,
  itemId,
}: {
  itemType: PinnedItemType;
  itemId: string | number;
}): React.ReactElement {
  const {t} = useTranslation();
  const {data: pinned = []} = usePinned(itemType);
  const toggle = useTogglePin(itemType);

  const idStr = String(itemId);
  const isPinned = pinned.some(p => String(p.item_id) === idStr);
  const label = isPinned ? t('pin.unpin', 'Unpin') : t('pin.pin', 'Pin');

  const handlePress = useCallback(() => {
    if (toggle.isPending) return;
    toggle.mutate({itemId: idStr, pin: !isPinned});
  }, [toggle, idStr, isPinned]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{selected: isPinned, disabled: toggle.isPending}}
      disabled={toggle.isPending}
      onPress={handlePress}
      style={({pressed}) => [
        styles.iconButton,
        pressed && !toggle.isPending && styles.pressed,
        toggle.isPending && styles.disabled,
      ]}
      testID="pin-button">
      <Glyph glyph="📌" style={isPinned ? styles.glyphPinned : styles.glyphMuted} />
    </Pressable>
  );
}

// ── ConfirmDialog (native equivalent of @/components/ui ConfirmDialog) ───────
// Implements the prop subset this card uses. The native RN Modal supplies the
// backdrop-tap-to-cancel and hardware-back cancel; the typed-confirmation /
// "don't ask again" silencing / loading-spinner features of the full web dialog
// are not exercised by this call site and belong to the dedicated ConfirmDialog
// parity port.
function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning';
  onConfirm: () => void;
  onCancel: () => void;
}): React.ReactElement {
  return (
    <Modal
      animationType="fade"
      onRequestClose={onCancel}
      transparent
      visible={open}>
      <View
        accessibilityLabel={title}
        accessibilityRole="alert"
        accessible
        style={styles.dialogOverlay}>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={onCancel}
          style={styles.dialogBackdrop}
        />
        <View style={styles.dialog} testID="automation-confirm-dialog">
          <AppText variant="title" weight="bold" style={styles.dialogTitle}>
            {title}
          </AppText>
          <View style={styles.dialogMessageRow}>
            <Glyph
              glyph={variant === 'danger' ? '⛔' : '⚠️'}
              style={styles.dialogMessageGlyph}
            />
            <AppText style={styles.dialogMessageText}>{message}</AppText>
          </View>
          <View style={styles.dialogActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={cancelLabel}
              onPress={onCancel}
              style={({pressed}) => [
                styles.dialogButton,
                styles.dialogCancel,
                pressed && styles.pressed,
              ]}>
              <AppText weight="semibold" style={styles.dialogCancelText}>
                {cancelLabel}
              </AppText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={confirmLabel}
              onPress={onConfirm}
              style={({pressed}) => [
                styles.dialogButton,
                variant === 'danger'
                  ? styles.dialogConfirmDanger
                  : styles.dialogConfirmWarning,
                pressed && styles.pressed,
              ]}>
              <AppText weight="semibold" style={styles.dialogConfirmText}>
                {confirmLabel}
              </AppText>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ── Actions menu item ───────────────────────────────────────────────────────

function MenuAction({
  glyph,
  label,
  textStyle,
  glyphStyle,
  danger,
  onPress,
}: {
  glyph: string;
  label: string;
  textStyle?: StyleProp<TextStyle>;
  glyphStyle?: StyleProp<TextStyle>;
  danger?: boolean;
  onPress: () => void;
}): React.ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({pressed}) => [
        styles.menuItem,
        pressed && (danger ? styles.menuItemPressedDanger : styles.menuItemPressed),
      ]}>
      <Glyph glyph={glyph} style={[styles.menuGlyph, glyphStyle]} />
      <AppText style={[styles.menuItemText, textStyle]}>{label}</AppText>
    </Pressable>
  );
}

// ── Props (verbatim from web) ───────────────────────────────────────────────

interface AutomationCardProps {
  automation: Automation;
  isFiring: boolean;
  vehicleName?: string;
  onToggle: (id: number, enabled: boolean) => void;
  onReEnable: (id: number) => void;
  onDelete: (id: number) => void;
  onTestRun: (id: number) => void;
}

export function AutomationCard({
  automation: a,
  isFiring,
  vehicleName,
  onToggle,
  onReEnable,
  onDelete,
  onTestRun,
}: AutomationCardProps): React.ReactElement {
  const {t} = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const uiStatus = useMemo(() => getUIStatus(a), [a]);
  const status = statusStyles[uiStatus];
  const conflicts = a.conflicts ?? [];

  const handleToggle = useCallback(
    (checked: boolean) => {
      if (a.auto_disabled && checked) {
        onReEnable(a.id);
      } else {
        onToggle(a.id, checked);
      }
    },
    [a.auto_disabled, a.id, onReEnable, onToggle],
  );

  return (
    <>
      <GlassPanel
        style={[
          styles.panel,
          isFiring && styles.panelFiring,
          uiStatus === 'auto-disabled' && styles.panelAutoDisabled,
        ]}>
        {/* Header row */}
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <View style={styles.titleRow}>
              <AppText
                numberOfLines={1}
                weight="semibold"
                style={styles.title}>
                {a.name}
              </AppText>
              <Badge variant={status.variant} size="sm">
                {t(`automations.status.${uiStatus}`, status.label)}
              </Badge>
              {isFiring && (
                <View style={styles.firing}>
                  <Glyph glyph="⚡" style={styles.firingText} />
                  <AppText style={styles.firingText}>
                    {t('automations.firing', 'Firing')}
                  </AppText>
                </View>
              )}
            </View>
            {a.description ? (
              <AppText
                numberOfLines={1}
                tone="secondary"
                style={styles.description}>
                {a.description}
              </AppText>
            ) : null}
          </View>

          <View style={styles.headerRight}>
            <PinButton itemType="automation" itemId={a.id} />
            <Switch
              accessibilityLabel={t('automations.toggleLabel', 'Toggle automation')}
              ios_backgroundColor="#374151"
              onValueChange={handleToggle}
              thumbColor="#ffffff"
              trackColor={{false: '#374151', true: colors.accent}}
              value={a.auto_disabled ? false : a.enabled}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('automations.menu', 'Actions menu')}
              onPress={() => setMenuOpen(!menuOpen)}
              style={({pressed}) => [
                styles.iconButton,
                pressed && styles.pressed,
              ]}>
              <Glyph glyph="⋮" style={styles.kebabGlyph} />
            </Pressable>
          </View>
        </View>

        {/* Vehicle row */}
        <View style={styles.vehicleRow}>
          {vehicleName ? (
            <View style={styles.inlineItem}>
              <Glyph glyph="🚗" style={styles.metaGlyph} />
              <AppText tone="secondary" style={styles.metaText}>
                {vehicleName}
              </AppText>
            </View>
          ) : (
            <AppText tone="secondary" style={styles.metaText}>
              {t('automations.allVehicles', 'All vehicles')}
            </AppText>
          )}
        </View>

        {/* Stats row */}
        <View style={styles.statsRow}>
          <View style={styles.inlineItem}>
            {a.last_triggered_at ? (
              <>
                <Glyph glyph="✅" style={styles.metaGlyph} />
                <AppText tone="secondary" style={styles.metaText}>
                  {t('automations.lastRun', 'Last')}: {timeAgo(a.last_triggered_at)}
                </AppText>
              </>
            ) : (
              <>
                <Glyph glyph="⏭️" style={styles.metaGlyph} />
                <AppText tone="secondary" style={styles.metaText}>
                  {t('automations.neverRun', 'Never run')}
                </AppText>
              </>
            )}
          </View>
          <AppText style={styles.dot}>·</AppText>
          <AppText tone="secondary" style={styles.metaText}>
            {t('automations.runs', 'Runs')}: {a.execution_count}
          </AppText>
          {a.failure_count > 0 && (
            <>
              <AppText style={styles.dot}>·</AppText>
              <View style={styles.inlineItem}>
                <Glyph glyph="❌" style={styles.metaGlyph} />
                <AppText style={styles.metaTextDanger}>
                  {t('automations.fails', 'Fails')}: {a.failure_count}
                </AppText>
              </View>
            </>
          )}
          {a.next_fire_time && (
            <>
              <AppText style={styles.dot}>·</AppText>
              <AppText style={styles.metaTextNext}>
                {t('automations.nextFire', 'Next')}: {formatDateTime(a.next_fire_time)}
              </AppText>
            </>
          )}
        </View>

        {/* Auto-disabled warning */}
        {a.auto_disabled && a.auto_disabled_reason && (
          <View style={styles.warningRow}>
            <Glyph glyph="⚠️" style={styles.warningGlyph} />
            <AppText style={styles.warningText}>{a.auto_disabled_reason}</AppText>
          </View>
        )}

        {/* Conflicts */}
        {conflicts.length > 0 && (
          <View style={styles.conflicts}>
            {conflicts.map((c, i) => (
              <View
                key={`conflict-${a.id}-${i}`}
                style={[
                  styles.conflictRow,
                  c.severity === 'warning'
                    ? styles.conflictWarning
                    : styles.conflictInfo,
                ]}>
                <Glyph
                  glyph="⚠️"
                  style={
                    c.severity === 'warning'
                      ? styles.conflictWarningText
                      : styles.conflictInfoText
                  }
                />
                <AppText
                  style={
                    c.severity === 'warning'
                      ? styles.conflictWarningText
                      : styles.conflictInfoText
                  }>
                  {t('automations.conflictWith', 'Conflict with')}{' '}
                  <AppText weight="semibold">"{c.automation_name}"</AppText>
                  {' — '}
                  {c.reason}
                </AppText>
              </View>
            ))}
          </View>
        )}

        {/* Actions menu (web absolute dropdown + fixed backdrop -> in-panel
            backdrop covering the card + a top-right anchored menu). */}
        {menuOpen && (
          <>
            <Pressable
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              onPress={() => setMenuOpen(false)}
              style={styles.menuBackdrop}
            />
            <View style={styles.menu}>
              <MenuAction
                glyph="▶"
                label={t('automations.testRun', 'Test Run')}
                onPress={() => {
                  onTestRun(a.id);
                  setMenuOpen(false);
                }}
              />
              {a.auto_disabled && (
                <MenuAction
                  glyph="↺"
                  label={t('automations.reEnable', 'Re-enable')}
                  textStyle={styles.menuItemCyan}
                  glyphStyle={styles.menuItemCyan}
                  onPress={() => {
                    onReEnable(a.id);
                    setMenuOpen(false);
                  }}
                />
              )}
              <MenuAction
                glyph="⧉"
                label={t('automations.duplicate', 'Duplicate')}
                onPress={() => {
                  setMenuOpen(false);
                }}
              />
              <MenuAction
                glyph="⬇"
                label={t('automations.export', 'Export')}
                onPress={() => {
                  setMenuOpen(false);
                }}
              />
              <MenuAction
                glyph="🗑"
                label={t('automations.delete', 'Delete')}
                danger
                textStyle={styles.menuItemDanger}
                glyphStyle={styles.menuItemDanger}
                onPress={() => {
                  setConfirmDelete(true);
                  setMenuOpen(false);
                }}
              />
            </View>
          </>
        )}
      </GlassPanel>

      <ConfirmDialog
        open={confirmDelete}
        title={t('automations.deleteTitle', 'Delete Automation')}
        message={t('automations.deleteMessage', {
          name: a.name,
          defaultValue: 'Are you sure you want to delete "{{name}}"? This cannot be undone.',
        })}
        confirmLabel={t('automations.deleteConfirm', 'Delete')}
        cancelLabel={t('common.cancel', 'Cancel')}
        variant="danger"
        onConfirm={() => {
          onDelete(a.id);
          setConfirmDelete(false);
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  panel: {
    padding: 16, // p-4
  },
  panelFiring: {
    borderColor: colors.borderAccent, // ring-neon-cyan/50
    borderWidth: 2,
    ...shadows.panel,
  },
  panelAutoDisabled: {
    borderColor: colors.dangerBorder, // border-red-500/30
  },
  // Header
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12, // gap-3
  },
  headerLeft: {
    flex: 1, // min-w-0 flex-1
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8, // gap-2
  },
  title: {
    flexShrink: 1,
    fontSize: 16, // text-base
    lineHeight: 22,
    color: colors.textPrimary,
  },
  description: {
    marginTop: 2, // mt-0.5
    fontSize: 14, // text-sm
    lineHeight: 20,
  },
  firing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4, // gap-1
  },
  firingText: {
    fontSize: 12, // text-xs
    lineHeight: 16,
    color: '#67e8f9', // text-cyan-300
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8, // gap-2
    flexShrink: 0,
  },
  iconButton: {
    minHeight: 32,
    minWidth: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    paddingHorizontal: 6,
  },
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.6,
  },
  glyph: {
    fontSize: 12,
    lineHeight: 16,
  },
  glyphMuted: {
    color: colors.textMuted,
  },
  glyphPinned: {
    color: '#fcd34d', // amber-300
  },
  kebabGlyph: {
    fontSize: 18,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  // Vehicle + stats meta rows
  vehicleRow: {
    marginTop: 12, // mt-3
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8, // gap-2
  },
  statsRow: {
    marginTop: 12, // mt-3
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12, // gap-3
  },
  inlineItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4, // gap-1
  },
  metaGlyph: {
    fontSize: 12,
    lineHeight: 16,
  },
  metaText: {
    fontSize: 12, // text-xs
    lineHeight: 16,
    color: colors.textSecondary,
  },
  metaTextDanger: {
    fontSize: 12,
    lineHeight: 16,
    color: '#f87171', // text-red-400
  },
  metaTextNext: {
    fontSize: 12,
    lineHeight: 16,
    color: 'rgba(53, 213, 255, 0.72)', // text-neon-cyan/70
  },
  dot: {
    fontSize: 12,
    lineHeight: 16,
    color: colors.textMuted, // text-[var(--text-muted)]
  },
  // Auto-disabled warning
  warningRow: {
    marginTop: 8, // mt-2
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8, // gap-2
    borderRadius: 6, // rounded-md
    backgroundColor: colors.dangerSurface, // bg-red-500/10
    paddingHorizontal: 12, // px-3
    paddingVertical: 8, // py-2
  },
  warningGlyph: {
    marginTop: 2, // mt-0.5
    fontSize: 12,
    lineHeight: 16,
    color: '#fca5a5', // text-red-300
  },
  warningText: {
    flexShrink: 1,
    fontSize: 12, // text-xs
    lineHeight: 16,
    color: '#fca5a5', // text-red-300
  },
  // Conflicts
  conflicts: {
    marginTop: 8, // mt-2
    gap: 4, // space-y-1
  },
  conflictRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8, // gap-2
    borderRadius: 6, // rounded-md
    paddingHorizontal: 12, // px-3
    paddingVertical: 6, // py-1.5
  },
  conflictWarning: {
    backgroundColor: colors.warningSurface, // bg-amber-500/10
  },
  conflictInfo: {
    backgroundColor: 'rgba(59, 130, 246, 0.12)', // bg-blue-500/10
  },
  conflictWarningText: {
    flexShrink: 1,
    fontSize: 12, // text-xs
    lineHeight: 16,
    color: '#fcd34d', // text-amber-300
  },
  conflictInfoText: {
    flexShrink: 1,
    fontSize: 12,
    lineHeight: 16,
    color: '#93c5fd', // text-blue-300
  },
  // Actions menu
  menuBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
  },
  menu: {
    position: 'absolute',
    right: 12,
    top: 48,
    width: 176, // w-44
    borderRadius: 8, // rounded-lg
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#111827', // bg-gray-900
    paddingVertical: 4, // py-1
    zIndex: 20,
    ...shadows.panel, // shadow-xl
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12, // px-3
    paddingVertical: 8, // py-2
  },
  menuItemPressed: {
    backgroundColor: colors.surfaceRaised,
  },
  menuItemPressedDanger: {
    backgroundColor: colors.dangerSurface, // hover:bg-red-500/10
  },
  menuGlyph: {
    fontSize: 12,
    lineHeight: 16,
    color: colors.textPrimary,
  },
  menuItemText: {
    fontSize: 14, // text-sm
    lineHeight: 20,
    color: colors.textPrimary,
  },
  menuItemCyan: {
    color: '#67e8f9', // text-cyan-300
  },
  menuItemDanger: {
    color: '#f87171', // text-red-400
  },
  // Confirm dialog
  dialogOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
  },
  dialogBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  dialog: {
    width: '92%',
    maxWidth: 420,
    alignSelf: 'center',
    margin: spacing.lg,
    padding: spacing.lg,
    gap: spacing.md,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.borderAccent,
    backgroundColor: colors.surface,
    ...shadows.panel,
  },
  dialogTitle: {
    color: colors.textPrimary,
  },
  dialogMessageRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerSurface,
    padding: 12,
  },
  dialogMessageGlyph: {
    marginTop: 2,
    fontSize: 16,
    lineHeight: 20,
    color: colors.danger,
  },
  dialogMessageText: {
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textPrimary,
  },
  dialogActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    flexWrap: 'wrap',
  },
  dialogButton: {
    minHeight: 44,
    minWidth: 96,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    paddingHorizontal: spacing.lg,
  },
  dialogCancel: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  dialogCancelText: {
    color: colors.textPrimary,
  },
  dialogConfirmDanger: {
    backgroundColor: colors.danger,
  },
  dialogConfirmWarning: {
    backgroundColor: colors.warning,
  },
  dialogConfirmText: {
    color: colors.background,
  },
});

export default AutomationCard;
