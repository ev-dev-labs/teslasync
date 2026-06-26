/**
 * Native parity port of
 * web/src/features/automations/pages/ActionBuilder.tsx.
 *
 * The web file is the automation **action** editor: a vertical stack of
 * GlassPanels (one per action) where each row carries a 1-based index, an
 * "Action Type" `<Select>`, the kind-specific field group (command + JSON
 * params, notify channel + message, set-setting key/type/value, or a
 * call-automation target id), and a move-up / move-down / remove icon-button
 * column, followed by an "Add Action" button. This native port preserves that
 * contract 1:1 — the same exported `ACTION_TYPES` table, the same private
 * `COMMAND_GROUPS` table, the same `isCommandParams` / `createDefaultAction` /
 * `settingValueKind` / `actionWithSettingValue` helpers, the same
 * `ActionBuilder` props (`actions`, `channels`, `onChange`) + memoised
 * `defaultChannelId` / `actionTypeOptions` / `channelOptions` + `addAction` /
 * `removeAction` / `replaceAction` / `moveAction` callbacks, and the same
 * `ActionFields` sub-component (its `paramsText` / `paramsError` state, the
 * `commandOptions` memo, the `action`-dependency `useEffect` that re-seeds the
 * JSON params text, and the four-way `kind` switch) — using React Native
 * primitives + the existing native GlassPanel / AppText / design tokens.
 *
 * Browser-only / unconverted dependencies are reduced explicitly and
 * documented in the `.parity.json` sidecar:
 *   - react-i18next `useTranslation` (web L2): replaced by a native-safe
 *     `t(key, fallback?, vars?)` fallback (the established sibling
 *     RequestBuilder / VehicleMultiSelect precedent) that returns the English
 *     default (else the key) and interpolates i18next-style `{{token}}`
 *     placeholders. Every web translation key is preserved verbatim.
 *   - lucide-react `Plus` / `Trash2` / `ChevronUp` / `ChevronDown` (web L10):
 *     rendered as decorative AppText glyphs (PLUS_GLYPH \u002B, TRASH_GLYPH
 *     \uD83D\uDDD1 — the same Trash2 stand-in the sibling RedisSignalViewerPage
 *     port uses, CHEVRON_UP_GLYPH \u2303, CHEVRON_DOWN_GLYPH \u2304 — the same
 *     chevron stand-in EndpointSidebar / ResponseViewer use) marked
 *     `importantForAccessibility="no-hide-descendants"` (the aria-hidden
 *     analog); the web `aria-label`s map to the buttons' `accessibilityLabel`.
 *   - `@/components/ui` `Select` / `Input` / `Textarea` / `Button` (web L3-9):
 *     no native parity port exists yet, so minimal native-safe equivalents are
 *     reproduced locally (the established "reproduce locally when no native
 *     parity port exists" precedent) — a `SelectField` (a Pressable trigger +
 *     a `<Modal>` option list, mirroring the VehicleMultiSelect popover: a
 *     full-screen backdrop Pressable closes on outside tap, `onRequestClose`
 *     ≈ Escape, the trigger is measured to anchor the menu, disabled options
 *     are non-pressable), an `InputField` (TextInput, web `type="number"` ->
 *     `keyboardType="numeric"`), and a `TextareaField` (multiline TextInput,
 *     `rows` -> numberOfLines + min-height, `error` -> danger border + message).
 *     The web `onChange={e => ...e.target.value}` becomes a direct
 *     `onValueChange` / `onChangeText` string callback (same RequestBuilder
 *     precedent), so the surrounding `replaceAction` / `onChange` logic is
 *     byte-for-byte equivalent.
 *   - `@/components/ui` `GlassPanel` (web L7): the existing native GlassPanel.
 *   - `@/types/notifications` `NotificationChannel` (web L11): imported from the
 *     already-ported native `../../../api/hooks/useNotificationChannels`.
 *   - `@/types/automations` `AutomationActionKind` (web L12-14): imported from
 *     the already-ported native `../../../api/hooks/useAutomations`.
 *   - `../components/stepInputTypes` `AutomationActionStepInput` /
 *     `AutomationActionCommandStepInput` / `AutomationActionSetSettingStepInput`
 *     (web L15-19): that sibling types-only file is not ported yet, so the same
 *     `Omit<T, 'id' | 'automation_id' | 'step_id' | 'step_order'>` mapped types
 *     are reproduced locally over the native `AutomationActionStep` union.
 *   - Tailwind layout/spacing/typography utilities map to StyleSheet tokens;
 *     the web `font-mono` index / params text becomes the platform monospace
 *     family, and the `text-red-400` remove button maps to the danger token.
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type StyleProp,
  type View as RNView,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing, typography} from '../../../../theme/tokens';
import type {
  AutomationActionKind,
  AutomationActionStep,
} from '../../../api/hooks/useAutomations';
import type {NotificationChannel} from '../../../api/hooks/useNotificationChannels';

/* ── native port of ../components/stepInputTypes (action variants only) ──── */

