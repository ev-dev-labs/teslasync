import {Glyph} from '../../../../components/icons/Glyph';
// Native parity port of web/src/features/dashboard/components/KioskSettingsModal.tsx.
//
// `KioskSettingsModal` is the configuration sheet that opens before a dashboard
// enters full-screen kiosk mode. It lets the operator pick the rotation
// interval (and which saved dashboards rotate), the cursor auto-hide / screen
// dimming / clock display behaviour, and the widget + background transparency,
// then commits the chosen `dashboardIds` and calls `onEnterKiosk`.
//
// The web source pulls several DOM / web-only dependencies that have no native
// parity surface (conversion rules 4/5/7); each is reproduced with a native-safe
// primitive in this file and recorded in the sidecar:
//   - react-i18next `useTranslation` is absent from the native deps, so it is a
//     local fallback resolver returning the inline English string (the same
//     approach as the DensityToggle / VehiclePaintPicker / ConfirmDialog ports).
//     Every i18n key + default is preserved verbatim so intent is kept.
//   - lucide-react `Maximize2` / `Monitor` SVG icons have no native analog
//     (react-native-svg is not a dependency), so each renders a small decorative
//     glyph stand-in flagged aria-hidden (the AutomationCard glyph precedent).
//   - `@/components/ui` `Modal` -> the RN core `Modal` primitive (transparent
//     fade, backdrop-tap + hardware-back close via onRequestClose), with a
//     ScrollView body so the long settings list scrolls like the web sheet.
//   - `@/components/ui` `Toggle` -> the RN core `Switch` primitive
//     (role=switch, onValueChange -> onChange(checked)).
//   - `@/components/ui` `Select` -> a native-safe labelled radiogroup of
//     selectable chips. The web `onChange(e => ... e.target.value)` event shape
//     has no native analog, so the native `Select` emits the option value
//     directly and the call sites keep their identical `Number(value)` /
//     `value as KioskConfig['clockPosition']` update logic.
//   - `@/components/ui` `Input type="checkbox"` -> a native-safe Pressable
//     checkbox row (role=checkbox) preserving the "can't deselect the last
//     dashboard" guard that lives in `toggleDashboard`.
//   - `@/components/ui` `Slider` (an `<input type=range>`) has no native core
//     slider and @react-native-community/slider is not installed, so it becomes
//     a native-safe adjustable control: a value-fill track plus -/+ stepper
//     buttons (clamped to min/max, stepping by `step`) and the WAI-ARIA
//     adjustable increment/decrement actions. `formatValue`, min, max, step,
//     value and onChange(number) are all preserved; the web pointer-drag and the
//     preview's CSS `backdrop-filter: blur()` have no native analog and are
//     documented as unavailable.
//   - `@/components/forms` `FormSection` -> a local titled section View
//     (glass-panel card with a heading + spaced body) matching the web layout.
//
// Behaviour preserved 1:1: the `selectedIds` Set state seeded from
// `config.dashboardIds` (falling back to every dashboard id), `toggleDashboard`
// (add / remove with the size>1 floor + immediate `onUpdateConfig`), and
// `handleEnter` (commit ids -> onClose -> onEnterKiosk). The rotation
// dashboard-picker only shows when `rotateInterval > 0 && dashboards.length > 1`;
// the cursor-timeout / dim-brightness / clock-position sub-controls stay gated on
// their parent toggle exactly as the source. The live preview swatch keeps the
// dynamic rgba opacity math for background + widget panels.

import React, {useCallback, useMemo, useState} from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
  type AccessibilityActionEvent,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';

// ── i18n shim ───────────────────────────────────────────────────────────────
// react-i18next has no native parity module; like the other web-parity ports,
// translations resolve to their inline English fallback. The hook shape mirrors
// the web `const { t } = useTranslation()` so the component body is unchanged.
type TFunc = (key: string, fallback: string) => string;

function useTranslation(): {t: TFunc} {
  return {t: (_key, fallback) => fallback};
}

// ── Type reproductions ──────────────────────────────────────────────────────
// Reproduced from web/src/features/dashboard/hooks/useKioskMode.ts. The web file
// imports `KioskConfig` as a type; the native hook is ported separately, so the
// config contract is mirrored locally (and exported) so this component and any
// future native consumer agree on the shape.
export interface KioskConfig {
  rotateInterval: number;
  dashboardIds: string[];
  hideCursor: boolean;
  cursorTimeout: number;
  dimAfter: number;
  dimLevel: number;
  showClock: boolean;
  clockPosition: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  /** Widget panel opacity: 0.3 (transparent) to 1.0 (solid/readable) */
  widgetOpacity: number;
  /** Page background opacity: 0.0 (transparent) to 1.0 (solid) */
  backgroundOpacity: number;
}

