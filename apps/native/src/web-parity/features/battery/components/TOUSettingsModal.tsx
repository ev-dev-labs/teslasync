// Native parity port of web/src/features/battery/components/TOUSettingsModal.tsx.
//
// The web module is the Powerwall "Update Rate Plan" dialog. It ships three
// hard-coded California Time-of-Use preset tariffs (PG&E EV2-A, SCE TOU-D,
// SDG&E TOU-DR1) and a two-tab editor: a "Preset Tariff" tab (a <Select> over
// the presets plus a live JSON preview of the chosen tariff) and a "Custom JSON"
// tab (a free-form <Textarea> the operator pastes a tou_settings payload into).
// getPayload() resolves the active tab to a TOUSettingsPayload — the selected
// preset's `settings`, or the parsed custom JSON (accepting either the full
// envelope with a top-level `tou_settings` key, or just the inner object which
// it wraps) — surfacing inline validation errors. handleSubmit() POSTs via
// useUpdateTOUSettings({siteId, settings}) and, on success, refreshes the Tesla
// site info (useRefreshTeslaEnergySiteInfo) and closes; handleClose() is a
// no-op while the mutation is pending. Built from the shared web UI kit (Modal,
// Button, Select, Textarea, Tabs), react-i18next, the lucide Clock/FileJson/Zap
// glyphs, and the @/types/energy TOU types.
//
// Native-safe substitutions (rule 7), documented in the parity sidecar:
//   • react-i18next useTranslation() -> a local useTranslation() hook whose
//     t(key, fallback?) returns the English fallback (or the key), preserving
//     every i18n key at the call site. A stable useCallback identity keeps the
//     `tabs` useMemo dependency [t] honest, matching the source.
//   • The shared web <Modal> (createPortal + DOM focus trap / Escape / Tab
//     cycling + responsive size presets) -> a native <Modal animationType="fade"
//     transparent> centered card (backdrop Pressable -> onClose, Escape/back ->
//     onRequestClose) with a header (title + a close glyph) and a ScrollView
//     body; the `size` preset maps to a maxWidth and the panel carries
//     accessibilityViewIsModal + the aria-label. RN has no portal/DOM focus
//     model, so the focus trap + Tab cycling are dropped (documented).
//   • The shared web <Select> (DOM <select> + <option>) -> a native Select: a
//     Pressable trigger that opens a Modal option sheet (the same precedent the
//     devtools FleetApiSection port uses). The web placeholder <option value="">
//     is preserved as a selectable first row so selecting it resets to "" and
//     hides the preview, exactly like the web.
//   • The shared web <Textarea> (DOM <textarea> + Label) -> an inlined native
//     Textarea: a multiline <TextInput> with a label, focus accent border, and a
//     monospace font (web className="font-mono text-xs"), preserving
//     label/value/rows/placeholder.
//   • The shared web <Button> (DOM <button> + animated SVG spinner + icon) -> a
//     native Pressable Button with primary/ghost tones and an ActivityIndicator
//     while `loading`, mirroring the FlagEditDrawer/GasPriceAutoPollPage native
//     Button precedent. disabled + loading both block onPress.
//   • The lucide Clock/FileJson/Zap glyphs -> the shared native SemanticIcon
//     (clock / fileJson / bolt), `decorative`, matching the GasPriceAutoPollPage
//     Zap->bolt precedent.
//   • The shared <Tabs> -> the already-ported native Tabs (same tabs/activeTab/
//     onChange API). cn() Tailwind + CSS vars -> StyleSheet + theme tokens.
// No DOM elements, react-dom, lucide-react, framer-motion, Recharts, Leaflet, or
// web UI-kit modules are imported into the native output.

