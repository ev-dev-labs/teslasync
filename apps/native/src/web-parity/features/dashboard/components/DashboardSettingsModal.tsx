// Native parity port of web/src/features/dashboard/components/DashboardSettingsModal.tsx.
//
// `<DashboardSettingsModal>` is the per-dashboard configuration dialog. It edits
// four things and commits them on Save: the dashboard's name (rename), its emoji
// icon (changeIcon), and its `DashboardSettings` (vehicle filter + auto-refresh
// interval + two display toggles). Opening the modal (or switching the target
// dashboard) reseeds the local form from the incoming `dashboard`.
//
// The web version composes the shared <Modal>/<Input>/<Select>/<Toggle>/<Button>
// from `@/components/ui`, an inline <EmojiPicker> built from ghost <Button>s laid
// out on a Tailwind `grid grid-cols-8`, the `cn()` class merge, and react-i18next
// (`useTranslation('dashboard')`). React Native has none of those DOM-bound pieces
// (no <div>/<h3>/<p>, no <select>/<input>, no Tailwind grid/CSS-vars, no clsx), so
// this port reproduces the same behavioural + visual contract with RN primitives:
//   - The shared <Modal size="md"> becomes a transparent fade RN <Modal> with a
//     tap-to-close backdrop <Pressable> and a centered dialog card (the established
//     native modal idiom — see SignalConfigModal/FeedbackModal). The title renders
//     in the card header; the scrollable body holds the four sections and the
//     Cancel/Save actions are pinned as a fixed footer so they stay reachable.
//   - The shared <Select> dropdowns (vehicle filter + auto-refresh) become a
//     reusable inline <SelectField>: a Pressable trigger showing the current
//     option's label that opens a transparent popover listing the options as
//     accessible Pressable rows (the IntervalSelect/Combobox idiom). Its
//     `onValueChange(value)` mirrors the web `onChange(e) => e.target.value`.
//   - The shared <Input> (with its `label`) becomes a labelled <TextInput>;
//     `onChange(e) => setName(e.target.value)` maps onto `onChangeText={setName}`.
//   - The shared <Toggle> is the already-ported native switch (same
//     label/checked/onChange(boolean) contract), imported from components/ui.
//   - The <EmojiPicker> ghost <Button>s become Pressables laid out on a wrapping
//     row of `width: '12.5%'` cells (the RN equivalent of `grid-cols-8`); the
//     selected cell carries the accent ring + raised fill (web `ring-1
//     ring-[var(--theme-primary)]` + `bg-[var(--surface-2)]`).
//
// Native-safe adaptations (documented in the sidecar):
//   - react-i18next is not wired in native, so `useTranslation('dashboard')` is
//     replaced by a native translation fallback hook that returns each call's
//     English `defaultValue`. Every i18n key + fallback (incl. the dynamic
//     `dashSettings.refresh${value}` keys) is preserved verbatim.
//   - Tailwind utility classes + CSS custom properties (var(--text-secondary),
//     var(--text-muted), var(--surface-2), var(--theme-primary),
//     var(--border-subtle)) resolve to StyleSheet styles against the native theme
//     tokens; `cn()` conditional joins become RN style arrays.
//   - `SavedDashboard` / `DashboardSettings` / `DEFAULT_DASHBOARD_SETTINGS` are
//     re-declared here (native-safe mirror of ../widgets/types) because that web
//     types module imports `lucide-react`'s `LucideIcon`, which is browser-only;
//     the unit-free dashboard shapes are reproduced exactly (sans the Lucide
//     `WidgetDef`).

import React, {useCallback, useEffect, useState} from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {colors, shadows, spacing} from '../../../../theme/tokens';
import {Toggle} from '../../../components/ui/Toggle';

// ---------------------------------------------------------------------------
// Native-safe mirror of the dashboard shapes from ../widgets/types. The web
// module is not portable as-is because it imports `lucide-react` (LucideIcon)
// for `WidgetDef`; the unit-free settings/saved-dashboard shapes are reproduced
// verbatim here so the modal stays self-contained on native.
// ---------------------------------------------------------------------------