// Subset of web/src/features/dashboard/widgets/types.ts `SavedDashboard` — only
// the fields this modal consumes (id / name / isDefault) are modeled; the full
// widget/layout blob belongs to the dedicated widgets/types parity port.
export interface SavedDashboard {
  id: string;
  name: string;
  isDefault?: boolean;
}

export interface KioskSettingsModalProps {
  open: boolean;
  onClose: () => void;
  config: KioskConfig;
  onUpdateConfig: (updates: Partial<KioskConfig>) => void;
  onEnterKiosk: () => void;
  dashboards: SavedDashboard[];
}

interface SelectOption {
  value: string;
  label: string;
}

const ROTATION_OPTIONS: SelectOption[] = [
  {value: '0', label: 'Off'},
  {value: '10', label: '10s'},
  {value: '15', label: '15s'},
  {value: '30', label: '30s'},
  {value: '60', label: '1 min'},
  {value: '120', label: '2 min'},
  {value: '300', label: '5 min'},
];

const CURSOR_TIMEOUT_OPTIONS: SelectOption[] = [
  {value: '3', label: '3s'},
  {value: '5', label: '5s'},
  {value: '10', label: '10s'},
  {value: '15', label: '15s'},
];

const DIM_AFTER_OPTIONS: SelectOption[] = [
  {value: '0', label: 'Never'},
  {value: '5', label: '5 min'},
  {value: '10', label: '10 min'},
  {value: '15', label: '15 min'},
  {value: '30', label: '30 min'},
  {value: '60', label: '60 min'},
];

const CLOCK_POSITION_OPTIONS: SelectOption[] = [
  {value: 'top-left', label: 'Top Left'},
  {value: 'top-right', label: 'Top Right'},
  {value: 'bottom-left', label: 'Bottom Left'},
  {value: 'bottom-right', label: 'Bottom Right'},
];

const SLIDER_ACCESSIBILITY_ACTIONS = [
  {name: 'increment' as const},
  {name: 'decrement' as const},
];

// ── Decorative glyph (lucide stand-in) ──────────────────────────────────────
function GlyphLegacyUnused({
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

// ── FormSection (native equivalent of @/components/forms FormSection) ─────────
function FormSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <View style={styles.formSection}>
      <AppText style={styles.sectionTitle} weight="semibold">
        {title}
      </AppText>
      <View style={styles.formSectionBody}>{children}</View>
    </View>
  );
}

// ── ToggleRow (native equivalent of @/components/ui Toggle) ──────────────────
function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}): React.ReactElement {
  return (
    <View style={styles.toggleRow}>
      <AppText style={styles.toggleLabel} tone="secondary" weight="semibold">
        {label}
      </AppText>
      <Switch
        accessibilityLabel={label}
        ios_backgroundColor="#4b5563"
        onValueChange={onChange}
        thumbColor="#ffffff"
        trackColor={{false: '#4b5563', true: colors.accent}}
        value={checked}
      />
    </View>
  );
}