import React, {
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {
  useUpdateTOUSettings,
  useRefreshTeslaEnergySiteInfo,
  type TOUSettingsPayload,
  type TOUPreset,
} from '../../../api/hooks/useEnergy';
import { Tabs } from '../../../components/ui/Tabs';
import { AppText } from '../../../../components/ui/AppText';
import { SemanticIcon } from '../../../../components/icons/SemanticIcon';
import { colors, spacing } from '../../../../theme/tokens';

/* ─── i18n fallback (web react-i18next useTranslation) ─────────────────── */

type TFunc = (key: string, fallback?: string) => string;

// Native stand-in for react-i18next's useTranslation: the parity bundle ships no
// i18n runtime, so `t` returns the English fallback (or the key) while preserving
// every key at the call site. The stable useCallback identity keeps the `tabs`
// useMemo dependency array honest, matching the source.
function useTranslation(): { t: TFunc } {
  const t = useCallback<TFunc>((key, fallback) => fallback ?? key, []);
  return { t };
}

const MONO_FAMILY = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

/* ───────── Preset Tariffs ───────── */

const PRESETS: TOUPreset[] = [
  {
    id: 'pge-ev2a',
    name: 'PG&E EV2-A',
    utility: 'Pacific Gas & Electric',
    settings: {
      tou_settings: {
        optimization_strategy: 'economics',
        tariff_content_v2: {
          name: 'PG&E EV2-A',
          utility: 'Pacific Gas & Electric',
          daily_charges: [{ amount: 0.32854, name: 'Charge' }],
          demand_charges: { ALL: { ALL: 0 } },
          energy_charges: {
            Summer: {
              ON_PEAK: [{ rate: 0.49, start: 16, end: 21 }],
              OFF_PEAK: [
                { rate: 0.35, start: 0, end: 16 },
                { rate: 0.35, start: 21, end: 24 },
              ],
            },
            Winter: {
              ON_PEAK: [{ rate: 0.42, start: 16, end: 21 }],
              OFF_PEAK: [
                { rate: 0.36, start: 0, end: 16 },
                { rate: 0.36, start: 21, end: 24 },
              ],
            },
          },
          seasons: {
            Summer: { fromMonth: 6, fromDay: 1, toMonth: 9, toDay: 30 },
            Winter: { fromMonth: 10, fromDay: 1, toMonth: 5, toDay: 31 },
          },
        },
      },
    },
  },
  {
    id: 'sce-tou-d',
    name: 'SCE TOU-D',
    utility: 'Southern California Edison',
    settings: {
      tou_settings: {
        optimization_strategy: 'economics',
        tariff_content_v2: {
          name: 'SCE TOU-D',
          utility: 'Southern California Edison',
          daily_charges: [{ amount: 0.031, name: 'Charge' }],
          demand_charges: { ALL: { ALL: 0 } },
          energy_charges: {
            Summer: {
              ON_PEAK: [{ rate: 0.54, start: 16, end: 21 }],
              MID_PEAK: [
                { rate: 0.41, start: 8, end: 16 },
                { rate: 0.41, start: 21, end: 23 },
              ],
              OFF_PEAK: [
                { rate: 0.28, start: 0, end: 8 },
                { rate: 0.28, start: 23, end: 24 },
              ],
            },
            Winter: {
              MID_PEAK: [{ rate: 0.43, start: 8, end: 21 }],
              SUPER_OFF_PEAK: [
                { rate: 0.28, start: 0, end: 8 },
                { rate: 0.28, start: 21, end: 24 },
              ],
            },
          },
          seasons: {
            Summer: { fromMonth: 6, fromDay: 1, toMonth: 9, toDay: 30 },
            Winter: { fromMonth: 10, fromDay: 1, toMonth: 5, toDay: 31 },
          },
        },
      },
    },
  },
  {
    id: 'sdge-tou-dr1',
    name: 'SDG&E TOU-DR1',
    utility: 'San Diego Gas & Electric',
    settings: {
      tou_settings: {
        optimization_strategy: 'economics',
        tariff_content_v2: {
          name: 'SDG&E TOU-DR1',
          utility: 'San Diego Gas & Electric',
          daily_charges: [{ amount: 0.546, name: 'Charge' }],
          demand_charges: { ALL: { ALL: 0 } },
          energy_charges: {
            Summer: {
              ON_PEAK: [{ rate: 0.71, start: 16, end: 21 }],
              OFF_PEAK: [
                { rate: 0.45, start: 0, end: 16 },
                { rate: 0.45, start: 21, end: 24 },
              ],
            },
            Winter: {
              ON_PEAK: [{ rate: 0.57, start: 16, end: 21 }],
              OFF_PEAK: [
                { rate: 0.45, start: 0, end: 16 },
                { rate: 0.45, start: 21, end: 24 },
              ],
            },
          },
          seasons: {
            Summer: { fromMonth: 6, fromDay: 1, toMonth: 9, toDay: 30 },
            Winter: { fromMonth: 10, fromDay: 1, toMonth: 5, toDay: 31 },
          },
        },
      },
    },
  },
];

/* ─── inlined @/components/ui Button ───────────────────────────────────── */

type ButtonVariant = 'primary' | 'ghost';

interface ButtonProps {
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  onPress?: () => void;
  children: ReactNode;
}

function Button({
  variant = 'primary',
  loading,
  disabled,
  icon,
  onPress,
  children,
}: ButtonProps) {
  const isDisabled = !!disabled || !!loading;
  const tone = BTN_VARIANT_STYLES[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: !!loading }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        tone.container,
        isDisabled ? styles.btnDisabled : null,
        pressed && !isDisabled ? styles.btnPressed : null,
      ]}>
      {loading ? (
        <ActivityIndicator
          color={tone.text.color}
          size="small"
          style={styles.btnSpinner}
        />
      ) : (
        icon ?? null
      )}
      <AppText numberOfLines={1} style={[styles.btnText, tone.text]} weight="semibold">
        {children}
      </AppText>
    </Pressable>
  );
}