interface WidgetConfig {
  vehicleId?: number;
  refreshRate?: number;
  chartType?: string;
  showTitle?: boolean;
  timeRange?: string;
  [key: string]: unknown;
}

interface WidgetInstance {
  id: string;
  widgetId: string;
  config?: WidgetConfig;
}

interface RGLLayout {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
  static?: boolean;
  isDraggable?: boolean;
  isResizable?: boolean;
  moved?: boolean;
}

interface RGLLayouts {
  [breakpoint: string]: RGLLayout[];
}

export interface DashboardSettings {
  /** Auto-refresh interval in seconds (0 = use per-widget default) */
  refreshInterval: number;
  /** Filter widgets to show only this vehicle (undefined = all vehicles) */
  vehicleId?: number;
  /** Show widget borders in view mode */
  showWidgetBorders: boolean;
  /** Compact mode — reduces grid gaps */
  compactMode: boolean;
}

export const DEFAULT_DASHBOARD_SETTINGS: DashboardSettings = {
  refreshInterval: 0,
  showWidgetBorders: false,
  compactMode: false,
};

export interface SavedDashboard {
  id: string;
  name: string;
  icon?: string;
  vehicleId?: number | null;
  widgets: WidgetInstance[];
  layouts: RGLLayouts;
  createdAt: string;
  updatedAt: string;
  isDefault?: boolean;
  settings?: DashboardSettings;
}

// ---------------------------------------------------------------------------
// react-i18next is not wired in native; this fallback returns each call's
// English defaultValue (web: useTranslation('dashboard')).
// ---------------------------------------------------------------------------

type NativeTFunction = (key: string, fallback: string) => string;

