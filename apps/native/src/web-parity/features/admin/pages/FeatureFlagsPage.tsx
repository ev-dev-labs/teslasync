// Native parity port of web/src/features/admin/pages/FeatureFlagsPage.tsx.
//
// FeatureFlagsPage — operator surface for the typed feature-flag registry
// mounted under /api/v1/system/flags*. It surfaces, side-by-side:
//   1. the CURRENT registry of flags (FlagsTable) with inline Edit + Delete
//      per row; the header "Add flag" CTA opens the same drawer with
//      initial=null; and
//   2. the recent change-audit log (ChangesPanel). Saving or deleting a flag
//      re-renders both feeds via the shared query invalidation already wired
//      into the mutation hooks.
// Both Edit/Create and Delete are sudo-gated by the server's RequireSudo
// middleware — the shared request() client transparently re-opens the mounted
// ReauthDialog on 401 + SUDO_REQUIRED and replays the request once the operator
// re-authenticates (handled inside the unchanged native useFeatureFlags hooks).
//
// The web original composes the DOM page kit (PageContainer, GlassPanel,
// Button, Input, Modal, Drawer, Textarea, DataTable + useSortToggle, Badge,
// TimeStamp, EmptyState, PanelTitle/Text typography), lucide SVG icons
// (History, Flag, Plus, Pencil, Trash2), framer-motion FadeIn,
// SectionErrorBoundary, the three feature-flags sub-components
// (FlagsTable, FlagEditDrawer, ChangesPanel), react-i18next, and usePageTitle.
// React Native has no DOM, Tailwind, lucide SVGs, framer-motion, DataTable, or
// wired react-i18next, so this port reproduces the same behaviour with RN
// primitives + the established native parity building blocks. The three
// feature-flags sub-components are inlined here verbatim-by-behaviour because
// they are not part of the native conversion manifest; every prop, state name,
// predicate, API path, JSON-validation rule, and i18n key/default is preserved.
// See the colocated .parity.json sidecar for the line-by-line mapping.

import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import {EmptyState} from '../../../../components/feedback/EmptyState';
import {SemanticIcon} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, shadows, spacing} from '../../../../theme/tokens';
import {FreshnessIndicator} from '../../../components/data-display/FreshnessIndicator';
import {
  useDeleteFlag,
  useFlagChanges,
  useFlags,
  useSetFlag,
  type FeatureFlagChange,
  type FeatureFlagEntry,
  type FeatureFlagOperation,
  type FeatureFlagValue,
} from '../../../api/hooks/useFeatureFlags';

/* ─── i18n fallback ───────────────────────────────────────────────────── */

type TVars = Record<string, string | number | null | undefined>;
type TFunc = (key: string, defaultValue?: string, vars?: TVars) => string;

// react-i18next is not wired in native. The web page calls
// t('admin.flags.pageTitle', 'Feature Flags') — a dotted key plus an English
// default — and i18next returns the default when the key is unresolved. This
// fallback therefore returns `defaultValue ?? key` and applies the same
// {{var}} interpolation the web `t` performs (delete message, drawer titles,
// invalid-JSON message, scoped audit-empty message). Keys are kept verbatim so
// a future i18n wiring can resolve them unchanged.
function useT(): TFunc {
  return useCallback((key: string, defaultValue?: string, vars?: TVars) => {
    let out = defaultValue ?? key;
    if (vars) {
      for (const varKey of Object.keys(vars)) {
        const value = vars[varKey];
        out = out
          .split(`{{${varKey}}}`)
          .join(value == null ? '' : String(value));
      }
    }
    return out;
  }, []);
}

/* ─── Constants ───────────────────────────────────────────────────────── */

const MONO_FONT = Platform.select({ios: 'Menlo', default: 'monospace'});

const FALLBACK = '\u2014'; // — universal missing-value placeholder
const ELLIPSIS = '\u2026'; // … JSON-preview truncation marker

const PLUS_GLYPH = '+'; // lucide Plus (Add flag / nothing else)
const EDIT_GLYPH = '\u270E'; // ✎ — lucide Pencil (Edit)
const DELETE_GLYPH = '\u2715'; // ✕ — lucide Trash2 (Delete)
const SORT_ASC = '\u2191'; // ↑
const SORT_DESC = '\u2193'; // ↓
const CLOSE_GLYPH = '\u2715'; // ✕ — lucide X (Drawer close)

/* ─── Inlined helpers (web FlagsTable / ChangesPanel / FlagEditDrawer) ── */

