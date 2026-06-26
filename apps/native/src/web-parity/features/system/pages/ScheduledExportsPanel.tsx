// Native parity port of web/src/features/system/pages/ScheduledExportsPanel.tsx.
//
// `ScheduledExportsPanel` renders the authenticated user's recurring exports: a
// header with a "New schedule" button, an inline create/edit form, a list of
// schedules with per-row Run-now / Enable-Disable / Edit / Delete actions, and a
// delete-confirmation dialog. Every state name (`showForm`, `editingId`, `form`,
// `pendingDelete`), the `rows = data ?? []` derivation, the helpers
// (`emptyInput`, `inputFromRow`) and field handlers (`startCreate`, `startEdit`,
// `closeForm`, `submit`, `toggleEnabled`), the `EXPORT_TYPES`/`FORMATS`/
// `DELIVERY_KINDS` option lists, the download-vs-target delivery normalisation in
// `submit`, every API path/mutation (via the reused web-parity `useExports`
// hooks), and every i18n key + fallback are preserved verbatim from the source.
//
// Web-only dependencies with no native-parity surface are mapped per the
// conversion contract (rules 4/5/6/7), each recorded in the sidecar:
//   - react-i18next `useTranslation` (L23) -> a local i18n shim returning
//     `fallback` and interpolating `{{token}}` options (the deleteConfirmBody
//     `{{name}}` case), so every key + copy survives. The hook shape mirrors the
//     web `const { t } = useTranslation()` (the CommandConfirmDialog precedent).
//   - `GlassPanel` from @/components/ui (L25) -> the shared native GlassPanel
//     (the panel root; web `p-6` -> padding 24).
//   - `Button` from @/components/ui (L26) is not ported -> a local `Button`
//     (Pressable: optional leading glyph / loading ActivityIndicator + label,
//     variant primary/ghost/danger, `onClick` -> `onPress`, web `size="sm"` baked
//     in since every call site is sm) — the "own the unported sibling locally"
//     approach the DataRepairPage / CommandConfirmDialog ports use. The web
//     `type="submit"`/`type="button"` has no native form; the Save button calls
//     `submit()` from `onPress`.
//   - `Input` from @/components/ui (L27) -> a local labelled `FieldInput`
//     (TextInput). Web DOM `onChange={(e)=>...e.target.value}` becomes RN
//     `onChangeText`; the delivery-target field maps to email/url keyboards.
//   - `Select` from @/components/ui (L28) -> a local native-safe `Select`
//     (a labelled radiogroup of selectable chips, the KioskSettingsModal
//     precedent). The web `onChange(e => e.target.value)` event shape has no
//     native analog, so `Select` emits the option value directly and the call
//     sites keep their identical `value as ...` cast.
//   - `Badge` from @/components/ui (L29) -> the web-parity Badge (reused;
//     variant="success"/"danger").
//   - `ConfirmDialog` from @/components/ui (L30) -> a local Modal-based
//     `ConfirmDialog` (transparent fade, backdrop-tap + hardware-back close via
//     onRequestClose), the AiConfirmDialog / CommandConfirmDialog scaffold. The
//     web extras (typed-confirmation, silenceKey, Escape handler, Modal portal)
//     are unused by this call site and intentionally omitted.
//   - `Skeleton` from @/components/feedback (L31) -> a local pulsing `Skeleton`
//     bar (Animated opacity loop) reproducing the three `h-12 w-full` placeholders.
//   - `EmptyState` from @/components/feedback (L32) -> the shared native
//     EmptyState (reused; title + message).
//   - `TimeStamp` from @/components/data-display (L33) -> the web-parity TimeStamp
//     (reused; renders next_run_at / last_run_at).
//   - `Icons` from @/lib/icons (L34): the `Icons.add` (lucide `Plus`) icon has no
//     native analog (react-native-svg is not a dependency) -> a decorative "+"
//     glyph in the New-schedule button; the label always carries the meaning.
//
// The web `<table>` has no native analog; each schedule renders as a stacked
// card (name as the title, then labelled Type / Cron / Delivery / Next run /
// Last run / Status fields, then the action button row) — the DataRepairPage
// StaleRow precedent. Disabled rows keep the web `opacity-50`. All `data-testid`
// values are preserved as `testID`. No DOM-only modules, browser HTML elements,
// Recharts, Leaflet, framer-motion, lucide, or old web UI components are imported.
// Tailwind maps to StyleSheet: p-6 -> 24, mt-6 -> 24, gap-4 -> 16, gap-2 -> 8,
// gap-1 -> 4, rounded-lg -> 8, rounded-md -> 6, text-lg -> 18, text-sm -> 14,
// text-xs -> 12; --text-primary/-secondary/-muted -> colors.text*.

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type TextStyle,
} from 'react-native';