type StepInput<T extends AutomationActionStep> = T extends unknown
  ? Omit<T, 'id' | 'automation_id' | 'step_id' | 'step_order'>
  : never;

export type AutomationActionStepInput = StepInput<AutomationActionStep>;

export type AutomationActionCommandStepInput = Extract<
  AutomationActionStepInput,
  {kind: 'action_command'}
>;

export type AutomationActionSetSettingStepInput = Extract<
  AutomationActionStepInput,
  {kind: 'action_set_setting'}
>;

/* ── ported verbatim: option / param / value-kind types ──────────────────── */

type ActionKindOption = {
  value: AutomationActionKind;
  labelKey: string;
  fallback: string;
};

type CommandParams = NonNullable<AutomationActionCommandStepInput['command_params']>;
type SettingValueKind = 'text' | 'number' | 'boolean';

export const ACTION_TYPES: ActionKindOption[] = [
  {
    value: 'action_command',
    labelKey: 'automations.actions.command',
    fallback: 'Vehicle Command',
  },
  {
    value: 'action_notify',
    labelKey: 'automations.actions.notify',
    fallback: 'Send Notification',
  },
  {
    value: 'action_set_setting',
    labelKey: 'automations.actions.setSetting',
    fallback: 'Set Setting',
  },
  {
    value: 'action_call_automation',
    labelKey: 'automations.actions.callAutomation',
    fallback: 'Call Automation',
  },
];