/* ─── inlined @/components/ui Select ───────────────────────────────────── */

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  label?: string;
  placeholder?: string;
  options: SelectOption[];
  value: string;
  onValueChange: (value: string) => void;
}

// Native <select> stand-in: a Pressable trigger that opens a Modal option sheet.
// The web placeholder <option value=""> is preserved as a selectable first row.
function Select({
  label,
  placeholder,
  options,
  value,
  onValueChange,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const allOptions = useMemo<SelectOption[]>(
    () =>
      placeholder
        ? [{ value: '', label: placeholder }, ...options]
        : options,
    [placeholder, options],
  );
  const selected = allOptions.find(o => o.value === value);
  const display = selected?.label ?? placeholder ?? '';
  const showPlaceholder = value === '';

  return (
    <View style={styles.fieldWrap}>
      {label ? <AppText style={styles.fieldLabel}>{label}</AppText> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={label}
        onPress={() => setOpen(true)}
        style={styles.selectTrigger}>
        <AppText
          numberOfLines={1}
          style={[styles.selectValue, showPlaceholder ? styles.selectPlaceholder : null]}>
          {display}
        </AppText>
        <AppText style={styles.selectChevron}>{'\u25BE'}</AppText>
      </Pressable>

      <Modal
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        transparent
        visible={open}>
        <Pressable
          accessibilityLabel="Close"
          onPress={() => setOpen(false)}
          style={styles.sheetOverlay}>
          <View style={styles.selectSheet}>
            {label ? (
              <AppText style={styles.selectSheetTitle} weight="semibold">
                {label}
              </AppText>
            ) : null}
            <ScrollView nestedScrollEnabled style={styles.selectSheetList}>
              {allOptions.map(option => {
                const active = option.value === value;
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    key={option.value || option.label}
                    onPress={() => {
                      onValueChange(option.value);
                      setOpen(false);
                    }}
                    style={styles.selectOption}>
                    <AppText
                      style={active ? styles.selectOptionActive : styles.selectOptionText}>
                      {option.label}
                    </AppText>
                    {active ? (
                      <AppText style={styles.selectOptionCheck}>{'\u2713'}</AppText>
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

/* ─── inlined @/components/ui Textarea ─────────────────────────────────── */

interface TextareaProps {
  label?: string;
  placeholder?: string;
  value: string;
  onChangeText: (text: string) => void;
  rows?: number;
  mono?: boolean;
}

function Textarea({
  label,
  placeholder,
  value,
  onChangeText,
  rows = 3,
  mono,
}: TextareaProps) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.fieldWrap}>
      {label ? <AppText style={styles.fieldLabel}>{label}</AppText> : null}
      <TextInput
        accessibilityLabel={label}
        multiline
        numberOfLines={rows}
        onBlur={() => setFocused(false)}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        style={[
          styles.textarea,
          mono ? { fontFamily: MONO_FAMILY } : null,
          { minHeight: rows * 18 + 16 },
          focused ? styles.textareaFocused : null,
        ]}
        textAlignVertical="top"
        value={value}
      />
    </View>
  );
}

/* ─── inlined @/components/ui Modal ────────────────────────────────────── */

type ModalSize = 'sm' | 'md' | 'lg' | 'full';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  size?: ModalSize;
  children: ReactNode;
}

const SIZE_MAX_WIDTH: Record<ModalSize, number> = {
  sm: 384,
  md: 512,
  lg: 672,
  full: 1100,
};

// Centered surface modal. Web renders a portal overlay + DOM focus trap; the
// native port uses a <Modal> (Escape/back -> onRequestClose, backdrop tap ->
// onClose) with a titled header and a scrollable body.
function Dialog({ open, onClose, title, size = 'md', children }: DialogProps) {
  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible={open}>
      <Pressable accessibilityLabel="Close" onPress={onClose} style={styles.modalOverlay}>
        <Pressable
          accessibilityLabel={title || 'Dialog'}
          accessibilityViewIsModal
          onPress={() => undefined}
          style={[styles.modalPanel, { maxWidth: SIZE_MAX_WIDTH[size] }]}>
          {title ? (
            <View style={styles.modalHeader}>
              <AppText numberOfLines={1} style={styles.modalTitle} weight="semibold">
                {title}
              </AppText>
              <Pressable
                accessibilityLabel="Close"
                accessibilityRole="button"
                hitSlop={8}
                onPress={onClose}
                style={styles.modalClose}>
                <AppText style={styles.modalCloseGlyph} weight="bold">
                  {'\u2715'}
                </AppText>
              </Pressable>
            </View>
          ) : null}
          <ScrollView contentContainerStyle={styles.modalBody} style={styles.modalScroll}>
            {children}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/* ───────── Component ───────── */

interface TOUSettingsModalProps {
  open: boolean;
  onClose: () => void;
  siteId: number;
}

export function TOUSettingsModal({ open, onClose, siteId }: TOUSettingsModalProps) {
  const { t } = useTranslation();
  const updateMutation = useUpdateTOUSettings();
  const refreshSiteInfo = useRefreshTeslaEnergySiteInfo();

  const [activeTab, setActiveTab] = useState<string>('preset');
  const [selectedPreset, setSelectedPreset] = useState('');
  const [customJSON, setCustomJSON] = useState('');
  const [error, setError] = useState('');

  const presetOptions = useMemo(
    () => PRESETS.map(p => ({ value: p.id, label: `${p.name} — ${p.utility}` })),
    [],
  );

  const tabs = useMemo(
    () => [
      { key: 'preset', label: t('energy.tou.tabPreset', 'Preset Tariff') },
      { key: 'custom', label: t('energy.tou.tabCustom', 'Custom JSON') },
    ],
    [t],
  );

  function getPayload(): TOUSettingsPayload | null {
    setError('');

    if (activeTab === 'preset') {
      const preset = PRESETS.find(p => p.id === selectedPreset);
      if (!preset) {
        setError(t('energy.tou.errorNoPreset', 'Please select a rate plan'));
        return null;
      }
      return preset.settings;
    }

    // Custom JSON mode
    const trimmed = customJSON.trim();
    if (!trimmed) {
      setError(t('energy.tou.errorEmptyJSON', 'Please enter the TOU settings JSON'));
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        setError(t('energy.tou.errorNotObject', 'JSON must be an object'));
        return null;
      }
      const obj = parsed as Record<string, unknown>;
      // Allow either the full envelope or just the inner tou_settings object
      if ('tou_settings' in obj) {
        return obj as unknown as TOUSettingsPayload;
      }
      return { tou_settings: obj };
    } catch {
      setError(t('energy.tou.errorInvalidJSON', 'Invalid JSON — please check syntax'));
      return null;
    }
  }

  function handleSubmit() {
    const payload = getPayload();
    if (!payload) {
      return;
    }

    updateMutation.mutate(
      { siteId, settings: payload },
      {
        onSuccess: () => {
          // Refresh site info from Tesla so the UI shows updated tariff data
          refreshSiteInfo.mutate(siteId);
          onClose();
        },
        onError: err => {
          setError(String(err instanceof Error ? err.message : err));
        },
      },
    );
  }

  function handleClose() {
    if (!updateMutation.isPending) {
      setError('');
      onClose();
    }
  }

  const previewPreset = PRESETS.find(p => p.id === selectedPreset);

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title={t('energy.tou.title', 'Update Rate Plan')}
      size="lg">
      <View style={styles.stack}>
        <AppText style={styles.description}>
          {t(
            'energy.tou.description',
            'Configure your utility rate plan so the Powerwall can optimize charging and discharging based on electricity pricing.',
          )}
        </AppText>

        <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

        {activeTab === 'preset' ? (
          <View style={styles.tabBody}>
            <Select
              label={t('energy.tou.selectPlan', 'Rate Plan')}
              placeholder={t('energy.tou.selectPlaceholder', 'Choose a rate plan…')}
              options={presetOptions}
              value={selectedPreset}
              onValueChange={setSelectedPreset}
            />
            {selectedPreset ? (
              <View style={styles.previewBox}>
                <AppText style={styles.previewLabel}>
                  {t('energy.tou.previewLabel', 'Preview')}
                </AppText>
                <ScrollView nestedScrollEnabled style={styles.previewScroll}>
                  <AppText style={styles.previewPre}>
                    {JSON.stringify(previewPreset?.settings, null, 2)}
                  </AppText>
                </ScrollView>
              </View>
            ) : null}
          </View>
        ) : (
          <View style={styles.tabBody}>
            <Textarea
              label={t('energy.tou.customLabel', 'TOU Settings JSON')}
              placeholder={
                '{\n  "tou_settings": {\n    "optimization_strategy": "economics",\n    "tariff_content_v2": { ... }\n  }\n}'
              }
              value={customJSON}
              onChangeText={setCustomJSON}
              rows={12}
              mono
            />
            <View style={styles.hintRow}>
              <SemanticIcon name="fileJson" size="sm" decorative />
              <AppText style={styles.hintText} variant="caption">
                {t(
                  'energy.tou.customHint',
                  'Paste the full tou_settings payload or just the inner object. See Tesla Fleet API docs for the schema.',
                )}
              </AppText>
            </View>
          </View>
        )}

        {error ? (
          <View style={styles.errorRow}>
            <SemanticIcon name="bolt" size="sm" decorative />
            <AppText style={styles.errorText} tone="danger" variant="caption">
              {error}
            </AppText>
          </View>
        ) : null}

        <View style={styles.footerRow}>
          <Button variant="ghost" onPress={handleClose} disabled={updateMutation.isPending}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            onPress={handleSubmit}
            loading={updateMutation.isPending}
            disabled={updateMutation.isPending}
            icon={<SemanticIcon name="clock" size="sm" decorative />}>
            {t('energy.tou.submit', 'Update Rate Plan')}
          </Button>
        </View>
      </View>
    </Dialog>
  );
}

const BTN_VARIANT_STYLES: Record<
  ButtonVariant,
  { container: ViewStyle; text: TextStyle }
> = {
  primary: {
    container: { backgroundColor: colors.accent },
    text: { color: colors.background },
  },
  ghost: {
    container: { backgroundColor: 'transparent' },
    text: { color: colors.textPrimary },
  },
};

const styles = StyleSheet.create({
  stack: {
    gap: spacing.md,
  },
  description: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
  tabBody: {
    gap: spacing.md,
  },
  fieldWrap: {
    gap: spacing.xs,
  },
  fieldLabel: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
  selectTrigger: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  selectValue: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 14,
  },
  selectPlaceholder: {
    color: colors.textMuted,
  },
  selectChevron: {
    color: colors.textMuted,
    fontSize: 12,
    marginLeft: spacing.sm,
  },
  sheetOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  selectSheet: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    maxHeight: '70%',
    maxWidth: 420,
    width: '100%',
  },
  selectSheetTitle: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    color: colors.textPrimary,
    fontSize: 14,
    padding: spacing.md,
  },
  selectSheetList: {
    paddingVertical: spacing.xs,
  },
  selectOption: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  selectOptionText: {
    color: colors.textSecondary,
    flex: 1,
    fontSize: 14,
  },
  selectOptionActive: {
    color: colors.accent,
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
  },
  selectOptionCheck: {
    color: colors.accent,
    fontSize: 14,
    marginLeft: spacing.sm,
  },
  textarea: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  textareaFocused: {
    borderColor: colors.borderAccent,
  },
  previewBox: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 10,
    borderWidth: 1,
    padding: spacing.md,
  },
  previewLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
    marginBottom: spacing.xs,
  },
  previewScroll: {
    maxHeight: 192,
  },
  previewPre: {
    color: colors.textSecondary,
    fontFamily: MONO_FAMILY,
    fontSize: 12,
    lineHeight: 16,
  },
  hintRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  hintText: {
    color: colors.textMuted,
    flex: 1,
  },
  errorRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  errorText: {
    color: colors.danger,
    flex: 1,
  },
  footerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
    paddingTop: spacing.xs,
  },
  btn: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  btnPressed: {
    opacity: 0.82,
  },
  btnSpinner: {
    marginRight: spacing.xs,
  },
  btnText: {
    fontSize: 14,
    lineHeight: 18,
  },
  modalOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalPanel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    maxHeight: '88%',
    width: '100%',
  },
  modalHeader: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  modalTitle: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 18,
    lineHeight: 24,
  },
  modalClose: {
    alignItems: 'center',
    borderRadius: 8,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  modalCloseGlyph: {
    color: colors.textSecondary,
    fontSize: 16,
  },
  modalScroll: {
    flexGrow: 0,
  },
  modalBody: {
    padding: spacing.lg,
  },
});