import {EmptyState} from '../../../../components/feedback/EmptyState';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors} from '../../../../theme/tokens';
import {TimeStamp} from '../../../components/data-display/TimeStamp';
import {Badge} from '../../../components/ui/Badge';
import {
  useCreateScheduledExport,
  useDeleteScheduledExport,
  useRunScheduledExportNow,
  useScheduledExports,
  useUpdateScheduledExport,
  type ScheduledExport,
  type ScheduledExportInput,
} from '../../../api/hooks/useExports';

// ── Local i18n shim ──────────────────────────────────────────────────────────
// react-i18next has no native parity module; translations resolve to their
// inline English fallback, with `{{token}}` interpolation for the parameterised
// deleteConfirmBody string. The hook shape mirrors the web
// `const { t } = useTranslation()` so call sites are unchanged.
type TOptions = Record<string, string>;
type TFn = (key: string, fallback: string, options?: TOptions) => string;

function useTranslation(): {t: TFn} {
  const t = useCallback<TFn>((_key, fallback, options) => {
    if (!options) {
      return fallback;
    }
    return Object.entries(options).reduce(
      (text, [token, value]) => text.split(`{{${token}}}`).join(value),
      fallback,
    );
  }, []);
  return {t};
}

// Decorative stand-in for the lucide `Icons.add` (Plus) icon; the button label
// always carries the meaning, so the glyph is flagged decorative for a11y.
const PLUS_GLYPH = '+';

const EXPORT_TYPES: ScheduledExport['export_type'][] = [
  'drives',
  'charging',
  'trips',
  'positions',
  'signals',
];

const FORMATS: ScheduledExport['format'][] = ['csv', 'json'];

const DELIVERY_KINDS: ScheduledExport['delivery']['kind'][] = [
  'download',
  'email',
  'webhook',
];

function emptyInput(): ScheduledExportInput {
  return {
    name: '',
    export_type: 'drives',
    format: 'csv',
    schedule_cron: '0 9 * * 0',
    delivery: {kind: 'download'},
    range_window: '7d',
    enabled: true,
  };
}

function inputFromRow(row: ScheduledExport): ScheduledExportInput {
  return {
    name: row.name,
    export_type: row.export_type,
    format: row.format,
    vehicle_id: row.vehicle_id ?? undefined,
    columns: row.columns ?? undefined,
    schedule_cron: row.schedule_cron,
    delivery: {...row.delivery},
    range_window: row.range_window,
    enabled: row.enabled,
  };
}

// ── Skeleton (web @/components/feedback Skeleton, h-12 w-full) ────────────────
function Skeleton() {
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.4,
          duration: 800,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return <Animated.View style={[styles.skeletonBar, {opacity}]} />;
}

// ── LabeledField (web `<label>` span + control + optional help span) ──────────
function LabeledField({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.field}>
      <AppText style={styles.fieldLabel}>{label}</AppText>
      {children}
      {help ? <AppText style={styles.fieldHelp}>{help}</AppText> : null}
    </View>
  );
}

// ── FieldInput (web @/components/ui Input) ────────────────────────────────────
function FieldInput({
  value,
  onChangeText,
  placeholder,
  keyboardType,
  autoCapitalize,
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: 'none' | 'sentences';
}) {
  return (
    <TextInput
      autoCapitalize={autoCapitalize}
      keyboardType={keyboardType}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.textMuted}
      style={styles.input}
      value={value}
    />
  );
}

// ── Select (web @/components/ui Select -> native radiogroup chips) ────────────
interface SelectOption {
  value: string;
  label: string;
}

