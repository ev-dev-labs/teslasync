// Native parity port of web/src/features/settings/components/ResetSection.tsx.
//
// The web component renders the "Reset to defaults" primitive mounted under
// <section id="reset"> on the Settings page. It is reproduced here with React
// Native primitives, preserving the data derivation, state names, API hooks,
// i18n keys + English copy, and visual intent:
//
//   1. "Reset by section" — a GlassPanel listing every whitelisted section with
//      a per-row "Reset" button. Tapping a row's button sets `pending` to that
//      section and opens a danger ConfirmDialog describing the reset. On confirm
//      we POST /settings/reset { section } via useResetSection (sudo gating +
//      cache flush handled inside the shared request() client / the hook).
//   2. "Danger zone" — a single danger Button that opens a ConfirmDialog gated by
//      a typed-confirmation input (`requireTypedConfirmation="RESET"`); on confirm
//      we POST /settings/reset {} via useResetAllSettings.
//   3. A read-only "deny-list" panel listing the sections that are NOT
//      user-resettable (tariffs, sound_prefs) with the reason for each.
//
// Toasts are surfaced for success ("X item(s) reset across Y section(s)") via a
// native Alert.alert shim; failures are toasted inside the hooks via
// useMutationToast (single source of truth), exactly as on web. On
// SudoCanceledError we no-op silently — the user saw the reauth prompt and
// decided not to proceed.
//
// React-Native-safe substitutions (documented in the parity sidecar):
//   - `@/components/ui` GlassPanel/Button -> the already-ported native GlassPanel
//     + native parity Button (variant/size/disabled/loading/icon/onPress carry
//     over; the web RotateCcw leading icon becomes the Button `icon` slot).
//   - `@/components/ui` IconBox (colored ring container) -> inline native IconBox
//     reproduction; web color="cyan"/"amber"/"red" map to the app accent /
//     warning / danger theme tints, web size="sm"/"md" to 32/40px boxes.
//   - `@/components/ui` ConfirmDialog (DOM Modal + Button + Input, Escape/focus
//     trap, silenceKey) -> inline native <Modal> reproduction with the props
//     these call sites pass: open/variant/loading/title/message/confirm+cancel
//     label + the typed-confirmation gate (requireTypedConfirmation /
//     typedConfirmationLabel). silenceKey is omitted because ResetSection never
//     passes it (and the web ConfirmDialog ignores silencing for danger /
//     typed-confirmation prompts anyway). The typed input resets on each reopen
//     and disables the confirm button until it exactly matches the required
//     string, preserving the web gate.
//   - `@/components/ui` Heading/Text/HelperText typography roles -> AppText with
//     matching size/weight/tone (sectionTitle 18/600/primary, panelTitle
//     16/600/primary, subhead 14/500/primary, bodySm + helper 12/muted — the
//     web overrides bodySm/subhead color to primary/muted via className, honored
//     here).
//   - `@/components/motion` FadeIn (framer-motion entrance, delay=0.24) -> inline
//     native Animated fade+slide-up that honours reduced motion.
//   - lucide-react Cog/Palette/Bell/MapPin/LayoutDashboard/Workflow/Calendar/
//     RotateCcw/Shield/AlertTriangle/AlertOctagon -> decorative Unicode glyphs
//     (importantForAccessibility="no"; the visible titles carry the meaning),
//     the same lucide -> glyph approach the ActiveSessionsSection/FeatureToggles
//     ports took.
//   - react-i18next useTranslation() -> a local t() shim returning the English
//     fallback and resolving `{{token}}` interpolation, so every settingsReset.*
//     key + copy is preserved verbatim.
//   - `@/components/feedback/Toast` useToast -> a local useNativeToast() shim
//     surfacing toast.success(title, detail) via Alert.alert (ThemePicker /
//     FeatureToggles precedent).
//   - `@/api/hooks/useSettingsReset` useResetSection/useResetAllSettings/
//     SudoCanceledError/SettingsResetResult -> the already-ported native hooks
//     (same /settings/reset paths + payloads, same global cache flush + sudo
//     interception).

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AccessibilityInfo,
  Alert,
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, shadows, spacing} from '../../../../theme/tokens';
import {
  SudoCanceledError,
  useResetAllSettings,
  useResetSection,
  type SettingsResetResult,
} from '../../../api/hooks/useSettingsReset';
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

