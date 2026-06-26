// LayoutSwitcher — native parity port of
// web/src/features/dashboard/components/LayoutSwitcher.tsx.
//
// Compact dropdown for switching between saved dashboard layouts. The dropdown
// surfaces dashboards visible for the currently selected vehicle (any layout
// pinned to the same vehicleId plus all user-global layouts) and offers
// Save-As, Reset and Pin-to-vehicle affordances. All behaviour, state names,
// the active/visible derivations, the pin toggle logic and the i18n keys are
// preserved 1:1 (every source line is mapped in the .parity.json sidecar).
//
// Native adaptations vs. the web source (browser-only bits become native-safe):
//   - lucide-react icons Check/ChevronDown/Edit3/MoreHorizontal/Pin/Plus/
//     RotateCcw/Save (web L3) -> the GLYPH text-glyph map (lucide is
//     browser-only); the AnalyticsPage/DashboardGrid glyph precedent.
//   - `@/lib/cn` (web L4) -> StyleSheet style arrays.
//   - `@/components/ui` Button/Badge/ConfirmDialog (web L5) -> native Pressable
//     buttons, an inline NativePill (Badge), and a self-contained
//     NativeConfirmDialog Modal (those barrels aren't native parity manifest
//     entries; the BulkActionsToolbar/AcknowledgeAlertDialog dialog precedent).
//   - `@/hooks/useConfirm` (web L6) -> a native useConfirm reproduced
//     self-contained with the identical promise-based {confirm, dialogProps}
//     contract so the handleReset call site stays verbatim. The web
//     silenceKey / requireTypedConfirmation features (confirmSilence +
//     localStorage) are unused by this component and out of scope here.
//   - `@/hooks/useSelectedVehicle` (web L7) -> a native useSelectedVehicle over
//     `useVehicles()` returning {vehicleId, vehicle} (first vehicle). The web
//     react-router URL-precedence + zustand store selection is browser/router
//     only and not wired in this single-file slice — the existing native
//     ChargingListPage useSelectedVehicle uses the same first-vehicle fallback.
//   - react-i18next useTranslation('dashboard') (web L2/55) -> a native-safe
//     t(key, fallback, options?) shim preserving every key, English default and
//     {{var}} interpolation; the namespace arg is accepted and ignored.
//   - the click-outside / Escape document listeners (web L70-84) are browser
//     only -> the dropdown is a transparent <Modal>; its backdrop press
//     (click-outside) and onRequestClose (Escape / hardware back) reproduce the
//     same dismissal contract, so `containerRef` is dropped.
//   - `window.prompt` for Save-As (web L86-100) is browser-only -> a native
//     PromptModal (TextInput) seeded with the same suggestion; submit/cancel map
//     to the web non-null/null prompt result running the identical
//     onDuplicate-else-onCreate branch.
//   - the responsive `hidden sm:flex` quick-action toolbar + `md:inline` labels
//     (web L163-187) are preserved via useWindowDimensions against the Tailwind
//     sm(640)/md(768) breakpoints, so a phone hides the inline toolbar (its
//     actions remain reachable in the dropdown) exactly like the web.
//
// No DOM / lucide-react / Recharts / Leaflet / old web-UI imports reach the
// native output — only react, react-native primitives, the canonical AppText,
// the native useVehicles hook, and theme tokens.

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {colors, shadows, spacing, typography} from '../../../../theme/tokens';
import {useVehicles, type Vehicle} from '../../../api/hooks/useVehicles';

/* ─── Native-safe i18n fallback (web react-i18next useTranslation) ───────────
 * Preserves every key + English default; the 'dashboard' namespace arg is
 * accepted and ignored. {{var}} interpolation is kept for parity even though no
 * call site in this component passes options. */
type InterpolationValues = Record<string, string | number>;
type NativeTFunction = (
  key: string,
  fallback: string,
  options?: InterpolationValues,
) => string;

function interpolate(template: string, values: InterpolationValues): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = values[key];
    return value === undefined ? '' : String(value);
  });
}

