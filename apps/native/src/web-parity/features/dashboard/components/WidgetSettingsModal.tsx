// Native parity port of web/src/features/dashboard/components/WidgetSettingsModal.tsx.
//
// The web source is the per-widget "{Name} Settings" modal opened from a
// dashboard tile. It renders the shared surface <Modal> (open/onClose/title/
// size="sm") whose body is a `space-y-4 p-4` stack of @/components/forms
// <FormSection>s:
//   1. (vehicle widgets only) a "Vehicle" <Select> — "All Vehicles (first)" plus
//      one option per vehicle from useVehicles(); writes config.vehicleId
//      (undefined for "all").
//   2. a "Refresh Interval" <Select> — Default / 5s / 15s / 30s / 1min; writes
//      config.refreshRate (undefined for "default").
//   3. (chart widgets only) a "Time Range" <Select> — 24h / 7d / 30d / 90d;
//      writes config.timeRange.
//   4. an "Appearance" <Toggle> — "Show widget title"; writes config.showTitle.
//   5. a right-aligned actions row: a ghost "Cancel" <Button> (onClose) and an
//      accent-tinted "Save" <Button> (onSave(config) then onClose).
// `isVehicleWidget` / `isChartWidget` are derived from def.category exactly as on
// the web. config is local component state seeded from widget.config ?? {}.
//
// None of the web modules are native-safe: react-i18next is not wired; the shared
// web UI <Button>/<Modal>/<Select>/<Toggle> and @/components/forms <FormSection>
// are DOM/Tailwind components; `../widgets/types` carries a lucide `icon` and a
// LazyExoticComponent `component` that have no native analogue. So — mirroring the
// sibling ExportModal / DraftRecoveryBanner ports — this self-contained port
// rebuilds each piece with React Native primitives, the existing native Modal
// parity, AppText, and the design tokens:
//   * <Modal> -> the existing native Modal parity (web-parity/components/ui/Modal),
//     same open/onClose/title/size="sm" contract; the title `${def.name} Settings`
//     template literal (not i18n on the web either) is preserved verbatim.
//   * <FormSection title> -> an inlined bordered surface panel with a section
//     heading + a gapped body, reproducing the web glass-panel grouping.
//   * <Select options value onChange> -> an inlined accessible radio group
//     (accessibilityRole="radiogroup"/"radio") since React Native has no <select>
//     primitive; selecting an option calls onChange(value) with the same string
//     value the web read from `e.target.value`, so every setConfig body is
//     preserved verbatim (including the `val === 'all'`/`'default'` sentinels).
//   * <Toggle label checked onChange> -> the core RN <Switch> (value/onValueChange),
//     the exact role="switch" semantics the web Toggle provided, with the label to
//     its right as on the web.
//   * <Button variant="ghost"> Cancel + the accent-tinted Save <Button> -> inlined
//     Pressables matching the web's secondary-ghost and primary-accent intent.
//   * useVehicles() -> the native parity hook (web-parity/api/hooks/useVehicles),
//     same `{ data }` shape and `?? []` guard.
//   * react-i18next -> a self-contained fallback that preserves every i18n key,
//     English fallback string, and `{{var}}` interpolation.
//   * `../widgets/types` WidgetConfig/WidgetDef/WidgetInstance -> local mirrors
//     (the native types port does not exist yet); the web WidgetDef `icon`
//     (LucideIcon) and `component` (LazyExoticComponent) are browser/web-React
//     specifics this modal never reads, so they are dropped from the mirror.
//
// No DOM, no react-i18next, no lucide-react, no Recharts/Leaflet, and no web UI
// components are imported.

import {useCallback, useState, type ReactNode} from 'react';
import {Pressable, StyleSheet, Switch, View} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing, typography} from '../../../../theme/tokens';
import {useVehicles} from '../../../api/hooks/useVehicles';
import {Modal} from '../../../components/ui/Modal';

// --- i18n fallback ----------------------------------------------------------
// The web component read `t` from useTranslation('dashboard'). Native parity has
// no i18n runtime wired yet, so this returns the English fallback string,
// applying the same `{{var}}` interpolation react-i18next would (the source
// passes no interpolation vars, but the shape is preserved for parity).
type TranslationVars = Record<string, string | number>;

type NativeTFunction = (
  key: string,
  fallback: string,
  vars?: TranslationVars,
) => string;

function interpolate(template: string, vars: TranslationVars): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = vars[key];
    return value === undefined ? '' : String(value);
  });
}

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallback, vars) => {
    if (!vars) {
      return fallback;
    }
    return interpolate(fallback, vars);
  }, []);
}