const COMMAND_GROUPS: {
  labelKey: string;
  fallback: string;
  commands: {value: string; labelKey: string; fallback: string}[];
}[] = [
  {
    labelKey: 'automations.commandGroups.security',
    fallback: 'Security & Access',
    commands: [
      {value: 'lock', labelKey: 'automations.commands.lock', fallback: 'Lock Doors'},
      {value: 'unlock', labelKey: 'automations.commands.unlock', fallback: 'Unlock Doors'},
      {value: 'sentry_on', labelKey: 'automations.commands.sentryOn', fallback: 'Sentry Mode On'},
      {value: 'sentry_off', labelKey: 'automations.commands.sentryOff', fallback: 'Sentry Mode Off'},
      {value: 'valet_on', labelKey: 'automations.commands.valetOn', fallback: 'Valet Mode On'},
      {value: 'valet_off', labelKey: 'automations.commands.valetOff', fallback: 'Valet Mode Off'},
    ],
  },
  {
    labelKey: 'automations.commandGroups.climate',
    fallback: 'Climate',
    commands: [
      {value: 'climate_on', labelKey: 'automations.commands.climateOn', fallback: 'Climate On'},
      {value: 'climate_off', labelKey: 'automations.commands.climateOff', fallback: 'Climate Off'},
      {value: 'set_temps', labelKey: 'automations.commands.setTemps', fallback: 'Set Temperature'},
      {value: 'seat_heater', labelKey: 'automations.commands.seatHeater', fallback: 'Seat Heater'},
      {value: 'seat_cooler', labelKey: 'automations.commands.seatCooler', fallback: 'Seat Cooler'},
      {
        value: 'steering_wheel_heat',
        labelKey: 'automations.commands.steeringWheelHeat',
        fallback: 'Steering Wheel Heater',
      },
      {value: 'dog_mode', labelKey: 'automations.commands.dogMode', fallback: 'Dog Mode'},
      {value: 'camp_mode', labelKey: 'automations.commands.campMode', fallback: 'Camp Mode'},
    ],
  },
  {
    labelKey: 'automations.commandGroups.charging',
    fallback: 'Charging',
    commands: [
      {value: 'charge_start', labelKey: 'automations.commands.chargeStart', fallback: 'Start Charging'},
      {value: 'charge_stop', labelKey: 'automations.commands.chargeStop', fallback: 'Stop Charging'},
      {
        value: 'set_charge_limit',
        labelKey: 'automations.commands.setChargeLimit',
        fallback: 'Set Charge Limit',
      },
      {
        value: 'set_charging_amps',
        labelKey: 'automations.commands.setChargingAmps',
        fallback: 'Set Charging Amps',
      },
      {
        value: 'open_charge_port',
        labelKey: 'automations.commands.openChargePort',
        fallback: 'Open Charge Port',
      },
      {
        value: 'close_charge_port',
        labelKey: 'automations.commands.closeChargePort',
        fallback: 'Close Charge Port',
      },
    ],
  },
  {
    labelKey: 'automations.commandGroups.doors',
    fallback: 'Doors & Trunk',
    commands: [
      {value: 'frunk_open', labelKey: 'automations.commands.frunkOpen', fallback: 'Open Frunk'},
      {value: 'trunk_open', labelKey: 'automations.commands.trunkOpen', fallback: 'Open Trunk'},
    ],
  },
  {
    labelKey: 'automations.commandGroups.alerts',
    fallback: 'Alerts',
    commands: [
      {value: 'honk', labelKey: 'automations.commands.honk', fallback: 'Honk Horn'},
      {value: 'flash', labelKey: 'automations.commands.flash', fallback: 'Flash Lights'},
    ],
  },
  {
    labelKey: 'automations.commandGroups.navigation',
    fallback: 'Navigation',
    commands: [
      {
        value: 'navigation_request',
        labelKey: 'automations.commands.navigationRequest',
        fallback: 'Navigate to Address',
      },
      {
        value: 'navigation_gps_request',
        labelKey: 'automations.commands.navigationGpsRequest',
        fallback: 'Navigate to GPS',
      },
      {
        value: 'trigger_homelink',
        labelKey: 'automations.commands.triggerHomelink',
        fallback: 'Trigger HomeLink',
      },
    ],
  },
  {
    labelKey: 'automations.commandGroups.driveSoftware',
    fallback: 'Drive & Software',
    commands: [
      {
        value: 'remote_start_drive',
        labelKey: 'automations.commands.remoteStartDrive',
        fallback: 'Remote Start',
      },
      {value: 'wake_up', labelKey: 'automations.commands.wakeUp', fallback: 'Wake Up'},
    ],
  },
];

interface ActionBuilderProps {
  actions: AutomationActionStepInput[];
  channels: NotificationChannel[];
  onChange: (actions: AutomationActionStepInput[]) => void;
}

interface ActionFieldsProps {
  action: AutomationActionStepInput;
  channelOptions: {value: string; label: string; disabled?: boolean}[];
  onChange: (action: AutomationActionStepInput) => void;
}

/* ── native translation fallback (native-safe port of react-i18next) ─────── */

type NativeTVars = Record<string, string | number>;
type NativeTFunction = (
  key: string,
  fallback?: string,
  vars?: NativeTVars,
) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useMemo<NativeTFunction>(
    () => (key, fallback, vars) => {
      const template = fallback ?? key;
      if (!vars) {
        return template;
      }
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
        Object.prototype.hasOwnProperty.call(vars, name)
          ? String(vars[name])
          : `{{${name}}}`,
      );
    },
    [],
  );
}

/* ── decorative glyph stand-ins for the lucide-react icons ───────────────── */

const PLUS_GLYPH = '\u002B'; // + (lucide Plus)
const TRASH_GLYPH = '\uD83D\uDDD1'; // 🗑 (lucide Trash2)
const CHEVRON_UP_GLYPH = '\u2303'; // ⌃ (lucide ChevronUp)
const CHEVRON_DOWN_GLYPH = '\u2304'; // ⌄ (lucide ChevronDown)
const SELECT_CHEVRON_GLYPH = '\u25BE'; // ▾ (native <select> affordance)