// Compact JSON preview for a single table cell. Falls back to String(value)
// for primitives so booleans / numbers don't get extra quoting noise.
// (web FlagsTable.previewValue, verbatim logic.)
function previewValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    return FALLBACK;
  }
  const tx = typeof value;
  if (tx === 'string') {
    return JSON.stringify(value);
  }
  if (tx === 'boolean' || tx === 'number') {
    return String(value);
  }
  try {
    const json = JSON.stringify(value);
    if (json && json.length > 120) {
      return `${json.slice(0, 117)}${ELLIPSIS}`;
    }
    return json ?? FALLBACK;
  } catch {
    return FALLBACK;
  }
}

// Even-more-compact JSON preview for the audit old/new columns.
// (web ChangesPanel.compact, verbatim logic.)
function compact(value: unknown): string {
  if (value == null) {
    return FALLBACK;
  }
  try {
    const s = JSON.stringify(value);
    if (s && s.length > 60) {
      return `${s.slice(0, 57)}${ELLIPSIS}`;
    }
    return s ?? FALLBACK;
  } catch {
    return FALLBACK;
  }
}

// Pretty-print the initial value when the drawer opens in edit mode.
// (web FlagEditDrawer.defaultValueJson, verbatim logic.)
function defaultValueJson(initial: FeatureFlagEntry | null): string {
  if (!initial) {
    return '';
  }
  try {
    return JSON.stringify(initial.value, null, 2);
  } catch {
    return '';
  }
}

// web ChangesPanel renders <TimeStamp value={row.changed_at} format="absolute" />,
// whose absolute branch shows "Apr 4, 2:30 AM" in the host locale/timezone and
// the universal "—" for null/unparseable input. TimeStamp is not ported to
// native, so this inlines that absolute formatting faithfully.
function formatAbsolute(value: string | number | Date | null | undefined): string {
  if (value == null) {
    return FALLBACK;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return FALLBACK;
  }
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// web ChangesPanel OP_VARIANT — set -> success badge, delete -> danger badge.
const OP_VARIANT: Record<FeatureFlagOperation, 'success' | 'danger'> = {
  set: 'success',
  delete: 'danger',
};

/* ─── TextButton (web Button primary / secondary / danger) ────────────── */

type ButtonVariant = 'primary' | 'secondary' | 'danger';

interface TextButtonProps {
  label: string;
  onPress: () => void;
  variant: ButtonVariant;
  glyph?: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
}

function TextButton({
  label,
  onPress,
  variant,
  glyph,
  size = 'md',
  disabled = false,
  loading = false,
  testID,
}: TextButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{busy: loading, disabled: isDisabled}}
      disabled={isDisabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.button,
        size === 'sm' ? styles.buttonSm : styles.buttonMd,
        variant === 'primary' && styles.buttonPrimary,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'danger' && styles.buttonDanger,
        isDisabled && styles.buttonDisabled,
        pressed && !isDisabled && styles.buttonPressed,
      ]}
      testID={testID}>
      {loading ? (
        <ActivityIndicator
          color={variant === 'primary' ? colors.background : colors.textPrimary}
          size="small"
        />
      ) : (
        <>
          {glyph ? (
            <AppText
              style={[
                styles.buttonGlyph,
                size === 'sm' && styles.buttonGlyphSm,
                variant === 'primary' && styles.buttonPrimaryText,
                variant === 'secondary' && styles.buttonSecondaryText,
                variant === 'danger' && styles.buttonDangerText,
              ]}>
              {glyph}
            </AppText>
          ) : null}
          <AppText
            style={[
              size === 'sm' ? styles.buttonLabelSm : styles.buttonLabel,
              variant === 'primary' && styles.buttonPrimaryText,
              variant === 'secondary' && styles.buttonSecondaryText,
              variant === 'danger' && styles.buttonDangerText,
            ]}
            weight="semibold">
            {label}
          </AppText>
        </>
      )}
    </Pressable>
  );
}

/* ─── FieldLabel + LabelledInput (web Input / Textarea label) ─────────── */

function FieldLabel({children}: {children: string}) {
  return (
    <AppText style={styles.fieldLabel} variant="caption" weight="semibold">
      {children}
    </AppText>
  );
}

/* ─── PanelHeader (web icon + PanelTitle) ─────────────────────────────── */

function PanelHeader({name, title}: {name: 'flag' | 'history'; title: string}) {
  return (
    <View style={styles.panelHeader}>
      <SemanticIcon decorative name={name} size="sm" />
      <AppText style={styles.panelTitle} weight="semibold">
        {title}
      </AppText>
    </View>
  );
}

/* ─── OperationBadge (web Badge success / danger) ─────────────────────── */