function Select({
  options,
  value,
  onChange,
  accessibilityLabel,
}: {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  accessibilityLabel?: string;
}) {
  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="radiogroup"
      style={styles.selectRow}>
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
              pressed && !selected ? styles.chipPressed : null,
            ]}>
            <AppText
              style={selected ? styles.chipLabelSelected : styles.chipLabel}>
              {opt.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

// ── Button (web @/components/ui Button, size="sm") ────────────────────────────
type ButtonVariant = 'primary' | 'ghost' | 'danger';

// Dark-surface mapping of the web Tailwind variant classes.
const BUTTON_VARIANTS: Record<ButtonVariant, {bg: string; text: string}> = {
  primary: {bg: '#2563eb', text: '#ffffff'}, // bg-blue-600 text-white
  ghost: {bg: 'transparent', text: colors.textSecondary}, // bg-transparent
  danger: {bg: '#dc2626', text: '#ffffff'}, // bg-red-600 text-white
};

function Button({
  variant = 'primary',
  onPress,
  loading,
  disabled,
  glyph,
  children,
  testID,
}: {
  variant?: ButtonVariant;
  onPress?: () => void;
  loading?: boolean;
  disabled?: boolean;
  glyph?: string;
  children?: ReactNode;
  testID?: string;
}) {
  const isDisabled = Boolean(disabled) || Boolean(loading);
  const v = BUTTON_VARIANTS[variant];
  const labelStyle: TextStyle = {color: v.text, fontSize: 12, fontWeight: '500'};

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{busy: Boolean(loading), disabled: isDisabled}}
      disabled={isDisabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.button,
        {backgroundColor: v.bg},
        isDisabled ? styles.buttonDisabled : null,
        pressed && !isDisabled ? styles.buttonPressed : null,
      ]}
      testID={testID}>
      {loading ? (
        <ActivityIndicator color={v.text} size="small" />
      ) : glyph ? (
        <AppText
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.buttonGlyph, {color: v.text}]}>
          {glyph}
        </AppText>
      ) : null}
      {typeof children === 'string' || typeof children === 'number' ? (
        <AppText style={labelStyle}>{children}</AppText>
      ) : (
        children
      )}
    </Pressable>
  );
}

// ── RowField (a labelled table-cell value in the native card row) ─────────────
function RowField({
  label,
  value,
  mono,
  children,
}: {
  label: string;
  value?: string;
  mono?: boolean;
  children?: ReactNode;
}) {
  return (
    <View style={styles.rowField}>
      <AppText style={styles.rowFieldLabel}>{label}</AppText>
      {children ?? (
        <AppText style={[styles.rowFieldValue, mono ? styles.mono : null]}>
          {value}
        </AppText>
      )}
    </View>
  );
}