// ── Select (native equivalent of @/components/ui Select) ─────────────────────
// The web `<select>` `onChange` handed back a DOM ChangeEvent; the native
// radiogroup emits the option value directly so call sites keep their identical
// Number()/cast update logic without a synthetic event.
function Select({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
}): React.ReactElement {
  return (
    <View style={styles.field}>
      <AppText style={styles.fieldLabel} tone="secondary" weight="semibold">
        {label}
      </AppText>
      <View
        accessibilityLabel={label}
        accessibilityRole="radiogroup"
        style={styles.optionRow}>
        {options.map(opt => {
          const selected = opt.value === value;
          return (
            <Pressable
              accessibilityLabel={opt.label}
              accessibilityRole="radio"
              accessibilityState={{checked: selected, selected}}
              key={opt.value}
              onPress={() => onChange(opt.value)}
              style={({pressed}) => [
                styles.chip,
                selected ? styles.chipSelected : styles.chipIdle,
                pressed && !selected && styles.chipPressed,
              ]}>
              <AppText
                style={selected ? styles.chipLabelSelected : styles.chipLabel}
                variant="caption"
                weight="semibold">
                {opt.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ── CheckboxRow (native equivalent of @/components/ui Input[type=checkbox]) ───
function CheckboxRow({
  checked,
  onChange,
  label,
  isDefault,
  defaultLabel,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  isDefault: boolean;
  defaultLabel: string;
}): React.ReactElement {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="checkbox"
      accessibilityState={{checked}}
      onPress={onChange}
      style={({pressed}) => [
        styles.checkboxRow,
        pressed && styles.checkboxRowPressed,
      ]}>
      <View
        style={[
          styles.checkbox,
          checked ? styles.checkboxChecked : styles.checkboxIdle,
        ]}>
        {checked ? (
          <AppText style={styles.checkboxGlyph} weight="bold">
            ✓
          </AppText>
        ) : null}
      </View>
      <AppText style={styles.checkboxLabel}>{label}</AppText>
      {isDefault ? (
        <AppText style={styles.defaultBadge} variant="caption">
          {defaultLabel}
        </AppText>
      ) : null}
    </Pressable>
  );
}

// ── Slider (native-safe equivalent of @/components/ui Slider) ────────────────
// No core RN slider exists and the community package is not installed, so the
// range input becomes a value-fill track plus -/+ steppers. Pointer-drag has no
// native analog; the WAI-ARIA adjustable increment/decrement actions provide the
// screen-reader equivalent. min/max/step/value/onChange/formatValue preserved.
function Slider({
  label,
  formatValue,
  min,
  max,
  step = 1,
  value,
  onChange,
}: {
  label: string;
  formatValue?: (n: number) => string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
}): React.ReactElement {
  const clamp = useCallback(
    (n: number) => Math.min(max, Math.max(min, n)),
    [max, min],
  );
  const clamped = clamp(value);
  const display = formatValue ? formatValue(value) : String(value);
  const fraction = max > min ? (clamped - min) / (max - min) : 0;
  const fillWidth = `${Math.round(fraction * 100)}%` as const;
  const atMin = clamped <= min;
  const atMax = clamped >= max;

  const decrement = useCallback(
    () => onChange(clamp(clamped - step)),
    [clamp, clamped, onChange, step],
  );
  const increment = useCallback(
    () => onChange(clamp(clamped + step)),
    [clamp, clamped, onChange, step],
  );

  const onAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      if (event.nativeEvent.actionName === 'increment') {
        increment();
      } else if (event.nativeEvent.actionName === 'decrement') {
        decrement();
      }
    },
    [decrement, increment],
  );

  return (
    <View
      accessibilityActions={SLIDER_ACCESSIBILITY_ACTIONS}
      accessibilityLabel={label}
      accessibilityRole="adjustable"
      accessibilityValue={{
        max,
        min,
        now: Math.round(clamped),
        text: display,
      }}
      onAccessibilityAction={onAccessibilityAction}
      style={styles.slider}>
      <View style={styles.sliderHeader}>
        <AppText style={styles.fieldLabel} tone="secondary" weight="semibold">
          {label}
        </AppText>
        <AppText style={styles.sliderValue} variant="caption" weight="semibold">
          {display}
        </AppText>
      </View>
      <View style={styles.sliderControls}>
        <Pressable
          accessibilityLabel={`${label} decrease`}
          accessibilityRole="button"
          accessibilityState={{disabled: atMin}}
          disabled={atMin}
          onPress={decrement}
          style={({pressed}) => [
            styles.stepperButton,
            atMin && styles.stepperDisabled,
            pressed && !atMin && styles.pressed,
          ]}>
          <AppText style={styles.stepperGlyph} weight="bold">
            −
          </AppText>
        </Pressable>
        <View pointerEvents="none" style={styles.sliderTrack}>
          <View style={[styles.sliderFill, {width: fillWidth}]} />
        </View>
        <Pressable
          accessibilityLabel={`${label} increase`}
          accessibilityRole="button"
          accessibilityState={{disabled: atMax}}
          disabled={atMax}
          onPress={increment}
          style={({pressed}) => [
            styles.stepperButton,
            atMax && styles.stepperDisabled,
            pressed && !atMax && styles.pressed,
          ]}>
          <AppText style={styles.stepperGlyph} weight="bold">
            +
          </AppText>
        </Pressable>
      </View>
    </View>
  );
}

// ── KioskSettingsModal ──────────────────────────────────────────────────────
export function KioskSettingsModal({
  open,
  onClose,
  config,
  onUpdateConfig,
  onEnterKiosk,
  dashboards,
}: KioskSettingsModalProps): React.ReactElement {
  const {t} = useTranslation();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () =>
      new Set(
        config.dashboardIds.length > 0
          ? config.dashboardIds
          : dashboards.map(d => d.id),
      ),
  );

  const toggleDashboard = useCallback(
    (id: string) => {
      setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(id)) {
          if (next.size > 1) next.delete(id);
        } else {
          next.add(id);
        }
        const ids = Array.from(next);
        onUpdateConfig({dashboardIds: ids});
        return next;
      });
    },
    [onUpdateConfig],
  );

  const handleEnter = useCallback(() => {
    onUpdateConfig({dashboardIds: Array.from(selectedIds)});
    onClose();
    onEnterKiosk();
  }, [onClose, onEnterKiosk, onUpdateConfig, selectedIds]);

  // Live preview opacity math (web inline-style rgba expressions).
  const previewBackground = useMemo(
    () => `rgba(10, 10, 20, ${config.backgroundOpacity ?? 1})`,
    [config.backgroundOpacity],
  );
  const previewWidget = useMemo(
    () => `rgba(255, 255, 255, ${0.03 + (config.widgetOpacity ?? 1) * 0.17})`,
    [config.widgetOpacity],
  );

  const title = t('kiosk.settings', 'Kiosk Settings');

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible={open}>
      <View
        accessibilityLabel={title}
        accessibilityViewIsModal
        style={styles.overlay}>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={onClose}
          style={styles.backdrop}
        />

        <View style={styles.dialog} testID="kiosk-settings-modal">
          <View style={styles.dialogHeader}>
            <AppText style={styles.dialogTitle} variant="title" weight="bold">
              {title}
            </AppText>
            <Pressable
              accessibilityLabel={t('common.close', 'Close')}
              accessibilityRole="button"
              onPress={onClose}
              style={({pressed}) => [
                styles.closeButton,
                pressed && styles.pressed,
              ]}>
              <Glyph glyph="✕" style={styles.closeGlyph} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.body}
            style={styles.bodyScroll}>
            {/* Rotation */}
            <FormSection title={t('kiosk.rotation', 'Dashboard Rotation')}>
              <View style={styles.stack3}>
                <Select
                  label={t('kiosk.rotationInterval', 'Rotation Interval')}
                  onChange={value =>
                    onUpdateConfig({rotateInterval: Number(value)})
                  }
                  options={ROTATION_OPTIONS}
                  value={String(config.rotateInterval)}
                />

                {config.rotateInterval > 0 && dashboards.length > 1 ? (
                  <View style={styles.stack2}>
                    <AppText
                      style={styles.fieldLabel}
                      tone="secondary"
                      weight="semibold">
                      {t('kiosk.dashboardsToRotate', 'Dashboards to Rotate')}
                    </AppText>
                    <ScrollView
                      nestedScrollEnabled
                      style={styles.dashboardList}>
                      {dashboards.map(d => (
                        <CheckboxRow
                          checked={selectedIds.has(d.id)}
                          defaultLabel={t('kiosk.default', 'Default')}
                          isDefault={Boolean(d.isDefault)}
                          key={d.id}
                          label={d.name}
                          onChange={() => toggleDashboard(d.id)}
                        />
                      ))}
                    </ScrollView>
                  </View>
                ) : null}
              </View>
            </FormSection>

            {/* Display settings */}
            <FormSection title={t('kiosk.display', 'Display')}>
              <View style={styles.stack4}>
                {/* Cursor auto-hide */}
                <View style={styles.stack2}>
                  <ToggleRow
                    checked={config.hideCursor}
                    label={t('kiosk.hideCursor', 'Auto-hide Cursor')}
                    onChange={v => onUpdateConfig({hideCursor: v})}
                  />
                  {config.hideCursor ? (
                    <Select
                      label={t('kiosk.cursorTimeout', 'Hide After')}
                      onChange={value =>
                        onUpdateConfig({cursorTimeout: Number(value)})
                      }
                      options={CURSOR_TIMEOUT_OPTIONS}
                      value={String(config.cursorTimeout)}
                    />
                  ) : null}
                </View>

                {/* Screen dimming */}
                <View style={styles.stack2}>
                  <Select
                    label={t('kiosk.dimAfter', 'Dim Screen After')}
                    onChange={value =>
                      onUpdateConfig({dimAfter: Number(value)})
                    }
                    options={DIM_AFTER_OPTIONS}
                    value={String(config.dimAfter)}
                  />
                  {config.dimAfter > 0 ? (
                    <Slider
                      formatValue={n => `${Math.round(n)}%`}
                      label={t('kiosk.brightness', 'Dimmed Brightness')}
                      max={90}
                      min={30}
                      onChange={n => onUpdateConfig({dimLevel: n / 100})}
                      value={Math.round(config.dimLevel * 100)}
                    />
                  ) : null}
                </View>

                {/* Clock */}
                <View style={styles.stack2}>
                  <ToggleRow
                    checked={config.showClock}
                    label={t('kiosk.showClock', 'Show Clock')}
                    onChange={v => onUpdateConfig({showClock: v})}
                  />
                  {config.showClock ? (
                    <Select
                      label={t('kiosk.clockPosition', 'Clock Position')}
                      onChange={value =>
                        onUpdateConfig({
                          clockPosition: value as KioskConfig['clockPosition'],
                        })
                      }
                      options={CLOCK_POSITION_OPTIONS}
                      value={config.clockPosition}
                    />
                  ) : null}
                </View>
              </View>
            </FormSection>

            {/* Transparency controls */}
            <FormSection title={t('kiosk.transparency', 'Transparency')}>
              <AppText style={styles.transparencyDesc} tone="muted" variant="caption">
                {t(
                  'kiosk.transparencyDesc',
                  'Adjust widget and background opacity. Higher values are more solid and readable.',
                )}
              </AppText>

              {/* Widget panel opacity */}
              <View style={styles.stack15}>
                <Slider
                  formatValue={n => `${Math.round(n)}%`}
                  label={t('kiosk.widgetOpacity', 'Widget Opacity')}
                  max={100}
                  min={30}
                  onChange={n => onUpdateConfig({widgetOpacity: n / 100})}
                  step={5}
                  value={Math.round((config.widgetOpacity ?? 1) * 100)}
                />
                <View style={styles.scaleRow}>
                  <AppText style={styles.scaleHint} variant="caption">
                    {t('kiosk.transparent', 'Transparent')}
                  </AppText>
                  <AppText style={styles.scaleHint} variant="caption">
                    {t('kiosk.solid', 'Solid')}
                  </AppText>
                </View>
              </View>

              {/* Background opacity */}
              <View style={[styles.stack15, styles.mt4]}>
                <Slider
                  formatValue={n => `${Math.round(n)}%`}
                  label={t('kiosk.bgOpacity', 'Background Opacity')}
                  max={100}
                  min={0}
                  onChange={n => onUpdateConfig({backgroundOpacity: n / 100})}
                  step={5}
                  value={Math.round((config.backgroundOpacity ?? 1) * 100)}
                />
                <View style={styles.scaleRow}>
                  <AppText style={styles.scaleHint} variant="caption">
                    {t('kiosk.transparent', 'Transparent')}
                  </AppText>
                  <AppText style={styles.scaleHint} variant="caption">
                    {t('kiosk.solid', 'Solid')}
                  </AppText>
                </View>
              </View>

              {/* Live preview swatch */}
              <View style={styles.previewBox}>
                <View
                  pointerEvents="none"
                  style={[styles.previewBackground, {backgroundColor: previewBackground}]}
                />
                <View
                  style={[styles.previewWidget, {backgroundColor: previewWidget}]}>
                  <AppText style={styles.previewText} tone="secondary" variant="caption">
                    {t('kiosk.preview', 'Preview — this is how widgets will look')}
                  </AppText>
                </View>
              </View>
            </FormSection>

            {/* Hint */}
            <View style={styles.hintRow}>
              <Glyph glyph="🖥" style={styles.hintGlyph} />
              <AppText style={styles.hintText} tone="muted" variant="caption">
                {t(
                  'kiosk.hint',
                  'Kiosk mode enters fullscreen and hides all navigation. Move the mouse or touch the screen to reveal the exit button. Press Esc to exit.',
                )}
              </AppText>
            </View>

            {/* Actions */}
            <View style={styles.actionRow}>
              <Pressable
                accessibilityLabel={t('common.cancel', 'Cancel')}
                accessibilityRole="button"
                onPress={onClose}
                style={({pressed}) => [
                  styles.button,
                  styles.ghostButton,
                  pressed && styles.pressed,
                ]}>
                <AppText style={styles.ghostButtonText} weight="semibold">
                  {t('common.cancel', 'Cancel')}
                </AppText>
              </Pressable>
              <Pressable
                accessibilityLabel={t('kiosk.enter', 'Enter Kiosk Mode')}
                accessibilityRole="button"
                onPress={handleEnter}
                style={({pressed}) => [
                  styles.button,
                  styles.primaryButton,
                  pressed && styles.pressed,
                ]}>
                <Glyph glyph="⤢" style={styles.primaryButtonGlyph} />
                <AppText style={styles.primaryButtonText} weight="semibold">
                  {t('kiosk.enter', 'Enter Kiosk Mode')}
                </AppText>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