function OperationBadge({operation}: {operation: FeatureFlagOperation}) {
  // The web ChangesPanel keeps a defensive `?? 'neutral'` for any unexpected
  // operation string; a Partial view makes that fallback type-meaningful.
  const variant: 'success' | 'danger' | 'neutral' =
    (OP_VARIANT as Partial<Record<FeatureFlagOperation, 'success' | 'danger'>>)[
      operation
    ] ?? 'neutral';
  return (
    <View
      style={[
        styles.opBadge,
        variant === 'success' && styles.opBadgeSuccess,
        variant === 'danger' && styles.opBadgeDanger,
        variant === 'neutral' && styles.opBadgeNeutral,
      ]}
      testID={`flag-op-${operation}`}>
      <AppText
        style={[
          styles.opBadgeText,
          variant === 'success' && styles.opBadgeTextSuccess,
          variant === 'danger' && styles.opBadgeTextDanger,
        ]}
        weight="semibold">
        {operation}
      </AppText>
    </View>
  );
}

/* ─── SectionBoundary (web SectionErrorBoundary) ──────────────────────── */

interface SectionBoundaryProps {
  name: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}

interface SectionBoundaryState {
  hasError: boolean;
}

// Wraps a section so a render failure inside it doesn't blank the whole page —
// the resilience contract of the web SectionErrorBoundary (inline fallback).
class SectionBoundary extends React.Component<
  SectionBoundaryProps,
  SectionBoundaryState
> {
  state: SectionBoundaryState = {hasError: false};

  static getDerivedStateFromError(): SectionBoundaryState {
    return {hasError: true};
  }

  render() {
    if (this.state.hasError) {
      return (
        <GlassPanel
          style={styles.panel}
          testID={`section-error-${this.props.name}`}>
          <View style={styles.sectionError}>
            <SemanticIcon decorative name="warning" size="sm" />
            <View style={styles.sectionErrorText}>
              <AppText tone="secondary" weight="semibold">
                {this.props.title}
              </AppText>
              <AppText tone="muted" variant="caption">
                {this.props.subtitle}
              </AppText>
            </View>
          </View>
        </GlassPanel>
      );
    }
    return this.props.children;
  }
}

/* ─── FlagsTableView (web FlagsTable / DataTable) ─────────────────────── */

interface FlagsTableViewProps {
  rows: FeatureFlagEntry[];
  loading: boolean;
  onEdit: (entry: FeatureFlagEntry) => void;
  onAskDelete: (entry: FeatureFlagEntry) => void;
  t: TFunc;
}

// web FlagsTable renders a DataTable with a sortable `key` column, a JSON value
// preview, and per-row Edit + Delete actions. Native has no DataTable, so this
// renders a card list (the established APIKeysPage pattern). The sortable key
// column is preserved as a tappable header toggling asc/desc — mirroring
// useSortToggle('key', 'asc') and the original [...rows].sort(localeCompare).
// DataTable pagination is omitted (all rows render); the loading/empty message
// contract is preserved verbatim.
function FlagsTableView({
  rows,
  loading,
  onEdit,
  onAskDelete,
  t,
}: FlagsTableViewProps) {
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => a.key.localeCompare(b.key) * dir);
  }, [rows, sortDir]);

  const toggleSort = useCallback(() => {
    setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'));
  }, []);

  if (sorted.length === 0) {
    return (
      <View style={styles.tableEmpty} testID="flags-table-empty">
        <AppText tone="muted">
          {loading
            ? t('admin.flags.table.loading', 'Loading flags\u2026')
            : t(
                'admin.flags.table.empty',
                'No feature flags are set on this server.',
              )}
        </AppText>
      </View>
    );
  }

  return (
    <View style={styles.table} testID="flags-table">
      <Pressable
        accessibilityHint={sortDir === 'asc' ? 'ascending' : 'descending'}
        accessibilityLabel={t('admin.flags.cols.key', 'Flag key')}
        accessibilityRole="button"
        onPress={toggleSort}
        style={styles.sortHeader}
        testID="flags-sort-key">
        <AppText tone="muted" variant="caption" weight="semibold">
          {t('admin.flags.cols.key', 'Flag key')}{' '}
          {sortDir === 'asc' ? SORT_ASC : SORT_DESC}
        </AppText>
      </Pressable>

      {sorted.map(row => (
        <GlassPanel
          key={row.key}
          style={styles.flagRow}
          testID={`flag-row-${row.key}`}>
          <View style={styles.flagRowText}>
            <AppText numberOfLines={1} style={styles.flagKey} weight="semibold">
              {row.key}
            </AppText>
            <View style={styles.flagValueRow}>
              <AppText style={styles.cellCaption} tone="muted" variant="caption">
                {t('admin.flags.cols.value', 'Value')}
              </AppText>
              <AppText
                numberOfLines={2}
                style={styles.flagValue}
                tone="muted">
                {previewValue(row.value)}
              </AppText>
            </View>
          </View>
          <View style={styles.rowActions}>
            <TextButton
              glyph={EDIT_GLYPH}
              label={t('admin.flags.actions.edit', 'Edit')}
              onPress={() => onEdit(row)}
              size="sm"
              testID={`flag-edit-${row.key}`}
              variant="secondary"
            />
            <TextButton
              glyph={DELETE_GLYPH}
              label={t('admin.flags.actions.delete', 'Delete')}
              onPress={() => onAskDelete(row)}
              size="sm"
              testID={`flag-delete-${row.key}`}
              variant="danger"
            />
          </View>
        </GlassPanel>
      ))}
    </View>
  );
}