function useTranslation(_namespace?: string): {t: NativeTFunction} {
  const t = useCallback<NativeTFunction>(
    (_key, fallback, options) =>
      options ? interpolate(fallback, options) : fallback,
    [],
  );
  return {t};
}

/* ─── Inlined SavedDashboard type (web ../widgets/types) ─────────────────────
 * Reproduced self-contained — `../widgets/types` is not a native parity
 * manifest entry (the DashboardGrid precedent). Only the fields this switcher
 * reads/passes are modelled; the RGL layouts / widget bodies are unrelated. */
interface SavedDashboard {
  id: string;
  name: string;
  icon?: string;
  /** undefined / null → user-global (all vehicles); number → pinned to that id. */
  vehicleId?: number | null;
  isDefault?: boolean;
}

/* ─── lucide-react icon glyphs (web L3) ──────────────────────────────────────
 * Monochrome text glyphs standing in for the browser-only lucide icons; the
 * accessibility labels + adjacent text carry the real meaning. */
const GLYPH = {
  check: '✓',
  chevronDown: '▾',
  edit: '✎',
  more: '⋯',
  pin: '⌖',
  plus: '＋',
  rotateCcw: '↺',
  save: '⤓',
} as const;

/* ─── Tailwind responsive breakpoints (web `sm:` / `md:` prefixes) ───────────*/
const SM_BREAKPOINT = 640;
const MD_BREAKPOINT = 768;

/* ─── Native useSelectedVehicle (web @/hooks/useSelectedVehicle) ─────────────
 * Returns {vehicleId, vehicle} from the first fleet vehicle. The web hook's
 * URL/path precedence + persisted zustand store are router/browser-only and not
 * wired in this slice; this mirrors the existing native ChargingListPage
 * first-vehicle fallback while also surfacing the vehicle record the pinned
 * label needs. */
function useSelectedVehicle(): {
  vehicleId: number | null;
  vehicle: Vehicle | null;
} {
  const {data} = useVehicles();
  const vehicles = data ?? [];
  const vehicle = vehicles.length > 0 ? vehicles[0] : null;
  const vehicleId = vehicle ? vehicle.id : null;
  return {vehicleId, vehicle};
}

/* ─── Native useConfirm (web @/hooks/useConfirm) ─────────────────────────────
 * Promise-based confirmation with the identical {confirm, dialogProps} surface
 * so the handleReset call site is verbatim. */
interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning';
}

interface ConfirmDialogProps extends ConfirmOptions {
  open: true;
  onConfirm: () => void;
  onCancel: () => void;
}

type ConfirmState = ConfirmOptions & {resolve: (ok: boolean) => void};

function useConfirm(): {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  dialogProps: ConfirmDialogProps | null;
} {
  const [state, setState] = useState<ConfirmState | null>(null);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>(resolve => {
      setState(prev => {
        // Resolve any still-open prompt as cancel before replacing it.
        if (prev) {
          prev.resolve(false);
        }
        return {...opts, resolve};
      });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    setState(current => {
      if (current) {
        current.resolve(true);
      }
      return null;
    });
  }, []);

  const handleCancel = useCallback(() => {
    setState(current => {
      if (current) {
        current.resolve(false);
      }
      return null;
    });
  }, []);

  const dialogProps: ConfirmDialogProps | null = state
    ? {
        open: true,
        title: state.title,
        message: state.message,
        confirmLabel: state.confirmLabel,
        cancelLabel: state.cancelLabel,
        variant: state.variant,
        onConfirm: handleConfirm,
        onCancel: handleCancel,
      }
    : null;

  return {confirm, dialogProps};
}

/* ─── Small shared primitives ────────────────────────────────────────────────*/
function Glyph({
  glyph,
  size = 14,
  color,
  style,
}: {
  glyph: string;
  size?: number;
  color?: string;
  style?: StyleProp<TextStyle>;
}): React.ReactElement {
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[styles.glyph, {fontSize: size, color: color ?? colors.textMuted}, style]}>
      {glyph}
    </AppText>
  );
}