KioskSettingsModal.displayName = 'KioskSettingsModal';

const styles = StyleSheet.create({
  actionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
    paddingTop: spacing.sm,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  body: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  bodyScroll: {
    flexGrow: 0,
  },
  button: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: spacing.lg,
  },
  checkbox: {
    alignItems: 'center',
    borderRadius: 4,
    borderWidth: 1,
    height: 18,
    justifyContent: 'center',
    width: 18,
  },
  checkboxChecked: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  checkboxGlyph: {
    color: colors.background,
    fontSize: 12,
    lineHeight: 14,
  },
  checkboxIdle: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderColor: colors.border,
  },
  checkboxLabel: {
    color: colors.textPrimary,
    flexShrink: 1,
  },
  checkboxRow: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 10,
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  checkboxRowPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  chip: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  chipIdle: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderColor: colors.border,
  },
  chipLabel: {
    color: colors.textSecondary,
  },
  chipLabelSelected: {
    color: colors.accent,
  },
  chipPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  chipSelected: {
    backgroundColor: colors.surfaceSelected,
    borderColor: colors.borderAccent,
  },
  dashboardList: {
    flexGrow: 0,
    maxHeight: 160,
  },
  closeButton: {
    alignItems: 'center',
    borderRadius: 10,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  closeGlyph: {
    color: colors.textSecondary,
    fontSize: 16,
  },
  defaultBadge: {
    color: colors.textMuted,
    fontSize: 10,
    marginLeft: 'auto',
  },
  dialog: {
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderAccent,
    borderRadius: 24,
    borderWidth: 1,
    maxHeight: '88%',
    maxWidth: 600,
    overflow: 'hidden',
    width: '94%',
  },
  dialogHeader: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  dialogTitle: {
    color: colors.textPrimary,
    flexShrink: 1,
  },
  field: {
    gap: spacing.sm,
  },
  fieldLabel: {
    color: colors.textSecondary,
  },
  formSection: {
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  formSectionBody: {
    gap: spacing.md,
  },
  ghostButton: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
  },
  ghostButtonText: {
    color: colors.textPrimary,
  },
  glyph: {
    fontSize: 14,
    lineHeight: 18,
  },
  hintGlyph: {
    fontSize: 16,
    marginTop: 1,
  },
  hintRow: {
    alignItems: 'flex-start',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 10,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  hintText: {
    color: colors.textMuted,
    flexShrink: 1,
    lineHeight: 18,
  },
  mt4: {
    marginTop: spacing.md,
  },
  optionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  pressed: {
    opacity: 0.82,
  },
  previewBackground: {
    ...StyleSheet.absoluteFillObject,
  },
  previewBox: {
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: spacing.md,
    overflow: 'hidden',
    padding: spacing.md,
  },
  previewText: {
    color: colors.textSecondary,
  },
  previewWidget: {
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    padding: spacing.sm,
  },
  primaryButton: {
    backgroundColor: colors.accent,
  },
  primaryButtonGlyph: {
    color: colors.background,
    fontSize: 14,
  },
  primaryButtonText: {
    color: colors.background,
  },
  scaleHint: {
    color: colors.textMuted,
    fontSize: 10,
  },
  scaleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    letterSpacing: 0.2,
  },
  slider: {
    gap: spacing.sm,
  },
  sliderControls: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  sliderFill: {
    backgroundColor: colors.accent,
    borderRadius: 999,
    height: '100%',
  },
  sliderHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sliderTrack: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 999,
    flex: 1,
    height: 6,
    overflow: 'hidden',
  },
  sliderValue: {
    color: colors.accent,
  },
  stack15: {
    gap: 6,
  },
  stack2: {
    gap: spacing.sm,
  },
  stack3: {
    gap: spacing.md,
  },
  stack4: {
    gap: spacing.lg,
  },
  stepperButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  stepperDisabled: {
    opacity: 0.4,
  },
  stepperGlyph: {
    color: colors.textPrimary,
    fontSize: 18,
    lineHeight: 20,
  },
  toggleLabel: {
    color: colors.textSecondary,
    flexShrink: 1,
  },
  toggleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  transparencyDesc: {
    color: colors.textMuted,
    lineHeight: 18,
  },
});

export default KioskSettingsModal;