/* ─── ChangesPanelView (web ChangesPanel / DataTable) ─────────────────── */

interface ChangesPanelViewProps {
  rows: FeatureFlagChange[];
  loading: boolean;
  scopedKey?: string | null;
  t: TFunc;
}

// web ChangesPanel renders the recent flag-change audit log. When
// !loading && rows.length === 0 it shows an EmptyState (scoped vs global
// message); otherwise a DataTable with changed_at/actor/flag_key/operation/
// old_value/new_value/reason columns. Native renders that EmptyState + a card
// list (DataTable pagination omitted), preserving every column and the
// loading/empty contract. The page mounts this with scopedKey omitted (the
// global feed); the scoped branch is preserved for fidelity.
function ChangesPanelView({rows, loading, scopedKey, t}: ChangesPanelViewProps) {
  if (!loading && rows.length === 0) {
    return (
      <View testID="flags-changes-empty">
        <EmptyState
          message={
            scopedKey
              ? t(
                  'admin.flags.audit.empty.scopedMessage',
                  'No audit rows for "{{key}}" \u2014 edit the value above to start the trail.',
                  {key: scopedKey},
                )
              : t(
                  'admin.flags.audit.empty.globalMessage',
                  'Flag changes will appear here once an operator edits a value.',
                )
          }
          title={t('admin.flags.audit.empty.title', 'No flag changes yet')}
        />
      </View>
    );
  }

  if (rows.length === 0) {
    return (
      <View style={styles.tableEmpty} testID="flags-changes-loading">
        <AppText tone="muted">
          {t('admin.flags.audit.loading', 'Loading audit log\u2026')}
        </AppText>
      </View>
    );
  }

  return (
    <View style={styles.table} testID="flag-changes-table">
      {rows.map(row => (
        <GlassPanel
          key={String(row.id)}
          style={styles.changeRow}
          testID={`flag-change-row-${row.id}`}>
          <View style={styles.changeTop}>
            <AppText style={styles.changeWhen} tone="secondary" variant="caption">
              {formatAbsolute(row.changed_at)}
            </AppText>
            <OperationBadge operation={row.operation} />
          </View>

          <View style={styles.changeKvRow}>
            <AppText style={styles.cellCaption} tone="muted" variant="caption">
              {t('admin.flags.audit.cols.flagKey', 'Key')}
            </AppText>
            <AppText numberOfLines={1} style={styles.changeMono}>
              {row.flag_key}
            </AppText>
          </View>

          <View style={styles.changeKvRow}>
            <AppText style={styles.cellCaption} tone="muted" variant="caption">
              {t('admin.flags.audit.cols.actor', 'Actor')}
            </AppText>
            <AppText numberOfLines={1} style={styles.changeMono} tone="muted">
              {row.actor || FALLBACK}
            </AppText>
          </View>

          <View style={styles.changeValues}>
            <View style={styles.changeValueCol}>
              <AppText style={styles.cellCaption} tone="muted" variant="caption">
                {t('admin.flags.audit.cols.oldValue', 'Old')}
              </AppText>
              <AppText numberOfLines={1} style={styles.changeMono} tone="muted">
                {compact(row.old_value)}
              </AppText>
            </View>
            <View style={styles.changeValueCol}>
              <AppText style={styles.cellCaption} tone="muted" variant="caption">
                {t('admin.flags.audit.cols.newValue', 'New')}
              </AppText>
              <AppText numberOfLines={1} style={styles.changeMono} tone="muted">
                {compact(row.new_value)}
              </AppText>
            </View>
          </View>

          <View style={styles.changeKvRow}>
            <AppText style={styles.cellCaption} tone="muted" variant="caption">
              {t('admin.flags.audit.cols.reason', 'Reason')}
            </AppText>
            <AppText style={styles.changeReason} tone="muted" variant="caption">
              {row.reason || FALLBACK}
            </AppText>
          </View>
        </GlassPanel>
      ))}
    </View>
  );
}

/* ─── FlagEditDrawerView (web FlagEditDrawer / Drawer) ────────────────── */

interface FlagEditDrawerViewProps {
  open: boolean;
  initial: FeatureFlagEntry | null;
  saving: boolean;
  onClose: () => void;
  onSave: (input: {
    key: string;
    value: FeatureFlagValue;
    reason: string;
  }) => void;
  t: TFunc;
}