/* ─── toast shim (web `@/components/feedback/Toast` useToast) ───────────────── */

interface NativeToast {
  success: (title: string, detail?: string) => void;
}

// useToast() is unavailable in native parity; the transient web toast becomes an
// `Alert.alert`, the established native feedback primitive (ThemePicker /
// FeatureToggles precedent). The success detail is shown as the Alert body.
function useNativeToast(): NativeToast {
  return useMemo(
    () => ({
      success: (title: string, detail?: string) => {
        Alert.alert(title, detail);
      },
    }),
    [],
  );
}

/* ─── decorative lucide glyphs (the visible labels carry the meaning) ──────── */

const COG_GLYPH = '\u2699'; // ⚙ lucide Cog
const PALETTE_GLYPH = '\uD83C\uDFA8'; // 🎨 lucide Palette
const BELL_GLYPH = '\uD83D\uDD14'; // 🔔 lucide Bell
const MAP_PIN_GLYPH = '\uD83D\uDCCD'; // 📍 lucide MapPin
const DASHBOARD_GLYPH = '\uD83D\uDDC2'; // 🗂 lucide LayoutDashboard
const WORKFLOW_GLYPH = '\uD83D\uDD00'; // 🔀 lucide Workflow
const CALENDAR_GLYPH = '\uD83D\uDCC5'; // 📅 lucide Calendar
const ROTATE_GLYPH = '\u21BA'; // ↺ lucide RotateCcw
const SHIELD_GLYPH = '\uD83D\uDEE1'; // 🛡 lucide Shield
const WARNING_GLYPH = '\u26A0'; // ⚠ lucide AlertTriangle
const OCTAGON_GLYPH = '\uD83D\uDED1'; // 🛑 lucide AlertOctagon

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

type IconBoxColor = 'cyan' | 'amber' | 'red';
type IconBoxSize = 'sm' | 'md';

function IconBox({
  color,
  size = 'md',
  glyph,
}: {
  color: IconBoxColor;
  size?: IconBoxSize;
  glyph: string;
}): React.ReactElement {
  return (
    <View
      style={[
        styles.iconBox,
        size === 'sm' ? styles.iconBoxSm : styles.iconBoxMd,
        iconBoxColorStyles[color],
      ]}>
      <AppText
        importantForAccessibility="no"
        style={[
          size === 'sm' ? styles.iconGlyphSm : styles.iconGlyphMd,
          iconGlyphColorStyles[color],
        ]}>
        {glyph}
      </AppText>
    </View>
  );
}

IconBox.displayName = 'IconBox';