// --- Local mirrors of `../widgets/types` ------------------------------------
// The native `../widgets/types` port does not exist yet in this file-by-file
// loop, so the (subset of the) shapes this modal consumes are reproduced here
// field-for-field. The web WidgetDef `icon` (LucideIcon) and `component`
// (LazyExoticComponent) are browser/web-React specifics this modal never reads,
// so they are intentionally dropped from the native mirror.
interface WidgetConfig {
  vehicleId?: number;
  refreshRate?: number;
  chartType?: string;
  showTitle?: boolean;
  timeRange?: string;
  [key: string]: unknown;
}

interface WidgetSize {
  cols: number;
  rows: number;
}

type WidgetCategory =
  | 'vehicle'
  | 'battery'
  | 'energy'
  | 'driving'
  | 'charging'
  | 'climate'
  | 'tires'
  | 'security'
  | 'commands'
  | 'media'
  | 'telemetry'
  | 'analytics'
  | 'alerts'
  | 'automations'
  | 'system'
  | 'maps';

interface WidgetDef {
  id: string;
  name: string;
  description: string;
  category: WidgetCategory;
  defaultSize: WidgetSize;
  minSize: WidgetSize;
  maxSize: WidgetSize;
}

interface WidgetInstance {
  id: string;
  widgetId: string;
  config?: WidgetConfig;
}

// --- Inlined <Select> option type (mirrors web SelectOption) ----------------
interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface WidgetSettingsModalProps {
  widget: WidgetInstance;
  def: WidgetDef;
  open: boolean;
  onClose: () => void;
  onSave: (config: WidgetConfig) => void;
}