function useDashboardTranslation(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

// lucide affordance rendered as a text glyph (the native "no SVG icons" idiom).
const CHEVRON_GLYPH = '\u25BE'; // ▾ Select caret

// Faint field fill resolving the web inputs' var(--surface-2) background.
const FIELD_FILL = 'rgba(255, 255, 255, 0.04)';

/* ─── Emoji picker ─── */
const DASHBOARD_EMOJIS = [
  '📊', '🔋', '🚗', '⚡', '🛡️', '🗺️', '📈', '🎯',
  '🔧', '🏠', '🌡️', '🎮', '📱', '🖥️', '🔔', '⭐',
];

function EmojiPicker({
  selected,
  onSelect,
}: {
  selected: string;
  onSelect: (emoji: string) => void;
}) {
  return (
    <View style={styles.emojiGrid}>
      {DASHBOARD_EMOJIS.map(emoji => {
        const isSelected = selected === emoji;
        return (
          <View key={emoji} style={styles.emojiCell}>
            <Pressable
              accessibilityLabel={emoji}
              accessibilityRole="button"
              accessibilityState={{selected: isSelected}}
              onPress={() => onSelect(emoji)}
              style={({pressed}) => [
                styles.emojiButton,
                isSelected && styles.emojiButtonSelected,
                pressed && styles.emojiButtonPressed,
              ]}>
              <AppText allowFontScaling={false} style={styles.emojiGlyph}>
                {emoji}
              </AppText>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

/* ─── Vehicle type (minimal — only what we need) ─── */
export interface VehicleOption {
  id: number;
  display_name: string;
}

/* ─── Props ─── */
export interface DashboardSettingsModalProps {
  open: boolean;
  onClose: () => void;
  dashboard: SavedDashboard;
  vehicles: VehicleOption[];
  onUpdate: (settings: DashboardSettings) => void;
  onRename: (name: string) => void;
  onChangeIcon: (icon: string) => void;
}

/* ─── Refresh interval options ─── */
const REFRESH_OPTIONS = [
  {value: '0', label: 'Default (per widget)'},
  {value: '5', label: 'Every 5 seconds'},
  {value: '10', label: 'Every 10 seconds'},
  {value: '30', label: 'Every 30 seconds'},
  {value: '60', label: 'Every minute'},
  {value: '300', label: 'Every 5 minutes'},
];

// ---------------------------------------------------------------------------
// SelectField — native replacement for the shared web <Select> (no DOM <select>
// on native). A Pressable trigger showing the current option's label opens a
// transparent popover listing the options as accessible rows.
// ---------------------------------------------------------------------------

interface SelectOption {
  value: string;
  label: string;
}

interface SelectFieldProps {
  value: string;
  options: SelectOption[];
  onValueChange: (value: string) => void;
  accessibilityLabel: string;
  placeholder?: string;
  testID?: string;
}

function SelectField({
  value,
  options,
  onValueChange,
  accessibilityLabel,
  placeholder,
  testID,
}: SelectFieldProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find(o => o.value === value);
  const triggerLabel = selected?.label ?? placeholder ?? '';

  const choose = (next: string) => {
    setOpen(false);
    onValueChange(next);
  };

  return (
    <View>
      <Pressable
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        accessibilityState={{expanded: open}}
        onPress={() => setOpen(true)}
        style={({pressed}) => [styles.selectTrigger, pressed && styles.pressed]}
        testID={testID}>
        <AppText numberOfLines={1} style={styles.selectTriggerText}>
          {triggerLabel}
        </AppText>
        <AppText
          accessible={false}
          allowFontScaling={false}
          style={styles.selectCaret}>
          {CHEVRON_GLYPH}
        </AppText>
      </Pressable>

      <Modal
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        transparent
        visible={open}>
        <View style={styles.popoverOverlay}>
          <Pressable
            accessibilityLabel={accessibilityLabel}
            accessibilityRole="button"
            onPress={() => setOpen(false)}
            style={styles.backdrop}
          />
          <View
            accessibilityLabel={accessibilityLabel}
            accessibilityRole="menu"
            style={styles.popoverMenu}
            testID={testID ? `${testID}-menu` : undefined}>
            <ScrollView
              bounces={false}
              contentContainerStyle={styles.popoverList}
              keyboardShouldPersistTaps="handled">
              {options.map(opt => {
                const isActive = opt.value === value;
                return (
                  <Pressable
                    accessibilityRole="menuitem"
                    accessibilityState={{selected: isActive}}
                    key={opt.value || '__placeholder__'}
                    onPress={() => choose(opt.value)}
                    style={({pressed}) => [
                      styles.popoverItem,
                      isActive && styles.popoverItemActive,
                      pressed && styles.popoverItemPressed,
                    ]}
                    testID={testID ? `${testID}-option-${opt.value}` : undefined}>
                    <AppText
                      style={[
                        styles.popoverItemText,
                        isActive && styles.popoverItemTextActive,
                      ]}>
                      {opt.label}
                    </AppText>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

export function DashboardSettingsModal({
  open,
  onClose,
  dashboard,
  vehicles,
  onUpdate,
  onRename,
  onChangeIcon,
}: DashboardSettingsModalProps) {
  const t = useDashboardTranslation();

  const [settings, setSettings] = useState<DashboardSettings>(
    dashboard.settings ?? {...DEFAULT_DASHBOARD_SETTINGS},
  );
  const [name, setName] = useState(dashboard.name);
  const [icon, setIcon] = useState(dashboard.icon ?? '📊');

  // Reset form state when modal opens or target dashboard changes
  useEffect(() => {
    if (open) {
      setSettings(dashboard.settings ?? {...DEFAULT_DASHBOARD_SETTINGS});
      setName(dashboard.name);
      setIcon(dashboard.icon ?? '📊');
    }
  }, [open, dashboard.id, dashboard.settings, dashboard.name, dashboard.icon]);

  const handleSave = () => {
    if (name.trim() && name.trim() !== dashboard.name) {
      onRename(name.trim());
    }
    if (icon !== dashboard.icon) {
      onChangeIcon(icon);
    }
    onUpdate(settings);
    onClose();
  };

  const vehicleOptions: SelectOption[] = [
    {value: '', label: t('dashSettings.allVehicles', 'All Vehicles')},
    ...vehicles.map(v => ({value: v.id.toString(), label: v.display_name})),
  ];

  const refreshOptions: SelectOption[] = REFRESH_OPTIONS.map(o => ({
    value: o.value,
    label: t(`dashSettings.refresh${o.value}`, o.label),
  }));

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible={open}>
      <View style={styles.overlay}>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={onClose}
          style={styles.backdrop}
        />

        <View style={styles.dialog} testID="dashboard-settings-modal">
          <AppText style={styles.title} weight="bold">
            {t('dashSettings.title', 'Dashboard Settings')}
          </AppText>

          <ScrollView
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
            style={styles.bodyScroll}>
            {/* Identity — Name & Icon */}
            <View>
              <AppText style={styles.sectionHeading} weight="semibold">
                {t('dashSettings.identity', 'Identity')}
              </AppText>
              <View style={styles.sectionStack}>
                <View>
                  <AppText style={styles.inputLabel}>
                    {t('dashSettings.nameLabel', 'Name')}
                  </AppText>
                  <TextInput
                    accessibilityLabel={t('dashSettings.nameLabel', 'Name')}
                    onChangeText={setName}
                    placeholder={t('dashSettings.name', 'Dashboard name')}
                    placeholderTextColor={colors.textMuted}
                    style={styles.input}
                    testID="dashboard-settings-name"
                    value={name}
                  />
                </View>
                <View>
                  <AppText style={styles.fieldHint}>
                    {t('dashSettings.iconLabel', 'Icon')}
                  </AppText>
                  <EmojiPicker onSelect={setIcon} selected={icon} />
                </View>
              </View>
            </View>

            {/* Vehicle filter */}
            <View>
              <AppText style={styles.sectionHeadingTight} weight="semibold">
                {t('dashSettings.vehicleFilter', 'Vehicle Filter')}
              </AppText>
              <AppText style={styles.sectionDesc}>
                {t(
                  'dashSettings.vehicleFilterDesc',
                  'Show data for a specific vehicle in all widgets. Widget-level filters take precedence.',
                )}
              </AppText>
              <SelectField
                accessibilityLabel={t(
                  'dashSettings.vehicleFilter',
                  'Vehicle Filter',
                )}
                onValueChange={next =>
                  setSettings(s => ({
                    ...s,
                    vehicleId: next ? Number(next) : undefined,
                  }))
                }
                options={vehicleOptions}
                testID="dashboard-settings-vehicle"
                value={settings.vehicleId?.toString() ?? ''}
              />
            </View>

            {/* Refresh interval */}
            <View>
              <AppText style={styles.sectionHeading} weight="semibold">
                {t('dashSettings.refresh', 'Auto-Refresh')}
              </AppText>
              <SelectField
                accessibilityLabel={t('dashSettings.refresh', 'Auto-Refresh')}
                onValueChange={next =>
                  setSettings(s => ({...s, refreshInterval: Number(next)}))
                }
                options={refreshOptions}
                testID="dashboard-settings-refresh"
                value={settings.refreshInterval.toString()}
              />
            </View>

            {/* Display options */}
            <View>
              <AppText style={styles.sectionHeading} weight="semibold">
                {t('dashSettings.display', 'Display')}
              </AppText>
              <View style={styles.sectionStack}>
                <Toggle
                  checked={settings.showWidgetBorders}
                  label={t('dashSettings.showBorders', 'Show widget borders')}
                  onChange={v =>
                    setSettings(s => ({...s, showWidgetBorders: v}))
                  }
                  testID="dashboard-settings-show-borders"
                />
                <Toggle
                  checked={settings.compactMode}
                  label={t(
                    'dashSettings.compactMode',
                    'Compact mode (smaller gaps)',
                  )}
                  onChange={v => setSettings(s => ({...s, compactMode: v}))}
                  testID="dashboard-settings-compact-mode"
                />
              </View>
            </View>
          </ScrollView>

          {/* Actions */}
          <View style={styles.actions}>
            <Pressable
              accessibilityLabel={t('common.cancel', 'Cancel')}
              accessibilityRole="button"
              onPress={onClose}
              style={({pressed}) => [styles.ghostButton, pressed && styles.pressed]}
              testID="dashboard-settings-cancel">
              <AppText style={styles.ghostButtonText} weight="semibold">
                {t('common.cancel', 'Cancel')}
              </AppText>
            </Pressable>
            <Pressable
              accessibilityLabel={t('common.save', 'Save')}
              accessibilityRole="button"
              onPress={handleSave}
              style={({pressed}) => [
                styles.primaryButton,
                pressed && styles.pressed,
              ]}
              testID="dashboard-settings-save">
              <AppText style={styles.primaryButtonText} weight="semibold">
                {t('common.save', 'Save')}
              </AppText>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

DashboardSettingsModal.displayName = 'DashboardSettingsModal';

const styles = StyleSheet.create({
  actions: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
    marginTop: spacing.xs,
    paddingTop: spacing.md,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  body: {
    gap: 24,
    paddingVertical: spacing.sm,
  },
  bodyScroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  dialog: {
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 20,
    borderWidth: 1,
    gap: spacing.sm,
    margin: spacing.md,
    maxHeight: '88%',
    maxWidth: 520,
    padding: spacing.lg,
    width: '94%',
    ...shadows.panel,
  },
  emojiButton: {
    alignItems: 'center',
    aspectRatio: 1,
    borderColor: 'transparent',
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
  },
  emojiButtonPressed: {
    backgroundColor: colors.surfaceHover,
  },
  emojiButtonSelected: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.accent,
  },
  emojiCell: {
    padding: 2,
    width: '12.5%',
  },
  emojiGlyph: {
    fontSize: 18,
    lineHeight: 24,
  },
  emojiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  fieldHint: {
    color: colors.textMuted,
    fontSize: 12,
    marginBottom: spacing.sm,
  },
  ghostButton: {
    alignItems: 'center',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  ghostButtonText: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  input: {
    backgroundColor: FIELD_FILL,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 14,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  inputLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    marginBottom: spacing.xs,
  },
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    flex: 1,
    justifyContent: 'center',
  },
  popoverItem: {
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  popoverItemActive: {
    backgroundColor: colors.surfaceSelected,
  },
  popoverItemPressed: {
    backgroundColor: colors.surfaceHover,
  },
  popoverItemText: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  popoverItemTextActive: {
    color: colors.textPrimary,
  },
  popoverList: {
    gap: 2,
    padding: spacing.xs,
  },
  popoverMenu: {
    ...shadows.panel,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    maxHeight: 320,
    maxWidth: 320,
    minWidth: 220,
  },
  popoverOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  pressed: {
    opacity: 0.82,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: 10,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  primaryButtonText: {
    color: colors.background,
    fontSize: 14,
  },
  sectionDesc: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
    marginBottom: spacing.md,
  },
  sectionHeading: {
    color: colors.textSecondary,
    fontSize: 14,
    marginBottom: spacing.md,
  },
  sectionHeadingTight: {
    color: colors.textSecondary,
    fontSize: 14,
    marginBottom: spacing.xs,
  },
  sectionStack: {
    gap: spacing.md,
  },
  selectCaret: {
    color: colors.textMuted,
    fontSize: 12,
    marginLeft: spacing.sm,
  },
  selectTrigger: {
    alignItems: 'center',
    backgroundColor: FIELD_FILL,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  selectTriggerText: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 14,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 18,
    lineHeight: 24,
    marginBottom: spacing.xs,
  },
});

export default DashboardSettingsModal;