/** Native stand-in for the web <Badge> chip (variants used: warning, neutral). */
function NativePill({
  variant,
  leadingGlyph,
  children,
}: {
  variant: 'warning' | 'neutral';
  leadingGlyph?: string;
  children: ReactNode;
}): React.ReactElement {
  return (
    <View
      style={[
        styles.pill,
        variant === 'warning' ? styles.pillWarning : styles.pillNeutral,
      ]}>
      {leadingGlyph ? (
        <Glyph
          glyph={leadingGlyph}
          size={9}
          color={variant === 'warning' ? colors.warning : colors.textSecondary}
        />
      ) : null}
      <AppText
        style={[
          styles.pillText,
          variant === 'warning' ? styles.pillTextWarning : styles.pillTextNeutral,
        ]}
        variant="caption"
        weight="semibold">
        {children}
      </AppText>
    </View>
  );
}

export interface LayoutSwitcherProps {
  dashboards: SavedDashboard[];
  activeId: string;
  /** Truthy while the local state has unsaved changes pending sync. */
  dirty?: boolean;
  /** True when the dashboard is currently in edit mode. */
  editMode?: boolean;
  onSwitch: (id: string) => void;
  onCreate: (name: string) => string | undefined;
  onDuplicate?: (id: string) => void;
  onReset: () => void;
  onToggleEdit?: () => void;
  onPinToVehicle?: (id: string, vehicleId: number | null | undefined) => void;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
}

/**
 * Compact dropdown for switching between saved dashboard layouts.
 *
 * The dropdown surfaces dashboards visible for the currently selected vehicle:
 * any layout pinned to the same `vehicleId` plus all user-global layouts
 * (`vehicleId == null`). When a vehicle is selected and the active layout is
 * pinned to it, the menu offers a "Pin to current vehicle" / "Unpin" toggle so
 * users can carve out vehicle-specific dashboards.
 *
 * Save-As prompts for a name and creates a duplicate of the current layout via
 * `onCreate`. Reset routes through a native confirm dialog from `useConfirm()`.
 */