export function WidgetSettingsModal({
  widget,
  def,
  open,
  onClose,
  onSave,
}: WidgetSettingsModalProps) {
  const t = useNativeTranslationFallback();
  const {data: vehicles} = useVehicles();
  const vehicleList = vehicles ?? [];

  const [config, setConfig] = useState<WidgetConfig>(widget.config ?? {});

  const handleSave = () => {
    onSave(config);
    onClose();
  };

  const isVehicleWidget = def.category !== 'system' && def.category !== 'analytics';
  const isChartWidget = def.category === 'driving' || def.category === 'charging' ||
    def.category === 'analytics' || def.category === 'battery';

  return (
    <Modal open={open} onClose={onClose} title={`${def.name} Settings`} size="sm">
      <View style={styles.body}>
        {/* Vehicle selector */}
        {isVehicleWidget && (
          <FormSection title={t('dashboard.settings.vehicle', 'Vehicle')}>
            <SelectField
              value={config.vehicleId?.toString() ?? 'all'}
              options={[
                {value: 'all', label: t('dashboard.settings.allVehicles', 'All Vehicles (first)')},
                ...vehicleList.map((v) => ({
                  value: v.id.toString(),
                  label: v.display_name || `Vehicle ${v.id}`,
                })),
              ]}
              onChange={(val) => {
                setConfig((prev) => ({
                  ...prev,
                  vehicleId: val === 'all' ? undefined : Number(val),
                }));
              }}
            />
          </FormSection>
        )}

        {/* Refresh rate */}
        <FormSection title={t('dashboard.settings.refreshInterval', 'Refresh Interval')}>
          <SelectField
            value={config.refreshRate?.toString() ?? 'default'}
            options={[
              {value: 'default', label: t('dashboard.settings.default', 'Default')},
              {value: '5', label: t('dashboard.settings.5s', '5 seconds')},
              {value: '15', label: t('dashboard.settings.15s', '15 seconds')},
              {value: '30', label: t('dashboard.settings.30s', '30 seconds')},
              {value: '60', label: t('dashboard.settings.60s', '1 minute')},
            ]}
            onChange={(val) => {
              setConfig((prev) => ({
                ...prev,
                refreshRate: val === 'default' ? undefined : Number(val),
              }));
            }}
          />
        </FormSection>

        {/* Time range (for chart widgets) */}
        {isChartWidget && (
          <FormSection title={t('dashboard.settings.timeRange', 'Time Range')}>
            <SelectField
              value={config.timeRange ?? '7d'}
              options={[
                {value: '24h', label: t('dashboard.settings.24h', 'Last 24 hours')},
                {value: '7d', label: t('dashboard.settings.7d', 'Last 7 days')},
                {value: '30d', label: t('dashboard.settings.30d', 'Last 30 days')},
                {value: '90d', label: t('dashboard.settings.90d', 'Last 90 days')},
              ]}
              onChange={(val) => {
                setConfig((prev) => ({...prev, timeRange: val}));
              }}
            />
          </FormSection>
        )}

        {/* Show title toggle */}
        <FormSection title={t('dashboard.settings.appearance', 'Appearance')}>
          <ToggleField
            label={t('dashboard.settings.showTitle', 'Show widget title')}
            checked={config.showTitle !== false}
            onChange={(checked) => {
              setConfig((prev) => ({...prev, showTitle: checked}));
            }}
          />
        </FormSection>

        {/* Actions */}
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.cancel', 'Cancel')}
            onPress={onClose}
            style={({pressed}) => [
              styles.actionButton,
              styles.cancelButton,
              pressed && styles.actionPressed,
            ]}>
            <AppText weight="semibold" style={styles.cancelLabel}>
              {t('common.cancel', 'Cancel')}
            </AppText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.save', 'Save')}
            onPress={handleSave}
            style={({pressed}) => [
              styles.actionButton,
              styles.saveButton,
              pressed && styles.actionPressed,
            ]}>
            <AppText weight="semibold" style={styles.saveLabel}>
              {t('common.save', 'Save')}
            </AppText>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// --- Inlined @/components/forms <FormSection> -------------------------------
// Labeled fieldset grouping form controls with consistent spacing — the web
// glass-panel + section-title heading + space-y-4 body, in native tokens.
function FormSection({title, children}: {title: string; children: ReactNode}) {
  return (
    <View style={styles.section}>
      <AppText
        weight="semibold"
        tone="secondary"
        style={styles.sectionTitle}>
        {title}
      </AppText>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

// --- Inlined @/components/ui <Select> ---------------------------------------
// React Native has no <select> primitive, so the options render as an accessible
// radio group. Selecting an option calls onChange(value) with the same string
// value the web read from `e.target.value`.
function SelectField({
  value,
  options,
  onChange,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
}) {
  return (
    <View accessibilityRole="radiogroup" style={styles.optionGroup}>
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            accessibilityRole="radio"
            accessibilityState={{selected, disabled: opt.disabled}}
            accessibilityLabel={opt.label}
            disabled={opt.disabled}
            onPress={() => onChange(opt.value)}
            style={({pressed}) => [
              styles.option,
              selected && styles.optionSelected,
              opt.disabled && styles.optionDisabled,
              pressed && !opt.disabled && !selected && styles.optionPressed,
            ]}>
            <AppText
              numberOfLines={1}
              style={[styles.optionLabel, selected && styles.optionLabelSelected]}>
              {opt.label}
            </AppText>
            {selected ? (
              <AppText
                style={styles.optionCheck}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants">
                {'✓'}
              </AppText>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

// --- Inlined @/components/ui <Toggle> ---------------------------------------
// role="switch" control: the core RN <Switch> + a trailing label (web order:
// switch then label).
function ToggleField({
  label,
  checked,
  onChange,
}: {
  label?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <Switch
        value={checked}
        onValueChange={onChange}
        accessibilityLabel={label}
        trackColor={{false: colors.surfaceRaised, true: colors.accentSoft}}
        thumbColor={checked ? colors.accent : colors.textMuted}
        ios_backgroundColor={colors.surfaceRaised}
      />
      {label ? (
        <AppText weight="semibold" tone="secondary" style={styles.toggleLabel}>
          {label}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // web `space-y-4 p-4`: the native Modal body already pads horizontally, so
  // only the 16px vertical rhythm between sections is reproduced here.
  body: {
    gap: 16,
  },
  // web FormSection glass-panel (bordered, rounded, padded) + space-y-4 body.
  section: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceGlass,
    borderRadius: 12,
    padding: spacing.lg,
    gap: spacing.md,
  },
  sectionTitle: {
    fontSize: typography.caption + 1,
    lineHeight: 18,
  },
  sectionBody: {
    gap: spacing.md,
  },
  optionGroup: {
    gap: spacing.xs,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 10,
  },
  optionSelected: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.surfaceSelected,
  },
  optionPressed: {
    backgroundColor: colors.surfaceHover,
  },
  optionDisabled: {
    opacity: 0.5,
  },
  optionLabel: {
    flexShrink: 1,
    fontSize: typography.body,
    color: colors.textPrimary,
  },
  optionLabelSelected: {
    color: colors.accent,
  },
  optionCheck: {
    fontSize: typography.body,
    color: colors.accent,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  toggleLabel: {
    flexShrink: 1,
    fontSize: typography.body,
  },
  // web actions row: flex gap-2 justify-end pt-2.
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  actionButton: {
    minHeight: 40,
    borderRadius: 10,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // web Cancel: ghost, secondary text.
  cancelButton: {
    backgroundColor: 'transparent',
  },
  cancelLabel: {
    fontSize: typography.body - 1,
    color: colors.textSecondary,
  },
  // web Save: accent-tinted (bg-primary/10, text-primary).
  saveButton: {
    backgroundColor: colors.accentSoft,
  },
  saveLabel: {
    fontSize: typography.body - 1,
    color: colors.accent,
  },
  actionPressed: {
    opacity: 0.82,
  },
});