// web FlagEditDrawer is a single Drawer that powers BOTH edit (initial != null,
// key field read-only) AND create (initial == null). Value editing is a
// free-form JSON textarea: invalid JSON disables Save and surfaces a parse
// error; an empty reason is rejected by the backend audit row. Native renders
// the Drawer as a slide-in RN Modal panel (title bar + scroll body + footer),
// preserving keyInput/valueInput/reason state, the re-seed-on-open effect, the
// parsed {ok,value,error} memo, keyValid/reasonValid/canSave gating, and the
// editing immutable-key hint.
function FlagEditDrawerView({
  open,
  initial,
  saving,
  onClose,
  onSave,
  t,
}: FlagEditDrawerViewProps) {
  const editing = initial !== null;

  const [keyInput, setKeyInput] = useState<string>(initial?.key ?? '');
  const [valueInput, setValueInput] = useState<string>(defaultValueJson(initial));
  const [reason, setReason] = useState<string>('');

  // Re-seed the form whenever the drawer opens with a different flag, so the
  // previous flag's value doesn't linger and clobber an unrelated row.
  useEffect(() => {
    if (open) {
      setKeyInput(initial?.key ?? '');
      setValueInput(defaultValueJson(initial));
      setReason('');
    }
  }, [open, initial]);

  const parsed = useMemo<{
    ok: boolean;
    value?: FeatureFlagValue;
    error?: string;
  }>(() => {
    if (valueInput.trim() === '') {
      return {
        ok: false,
        error: t('admin.flags.editor.valueEmpty', 'Value is required.'),
      };
    }
    try {
      return {ok: true, value: JSON.parse(valueInput) as FeatureFlagValue};
    } catch (e) {
      return {
        ok: false,
        error: t('admin.flags.editor.valueInvalid', 'Invalid JSON: {{msg}}', {
          msg: e instanceof Error ? e.message : String(e),
        }),
      };
    }
  }, [valueInput, t]);

  const keyValid = keyInput.trim().length > 0;
  const reasonValid = reason.trim().length > 0;
  const canSave = parsed.ok && keyValid && reasonValid && !saving;

  const handleSave = () => {
    if (!canSave || !parsed.ok) {
      return;
    }
    onSave({
      key: keyInput.trim(),
      value: parsed.value as FeatureFlagValue,
      reason: reason.trim(),
    });
  };

  const title = editing
    ? t('admin.flags.drawer.editTitle', 'Edit flag "{{key}}"', {
        key: initial?.key ?? '',
      })
    : t('admin.flags.drawer.createTitle', 'Create flag');

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      transparent
      visible={open}>
      <View style={styles.drawerOverlay}>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={onClose}
          style={styles.backdrop}
        />
        <View style={styles.drawerPanel} testID="flag-edit-drawer">
          <View style={styles.drawerHeader}>
            <AppText
              numberOfLines={1}
              style={styles.drawerTitle}
              weight="semibold">
              {title}
            </AppText>
            <Pressable
              accessibilityLabel={t('common.cancel', 'Cancel')}
              accessibilityRole="button"
              hitSlop={8}
              onPress={onClose}
              style={({pressed}) => [
                styles.drawerClose,
                pressed && styles.buttonPressed,
              ]}
              testID="flag-drawer-close">
              <AppText style={styles.drawerCloseGlyph}>{CLOSE_GLYPH}</AppText>
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.drawerBody}
            style={styles.drawerScroll}>
            <GlassPanel style={styles.drawerSection}>
              <FieldLabel>
                {t('admin.flags.editor.keyLabel', 'Flag key')}
              </FieldLabel>
              <TextInput
                accessibilityLabel={t('admin.flags.editor.keyLabel', 'Flag key')}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!editing}
                onChangeText={setKeyInput}
                placeholder={t(
                  'admin.flags.editor.keyPlaceholder',
                  'feature.dlq.replay_enabled',
                )}
                placeholderTextColor={colors.textMuted}
                style={[styles.input, editing && styles.inputDisabled]}
                testID="flag-key-input"
                value={keyInput}
              />
              {editing ? (
                <AppText style={styles.hint} tone="muted" variant="caption">
                  {t(
                    'admin.flags.editor.keyImmutable',
                    'Flag keys are immutable once created. Delete + re-create to rename.',
                  )}
                </AppText>
              ) : null}
            </GlassPanel>

            <GlassPanel style={styles.drawerSection}>
              <FieldLabel>
                {t('admin.flags.editor.valueLabel', 'Value (JSON)')}
              </FieldLabel>
              <TextInput
                accessibilityLabel={t(
                  'admin.flags.editor.valueLabel',
                  'Value (JSON)',
                )}
                autoCapitalize="none"
                autoCorrect={false}
                multiline
                onChangeText={setValueInput}
                placeholder={'{\n  "enabled": true\n}'}
                placeholderTextColor={colors.textMuted}
                style={[styles.input, styles.textarea]}
                testID="flag-value-input"
                value={valueInput}
              />
              {parsed.ok ? null : (
                <AppText
                  style={styles.errorText}
                  testID="flag-value-error"
                  variant="caption">
                  {parsed.error}
                </AppText>
              )}
            </GlassPanel>

            <GlassPanel style={styles.drawerSection}>
              <FieldLabel>
                {t('admin.flags.editor.reasonLabel', 'Reason')}
              </FieldLabel>
              <TextInput
                accessibilityLabel={t('admin.flags.editor.reasonLabel', 'Reason')}
                onChangeText={setReason}
                placeholder={t(
                  'admin.flags.editor.reasonPlaceholder',
                  'Why this change? (logged in audit)',
                )}
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                testID="flag-reason-input"
                value={reason}
              />
            </GlassPanel>
          </ScrollView>

          <View style={styles.drawerFooter}>
            <TextButton
              disabled={saving}
              label={t('common.cancel', 'Cancel')}
              onPress={onClose}
              testID="flag-cancel-button"
              variant="secondary"
            />
            <TextButton
              disabled={!canSave}
              label={t('admin.flags.drawer.save', 'Save flag')}
              loading={saving}
              onPress={handleSave}
              testID="flag-save-button"
              variant="primary"
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