const MONO_FONT = Platform.select({ios: 'Menlo', android: 'monospace', default: 'monospace'});

/* ── shared field label (web `<Select>`/`<Input>` label) ─────────────────── */

function FieldLabel({children}: {children: ReactNode}) {
  return (
    <AppText style={styles.fieldLabel} tone="secondary" weight="semibold">
      {children}
    </AppText>
  );
}

/* ── native Select stand-in (`@/components/ui` Select) ───────────────────── */

interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectFieldProps {
  label?: string;
  options: SelectOption[];
  value: string;
  onValueChange: (value: string) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

interface Anchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

function SelectField({
  label,
  options,
  value,
  onValueChange,
  style,
  testID,
}: SelectFieldProps) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const triggerRef = useRef<RNView | null>(null);

  const selected = options.find((option) => option.value === value);

  const openMenu = useCallback(() => {
    triggerRef.current?.measureInWindow((x, y, width, height) => {
      setAnchor({x, y, width, height});
    });
    setOpen(true);
  }, []);

  const close = useCallback(() => setOpen(false), []);

  const select = useCallback(
    (next: string) => {
      onValueChange(next);
      setOpen(false);
    },
    [onValueChange],
  );

  const menuPosition = useMemo<StyleProp<ViewStyle>>(() => {
    if (!anchor) {
      return styles.menuFallback;
    }
    return {
      left: anchor.x,
      top: anchor.y + anchor.height + spacing.xs,
      width: anchor.width,
    };
  }, [anchor]);

  return (
    <View style={[styles.field, style]}>
      {label ? <FieldLabel>{label}</FieldLabel> : null}
      <Pressable
        ref={triggerRef}
        accessibilityRole="button"
        accessibilityState={{expanded: open}}
        onPress={openMenu}
        style={({pressed}) => [
          styles.selectTrigger,
          pressed && styles.selectTriggerPressed,
        ]}
        testID={testID}>
        <AppText numberOfLines={1} style={styles.selectValue}>
          {selected?.label ?? ''}
        </AppText>
        <AppText
          importantForAccessibility="no-hide-descendants"
          style={styles.selectChevron}>
          {SELECT_CHEVRON_GLYPH}
        </AppText>
      </Pressable>

      <Modal
        animationType="fade"
        onRequestClose={close}
        transparent
        visible={open}>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={close}
          style={styles.backdrop}
          testID={testID ? `${testID}-backdrop` : undefined}
        />
        <View
          accessibilityViewIsModal
          style={[styles.menu, menuPosition]}
          testID={testID ? `${testID}-menu` : undefined}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            style={styles.menuScroll}>
            {options.map((option) => {
              const isSelected = option.value === value;
              const isDisabled = Boolean(option.disabled);
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="button"
                  accessibilityState={{disabled: isDisabled, selected: isSelected}}
                  disabled={isDisabled}
                  onPress={() => select(option.value)}
                  style={({pressed}) => [
                    styles.option,
                    isSelected && styles.optionSelected,
                    pressed && !isDisabled && styles.optionPressed,
                  ]}
                  testID={
                    testID ? `${testID}-option-${option.value}` : undefined
                  }>
                  <AppText
                    numberOfLines={1}
                    style={[
                      styles.optionLabel,
                      isDisabled && styles.optionLabelDisabled,
                    ]}>
                    {option.label}
                  </AppText>
                  {isSelected ? (
                    <AppText
                      importantForAccessibility="no-hide-descendants"
                      style={styles.optionCheck}>
                      {'\u2713'}
                    </AppText>
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

/* ── native Input stand-in (`@/components/ui` Input) ─────────────────────── */

interface InputFieldProps {
  label?: string;
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

function InputField({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  style,
  testID,
}: InputFieldProps) {
  return (
    <View style={[styles.field, style]}>
      {label ? <FieldLabel>{label}</FieldLabel> : null}
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={keyboardType}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        testID={testID}
        value={value}
      />
    </View>
  );
}

/* ── native Textarea stand-in (`@/components/ui` Textarea) ───────────────── */

interface TextareaFieldProps {
  label?: string;
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  rows?: number;
  error?: string;
  mono?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

function TextareaField({
  label,
  value,
  onChangeText,
  placeholder,
  rows = 2,
  error,
  mono = false,
  style,
  testID,
}: TextareaFieldProps) {
  return (
    <View style={[styles.field, style]}>
      {label ? <FieldLabel>{label}</FieldLabel> : null}
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        multiline
        numberOfLines={rows}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        style={[
          styles.textarea,
          {minHeight: 22 * rows + spacing.md},
          mono && styles.mono,
          error ? styles.inputError : null,
        ]}
        testID={testID}
        textAlignVertical="top"
        value={value}
      />
      {error ? (
        <AppText style={styles.errorText} testID={testID ? `${testID}-error` : undefined}>
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

/* ── native icon Button stand-in (`@/components/ui` Button, ghost/sm) ─────── */

interface IconButtonProps {
  glyph: string;
  onPress: () => void;
  accessibilityLabel: string;
  disabled?: boolean;
  danger?: boolean;
  testID?: string;
}

function IconButton({
  glyph,
  onPress,
  accessibilityLabel,
  disabled = false,
  danger = false,
  testID,
}: IconButtonProps) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{disabled}}
      disabled={disabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.iconButton,
        disabled && styles.iconButtonDisabled,
        pressed && !disabled && styles.iconButtonPressed,
      ]}
      testID={testID}>
      <AppText
        importantForAccessibility="no-hide-descendants"
        style={[styles.iconGlyph, danger && styles.iconGlyphDanger]}>
        {glyph}
      </AppText>
    </Pressable>
  );
}

/* ── ported verbatim: pure helpers ───────────────────────────────────────── */

function isCommandParams(value: unknown): value is CommandParams {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function createDefaultAction(
  kind: AutomationActionKind,
  channelId = 0,
): AutomationActionStepInput {
  switch (kind) {
    case 'action_command':
      return {kind, command_name: 'climate_on'};
    case 'action_notify':
      return {kind, channel_id: channelId, template: ''};
    case 'action_set_setting':
      return {kind, setting_key: '', value_text: ''};
    case 'action_call_automation':
      return {kind, target_automation_id: 0};
  }
}

function settingValueKind(
  action: AutomationActionSetSettingStepInput,
): SettingValueKind {
  if (action.value_num != null) {
    return 'number';
  }
  if (action.value_bool != null) {
    return 'boolean';
  }
  return 'text';
}

function actionWithSettingValue(
  action: AutomationActionSetSettingStepInput,
  kind: SettingValueKind,
  value: string,
): AutomationActionStepInput {
  if (kind === 'number') {
    return {
      kind: 'action_set_setting',
      setting_key: action.setting_key,
      value_num: Number.parseFloat(value) || 0,
    };
  }
  if (kind === 'boolean') {
    return {
      kind: 'action_set_setting',
      setting_key: action.setting_key,
      value_bool: value === 'true',
    };
  }
  return {
    kind: 'action_set_setting',
    setting_key: action.setting_key,
    value_text: value,
  };
}

/* ═══════════════════════════════════════════════════════════════════════
   ActionBuilder — ordered list of automation actions
   ═══════════════════════════════════════════════════════════════════════ */

export function ActionBuilder({actions, channels, onChange}: ActionBuilderProps) {
  const t = useNativeTranslationFallback();

  const defaultChannelId = useMemo(
    () => channels.find((channel) => channel.enabled)?.id ?? channels[0]?.id ?? 0,
    [channels],
  );

  const actionTypeOptions = useMemo(
    () =>
      ACTION_TYPES.map((action) => ({
        value: action.value,
        label: t(action.labelKey, action.fallback),
      })),
    [t],
  );

  const channelOptions = useMemo(
    () =>
      channels.map((channel) => ({
        value: String(channel.id),
        label: `${channel.name} (${channel.kind})`,
        disabled: !channel.enabled,
      })),
    [channels],
  );

  const addAction = useCallback(() => {
    onChange([...actions, createDefaultAction('action_command', defaultChannelId)]);
  }, [actions, defaultChannelId, onChange]);

  const removeAction = useCallback(
    (index: number) =>
      onChange(actions.filter((_, currentIndex) => currentIndex !== index)),
    [actions, onChange],
  );

  const replaceAction = useCallback(
    (index: number, nextAction: AutomationActionStepInput) => {
      onChange(
        actions.map((action, currentIndex) =>
          currentIndex === index ? nextAction : action,
        ),
      );
    },
    [actions, onChange],
  );

  const moveAction = useCallback(
    (index: number, direction: -1 | 1) => {
      const target = index + direction;
      if (target < 0 || target >= actions.length) {
        return;
      }
      const next = [...actions];
      [next[index], next[target]] = [next[target], next[index]];
      onChange(next);
    },
    [actions, onChange],
  );

  return (
    <View style={styles.root} testID="action-builder">
      {actions.map((action, index) => (
        <GlassPanel
          key={`${action.kind}-${index}`}
          style={styles.panel}
          testID={`action-builder-row-${index}`}>
          <View style={styles.row}>
            <AppText
              style={styles.index}
              tone="muted"
              testID={`action-builder-index-${index}`}>
              {`${index + 1}.`}
            </AppText>
            <View style={styles.rowBody}>
              <View style={styles.fieldsRow}>
                <SelectField
                  label={
                    index === 0
                      ? t('automations.builder.actionType', 'Action Type')
                      : undefined
                  }
                  options={actionTypeOptions}
                  value={action.kind}
                  onValueChange={(next) =>
                    replaceAction(
                      index,
                      createDefaultAction(
                        next as AutomationActionKind,
                        defaultChannelId,
                      ),
                    )
                  }
                  style={styles.w48}
                  testID={`action-builder-kind-${index}`}
                />
                <ActionFields
                  action={action}
                  channelOptions={channelOptions}
                  onChange={(nextAction) => replaceAction(index, nextAction)}
                />
              </View>
            </View>
            <View style={styles.controls}>
              <IconButton
                glyph={CHEVRON_UP_GLYPH}
                onPress={() => moveAction(index, -1)}
                disabled={index === 0}
                accessibilityLabel={t('automations.builder.moveUp', 'Move up')}
                testID={`action-builder-up-${index}`}
              />
              <IconButton
                glyph={CHEVRON_DOWN_GLYPH}
                onPress={() => moveAction(index, 1)}
                disabled={index === actions.length - 1}
                accessibilityLabel={t('automations.builder.moveDown', 'Move down')}
                testID={`action-builder-down-${index}`}
              />
              <IconButton
                glyph={TRASH_GLYPH}
                onPress={() => removeAction(index)}
                danger
                accessibilityLabel={t(
                  'automations.builder.removeAction',
                  'Remove action',
                )}
                testID={`action-builder-remove-${index}`}
              />
            </View>
          </View>
        </GlassPanel>
      ))}

      <Pressable
        accessibilityRole="button"
        onPress={addAction}
        style={({pressed}) => [
          styles.addButton,
          pressed && styles.addButtonPressed,
        ]}
        testID="action-builder-add">
        <AppText
          importantForAccessibility="no-hide-descendants"
          style={styles.addGlyph}>
          {PLUS_GLYPH}
        </AppText>
        <AppText style={styles.addLabel} weight="semibold">
          {t('automations.builder.addAction', 'Add Action')}
        </AppText>
      </Pressable>
    </View>
  );
}

function ActionFields({action, channelOptions, onChange}: ActionFieldsProps) {
  const t = useNativeTranslationFallback();
  const [paramsText, setParamsText] = useState('');
  const [paramsError, setParamsError] = useState<string | null>(null);

  const commandOptions = useMemo(
    () => [
      {value: '', label: t('automations.builder.selectCommand', 'Select command...')},
      ...COMMAND_GROUPS.flatMap((group) => {
        const groupLabel = t(group.labelKey, group.fallback);
        return group.commands.map((command) => ({
          value: command.value,
          label: `${groupLabel} - ${t(command.labelKey, command.fallback)}`,
        }));
      }),
    ],
    [t],
  );

  useEffect(() => {
    if (action.kind !== 'action_command') {
      setParamsText('');
      setParamsError(null);
      return;
    }
    setParamsText(
      action.command_params ? JSON.stringify(action.command_params, null, 2) : '',
    );
    setParamsError(null);
  }, [action]);

  switch (action.kind) {
    case 'action_command':
      return (
        <View style={styles.fieldsRowFlex}>
          <SelectField
            label={t('automations.builder.command', 'Command')}
            options={commandOptions}
            value={action.command_name}
            onValueChange={(next) => onChange({...action, command_name: next})}
            style={styles.w64}
            testID="action-fields-command"
          />
          <View style={styles.paramsContainer}>
            <TextareaField
              label={t('automations.builder.commandParams', 'Params (JSON, optional)')}
              value={paramsText}
              onChangeText={(nextText) => {
                setParamsText(nextText);
                if (!nextText.trim()) {
                  setParamsError(null);
                  onChange({...action, command_params: undefined});
                  return;
                }
                try {
                  const parsed: unknown = JSON.parse(nextText);
                  if (!isCommandParams(parsed)) {
                    setParamsError(
                      t(
                        'automations.builder.commandParamsObjectError',
                        'Params must be a JSON object.',
                      ),
                    );
                    return;
                  }
                  setParamsError(null);
                  onChange({...action, command_params: parsed});
                } catch (error) {
                  setParamsError(
                    error instanceof Error
                      ? error.message
                      : t('automations.builder.invalidJson', 'Invalid JSON'),
                  );
                }
              }}
              placeholder={t('automations.builder.commandParamsPlaceholder', '{"temp": 21}')}
              rows={2}
              error={paramsError ?? undefined}
              mono
              testID="action-fields-command-params"
            />
          </View>
        </View>
      );

    case 'action_notify':
      return (
        <View style={styles.fieldsRowFlex}>
          <SelectField
            label={t('automations.builder.channel', 'Channel')}
            options={
              channelOptions.length > 0
                ? channelOptions
                : [
                    {
                      value: '0',
                      label: t('automations.builder.noChannels', 'No channels configured'),
                    },
                  ]
            }
            value={String(action.channel_id)}
            onValueChange={(next) =>
              onChange({
                ...action,
                channel_id: Number.parseInt(next, 10) || 0,
              })
            }
            style={styles.w48}
            testID="action-fields-channel"
          />
          <View style={styles.paramsContainer}>
            <TextareaField
              label={t('automations.builder.notifyMessage', 'Message')}
              value={action.template}
              onChangeText={(next) => onChange({...action, template: next})}
              placeholder={t('automations.builder.notifyPlaceholder', 'Car is warming up!')}
              rows={2}
              testID="action-fields-notify-message"
            />
          </View>
        </View>
      );

    case 'action_set_setting': {
      const valueKind = settingValueKind(action);
      const value =
        valueKind === 'number'
          ? String(action.value_num ?? 0)
          : valueKind === 'boolean'
            ? String(action.value_bool ?? false)
            : action.value_text ?? '';

      return (
        <View style={styles.fieldsRowFlex}>
          <InputField
            label={t('automations.builder.settingKey', 'Setting Key')}
            value={action.setting_key}
            onChangeText={(next) => onChange({...action, setting_key: next})}
            placeholder={t('automations.builder.settingKeyPlaceholder', 'charge_limit')}
            style={styles.w44}
            testID="action-fields-setting-key"
          />
          <SelectField
            label={t('automations.builder.valueType', 'Value Type')}
            options={[
              {value: 'text', label: t('automations.builder.valueText', 'Text')},
              {value: 'number', label: t('automations.builder.valueNumber', 'Number')},
              {value: 'boolean', label: t('automations.builder.valueBoolean', 'Boolean')},
            ]}
            value={valueKind}
            onValueChange={(next) =>
              onChange(
                actionWithSettingValue(action, next as SettingValueKind, value),
              )
            }
            style={styles.w36}
            testID="action-fields-value-type"
          />
          {valueKind === 'boolean' ? (
            <SelectField
              label={t('automations.builder.value', 'Value')}
              options={[
                {value: 'true', label: t('common.true', 'True')},
                {value: 'false', label: t('common.false', 'False')},
              ]}
              value={value}
              onValueChange={(next) =>
                onChange(actionWithSettingValue(action, valueKind, next))
              }
              style={styles.w28}
              testID="action-fields-value-bool"
            />
          ) : (
            <InputField
              label={t('automations.builder.value', 'Value')}
              keyboardType={valueKind === 'number' ? 'numeric' : 'default'}
              value={value}
              onChangeText={(next) =>
                onChange(actionWithSettingValue(action, valueKind, next))
              }
              placeholder={
                valueKind === 'number'
                  ? t('automations.builder.valueNumberPlaceholder', '80')
                  : t('automations.builder.valueTextPlaceholder', 'enabled')
              }
              style={styles.w44}
              testID="action-fields-value"
            />
          )}
        </View>
      );
    }

    case 'action_call_automation':
      return (
        <View style={styles.fieldsRowFlex}>
          <InputField
            label={t('automations.builder.targetAutomationId', 'Target Automation ID')}
            keyboardType="numeric"
            value={action.target_automation_id ? String(action.target_automation_id) : ''}
            onChangeText={(next) =>
              onChange({
                ...action,
                target_automation_id: Number.parseInt(next, 10) || 0,
              })
            }
            style={styles.w48}
            testID="action-fields-target-automation"
          />
        </View>
      );
  }
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.md,
  },
  panel: {
    padding: spacing.md,
  },
  row: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  index: {
    fontFamily: MONO_FONT,
    fontSize: typography.caption,
    marginTop: spacing.lg,
    textAlign: 'right',
    width: 24,
  },
  rowBody: {
    flex: 1,
    gap: spacing.md,
  },
  fieldsRow: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  fieldsRowFlex: {
    alignItems: 'flex-end',
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  controls: {
    flexDirection: 'column',
    gap: spacing.xs,
    marginTop: spacing.lg,
  },
  field: {
    gap: spacing.xs,
  },
  fieldLabel: {
    fontSize: typography.caption,
  },
  w48: {
    maxWidth: '100%',
    width: 192,
  },
  w64: {
    maxWidth: '100%',
    width: 256,
  },
  w44: {
    maxWidth: '100%',
    width: 176,
  },
  w36: {
    maxWidth: '100%',
    width: 144,
  },
  w28: {
    maxWidth: '100%',
    width: 112,
  },
  paramsContainer: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 220,
  },
  selectTrigger: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    minHeight: 40,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  selectTriggerPressed: {
    borderColor: colors.borderAccent,
  },
  selectValue: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: typography.caption,
  },
  selectChevron: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 18,
  },
  input: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: typography.caption,
    minHeight: 40,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  inputError: {
    borderColor: colors.danger,
  },
  textarea: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: typography.caption,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  mono: {
    fontFamily: MONO_FONT,
  },
  errorText: {
    color: colors.danger,
    fontSize: 11,
    lineHeight: 15,
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: 6,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  iconButtonDisabled: {
    opacity: 0.4,
  },
  iconButtonPressed: {
    backgroundColor: colors.surfaceHover,
  },
  iconGlyph: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 18,
  },
  iconGlyphDanger: {
    color: colors.danger,
  },
  addButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 8,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  addButtonPressed: {
    backgroundColor: colors.surfaceHover,
  },
  addGlyph: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 20,
  },
  addLabel: {
    color: colors.textPrimary,
    fontSize: typography.caption,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  menu: {
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    elevation: 12,
    maxHeight: 288,
    padding: spacing.xs,
    position: 'absolute',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 10},
    shadowOpacity: 0.34,
    shadowRadius: 18,
  },
  menuFallback: {
    left: spacing.md,
    right: spacing.md,
    top: spacing.xxl,
  },
  menuScroll: {
    maxHeight: 280,
  },
  option: {
    alignItems: 'center',
    borderRadius: 6,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  optionSelected: {
    backgroundColor: colors.surfaceSelected,
  },
  optionPressed: {
    backgroundColor: colors.surfaceHover,
  },
  optionLabel: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: typography.caption,
  },
  optionLabelDisabled: {
    color: colors.textMuted,
  },
  optionCheck: {
    color: colors.accent,
    fontSize: 14,
    lineHeight: 18,
  },
});