/* ─── ConfirmDialog (web `@/components/ui` ConfirmDialog) ───────────────────── */

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning';
  loading?: boolean;
  requireTypedConfirmation?: string;
  typedConfirmationLabel?: string;
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
  requireTypedConfirmation,
  typedConfirmationLabel,
  onConfirm,
  onCancel,
  testID,
}: ConfirmDialogProps): React.ReactElement {
  const isWarning = variant === 'warning';
  const [typed, setTyped] = useState('');

  // Reset the typed input each time the dialog reopens so a stale value from a
  // previous invocation can't bypass the typed-confirmation gate (web parity).
  useEffect(() => {
    if (open) {
      setTyped('');
    }
  }, [open]);

  const typedMatches =
    !requireTypedConfirmation || typed === requireTypedConfirmation;
  const confirmDisabled = loading || !typedMatches;
  const handleCancel = loading ? undefined : onCancel;

  const inputLabel =
    typedConfirmationLabel ??
    (requireTypedConfirmation
      ? `Type "${requireTypedConfirmation}" to confirm`
      : '');

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
              {isWarning ? WARNING_GLYPH : OCTAGON_GLYPH}
            </AppText>
            <AppText style={styles.messageText}>{message}</AppText>
          </View>

          {requireTypedConfirmation ? (
            <View style={styles.field}>
              <AppText style={styles.fieldLabel} variant="caption">
                {inputLabel}
              </AppText>
              <TextInput
                accessibilityLabel={inputLabel}
                autoCapitalize="characters"
                autoCorrect={false}
                editable={!loading}
                onChangeText={setTyped}
                placeholder={requireTypedConfirmation}
                placeholderTextColor={colors.textMuted}
                spellCheck={false}
                style={styles.input}
                value={typed}
              />
            </View>
          ) : null}

          <View style={styles.actionRow}>
            <Button disabled={loading} onPress={onCancel} variant="secondary">
              {cancelLabel}
            </Button>
            <Button
              disabled={confirmDisabled}
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

/* ─── row shapes (web SectionRow / DeniedRow) ──────────────────────────────── */

interface SectionRow {
  id: string;
  title: string;
  description: string;
  glyph: string;
}

interface DeniedRow {
  id: string;
  title: string;
  reason: string;
}

function useSectionRows(t: NativeTFunction): SectionRow[] {
  return useMemo(
    () => [
      {
        id: 'general',
        glyph: COG_GLYPH,
        title: t('settingsReset.section.general.title', 'General preferences'),
        description: t(
          'settingsReset.section.general.desc',
          'Units, language, currency, timezone, and energy/gas pricing defaults.',
        ),
      },
      {
        id: 'appearance',
        glyph: PALETTE_GLYPH,
        title: t('settingsReset.section.appearance.title', 'Appearance'),
        description: t(
          'settingsReset.section.appearance.desc',
          'Theme, density, chart palette, and notification badge / flash preferences.',
        ),
      },
      {
        id: 'alert_rules',
        glyph: BELL_GLYPH,
        title: t('settingsReset.section.alertRules.title', 'Alert rules'),
        description: t(
          'settingsReset.section.alertRules.desc',
          'Delete every alert rule you have authored. Cannot be undone.',
        ),
      },
      {
        id: 'geofences',
        glyph: MAP_PIN_GLYPH,
        title: t('settingsReset.section.geofences.title', 'Geofences'),
        description: t(
          'settingsReset.section.geofences.desc',
          'Delete every geofence and its electricity-rate overrides. Vehicle home assignments will be cleared.',
        ),
      },
      {
        id: 'notification_channels',
        glyph: BELL_GLYPH,
        title: t(
          'settingsReset.section.notificationChannels.title',
          'Notification channels',
        ),
        description: t(
          'settingsReset.section.notificationChannels.desc',
          'Delete every webhook, Discord, Slack, email, and push channel along with their delivery history.',
        ),
      },
      {
        id: 'dashboard_layout',
        glyph: DASHBOARD_GLYPH,
        title: t(
          'settingsReset.section.dashboardLayout.title',
          'Dashboard layouts',
        ),
        description: t(
          'settingsReset.section.dashboardLayout.desc',
          'Delete every saved dashboard layout preset.',
        ),
      },
      {
        id: 'automations',
        glyph: WORKFLOW_GLYPH,
        title: t('settingsReset.section.automations.title', 'Automations'),
        description: t(
          'settingsReset.section.automations.desc',
          'Delete every automation, including its triggers, conditions, actions, variables, and run history.',
        ),
      },
      {
        id: 'quiet_hours',
        glyph: CALENDAR_GLYPH,
        title: t('settingsReset.section.quietHours.title', 'Quiet hours'),
        description: t(
          'settingsReset.section.quietHours.desc',
          'Delete every quiet-hours window for your account.',
        ),
      },
    ],
    [t],
  );
}

function useDeniedRows(t: NativeTFunction): DeniedRow[] {
  return useMemo(
    () => [
      {
        id: 'tariffs',
        title: t('settingsReset.denied.tariffs.title', 'Charge cost tariffs'),
        reason: t(
          'settingsReset.denied.tariffs.reason',
          'Tariffs are stored per-vehicle. Reset the assignment from the Vehicle Settings page on the vehicle detail screen.',
        ),
      },
      {
        id: 'sound_prefs',
        title: t(
          'settingsReset.denied.soundPrefs.title',
          'Notification sound preferences',
        ),
        reason: t(
          'settingsReset.denied.soundPrefs.reason',
          'Notification sound preferences are stored in your browser. Clear them via your browser\u2019s site-data controls.',
        ),
      },
    ],
    [t],
  );
}

/* ─── SectionRowItem (web SectionRowItem) ──────────────────────────────────── */

interface SectionRowItemProps {
  row: SectionRow;
  onRequestReset: (row: SectionRow) => void;
  busy: boolean;
  isFirst: boolean;
  isLast: boolean;
}

function SectionRowItem({
  row,
  onRequestReset,
  busy,
  isFirst,
  isLast,
}: SectionRowItemProps): React.ReactElement {
  const t = useNativeTranslationFallback();
  return (
    <View
      style={[
        styles.sectionRow,
        isFirst ? styles.sectionRowFirst : null,
        isLast ? styles.sectionRowLast : null,
      ]}
      testID={`reset-section-row-${row.id}`}>
      <IconBox color="cyan" glyph={row.glyph} size="sm" />
      <View style={styles.rowTextCol}>
        <AppText style={styles.headingSub}>{row.title}</AppText>
        <AppText style={styles.helperText} tone="muted" variant="caption">
          {row.description}
        </AppText>
      </View>
      <Button
        disabled={busy}
        icon={
          <AppText importantForAccessibility="no" style={styles.resetGlyph}>
            {ROTATE_GLYPH}
          </AppText>
        }
        onPress={() => onRequestReset(row)}
        testID={`reset-section-button-${row.id}`}
        variant="ghost">
        {t('settingsReset.actions.reset', 'Reset')}
      </Button>
    </View>
  );
}

SectionRowItem.displayName = 'SectionRowItem';

/* ─── ResetSection ─────────────────────────────────────────────────────────── */

export function ResetSection(): React.ReactElement {
  const t = useNativeTranslationFallback();
  const toast = useNativeToast();
  const sections = useSectionRows(t);
  const deniedRows = useDeniedRows(t);

  // Per-section confirm — a single ConfirmDialog whose `pending` state tracks
  // which section the user is confirming.
  const [pending, setPending] = useState<SectionRow | null>(null);
  const [resetAllOpen, setResetAllOpen] = useState(false);

  // The hook is keyed by section name so we re-create the mutation once per
  // pending row. Render-time we keep two stable mutations: one for the active
  // pending section and one for the global reset.
  const sectionMut = useResetSection(pending?.id ?? '__none__');
  const allMut = useResetAllSettings();

  const sectionBusy = sectionMut.isPending;
  const allBusy = allMut.isPending;

  const announceSuccess = (
    result: SettingsResetResult,
    fallbackTitle: string,
  ) => {
    const count = result.reset;
    toast.success(
      t('settingsReset.toasts.successTitle', fallbackTitle),
      t(
        'settingsReset.toasts.successDetail',
        '{{count}} item(s) reset across {{sections}} section(s).',
        {
          count,
          sections: result.sections.length,
        },
      ),
    );
  };

  const handleConfirmSection = async () => {
    if (!pending) {
      return;
    }
    try {
      const result = await sectionMut.mutateAsync();
      announceSuccess(result, 'Section reset');
    } catch (e) {
      // Non-cancel errors are toasted by useMutationToast inside the hook. We
      // only swallow the cancel here so the dialog closes cleanly.
      if (!(e instanceof SudoCanceledError)) {
        console.warn('[ResetSection] section reset failed', e);
      }
    } finally {
      setPending(null);
    }
  };

  const handleConfirmAll = async () => {
    try {
      const result = await allMut.mutateAsync();
      announceSuccess(result, 'All settings reset');
    } catch (e) {
      if (!(e instanceof SudoCanceledError)) {
        console.warn('[ResetSection] all-reset failed', e);
      }
    } finally {
      setResetAllOpen(false);
    }
  };

  return (
    <FadeIn delay={0.24}>
      <View style={styles.root} testID="reset-section-root">
        {/* By-section panel */}
        <GlassPanel style={styles.panel} testID="reset-section-by-section">
          <View style={styles.panelHeader}>
            <IconBox color="amber" glyph={ROTATE_GLYPH} />
            <View style={styles.headerTextCol}>
              <AppText style={styles.headingSection}>
                {t('settingsReset.title', 'Reset to defaults')}
              </AppText>
              <AppText style={styles.bodySm} tone="muted" variant="caption">
                {t(
                  'settingsReset.subtitle',
                  'Restore an individual section to its default state. Each reset is destructive and cannot be undone — export your settings first if you want a backup.',
                )}
              </AppText>
            </View>
          </View>
          <View>
            {sections.map((row, index) => (
              <SectionRowItem
                busy={sectionBusy && pending?.id === row.id}
                isFirst={index === 0}
                isLast={index === sections.length - 1}
                key={row.id}
                onRequestReset={setPending}
                row={row}
              />
            ))}
          </View>
        </GlassPanel>

        {/* Deny-list / read-only panel */}
        <GlassPanel style={styles.panel} testID="reset-section-denied">
          <View style={styles.panelHeaderTight}>
            <IconBox color="cyan" glyph={SHIELD_GLYPH} />
            <View style={styles.headerTextCol}>
              <AppText style={styles.headingPanel}>
                {t(
                  'settingsReset.deniedTitle',
                  'Sections that aren\u2019t user-resettable',
                )}
              </AppText>
              <AppText style={styles.bodySm} tone="muted" variant="caption">
                {t(
                  'settingsReset.deniedSubtitle',
                  'These sections live outside this server\u2019s preference store. The Settings page can\u2019t reset them, but the linked instructions tell you where to go.',
                )}
              </AppText>
            </View>
          </View>
          <View style={styles.deniedList}>
            {deniedRows.map(row => (
              <View
                key={row.id}
                style={styles.deniedRow}
                testID={`reset-section-denied-row-${row.id}`}>
                <AppText
                  importantForAccessibility="no"
                  style={styles.deniedIcon}>
                  {WARNING_GLYPH}
                </AppText>
                <View style={styles.rowTextCol}>
                  <AppText style={styles.headingSub}>{row.title}</AppText>
                  <AppText
                    style={styles.helperText}
                    tone="muted"
                    variant="caption">
                    {row.reason}
                  </AppText>
                </View>
              </View>
            ))}
          </View>
        </GlassPanel>

        {/* Danger zone */}
        <GlassPanel
          style={[styles.panel, styles.dangerPanel]}
          testID="reset-section-danger-zone">
          <View style={styles.panelHeader}>
            <IconBox color="red" glyph={OCTAGON_GLYPH} />
            <View style={styles.headerTextCol}>
              <AppText style={styles.headingSection}>
                {t('settingsReset.dangerZone.title', 'Danger zone')}
              </AppText>
              <AppText style={styles.bodySm} tone="muted" variant="caption">
                {t(
                  'settingsReset.dangerZone.subtitle',
                  'Wipe every user-discoverable preference at once. Alert rules, geofences, channels, automations, dashboard layouts, and your typed preference rows are all deleted in a single transaction.',
                )}
              </AppText>
            </View>
          </View>
          <View style={styles.dangerRow}>
            <AppText
              style={styles.dangerHelper}
              tone="muted"
              variant="caption">
              {t(
                'settingsReset.dangerZone.help',
                'You will be asked to type RESET to confirm.',
              )}
            </AppText>
            <Button
              disabled={allBusy}
              icon={
                <AppText
                  importantForAccessibility="no"
                  style={styles.dangerCtaGlyph}>
                  {ROTATE_GLYPH}
                </AppText>
              }
              onPress={() => setResetAllOpen(true)}
              testID="reset-section-reset-all"
              variant="danger">
              {t('settingsReset.dangerZone.cta', 'Reset ALL settings')}
            </Button>
          </View>
        </GlassPanel>

        {/* Per-section confirm dialog */}
        <ConfirmDialog
          cancelLabel={t('settingsReset.confirm.cancelLabel', 'Cancel')}
          confirmLabel={t('settingsReset.confirm.confirmLabel', 'Reset')}
          loading={sectionBusy}
          message={
            pending
              ? t(
                  'settingsReset.confirm.sectionMessage',
                  '{{description}} This action is permanent.',
                  {description: pending.description},
                )
              : ''
          }
          onCancel={() => setPending(null)}
          onConfirm={handleConfirmSection}
          open={pending !== null}
          testID="reset-section-confirm-section"
          title={t('settingsReset.confirm.sectionTitle', 'Reset {{name}}?', {
            name: pending?.title ?? '',
          })}
          variant="danger"
        />

        {/* Danger-zone typed-confirmation dialog */}
        <ConfirmDialog
          cancelLabel={t('settingsReset.confirm.cancelLabel', 'Cancel')}
          confirmLabel={t(
            'settingsReset.confirm.allConfirmLabel',
            'Reset everything',
          )}
          loading={allBusy}
          message={t(
            'settingsReset.confirm.allMessage',
            'Every alert rule, geofence, channel, automation, dashboard layout preset, and preference row will be permanently deleted. This cannot be undone.',
          )}
          onCancel={() => setResetAllOpen(false)}
          onConfirm={handleConfirmAll}
          open={resetAllOpen}
          requireTypedConfirmation="RESET"
          testID="reset-section-confirm-all"
          title={t(
            'settingsReset.confirm.allTitle',
            'Reset every user-discoverable setting?',
          )}
          typedConfirmationLabel={t(
            'settingsReset.confirm.typedLabel',
            'Type RESET to confirm',
          )}
          variant="danger"
        />
      </View>
    </FadeIn>
  );
}

ResetSection.displayName = 'ResetSection';

/* ─── styles ────────────────────────────────────────────────────────────────── */

// Toned-down danger/warning severity tints for the ConfirmDialog message box,
// preserved as literals (the web ConfirmDialog danger severity maps to red-500
// surface/border with a red-300 icon; warning to amber-500/amber-300).
const RED_300 = '#fca5a5';
const RED_500_SURFACE = 'rgba(239, 68, 68, 0.1)';
const RED_500_BORDER = 'rgba(239, 68, 68, 0.3)';
const AMBER_300 = '#fcd34d';
const AMBER_500_SURFACE = 'rgba(245, 158, 11, 0.1)';
const AMBER_500_BORDER = 'rgba(245, 158, 11, 0.3)';
// web `border-tesla-red/30` (--tesla-red: #e31937).
const TESLA_RED_30 = 'rgba(227, 25, 55, 0.3)';

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
  bodySm: {
    color: colors.textMuted,
    marginTop: 2,
  },
  dangerBox: {
    backgroundColor: RED_500_SURFACE,
    borderColor: RED_500_BORDER,
  },
  dangerCtaGlyph: {
    color: '#ffffff',
    fontSize: 14,
    lineHeight: 16,
  },
  dangerHelper: {
    color: colors.textMuted,
    flex: 1,
    minWidth: 200,
  },
  dangerIcon: {
    color: RED_300,
  },
  dangerPanel: {
    borderColor: TESLA_RED_30,
  },
  dangerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  deniedIcon: {
    color: colors.warning,
    fontSize: 14,
    lineHeight: 18,
    marginTop: 2,
  },
  deniedList: {
    gap: spacing.md,
  },
  deniedRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
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
  field: {
    gap: spacing.xs,
  },
  fieldLabel: {
    color: colors.textSecondary,
  },
  headerTextCol: {
    flex: 1,
  },
  headingPanel: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
  },
  headingSection: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: -0.2,
    lineHeight: 24,
  },
  headingSub: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
  helperText: {
    color: colors.textMuted,
    marginTop: 2,
  },
  iconBox: {
    alignItems: 'center',
    borderWidth: 1,
    justifyContent: 'center',
  },
  iconBoxAmber: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
  iconBoxCyan: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  iconBoxMd: {
    borderRadius: 12,
    height: 40,
    width: 40,
  },
  iconBoxRed: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  iconBoxSm: {
    borderRadius: 8,
    height: 32,
    width: 32,
  },
  iconGlyphAmber: {
    color: colors.warning,
  },
  iconGlyphCyan: {
    color: colors.accent,
  },
  iconGlyphMd: {
    fontSize: 18,
    lineHeight: 22,
  },
  iconGlyphRed: {
    color: colors.danger,
  },
  iconGlyphSm: {
    fontSize: 14,
    lineHeight: 18,
  },
  input: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 15,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
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
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    flex: 1,
    justifyContent: 'center',
  },
  panel: {
    padding: spacing.lg,
  },
  panelHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: 16,
  },
  panelHeaderTight: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  resetGlyph: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 16,
  },
  root: {
    gap: 24,
  },
  rowTextCol: {
    flex: 1,
  },
  sectionRow: {
    alignItems: 'flex-start',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  sectionRowFirst: {
    paddingTop: 0,
  },
  sectionRowLast: {
    borderBottomWidth: 0,
    paddingBottom: 0,
  },
  warningBox: {
    backgroundColor: AMBER_500_SURFACE,
    borderColor: AMBER_500_BORDER,
  },
  warningIcon: {
    color: AMBER_300,
  },
});

const iconBoxColorStyles: Record<IconBoxColor, ViewStyle> = {
  amber: styles.iconBoxAmber,
  cyan: styles.iconBoxCyan,
  red: styles.iconBoxRed,
};

const iconGlyphColorStyles: Record<IconBoxColor, TextStyle> = {
  amber: styles.iconGlyphAmber,
  cyan: styles.iconGlyphCyan,
  red: styles.iconGlyphRed,
};