/* ─── DeleteFlagModal (web Modal size="sm") ───────────────────────────── */

interface DeleteFlagModalProps {
  pendingDelete: FeatureFlagEntry | null;
  reason: string;
  onReasonChange: (next: string) => void;
  saving: boolean;
  onClose: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  t: TFunc;
}

function DeleteFlagModal({
  pendingDelete,
  reason,
  onReasonChange,
  saving,
  onClose,
  onCancel,
  onConfirm,
  t,
}: DeleteFlagModalProps) {
  const open = pendingDelete !== null;
  const confirmDisabled = reason.trim().length === 0 || saving;
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
        <View style={styles.dialog} testID="flag-delete-modal">
          <AppText style={styles.dialogTitle} variant="title" weight="bold">
            {t('admin.flags.delete.title', 'Delete flag?')}
          </AppText>
          <View style={styles.modalSection}>
            <AppText tone="secondary">
              {t(
                'admin.flags.delete.message',
                'Permanently remove flag "{{key}}". This is logged as a delete operation in the audit feed.',
                {key: pendingDelete?.key ?? ''},
              )}
            </AppText>
            <View style={styles.field}>
              <FieldLabel>
                {t('admin.flags.delete.reasonLabel', 'Reason')}
              </FieldLabel>
              <TextInput
                accessibilityLabel={t('admin.flags.delete.reasonLabel', 'Reason')}
                onChangeText={onReasonChange}
                placeholder={t(
                  'admin.flags.delete.reasonPlaceholder',
                  'Why this delete? (logged in audit)',
                )}
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                testID="flag-delete-reason-input"
                value={reason}
              />
            </View>
            <View style={styles.modalActions}>
              <TextButton
                disabled={saving}
                label={t('common.cancel', 'Cancel')}
                onPress={onCancel}
                testID="flag-delete-cancel-button"
                variant="secondary"
              />
              <TextButton
                disabled={confirmDisabled}
                label={t('admin.flags.delete.confirm', 'Delete flag')}
                loading={saving}
                onPress={onConfirm}
                testID="flag-delete-confirm-button"
                variant="danger"
              />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/* ─── Page component ──────────────────────────────────────────────────── */

export default function FeatureFlagsPage() {
  const t = useT();
  // usePageTitle(t('admin.flags.pageTitle', 'Feature Flags')) drives the browser
  // document.title, which has no React Native analogue; the same translated
  // string is surfaced as the on-screen page header below instead.

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<FeatureFlagEntry | null>(null);
  const [pendingDelete, setPendingDelete] = useState<FeatureFlagEntry | null>(
    null,
  );
  const [deleteReason, setDeleteReason] = useState('');

  const flags = useFlags();
  const changes = useFlagChanges(null, 50);
  const setFlag = useSetFlag();
  const deleteFlag = useDeleteFlag();

  const handleEdit = useCallback((row: FeatureFlagEntry) => {
    setEditing(row);
    setEditorOpen(true);
  }, []);

  const handleCreate = useCallback(() => {
    setEditing(null);
    setEditorOpen(true);
  }, []);

  const handleSave = useCallback(
    async (input: {key: string; value: FeatureFlagValue; reason: string}) => {
      try {
        await setFlag.mutateAsync(input);
        setEditorOpen(false);
        setEditing(null);
      } catch {
        // Toast + sudo handling are already routed through the mutation.
        // Keep the drawer open so the operator can retry without re-typing.
      }
    },
    [setFlag],
  );

  const handleAskDelete = useCallback((row: FeatureFlagEntry) => {
    setPendingDelete(row);
    setDeleteReason('');
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!pendingDelete || deleteReason.trim().length === 0) {
      return;
    }
    try {
      await deleteFlag.mutateAsync({
        key: pendingDelete.key,
        reason: deleteReason.trim(),
      });
      setPendingDelete(null);
      setDeleteReason('');
    } catch {
      // Toast + sudo handling already routed. Leave dialog open on retry.
    }
  }, [pendingDelete, deleteReason, deleteFlag]);

  const flagRows = flags.data?.flags ?? [];
  const changeRows = changes.data?.rows ?? [];
  const freshnessTs =
    typeof flags.dataUpdatedAt === 'number' && flags.dataUpdatedAt > 0
      ? new Date(flags.dataUpdatedAt).toISOString()
      : null;

  return (
    <View style={styles.page} testID="feature-flags-page">
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        style={styles.scroll}>
        {/* Header — PageContainer title / subtitle / actions + query freshness.
            The web page passes no `loading` prop, so children always render and
            each panel owns its own loading/empty state, exactly as here. */}
        <View style={styles.header}>
          <View style={styles.headerText}>
            <AppText accessibilityRole="header" style={styles.pageTitle}>
              {t('admin.flags.pageTitle', 'Feature Flags')}
            </AppText>
            <AppText style={styles.pageSubtitle} tone="muted">
              {t(
                'admin.flags.subtitle',
                'Typed feature-flag registry \u2014 all changes are sudo-gated and logged.',
              )}
            </AppText>
          </View>
          <View style={styles.headerActions}>
            {freshnessTs ? (
              <FreshnessIndicator
                testID="feature-flags-freshness"
                timestamp={freshnessTs}
              />
            ) : null}
            <TextButton
              glyph={PLUS_GLYPH}
              label={t('admin.flags.actions.add', 'Add flag')}
              onPress={handleCreate}
              testID="feature-flags-add-button"
              variant="primary"
            />
          </View>
        </View>

        <SectionBoundary
          name="flags-table"
          subtitle={t(
            'errors.section.subtitle',
            'Other parts of the page should still work.',
          )}
          title={t('errors.section.title', 'This section failed to load.')}>
          <GlassPanel style={styles.panel} testID="flags-registry-panel">
            <PanelHeader
              name="flag"
              title={t('admin.flags.panels.registry', 'Registry')}
            />
            <FlagsTableView
              loading={flags.isLoading}
              onAskDelete={handleAskDelete}
              onEdit={handleEdit}
              rows={flagRows}
              t={t}
            />
          </GlassPanel>
        </SectionBoundary>

        <SectionBoundary
          name="flags-changes"
          subtitle={t(
            'errors.section.subtitle',
            'Other parts of the page should still work.',
          )}
          title={t('errors.section.title', 'This section failed to load.')}>
          <GlassPanel style={styles.panel} testID="flags-changes-panel">
            <PanelHeader
              name="history"
              title={t('admin.flags.panels.changes', 'Recent changes')}
            />
            <ChangesPanelView
              loading={changes.isLoading}
              rows={changeRows}
              t={t}
            />
          </GlassPanel>
        </SectionBoundary>
      </ScrollView>

      <FlagEditDrawerView
        initial={editing}
        onClose={() => {
          setEditorOpen(false);
          setEditing(null);
        }}
        onSave={handleSave}
        open={editorOpen}
        saving={setFlag.isPending}
        t={t}
      />

      <DeleteFlagModal
        onCancel={() => {
          setPendingDelete(null);
          setDeleteReason('');
        }}
        onClose={() => {
          if (deleteFlag.isPending) {
            return;
          }
          setPendingDelete(null);
          setDeleteReason('');
        }}
        onConfirm={handleConfirmDelete}
        onReasonChange={setDeleteReason}
        pendingDelete={pendingDelete}
        reason={deleteReason}
        saving={deleteFlag.isPending}
        t={t}
      />
    </View>
  );
}