export function LayoutSwitcher({
  dashboards,
  activeId,
  dirty,
  editMode,
  onSwitch,
  onCreate,
  onDuplicate,
  onReset,
  onToggleEdit,
  onPinToVehicle,
  className: _className,
}: LayoutSwitcherProps): React.ReactElement {
  const {t} = useTranslation('dashboard');
  const {vehicleId, vehicle} = useSelectedVehicle();
  const {confirm, dialogProps} = useConfirm();
  const [open, setOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const {width} = useWindowDimensions();

  const active = dashboards.find(d => d.id === activeId) ?? dashboards[0];

  // Filter the layouts dropdown by current vehicle scope.
  const visible = dashboards.filter(d => {
    const scope = d.vehicleId;
    if (scope == null) {
      return true;
    }
    return vehicleId != null && scope === vehicleId;
  });

  // web handleSaveAs ran window.prompt synchronously; native opens the
  // PromptModal (seeded with the same suggestion) and processes its result in
  // submitSaveAs with the identical onDuplicate-else-onCreate branch.
  const saveAsSuggestion = active
    ? `${active.name} (Copy)`
    : t('layout.newLayoutDefault', 'New Layout');

  const handleSaveAs = () => {
    setOpen(false);
    setPromptOpen(true);
  };

  const submitSaveAs = (name: string) => {
    setPromptOpen(false);
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    if (onDuplicate && active) {
      onDuplicate(active.id);
    } else {
      onCreate(trimmed);
    }
  };

  const handleReset = async () => {
    setOpen(false);
    const ok = await confirm({
      title: t('layout.resetTitle', 'Reset dashboard to default?'),
      message: t(
        'layout.resetMessage',
        'This removes all customizations and restores the shipped default dashboard. Your other saved layouts are not affected.',
      ),
      variant: 'danger',
      confirmLabel: t('layout.resetConfirm', 'Reset'),
    });
    if (ok) {
      onReset();
    }
  };

  const handlePinToggle = () => {
    if (!onPinToVehicle || !active) {
      return;
    }
    setOpen(false);
    if (active.vehicleId != null) {
      onPinToVehicle(active.id, null);
    } else if (vehicleId != null) {
      onPinToVehicle(active.id, vehicleId);
    }
  };

  const activeName = active?.name ?? t('layout.untitled', 'Untitled');
  const pinnedLabel =
    active?.vehicleId != null && vehicle
      ? vehicle.display_name ?? vehicle.vin ?? `#${active.vehicleId}`
      : null;

  const showToolbar = width >= SM_BREAKPOINT;
  const showButtonLabels = width >= MD_BREAKPOINT;
  const pinDisabled = active?.vehicleId == null && vehicleId == null;

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityHint={t('layout.switcherLabel', 'Switch dashboard layout')}
        accessibilityLabel={t('layout.switcherLabel', 'Switch dashboard layout')}
        accessibilityRole="button"
        accessibilityState={{expanded: open}}
        onPress={() => setOpen(v => !v)}
        style={({pressed}) => [styles.trigger, pressed && styles.triggerPressed]}
        testID="layout-switcher-trigger">
        <AppText style={styles.triggerKicker} variant="caption" weight="semibold">
          {t('layout.label', 'Layout')}
        </AppText>
        <AppText
          numberOfLines={1}
          style={styles.triggerName}
          weight="semibold">
          {activeName}
        </AppText>
        {dirty ? (
          <NativePill variant="warning">
            {t('layout.modified', 'modified')}
          </NativePill>
        ) : null}
        {pinnedLabel ? (
          <NativePill leadingGlyph={GLYPH.pin} variant="neutral">
            {pinnedLabel}
          </NativePill>
        ) : null}
        <Glyph glyph={GLYPH.chevronDown} size={13} />
      </Pressable>

      {showToolbar ? (
        <View style={styles.toolbar}>
          {onToggleEdit ? (
            <ToolbarButton
              accessibilityState={{selected: !!editMode}}
              glyph={GLYPH.edit}
              hint={
                editMode
                  ? t('layout.editTitle', 'Exit edit (E)')
                  : t('layout.editTitle', 'Edit dashboard (E)')
              }
              label={
                editMode
                  ? t('layout.editExit', 'Done')
                  : t('layout.editEnter', 'Edit')
              }
              onPress={onToggleEdit}
              showLabel={showButtonLabels}
              testID="layout-switcher-edit"
            />
          ) : null}
          <ToolbarButton
            glyph={GLYPH.save}
            hint={t('layout.saveAs', 'Save as new layout')}
            label={t('layout.saveAsShort', 'Save as')}
            onPress={handleSaveAs}
            showLabel={showButtonLabels}
            testID="layout-switcher-saveas"
          />
          <ToolbarButton
            glyph={GLYPH.rotateCcw}
            hint={t('layout.reset', 'Reset to default')}
            label={t('layout.reset', 'Reset to default')}
            onPress={handleReset}
            showLabel={false}
            testID="layout-switcher-reset"
          />
        </View>
      ) : null}

      <Modal
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        transparent
        visible={open}>
        <View style={styles.menuOverlay}>
          <Pressable
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            onPress={() => setOpen(false)}
            style={styles.backdrop}
          />
          <View
            accessibilityLabel={t('layout.menuLabel', 'Saved layouts')}
            accessibilityRole="menu"
            style={styles.menuCard}
            testID="layout-switcher-menu">
            <ScrollView style={styles.menuList}>
              {visible.length === 0 ? (
                <AppText style={styles.menuEmpty} tone="muted" variant="caption">
                  {t(
                    'layout.noneVisible',
                    'No layouts available for this vehicle.',
                  )}
                </AppText>
              ) : (
                visible.map(d => {
                  const isActive = d.id === active?.id;
                  return (
                    <Pressable
                      accessibilityRole="menuitem"
                      accessibilityState={{checked: isActive, selected: isActive}}
                      key={d.id}
                      onPress={() => {
                        onSwitch(d.id);
                        setOpen(false);
                      }}
                      style={({pressed}) => [
                        styles.menuItem,
                        isActive && styles.menuItemActive,
                        pressed && !isActive && styles.menuItemPressed,
                      ]}>
                      <View style={styles.menuItemLabel}>
                        <AppText
                          numberOfLines={1}
                          style={isActive ? styles.menuItemTextActive : undefined}>
                          {d.name}
                        </AppText>
                        {d.isDefault ? (
                          <NativePill variant="neutral">
                            {t('layout.defaultBadge', 'default')}
                          </NativePill>
                        ) : null}
                        {d.vehicleId != null ? (
                          <Glyph glyph={GLYPH.pin} size={11} />
                        ) : null}
                      </View>
                      {isActive ? (
                        <Glyph
                          color={colors.accent}
                          glyph={GLYPH.check}
                          size={13}
                        />
                      ) : null}
                    </Pressable>
                  );
                })
              )}
            </ScrollView>

            <View style={styles.divider} />

            <Pressable
              accessibilityRole="menuitem"
              onPress={handleSaveAs}
              style={({pressed}) => [
                styles.menuAction,
                pressed && styles.menuItemPressed,
              ]}>
              <Glyph glyph={GLYPH.plus} size={13} />
              <AppText>{t('layout.newFromCurrent', 'New layout from current')}</AppText>
            </Pressable>

            {onPinToVehicle && active ? (
              <Pressable
                accessibilityRole="menuitem"
                accessibilityState={{disabled: pinDisabled}}
                disabled={pinDisabled}
                onPress={handlePinToggle}
                style={({pressed}) => [
                  styles.menuAction,
                  pinDisabled && styles.menuActionDisabled,
                  pressed && !pinDisabled && styles.menuItemPressed,
                ]}>
                <Glyph glyph={GLYPH.pin} size={13} />
                <AppText>
                  {active.vehicleId != null
                    ? t('layout.unpin', 'Unpin from vehicle')
                    : t('layout.pin', 'Pin to current vehicle')}
                </AppText>
              </Pressable>
            ) : null}

            <Pressable
              accessibilityRole="menuitem"
              onPress={handleReset}
              style={({pressed}) => [
                styles.menuAction,
                pressed && styles.menuActionDangerPressed,
              ]}>
              <Glyph color={colors.danger} glyph={GLYPH.rotateCcw} size={13} />
              <AppText style={styles.menuActionDangerText}>
                {t('layout.reset', 'Reset to default')}
              </AppText>
            </Pressable>

            <View style={styles.divider} />

            <View style={styles.menuFooter}>
              <Glyph glyph={GLYPH.more} size={11} />
              <AppText style={styles.menuFooterText} tone="muted" variant="caption">
                {t('layout.menuFooter', 'Manage layouts in the tab strip below')}
              </AppText>
            </View>
          </View>
        </View>
      </Modal>

      <PromptModal
        cancelLabel={t('layout.saveAsCancel', 'Cancel')}
        initialValue={saveAsSuggestion}
        onCancel={() => setPromptOpen(false)}
        onSubmit={submitSaveAs}
        submitLabel={t('layout.saveAsConfirm', 'Save')}
        title={t('layout.saveAsPrompt', 'Name for the new layout:')}
        visible={promptOpen}
      />

      {dialogProps ? <NativeConfirmDialog {...dialogProps} /> : null}
    </View>
  );
}
LayoutSwitcher.displayName = 'LayoutSwitcher';