// ── ConfirmDialog (web @/components/ui ConfirmDialog, danger variant) ─────────
function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
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
        style={styles.overlay}>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={onCancel}
          style={styles.backdrop}
        />
        <View style={styles.dialog} testID="scheduled-exports-delete-dialog">
          <AppText style={styles.dialogTitle} weight="semibold">
            {title}
          </AppText>
          <AppText style={styles.dialogMessage} tone="secondary">
            {message}
          </AppText>
          <View style={styles.dialogActions}>
            <Button onPress={onCancel} variant="ghost">
              {cancelLabel}
            </Button>
            <Button
              onPress={onConfirm}
              testID="scheduled-exports-delete-confirm"
              variant="danger">
              {confirmLabel}
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function ScheduledExportsPanel() {
  const {t} = useTranslation();
  const {data, isLoading} = useScheduledExports();
  const create = useCreateScheduledExport();
  const update = useUpdateScheduledExport();
  const remove = useDeleteScheduledExport();
  const runNow = useRunScheduledExportNow();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ScheduledExportInput>(emptyInput);
  const [pendingDelete, setPendingDelete] = useState<ScheduledExport | null>(
    null,
  );

  const rows = data ?? [];

  function startCreate() {
    setForm(emptyInput());
    setEditingId(null);
    setShowForm(true);
  }

  function startEdit(row: ScheduledExport) {
    setForm(inputFromRow(row));
    setEditingId(row.id);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyInput());
  }

  async function submit() {
    const payload: ScheduledExportInput = {
      ...form,
      // Drop the optional target field for download deliveries so we
      // don't round-trip an unused string.
      delivery:
        form.delivery.kind === 'download'
          ? {kind: 'download'}
          : {
              kind: form.delivery.kind,
              target: (form.delivery.target ?? '').trim(),
            },
    };
    try {
      if (editingId == null) {
        await create.mutateAsync(payload);
      } else {
        await update.mutateAsync({id: editingId, payload});
      }
      closeForm();
    } catch {
      /* toast surfaced by mutation hook */
    }
  }

  async function toggleEnabled(row: ScheduledExport) {
    try {
      await update.mutateAsync({
        id: row.id,
        payload: {...inputFromRow(row), enabled: !row.enabled},
      });
    } catch {
      /* toast surfaced by mutation hook */
    }
  }

  return (
    <GlassPanel style={styles.panel} testID="scheduled-exports-panel">
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          <AppText style={styles.title}>
            {t('dataExport.scheduled.title', 'Scheduled exports')}
          </AppText>
          <AppText style={styles.subtitle}>
            {t(
              'dataExport.scheduled.subtitle',
              'Cron-driven recurring exports.',
            )}
          </AppText>
        </View>
        <Button
          glyph={PLUS_GLYPH}
          onPress={startCreate}
          testID="scheduled-exports-new-button"
          variant="primary">
          {t('dataExport.scheduled.newSchedule', 'New schedule')}
        </Button>
      </View>

      {showForm ? (
        <View style={styles.form} testID="scheduled-exports-form">
          <View style={styles.fieldsGrid}>
            <LabeledField label={t('dataExport.scheduled.form.name', 'Name')}>
              <FieldInput
                onChangeText={text => setForm({...form, name: text})}
                placeholder={t(
                  'dataExport.scheduled.form.namePlaceholder',
                  'Drives weekly',
                )}
                value={form.name}
              />
            </LabeledField>
            <LabeledField
              help={t(
                'dataExport.scheduled.form.scheduleCronHelp',
                "Standard 5-field cron, e.g. '0 9 * * 0'.",
              )}
              label={t(
                'dataExport.scheduled.form.scheduleCron',
                'Cron expression',
              )}>
              <FieldInput
                autoCapitalize="none"
                onChangeText={text => setForm({...form, schedule_cron: text})}
                placeholder="0 9 * * 0"
                value={form.schedule_cron}
              />
            </LabeledField>
            <LabeledField
              label={t('dataExport.scheduled.form.exportType', 'Export type')}>
              <Select
                accessibilityLabel={t(
                  'dataExport.scheduled.form.exportType',
                  'Export type',
                )}
                onChange={value =>
                  setForm({
                    ...form,
                    export_type: value as ScheduledExport['export_type'],
                  })
                }
                options={EXPORT_TYPES.map(opt => ({value: opt, label: opt}))}
                value={form.export_type}
              />
            </LabeledField>
            <LabeledField
              label={t('dataExport.scheduled.form.format', 'Format')}>
              <Select
                accessibilityLabel={t(
                  'dataExport.scheduled.form.format',
                  'Format',
                )}
                onChange={value =>
                  setForm({
                    ...form,
                    format: value as ScheduledExport['format'],
                  })
                }
                options={FORMATS.map(opt => ({value: opt, label: opt}))}
                value={form.format}
              />
            </LabeledField>
            <LabeledField
              help={t(
                'dataExport.scheduled.form.rangeWindowHelp',
                'Format: number + m/h/d.',
              )}
              label={t('dataExport.scheduled.form.rangeWindow', 'Range window')}>
              <FieldInput
                autoCapitalize="none"
                onChangeText={text => setForm({...form, range_window: text})}
                placeholder="7d"
                value={form.range_window ?? ''}
              />
            </LabeledField>
            <LabeledField
              label={t(
                'dataExport.scheduled.form.deliveryKind',
                'Delivery kind',
              )}>
              <Select
                accessibilityLabel={t(
                  'dataExport.scheduled.form.deliveryKind',
                  'Delivery kind',
                )}
                onChange={value =>
                  setForm({
                    ...form,
                    delivery: {
                      ...form.delivery,
                      kind: value as ScheduledExport['delivery']['kind'],
                    },
                  })
                }
                options={DELIVERY_KINDS.map(opt => ({value: opt, label: opt}))}
                value={form.delivery.kind}
              />
            </LabeledField>
            {form.delivery.kind !== 'download' ? (
              <LabeledField
                help={t(
                  'dataExport.scheduled.form.deliveryTargetHelp',
                  'Email address or HTTPS URL.',
                )}
                label={t(
                  'dataExport.scheduled.form.deliveryTarget',
                  'Delivery target',
                )}>
                <FieldInput
                  autoCapitalize="none"
                  keyboardType={
                    form.delivery.kind === 'email' ? 'email-address' : 'url'
                  }
                  onChangeText={text =>
                    setForm({
                      ...form,
                      delivery: {...form.delivery, target: text},
                    })
                  }
                  placeholder={
                    form.delivery.kind === 'email'
                      ? 'you@example.com'
                      : 'https://example.com/hook'
                  }
                  value={form.delivery.target ?? ''}
                />
              </LabeledField>
            ) : null}
          </View>
          <View style={styles.formActions}>
            <Button onPress={closeForm} variant="ghost">
              {t('dataExport.scheduled.form.cancel', 'Cancel')}
            </Button>
            <Button
              loading={create.isPending || update.isPending}
              onPress={() => submit().catch(() => undefined)}
              testID="scheduled-exports-form-submit"
              variant="primary">
              {t('dataExport.scheduled.form.submit', 'Save schedule')}
            </Button>
          </View>
        </View>
      ) : null}

      <View style={styles.listWrap}>
        {isLoading ? (
          <View style={styles.skeletonWrap}>
            <Skeleton />
            <Skeleton />
            <Skeleton />
          </View>
        ) : rows.length === 0 ? (
          // no-action: panel header already exposes a "New schedule" button
          <EmptyState
            message={t(
              'dataExport.scheduled.emptyMessage',
              'Create a schedule to receive recurring exports automatically.',
            )}
            title={t('dataExport.scheduled.empty', 'No schedules yet')}
          />
        ) : (
          <View style={styles.table} testID="scheduled-exports-table">
            {rows.map(row => (
              <View
                key={row.id}
                style={[styles.row, row.enabled ? null : styles.rowDisabled]}
                testID={`scheduled-exports-row-${row.id}`}>
                <AppText numberOfLines={1} style={styles.rowName}>
                  {row.name}
                </AppText>
                <RowField
                  label={t('dataExport.scheduled.table.type', 'Type')}
                  value={`${row.export_type} (${row.format})`}
                />
                <RowField
                  label={t('dataExport.scheduled.table.cron', 'Cron')}
                  mono
                  value={row.schedule_cron}
                />
                <RowField
                  label={t('dataExport.scheduled.table.delivery', 'Delivery')}
                  value={`${row.delivery.kind}${
                    row.delivery.target ? ` → ${row.delivery.target}` : ''
                  }`}
                />
                <RowField
                  label={t('dataExport.scheduled.table.nextRun', 'Next run')}>
                  {row.next_run_at ? (
                    <TimeStamp value={row.next_run_at} />
                  ) : (
                    <AppText style={styles.mutedText}>—</AppText>
                  )}
                </RowField>
                <RowField
                  label={t('dataExport.scheduled.table.lastRun', 'Last run')}>
                  {row.last_run_at ? (
                    <TimeStamp value={row.last_run_at} />
                  ) : (
                    <AppText style={styles.mutedText}>
                      {t('dataExport.scheduled.status.never', 'Never')}
                    </AppText>
                  )}
                </RowField>
                <RowField
                  label={t('dataExport.scheduled.table.status', 'Status')}>
                  {row.last_status === 'ok' ? (
                    <Badge variant="success">
                      {t('dataExport.scheduled.status.ok', 'OK')}
                    </Badge>
                  ) : row.last_status === 'failed' ? (
                    <Badge variant="danger">
                      {t('dataExport.scheduled.status.failed', 'Failed')}
                    </Badge>
                  ) : (
                    <AppText style={styles.mutedText}>—</AppText>
                  )}
                </RowField>
                <View style={styles.rowActions}>
                  <Button
                    loading={runNow.isPending && runNow.variables === row.id}
                    onPress={() => runNow.mutate(row.id)}
                    testID={`scheduled-exports-run-${row.id}`}
                    variant="ghost">
                    {t('dataExport.scheduled.actions.runNow', 'Run now')}
                  </Button>
                  <Button
                    onPress={() => toggleEnabled(row).catch(() => undefined)}
                    variant="ghost">
                    {row.enabled
                      ? t('dataExport.scheduled.actions.disable', 'Disable')
                      : t('dataExport.scheduled.actions.enable', 'Enable')}
                  </Button>
                  <Button onPress={() => startEdit(row)} variant="ghost">
                    {t('dataExport.scheduled.actions.edit', 'Edit')}
                  </Button>
                  <Button
                    onPress={() => setPendingDelete(row)}
                    testID={`scheduled-exports-delete-${row.id}`}
                    variant="danger">
                    {t('dataExport.scheduled.actions.delete', 'Delete')}
                  </Button>
                </View>
              </View>
            ))}
          </View>
        )}
      </View>

      <ConfirmDialog
        confirmLabel={t('dataExport.scheduled.actions.delete', 'Delete')}
        message={t(
          'dataExport.scheduled.deleteConfirmBody',
          'This will stop future runs of {{name}}.',
          {name: pendingDelete?.name ?? ''},
        )}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) {
            remove.mutate(pendingDelete.id);
          }
          setPendingDelete(null);
        }}
        open={pendingDelete !== null}
        title={t('dataExport.scheduled.deleteConfirmTitle', 'Delete schedule?')}
      />
    </GlassPanel>
  );
}