FeatureFlagsPage.displayName = 'FeatureFlagsPage';

/* ─── Styles ──────────────────────────────────────────────────────────── */

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
    rowGap: spacing.lg,
  },
  header: {
    alignItems: 'flex-start',
    columnGap: spacing.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: spacing.md,
  },
  headerText: {
    flex: 1,
    minWidth: 200,
    rowGap: spacing.xs,
  },
  headerActions: {
    alignItems: 'center',
    columnGap: spacing.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.sm,
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
  panel: {
    padding: spacing.lg,
    rowGap: spacing.md,
  },
  panelHeader: {
    alignItems: 'center',
    columnGap: spacing.sm,
    flexDirection: 'row',
  },
  panelTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 22,
  },
  sectionError: {
    alignItems: 'center',
    columnGap: spacing.sm,
    flexDirection: 'row',
  },
  sectionErrorText: {
    flex: 1,
    rowGap: spacing.xs,
  },

  /* table (flags) */
  table: {
    rowGap: spacing.sm,
  },
  tableEmpty: {
    paddingVertical: spacing.md,
  },
  sortHeader: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
  },
  flagRow: {
    alignItems: 'center',
    columnGap: spacing.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    padding: spacing.md,
    rowGap: spacing.sm,
  },
  flagRowText: {
    flex: 1,
    minWidth: 180,
    rowGap: spacing.xs,
  },
  flagKey: {
    color: colors.textPrimary,
    fontFamily: MONO_FONT,
    fontSize: 14,
  },
  flagValueRow: {
    rowGap: 2,
  },
  flagValue: {
    fontFamily: MONO_FONT,
    fontSize: 12,
  },
  cellCaption: {
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  rowActions: {
    columnGap: spacing.sm,
    flexDirection: 'row',
  },

  /* table (changes) */
  changeRow: {
    padding: spacing.md,
    rowGap: spacing.sm,
  },
  changeTop: {
    alignItems: 'center',
    columnGap: spacing.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  changeWhen: {
    flexShrink: 1,
  },
  changeKvRow: {
    rowGap: 2,
  },
  changeMono: {
    fontFamily: MONO_FONT,
    fontSize: 12,
  },
  changeValues: {
    columnGap: spacing.md,
    flexDirection: 'row',
  },
  changeValueCol: {
    flex: 1,
    rowGap: 2,
  },
  changeReason: {
    lineHeight: 16,
  },

  /* operation badge */
  opBadge: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  opBadgeSuccess: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  opBadgeDanger: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  opBadgeNeutral: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
  opBadgeText: {
    fontSize: 11,
    textTransform: 'uppercase',
  },
  opBadgeTextSuccess: {
    color: colors.success,
  },
  opBadgeTextDanger: {
    color: colors.danger,
  },

  /* buttons */
  button: {
    alignItems: 'center',
    borderRadius: 12,
    columnGap: spacing.xs,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  buttonMd: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  buttonSm: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
  },
  buttonPrimary: {
    backgroundColor: colors.accent,
  },
  buttonSecondary: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderWidth: 1,
  },
  buttonDanger: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderWidth: 1,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonPressed: {
    opacity: 0.7,
  },
  buttonLabel: {
    fontSize: 14,
  },
  buttonLabelSm: {
    fontSize: 12,
  },
  buttonGlyph: {
    fontSize: 14,
    fontWeight: '700',
  },
  buttonGlyphSm: {
    fontSize: 12,
  },
  buttonPrimaryText: {
    color: colors.background,
  },
  buttonSecondaryText: {
    color: colors.textPrimary,
  },
  buttonDangerText: {
    color: colors.danger,
  },

  /* fields */
  fieldLabel: {
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  field: {
    rowGap: spacing.xs,
  },
  input: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 14,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  inputDisabled: {
    opacity: 0.6,
  },
  textarea: {
    fontFamily: MONO_FONT,
    minHeight: 160,
    textAlignVertical: 'top',
  },
  hint: {
    marginTop: spacing.xs,
  },
  errorText: {
    color: colors.danger,
    marginTop: spacing.xs,
  },

  /* drawer */
  drawerOverlay: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  drawerPanel: {
    backgroundColor: colors.surface,
    borderLeftColor: colors.border,
    borderLeftWidth: 1,
    flex: 1,
    maxWidth: 520,
    width: '100%',
  },
  drawerHeader: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    columnGap: spacing.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  drawerTitle: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 17,
    lineHeight: 24,
  },
  drawerClose: {
    alignItems: 'center',
    borderRadius: 10,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  drawerCloseGlyph: {
    color: colors.textMuted,
    fontSize: 16,
    fontWeight: '700',
  },
  drawerScroll: {
    flex: 1,
  },
  drawerBody: {
    padding: spacing.lg,
    rowGap: spacing.md,
  },
  drawerSection: {
    padding: spacing.md,
    rowGap: spacing.xs,
  },
  drawerFooter: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    columnGap: spacing.sm,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },

  /* modal (delete) */
  overlay: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(2, 4, 9, 0.72)',
  },
  dialog: {
    ...shadows.panel,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 20,
    borderWidth: 1,
    maxWidth: 420,
    padding: spacing.lg,
    rowGap: spacing.md,
    width: '100%',
  },
  dialogTitle: {
    color: colors.textPrimary,
  },
  modalSection: {
    rowGap: spacing.md,
  },
  modalActions: {
    columnGap: spacing.sm,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
});