/** Ghost icon button for the responsive quick-action toolbar (web <Button>). */
function ToolbarButton({
  glyph,
  label,
  hint,
  onPress,
  showLabel,
  testID,
  accessibilityState,
}: {
  glyph: string;
  label: string;
  hint: string;
  onPress: () => void;
  showLabel: boolean;
  testID: string;
  accessibilityState?: {selected?: boolean};
}): React.ReactElement {
  return (
    <Pressable
      accessibilityHint={hint}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      hitSlop={6}
      onPress={onPress}
      style={({pressed}) => [styles.toolbarBtn, pressed && styles.triggerPressed]}
      testID={testID}>
      <Glyph glyph={glyph} size={13} color={colors.textSecondary} />
      {showLabel ? (
        <AppText style={styles.toolbarBtnLabel} variant="caption" weight="semibold">
          {label}
        </AppText>
      ) : null}
    </Pressable>
  );
}

/** Native replacement for web `window.prompt` (Save-As name entry). */
function PromptModal({
  visible,
  title,
  initialValue,
  submitLabel,
  cancelLabel,
  onSubmit,
  onCancel,
}: {
  visible: boolean;
  title: string;
  initialValue: string;
  submitLabel: string;
  cancelLabel: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}): React.ReactElement {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<TextInput | null>(null);

  // Reseed with the current suggestion and focus the field each time the prompt
  // opens (mirrors window.prompt presenting the suggestion pre-selected).
  useEffect(() => {
    if (visible) {
      setValue(initialValue);
      const id = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [visible, initialValue]);

  return (
    <Modal
      animationType="fade"
      onRequestClose={onCancel}
      transparent
      visible={visible}>
      <View
        accessibilityLabel={title}
        accessibilityRole="alert"
        accessible
        style={styles.overlay}>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={onCancel}
          style={styles.backdrop}
        />
        <View style={styles.dialog} testID="layout-switcher-prompt">
          <AppText variant="title" weight="bold">
            {title}
          </AppText>
          <TextInput
            accessibilityLabel={title}
            onChangeText={setValue}
            onSubmitEditing={() => onSubmit(value)}
            placeholderTextColor={colors.textMuted}
            ref={inputRef}
            returnKeyType="done"
            style={styles.promptInput}
            testID="layout-switcher-prompt-input"
            value={value}
          />
          <View style={styles.dialogActions}>
            <DialogButton
              label={cancelLabel}
              onPress={onCancel}
              testID="layout-switcher-prompt-cancel"
              variant="secondary"
            />
            <DialogButton
              label={submitLabel}
              onPress={() => onSubmit(value)}
              testID="layout-switcher-prompt-submit"
              variant="primary"
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** Native replacement for the web shared <ConfirmDialog> (reset gate). */
function NativeConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  variant,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): React.ReactElement {
  const {t} = useTranslation('dashboard');
  return (
    <Modal animationType="fade" onRequestClose={onCancel} transparent visible>
      <View
        accessibilityLabel={title}
        accessibilityRole="alert"
        accessible
        style={styles.overlay}>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={onCancel}
          style={styles.backdrop}
        />
        <View style={styles.dialog} testID="layout-switcher-confirm">
          <View
            pointerEvents="none"
            style={[
              styles.confirmMarker,
              variant === 'danger'
                ? styles.confirmMarkerDanger
                : styles.confirmMarkerWarning,
            ]}
          />
          <AppText variant="title" weight="bold">
            {title}
          </AppText>
          <AppText style={styles.confirmMessage} tone="secondary">
            {message}
          </AppText>
          <View style={styles.dialogActions}>
            <DialogButton
              label={cancelLabel ?? t('layout.cancel', 'Cancel')}
              onPress={onCancel}
              testID="layout-switcher-confirm-cancel"
              variant="secondary"
            />
            <DialogButton
              label={confirmLabel ?? t('layout.confirm', 'Confirm')}
              onPress={onConfirm}
              testID="layout-switcher-confirm-ok"
              variant={variant === 'danger' ? 'danger' : 'warning'}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function DialogButton({
  label,
  onPress,
  testID,
  variant,
}: {
  label: string;
  onPress: () => void;
  testID: string;
  variant: 'primary' | 'secondary' | 'danger' | 'warning';
}): React.ReactElement {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({pressed}) => [
        styles.dialogButton,
        dialogButtonStyles[variant],
        pressed && styles.triggerPressed,
      ]}
      testID={testID}>
      <AppText
        style={dialogButtonTextStyles[variant]}
        variant="caption"
        weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  confirmMarker: {
    borderRadius: 999,
    height: 4,
    width: 44,
  },
  confirmMarkerDanger: {
    backgroundColor: colors.danger,
  },
  confirmMarkerWarning: {
    backgroundColor: colors.warning,
  },
  confirmMessage: {
    lineHeight: 20,
  },
  container: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  dialog: {
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderAccent,
    borderRadius: 24,
    borderWidth: 1,
    gap: spacing.md,
    margin: spacing.lg,
    maxWidth: 520,
    padding: spacing.lg,
    width: '92%',
    ...shadows.panel,
  },
  dialogActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'flex-end',
    paddingTop: spacing.xs,
  },
  dialogButton: {
    alignItems: 'center',
    borderRadius: 14,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 96,
    paddingHorizontal: spacing.lg,
  },
  dialogButtonDanger: {
    backgroundColor: colors.danger,
  },
  dialogButtonPrimary: {
    backgroundColor: colors.accent,
  },
  dialogButtonSecondary: {
    backgroundColor: 'transparent',
    borderColor: colors.border,
    borderWidth: 1,
  },
  dialogButtonTextDanger: {
    color: colors.background,
  },
  dialogButtonTextPrimary: {
    color: colors.background,
  },
  dialogButtonTextSecondary: {
    color: colors.textSecondary,
  },
  dialogButtonTextWarning: {
    color: colors.background,
  },
  dialogButtonWarning: {
    backgroundColor: colors.warning,
  },
  divider: {
    backgroundColor: colors.border,
    height: StyleSheet.hairlineWidth,
    marginVertical: spacing.xs,
  },
  glyph: {
    color: colors.textMuted,
  },
  menuAction: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  menuActionDangerPressed: {
    backgroundColor: colors.dangerSurface,
  },
  menuActionDangerText: {
    color: colors.danger,
  },
  menuActionDisabled: {
    opacity: 0.4,
  },
  menuCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    maxWidth: 420,
    minWidth: 256,
    padding: spacing.sm,
    width: '100%',
    ...shadows.panel,
  },
  menuEmpty: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  menuFooter: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  menuFooterText: {
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  menuItem: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  menuItemActive: {
    backgroundColor: colors.accentSoft,
  },
  menuItemLabel: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: spacing.sm,
  },
  menuItemPressed: {
    backgroundColor: colors.surfaceRaised,
  },
  menuItemTextActive: {
    color: colors.accent,
  },
  menuList: {
    maxHeight: 288,
  },
  menuOverlay: {
    alignItems: 'flex-start',
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: 76,
  },
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    flex: 1,
    justifyContent: 'center',
  },
  pill: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  pillNeutral: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
  pillText: {
    fontSize: 10,
    lineHeight: 14,
  },
  pillTextNeutral: {
    color: colors.textSecondary,
  },
  pillTextWarning: {
    color: colors.warning,
  },
  pillWarning: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
  promptInput: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: typography.body,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  toolbar: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  toolbarBtn: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  toolbarBtnLabel: {
    color: colors.textSecondary,
  },
  trigger: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  triggerKicker: {
    color: colors.textMuted,
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  triggerName: {
    color: colors.textPrimary,
    maxWidth: 160,
  },
  triggerPressed: {
    opacity: 0.82,
  },
});

const dialogButtonStyles = {
  primary: styles.dialogButtonPrimary,
  secondary: styles.dialogButtonSecondary,
  danger: styles.dialogButtonDanger,
  warning: styles.dialogButtonWarning,
} as const;

const dialogButtonTextStyles = {
  primary: styles.dialogButtonTextPrimary,
  secondary: styles.dialogButtonTextSecondary,
  danger: styles.dialogButtonTextDanger,
  warning: styles.dialogButtonTextWarning,
} as const;