export default ScheduledExportsPanel;

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  button: {
    alignItems: 'center',
    borderRadius: 6,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 32,
    paddingHorizontal: 12,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonGlyph: {
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 18,
  },
  buttonPressed: {
    opacity: 0.8,
  },
  chip: {
    borderColor: colors.border,
    borderRadius: 9999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipIdle: {
    backgroundColor: colors.surfaceRaised,
  },
  chipLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '500',
  },
  chipLabelSelected: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '600',
  },
  chipPressed: {
    opacity: 0.7,
  },
  chipSelected: {
    backgroundColor: colors.surfaceSelected,
    borderColor: colors.borderAccent,
  },
  dialog: {
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.dangerBorder,
    borderRadius: 20,
    borderWidth: 1,
    gap: 12,
    margin: 20,
    maxWidth: 420,
    padding: 20,
    width: '92%',
  },
  dialogActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'flex-end',
    paddingTop: 4,
  },
  dialogMessage: {
    lineHeight: 20,
  },
  dialogTitle: {
    color: colors.textPrimary,
    fontSize: 16,
  },
  field: {
    gap: 4,
  },
  fieldHelp: {
    color: colors.textMuted,
    fontSize: 12,
  },
  fieldLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  fieldsGrid: {
    gap: 16,
  },
  form: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: 16,
    marginTop: 24,
    padding: 16,
  },
  formActions: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'flex-end',
  },
  headerRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 16,
    justifyContent: 'space-between',
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  input: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  listWrap: {
    gap: 8,
    marginTop: 24,
  },
  mono: {
    fontFamily: 'monospace',
    fontSize: 12,
  },
  mutedText: {
    color: colors.textMuted,
  },
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    flex: 1,
    justifyContent: 'center',
  },
  panel: {
    padding: 24,
  },
  row: {
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    padding: 12,
  },
  rowActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    justifyContent: 'flex-end',
    marginTop: 4,
  },
  rowDisabled: {
    opacity: 0.5,
  },
  rowField: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
  rowFieldLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  rowFieldValue: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: 14,
    textAlign: 'right',
  },
  rowName: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '500',
  },
  selectRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  skeletonBar: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 6,
    height: 48,
    width: '100%',
  },
  skeletonWrap: {
    gap: 8,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  table: {
    gap: 8,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '600',
  },
});
