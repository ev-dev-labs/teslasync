// AlertRulesPage — native parity port of
// web/src/features/notifications/pages/AlertRulesPage.tsx.
//
// Focused list view of every alert rule with bulk enable / disable / delete
// (web doc comment L26-33). The full CRUD studio lives at /alert-studio; this
// page is the streamlined "manage many at once" surface — rule names link to
// the studio for editing and can be renamed inline. Every state name
// (leaseKey, rules, visibleIds, sel, bulkEnable, bulkDisable, deleteOne,
// saveRule, masterState, onMasterToggle, onBulkDelete, checked), the API
// mutation wiring (/alerts/rules + bulk enable/disable + per-id DELETE via the
// native useNotifications hooks), every i18n key + English fallback, the
// per-id bulk-delete fallback, and the master-checkbox indeterminate logic are
// preserved verbatim from the web source.
//
// Native adaptations vs. the web source (behaviour / state / keys / API kept):
//   - react-i18next useTranslation (web L2) -> a native-safe t(key, fallback,
//     options?) preserving every alertRules.* / bulk.* / common.* /
//     editableText.* / editConflict.* key and {{name}}/{{resource}}
//     interpolation (no i18n runtime in this RN layer).
//   - react-router-dom Link (web L3) -> a native-safe <Link> Pressable that
//     preserves the `to` target (/alert-studio?rule={id}, /notifications/studio)
//     and routes through an optional onNavigate navigation-shell callback (RN
//     has no react-router DOM history).
//   - @/components/ui GlassPanel/Badge/EditableText (web L5) -> the canonical
//     native GlassPanel + an inline native Badge (success/neutral) + an inline
//     native EditableText (TextInput inline-edit: submit/blur-to-save,
//     cancel affordance for Escape, live validation, saving spinner, error
//     text, no-op + duplicate-submit guards) reproducing the web commit path.
//   - @/components/data-display BulkActionToolbar/SeverityBadge (web L6) ->
//     the shared native BulkActionsToolbar port + an inline native SeverityBadge
//     (normalizeSeverity + the web severity tokens mapped to native colors;
//     lucide icons become glyph chips).
//   - @/components/layout PageContainer (web L7) -> an inline RN PageContainer
//     (ScrollView header: title/subtitle, then children).
//   - @/components/motion FadeIn (web L8, framer-motion) -> an inline
//     reduced-motion-aware Animated FadeIn.
//   - @/components/feedback EmptyState/Skeleton/ErrorDisplay/EditConflictBanner
//     (web L9) -> an inline native EmptyState (with the actionTo CTA), an inline
//     native Skeleton, the shared native ErrorDisplay port, and an inline native
//     EditConflictBanner.
//   - @/components/a11y VisuallyHidden (web L10) -> the shared native
//     VisuallyHidden port (maps web label/span tags to native Text/View).
//   - @/hooks usePageTitle (web L12) -> a native-safe no-op (RN has no
//     document.title); the call site + argument are preserved.
//   - @/hooks useBulkSelection (web L13) -> the pure selection-state primitive
//     ported inline verbatim (Set<T>, toggle/toggleAll/masterState/clear).
//   - @/hooks useEditLease (web L14) -> a native-safe no-op. The web lease
//     coordinates edits across browser tabs via BroadcastChannel, which does
//     not exist in React Native, so the hook always reports
//     {isOwner:false, otherTab:null} and the EditConflictBanner stays inert
//     (rule 7). The leaseKey 'alert-rules/list' + the call site are preserved.
//   - @/lib/icons Icons (web L24) -> SemanticIcon glyphs (play/pause/delete/
//     edit/add); lucide is browser-only.
//   - The web HTML <table>/<thead>/<tbody>/<input type=checkbox> (web L155-252)
//     -> a native View-based table (column-label header row + per-rule rows)
//     with an accessible native <Checkbox> (accessibilityRole="checkbox",
//     mixed state for the indeterminate master). Every column (name/signal/
//     severity/status) and the select-all + per-row select affordances are kept.
//
// No DOM / react-router / react-i18next / lucide / Recharts / framer-motion /
// old-web-UI import reaches this native output — only react, react-native
// primitives, the canonical AppText/GlassPanel/SemanticIcon + theme tokens, the
// shared native BulkActionsToolbar/VisuallyHidden/ErrorDisplay ports, and the
// native notifications hooks + AlertRule type.

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
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {SemanticIcon} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {VisuallyHidden} from '../../../components/a11y/VisuallyHidden';
import {
  BulkActionsToolbar,
  type BulkAction,
} from '../../../components/data-display/BulkActionsToolbar';
import {ErrorDisplay} from '../../../components/feedback/ErrorDisplay';
import {
  useAlertRules,
  useBulkDisableRules,
  useBulkEnableRules,
  useDeleteAlertRule,
  useSaveAlertRule,
} from '../../../api/hooks/useNotifications';
import type {AlertRule} from '../../../api/types';

// ─── Native-safe i18n fallback (web react-i18next useTranslation) ─────────────

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

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback(
    (_key, fallback, options) =>
      options ? interpolate(fallback, options) : fallback,
    [],
  );
}

// ─── Native-safe usePageTitle (web @/hooks/usePageTitle) ──────────────────────

/**
 * Web `usePageTitle` writes `"{title} — TeslaSync"` to `document.title`. React
 * Native has no browser tab / document title, so this is a no-op that preserves
 * the call site and argument.
 */
function usePageTitle(title: string): void {
  useEffect(() => {
    // No document.title in React Native; intentional no-op.
  }, [title]);
}

// ─── Native-safe navigate (web react-router-dom Link `to`) ────────────────────

/**
 * Web routes rule names and the studio CTA through react-router `<Link to>`.
 * React Native has no react-router DOM history, so navigation is funnelled to
 * an optional navigation-shell callback; the `to` targets are preserved on the
 * Link/EmptyState so a future wire-up maps them to native routes.
 */
function useNativeNavigateFallback(): (path: string) => void {
  return useCallback((_path: string) => {
    // Intentional native-safe no-op — see doc comment above.
  }, []);
}

// ─── Native-safe useEditLease (web @/hooks/useEditLease) ──────────────────────

/**
 * Browser-only capabilities the lease cannot reproduce on native, surfaced for
 * parity tooling. The web lease coordinates "I am editing X" across browser
 * tabs via BroadcastChannel; React Native has no BroadcastChannel and no notion
 * of sibling tabs, so the native lease is inert.
 */
export const nativeEditLeaseCapabilities = {
  broadcastChannelAvailable: false,
  crossTabConflictDetectionAvailable: false,
  beforeUnloadReleaseAvailable: false,
} as const;

interface NativeOtherTabInfo {
  tabId: string;
  claimedAt: number;
}

interface NativeEditLeaseResult {
  isOwner: boolean;
  otherTab: NativeOtherTabInfo | null;
  claim: () => void;
}

function useEditLease(resourceKey: string): NativeEditLeaseResult {
  useEffect(() => {
    // No BroadcastChannel on native — the web election/handshake is a no-op.
    // The resourceKey dependency mirrors the web hook so the effect re-runs on
    // key changes.
  }, [resourceKey]);

  return {isOwner: false, otherTab: null, claim: noop};
}

function noop(): void {}

// ─── useBulkSelection (web @/hooks/useBulkSelection) — pure logic, ported ──────

interface BulkSelection<T> {
  selectedIds: Set<T>;
  count: number;
  isSelected: (id: T) => boolean;
  toggle: (id: T) => void;
  setSelected: (id: T, selected: boolean) => void;
  selectAll: (ids: T[]) => void;
  clear: () => void;
  masterState: (visibleIds: T[]) => 'none' | 'some' | 'all';
  toggleAll: (visibleIds: T[]) => void;
}

function useBulkSelection<T = number>(): BulkSelection<T> {
  const [selectedIds, setIds] = useState<Set<T>>(() => new Set<T>());

  const isSelected = useCallback((id: T) => selectedIds.has(id), [selectedIds]);

  const toggle = useCallback((id: T) => {
    setIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const setSelected = useCallback((id: T, sel: boolean) => {
    setIds(prev => {
      const has = prev.has(id);
      if (has === sel) {
        return prev;
      }
      const next = new Set(prev);
      if (sel) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback((ids: T[]) => {
    if (ids.length === 0) {
      return;
    }
    setIds(prev => {
      const next = new Set(prev);
      let changed = false;
      for (const id of ids) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  const clear = useCallback(() => {
    setIds(prev => (prev.size === 0 ? prev : new Set<T>()));
  }, []);

  const masterState = useCallback(
    (visible: T[]): 'none' | 'some' | 'all' => {
      if (visible.length === 0) {
        return 'none';
      }
      let hits = 0;
      for (const id of visible) {
        if (selectedIds.has(id)) {
          hits++;
        }
      }
      if (hits === 0) {
        return 'none';
      }
      if (hits === visible.length) {
        return 'all';
      }
      return 'some';
    },
    [selectedIds],
  );

  const toggleAll = useCallback((visible: T[]) => {
    if (visible.length === 0) {
      return;
    }
    setIds(prev => {
      const allSelected = visible.every(id => prev.has(id));
      const next = new Set(prev);
      if (allSelected) {
        for (const id of visible) {
          next.delete(id);
        }
      } else {
        for (const id of visible) {
          next.add(id);
        }
      }
      return next;
    });
  }, []);

  return useMemo<BulkSelection<T>>(
    () => ({
      selectedIds,
      count: selectedIds.size,
      isSelected,
      toggle,
      setSelected,
      selectAll,
      clear,
      masterState,
      toggleAll,
    }),
    [
      selectedIds,
      isSelected,
      toggle,
      setSelected,
      selectAll,
      clear,
      masterState,
      toggleAll,
    ],
  );
}

// ─── Native Link (web react-router-dom Link) ──────────────────────────────────

interface LinkProps {
  to: string;
  onNavigate?: (path: string) => void;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
  testID?: string;
}

function Link({
  to,
  onNavigate,
  children,
  style,
  textStyle,
  accessibilityLabel,
  testID,
}: LinkProps): React.ReactElement {
  const handlePress = useCallback(() => {
    onNavigate?.(to);
  }, [onNavigate, to]);

  return (
    <Pressable
      accessibilityHint={to}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="link"
      onPress={handlePress}
      style={({pressed}) => [style, pressed && styles.pressed]}
      testID={testID}>
      {typeof children === 'string' ? (
        <AppText style={[styles.linkText, textStyle]}>{children}</AppText>
      ) : (
        children
      )}
    </Pressable>
  );
}

// ─── Inline FadeIn (web @/components/motion FadeIn — framer-motion) ────────────

function FadeIn({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then(reduce => {
        if (cancelled) {
          return;
        }
        if (reduce) {
          progress.setValue(1);
          return;
        }
        Animated.timing(progress, {
          duration: 320,
          easing: Easing.out(Easing.ease),
          toValue: 1,
          useNativeDriver: true,
        }).start();
      })
      .catch(() => progress.setValue(1));
    return () => {
      cancelled = true;
    };
  }, [progress]);

  return (
    <Animated.View
      style={[
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [10, 0],
              }),
            },
          ],
        },
        style,
      ]}>
      {children}
    </Animated.View>
  );
}

// ─── Inline Badge (web @/components/ui Badge) ─────────────────────────────────

type BadgeVariant = 'neutral' | 'success';

function Badge({
  children,
  variant = 'neutral',
}: {
  children: ReactNode;
  variant?: BadgeVariant;
}): React.ReactElement {
  return (
    <View style={[styles.badge, badgeVariantStyles[variant]]}>
      <AppText
        style={badgeTextStyles[variant]}
        variant="caption"
        weight="semibold">
        {children}
      </AppText>
    </View>
  );
}

// ─── Inline SeverityBadge (web @/components/data-display SeverityBadge) ────────

type Severity = 'info' | 'warn' | 'critical' | 'success';

/** Web `normalizeSeverity` (lib/tokens) — ported verbatim. */
function normalizeSeverity(s: string | null | undefined): Severity {
  if (!s) {
    return 'info';
  }
  const v = s.toLowerCase();
  if (v === 'warning') {
    return 'warn';
  }
  if (v === 'error' || v === 'fatal') {
    return 'critical';
  }
  if (v === 'ok' || v === 'success') {
    return 'success';
  }
  if (v === 'info' || v === 'warn' || v === 'critical') {
    return v as Severity;
  }
  return 'info';
}

interface SeverityVisual {
  glyph: string;
  surface: ViewStyle;
  text: TextStyle;
}

// Web severityTokens (sky/amber/red/emerald) mapped to native theme colors.
const severityVisuals: Record<Severity, SeverityVisual> = {
  info: {
    glyph: 'i',
    surface: {
      backgroundColor: colors.accentSoft,
      borderColor: colors.borderAccent,
    },
    text: {color: colors.accent},
  },
  warn: {
    glyph: '!',
    surface: {
      backgroundColor: colors.warningSurface,
      borderColor: colors.warningBorder,
    },
    text: {color: colors.warning},
  },
  critical: {
    glyph: '!!',
    surface: {
      backgroundColor: colors.dangerSurface,
      borderColor: colors.dangerBorder,
    },
    text: {color: colors.danger},
  },
  success: {
    glyph: 'OK',
    surface: {
      backgroundColor: colors.successSurface,
      borderColor: colors.successBorder,
    },
    text: {color: colors.success},
  },
};

function SeverityBadge({
  severity,
}: {
  severity: string | null | undefined;
}): React.ReactElement {
  const sev = normalizeSeverity(severity);
  const visual = severityVisuals[sev];
  return (
    <View style={[styles.severityBadge, visual.surface]}>
      <AppText style={visual.text} variant="caption" weight="bold">
        {visual.glyph}
      </AppText>
      <AppText style={visual.text} variant="caption" weight="semibold">
        {sev}
      </AppText>
    </View>
  );
}

// ─── Inline Checkbox (web <input type="checkbox">) ────────────────────────────

function Checkbox({
  checked,
  indeterminate = false,
  onPress,
  accessibilityLabel,
  testID,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onPress: () => void;
  accessibilityLabel: string;
  testID?: string;
}): React.ReactElement {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="checkbox"
      accessibilityState={{checked: indeterminate ? 'mixed' : checked}}
      hitSlop={8}
      onPress={onPress}
      style={({pressed}) => [
        styles.checkbox,
        (checked || indeterminate) && styles.checkboxOn,
        pressed && styles.pressed,
      ]}
      testID={testID}>
      {indeterminate ? (
        <AppText style={styles.checkboxGlyph} variant="caption" weight="bold">
          –
        </AppText>
      ) : checked ? (
        <AppText style={styles.checkboxGlyph} variant="caption" weight="bold">
          ✓
        </AppText>
      ) : null}
    </Pressable>
  );
}

// ─── Inline EditableText (web @/components/ui EditableText) ────────────────────

interface EditableTextDisplayProps {
  value: string;
  onStartEdit: () => void;
  disabled: boolean;
}

interface EditableTextProps {
  value: string;
  onSave: (next: string) => Promise<void>;
  validate?: (next: string) => string | null | undefined;
  placeholder?: string;
  maxLength?: number;
  ariaLabel: string;
  disabled?: boolean;
  display?: (props: EditableTextDisplayProps) => ReactNode;
}

/** Trim is the canonical normaliser — same value sent to the server. */
function normalise(s: string): string {
  return s.trim();
}

function EditableText({
  value,
  onSave,
  validate,
  placeholder,
  maxLength,
  ariaLabel,
  disabled = false,
  display,
}: EditableTextProps): React.ReactElement {
  const t = useNativeTranslationFallback();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const savingRef = useRef(false);
  const lastSubmittedRef = useRef<string | null>(null);

  // Re-sync draft if the canonical value changes from outside while we're NOT
  // editing (e.g. a TanStack Query invalidation lands). When editing we leave
  // the user's draft alone.
  useEffect(() => {
    if (!editing) {
      setDraft(value);
    }
  }, [value, editing]);

  const startEdit = useCallback(() => {
    if (disabled) {
      return;
    }
    setDraft(value);
    setError(null);
    lastSubmittedRef.current = null;
    setEditing(true);
  }, [disabled, value]);

  const cancelEdit = useCallback(() => {
    if (savingRef.current) {
      return;
    }
    setDraft(value);
    setError(null);
    setEditing(false);
  }, [value]);

  const commitDraft = useCallback(async (): Promise<boolean> => {
    if (savingRef.current) {
      return false;
    }

    const next = normalise(draft);
    const current = normalise(value);

    // No-op: leave edit mode without touching the server.
    if (next === current) {
      setError(null);
      setEditing(false);
      return true;
    }

    let validationError: string | null = null;
    if (next === '') {
      validationError = t('editableText.error.empty', 'Value cannot be empty');
    } else if (validate) {
      const v = validate(next);
      if (v) {
        validationError = v;
      }
    }

    if (validationError) {
      setError(validationError);
      return false;
    }

    // Skip identical re-submit (e.g. submit-then-blur fires twice).
    if (lastSubmittedRef.current === next) {
      setError(null);
      setEditing(false);
      return true;
    }

    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await onSave(next);
      lastSubmittedRef.current = next;
      setEditing(false);
      AccessibilityInfo.announceForAccessibility(
        t('editableText.announce.saved', '{{label}} saved', {label: ariaLabel}),
      );
      return true;
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : t('editableText.error.saveFailed', 'Save failed');
      setError(message);
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [ariaLabel, draft, onSave, t, validate, value]);

  const handleChangeText = useCallback(
    (next: string) => {
      setDraft(next);
      // Live validation so the user sees the error before committing.
      if (validate) {
        const trimmed = normalise(next);
        if (trimmed === '') {
          setError(null);
        } else {
          const v = validate(trimmed);
          setError(v ?? null);
        }
      } else {
        setError(null);
      }
    },
    [validate],
  );

  const handleBlur = useCallback(() => {
    if (savingRef.current) {
      return;
    }
    // If the user blurs while invalid, stay in edit mode so the error remains
    // visible. Otherwise commit (web handleInputBlur).
    if (error) {
      return;
    }
    void commitDraft();
  }, [commitDraft, error]);

  // ─── Edit mode ──────────────────────────────────────────────────────────
  if (editing) {
    return (
      <View style={styles.editColumn}>
        <View style={styles.editRow}>
          <TextInput
            accessibilityLabel={ariaLabel}
            autoFocus
            editable={!saving}
            maxLength={maxLength}
            onBlur={handleBlur}
            onChangeText={handleChangeText}
            onSubmitEditing={() => {
              void commitDraft();
            }}
            placeholder={placeholder}
            placeholderTextColor={colors.textMuted}
            returnKeyType="done"
            style={[styles.editInput, error ? styles.editInputError : null]}
            testID="editable-text-input"
            value={draft}
          />
          {saving ? (
            <ActivityIndicator
              accessibilityLabel={t('editableText.saving', 'Saving…')}
              color={colors.textMuted}
              size="small"
              testID="editable-text-spinner"
            />
          ) : (
            <Pressable
              accessibilityLabel={t('common.cancel', 'Cancel')}
              accessibilityRole="button"
              hitSlop={8}
              onPress={cancelEdit}
              style={({pressed}) => [styles.iconButton, pressed && styles.pressed]}
              testID="editable-text-cancel">
              <SemanticIcon decorative name="close" size="sm" />
            </Pressable>
          )}
        </View>
        {error ? (
          <AppText style={styles.editError} tone="danger" variant="caption">
            {error}
          </AppText>
        ) : null}
      </View>
    );
  }

  // ─── Display mode ───────────────────────────────────────────────────────
  if (display) {
    return (
      <View style={styles.inlineRow}>
        {display({value, onStartEdit: startEdit, disabled})}
      </View>
    );
  }

  const visibleText = value === '' && placeholder ? placeholder : value;

  return (
    <Pressable
      accessibilityLabel={ariaLabel}
      accessibilityRole="button"
      disabled={disabled}
      onPress={startEdit}
      style={({pressed}) => [styles.inlineRow, pressed && styles.pressed]}
      testID="editable-text-trigger">
      <AppText numberOfLines={1}>{visibleText}</AppText>
      {!disabled ? (
        <SemanticIcon decorative name="pencil" size="sm" style={styles.editAffordance} />
      ) : null}
    </Pressable>
  );
}

// ─── Inline EditConflictBanner (web @/components/feedback EditConflictBanner) ──

function EditConflictBanner({
  resourceKey,
  resourceLabel,
}: {
  resourceKey: string;
  resourceLabel?: string;
}): React.ReactElement | null {
  const t = useNativeTranslationFallback();
  const {isOwner, otherTab, claim} = useEditLease(resourceKey);

  // No banner when this tab owns the lease OR no peer has announced ownership.
  // On native there are no sibling tabs, so otherTab is always null and this
  // returns null — matching the web "fresh load, no conflict" path.
  if (isOwner || otherTab === null) {
    return null;
  }

  const title = t(
    'editConflict.banner.title',
    'Another browser tab is editing this',
  );
  const body = resourceLabel
    ? t(
        'editConflict.banner.bodyWithLabel',
        '{{resource}} is open in another tab of this browser. Saving here will overwrite changes made there.',
        {resource: resourceLabel},
      )
    : t(
        'editConflict.banner.body',
        'This resource is open in another tab of this browser. Saving here will overwrite changes made there.',
      );

  return (
    <GlassPanel
      accessibilityRole="alert"
      style={styles.conflictBanner}
      testID="edit-conflict-banner">
      <View style={styles.conflictHeader}>
        <SemanticIcon decorative name="warning" size="sm" />
        <AppText style={styles.conflictTitle} weight="semibold">
          {title}
        </AppText>
      </View>
      <AppText tone="secondary" variant="caption">
        {body}
      </AppText>
      <View style={styles.conflictActions}>
        <Pressable
          accessibilityLabel={t('editConflict.banner.takeOver', 'Take over editing')}
          accessibilityRole="button"
          onPress={claim}
          style={({pressed}) => [styles.ghostButton, pressed && styles.pressed]}
          testID="edit-conflict-take-over">
          <AppText tone="accent" variant="caption" weight="semibold">
            {t('editConflict.banner.takeOver', 'Take over editing')}
          </AppText>
        </Pressable>
        <AppText tone="muted" variant="caption">
          {t(
            'editConflict.banner.switchHint',
            'Or switch to your other tab to keep editing there.',
          )}
        </AppText>
      </View>
    </GlassPanel>
  );
}

// ─── Inline Skeleton (web @/components/feedback Skeleton) ──────────────────────

function Skeleton(): React.ReactElement {
  return <View style={styles.skeleton} />;
}

// ─── Inline EmptyState (web @/components/feedback EmptyState) ──────────────────

function EmptyState({
  title,
  message,
  actionTo,
  onNavigate,
}: {
  title: string;
  message: string;
  actionTo?: {label: string; to: string};
  onNavigate?: (path: string) => void;
}): React.ReactElement {
  return (
    <View accessibilityRole="summary" style={styles.emptyState}>
      <AppText style={styles.emptyTitle} weight="semibold">
        {title}
      </AppText>
      <AppText style={styles.emptyMessage} tone="muted">
        {message}
      </AppText>
      {actionTo ? (
        <Link
          accessibilityLabel={actionTo.label}
          onNavigate={onNavigate}
          style={styles.secondaryButton}
          to={actionTo.to}>
          <AppText variant="caption" weight="semibold">
            {actionTo.label}
          </AppText>
        </Link>
      ) : null}
    </View>
  );
}

// ─── Inline PageContainer (web @/components/layout PageContainer) ──────────────

function PageContainer({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}): React.ReactElement {
  return (
    <ScrollView contentContainerStyle={styles.scrollContent} style={styles.scroll}>
      <View style={styles.pageHeader}>
        <AppText style={styles.pageTitle} variant="display" weight="bold">
          {title}
        </AppText>
        {subtitle ? (
          <AppText style={styles.pageSubtitle} tone="muted" variant="caption">
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {children}
    </ScrollView>
  );
}

// ─── Page (web L34-268) ───────────────────────────────────────────────────────

/**
 * AlertRulesPage — focused list view of every alert rule with bulk
 * enable/disable/delete.
 *
 * The full CRUD studio lives at /alert-studio (`AlertStudioPage`); this page is
 * the streamlined "manage many at once" surface for power users with dozens of
 * rules. Rule names link to the studio for editing.
 */
export default function AlertRulesPage(): React.ReactElement {
  const t = useNativeTranslationFallback();
  const navigate = useNativeNavigateFallback();
  usePageTitle(t('alertRules.title', 'Alert rules'));

  // Claim an edit lease so a second tab opening the same bulk-rules surface
  // sees a banner before its renames / bulk-enables silently race this tab. The
  // lease is scoped to the list view itself (not per-rule) because the rename /
  // bulk affordances on this page operate across the whole rule set.
  const leaseKey = 'alert-rules/list';
  useEditLease(leaseKey);

  const {data: rulesRaw, isLoading, error} = useAlertRules();
  const rules: AlertRule[] = useMemo(() => rulesRaw ?? [], [rulesRaw]);
  const visibleIds = useMemo(() => rules.map(r => r.id), [rules]);

  const sel = useBulkSelection<number>();
  const bulkEnable = useBulkEnableRules();
  const bulkDisable = useBulkDisableRules();
  const deleteOne = useDeleteAlertRule();
  const saveRule = useSaveAlertRule();

  const masterState = sel.masterState(visibleIds);

  const onMasterToggle = useCallback(() => {
    sel.toggleAll(visibleIds);
  }, [sel, visibleIds]);

  const onBulkDelete = useCallback(
    async (ids: Array<string | number>) => {
      // No bulk-delete-rules endpoint yet — fall back to per-id DELETE.
      // Confirmation already handled by the toolbar's `confirm` payload.
      const numericIds = ids.map(i => Number(i));
      await Promise.allSettled(
        numericIds.map(id => deleteOne.mutateAsync(id)),
      );
      sel.clear();
    },
    [deleteOne, sel],
  );

  const actions: BulkAction[] = [
    {
      id: 'enable',
      label: t('alertRules.bulk.enable', 'Enable'),
      icon: <SemanticIcon decorative name="play" size="sm" />,
      onClick: async ids => {
        await bulkEnable.mutateAsync(ids.map(i => Number(i)));
        sel.clear();
      },
    },
    {
      id: 'disable',
      label: t('alertRules.bulk.disable', 'Disable'),
      icon: <SemanticIcon decorative name="pause" size="sm" />,
      onClick: async ids => {
        await bulkDisable.mutateAsync(ids.map(i => Number(i)));
        sel.clear();
      },
    },
    {
      id: 'delete',
      label: t('alertRules.bulk.delete', 'Delete'),
      variant: 'danger',
      icon: <SemanticIcon decorative name="delete" size="sm" />,
      confirm: {
        title: t('alertRules.bulk.deleteConfirm.title', 'Delete alert rules?'),
        description: t(
          'alertRules.bulk.deleteConfirm.body',
          'These rules will stop firing immediately. This cannot be undone.',
        ),
        confirmLabel: t('common.delete', 'Delete'),
      },
      onClick: onBulkDelete,
    },
  ];

  return (
    <PageContainer
      subtitle={t(
        'alertRules.subtitle',
        'Bulk-manage alert rules. Click a rule to edit it in Alert Studio.',
      )}
      title={t('alertRules.title', 'Alert rules')}>
      <FadeIn>
        <EditConflictBanner
          resourceKey={leaseKey}
          resourceLabel={t('editConflict.resource.alertRules', 'Your alert rules')}
        />
        <BulkActionsToolbar
          actions={actions}
          itemNoun={{
            one: t('alertRules.noun.one', 'rule'),
            other: t('alertRules.noun.other', 'rules'),
          }}
          onClear={sel.clear}
          selectedIds={Array.from(sel.selectedIds)}
          total={visibleIds.length}
        />

        <GlassPanel style={styles.panel}>
          {isLoading ? (
            <View style={styles.skeletonStack}>
              <Skeleton />
              <Skeleton />
              <Skeleton />
            </View>
          ) : error ? (
            <ErrorDisplay error={error} />
          ) : rules.length === 0 ? (
            <EmptyState
              actionTo={{
                label: t('alertRules.empty.cta', 'Open Alert Studio'),
                to: '/notifications/studio',
              }}
              message={t(
                'alertRules.empty.body',
                'Create your first alert rule in the Alert Studio.',
              )}
              onNavigate={navigate}
              title={t('alertRules.empty.title', 'No alert rules yet')}
            />
          ) : (
            <View style={styles.table}>
              <View style={styles.headerRow}>
                <View style={styles.checkboxCell}>
                  <VisuallyHidden as="label" htmlFor="alert-rules-master">
                    {t('bulk.selectAll', 'Select all')}
                  </VisuallyHidden>
                  <Checkbox
                    accessibilityLabel={t('bulk.selectAll', 'Select all')}
                    checked={masterState === 'all'}
                    indeterminate={masterState === 'some'}
                    onPress={onMasterToggle}
                    testID="alert-rules-master"
                  />
                </View>
                <View style={styles.headerLabels}>
                  <AppText style={styles.headerLabel} tone="secondary" variant="caption">
                    {t('alertRules.col.name', 'Name')}
                  </AppText>
                  <AppText style={styles.headerLabel} tone="secondary" variant="caption">
                    {t('alertRules.col.signal', 'Signal')}
                  </AppText>
                  <AppText style={styles.headerLabel} tone="secondary" variant="caption">
                    {t('alertRules.col.severity', 'Severity')}
                  </AppText>
                  <AppText style={styles.headerLabel} tone="secondary" variant="caption">
                    {t('alertRules.col.status', 'Status')}
                  </AppText>
                </View>
              </View>

              {rules.map(r => {
                const checked = sel.isSelected(r.id);
                return (
                  <View
                    key={r.id}
                    style={[styles.ruleRow, checked ? styles.ruleRowSelected : null]}>
                    <View style={styles.checkboxCell}>
                      <VisuallyHidden as="label" htmlFor={`alert-rule-${r.id}`}>
                        {t('bulk.selectRow', 'Select row')}
                      </VisuallyHidden>
                      <Checkbox
                        accessibilityLabel={t(
                          'alertRules.selectRule',
                          'Select rule {{name}}',
                          {name: r.name},
                        )}
                        checked={checked}
                        onPress={() => sel.toggle(r.id)}
                        testID={`alert-rule-${r.id}`}
                      />
                    </View>

                    <View style={styles.ruleContent}>
                      <EditableText
                        ariaLabel={t(
                          'editableText.rename.alertRule',
                          'Rename alert rule {{name}}',
                          {name: r.name},
                        )}
                        maxLength={120}
                        onSave={async next => {
                          await saveRule.mutateAsync({id: r.id, name: next});
                        }}
                        validate={next =>
                          next.length > 120
                            ? t(
                                'alertRules.error.nameTooLong',
                                'Max 120 characters',
                              )
                            : null
                        }
                        value={r.name}
                        display={({value, onStartEdit}) => (
                          <View style={styles.nameInline}>
                            <Link
                              accessibilityLabel={value}
                              onNavigate={navigate}
                              textStyle={styles.nameLinkText}
                              to={`/alert-studio?rule=${r.id}`}>
                              {value}
                            </Link>
                            <Pressable
                              accessibilityLabel={t(
                                'editableText.rename.alertRule',
                                'Rename alert rule {{name}}',
                                {name: r.name},
                              )}
                              accessibilityRole="button"
                              hitSlop={6}
                              onPress={onStartEdit}
                              style={({pressed}) => [
                                styles.iconButton,
                                pressed && styles.pressed,
                              ]}>
                              <SemanticIcon decorative name="edit" size="sm" />
                            </Pressable>
                          </View>
                        )}
                      />

                      <View style={styles.ruleMeta}>
                        <View style={styles.metaItem}>
                          <AppText tone="muted" variant="caption">
                            {t('alertRules.col.signal', 'Signal')}
                          </AppText>
                          <AppText tone="secondary" variant="caption">
                            {r.signal_name}
                          </AppText>
                        </View>
                        <SeverityBadge severity={r.severity} />
                        {r.enabled ? (
                          <Badge variant="success">
                            {t('common.enabled', 'Enabled')}
                          </Badge>
                        ) : (
                          <Badge variant="neutral">
                            {t('common.disabled', 'Disabled')}
                          </Badge>
                        )}
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </GlassPanel>

        <View style={styles.footer}>
          <Link
            accessibilityLabel={t('alertRules.openStudio', 'Open Alert Studio')}
            onNavigate={navigate}
            style={styles.secondaryButton}
            to="/notifications/studio">
            <View style={styles.footerCtaContent}>
              <SemanticIcon decorative name="add" size="sm" />
              <AppText variant="caption" weight="semibold">
                {t('alertRules.openStudio', 'Open Alert Studio')}
              </AppText>
            </View>
          </Link>
        </View>
      </FadeIn>
    </PageContainer>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  checkbox: {
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  checkboxCell: {
    paddingTop: 2,
  },
  checkboxGlyph: {
    color: colors.accent,
    lineHeight: 16,
  },
  checkboxOn: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  conflictActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  conflictBanner: {
    borderColor: colors.warningBorder,
    gap: spacing.xs,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  conflictHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  conflictTitle: {
    color: colors.warning,
    flexShrink: 1,
  },
  editAffordance: {
    marginLeft: spacing.xs,
  },
  editColumn: {
    gap: spacing.xs,
  },
  editError: {
    marginLeft: spacing.xs,
  },
  editInput: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.textPrimary,
    flexShrink: 1,
    minWidth: 160,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  editInputError: {
    borderColor: colors.danger,
  },
  editRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  emptyMessage: {
    maxWidth: 360,
    textAlign: 'center',
  },
  emptyState: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xxl,
  },
  emptyTitle: {
    textAlign: 'center',
  },
  footer: {
    alignItems: 'flex-end',
    marginTop: spacing.md,
  },
  footerCtaContent: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  ghostButton: {
    borderColor: colors.borderAccent,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  headerLabel: {
    flexShrink: 1,
  },
  headerLabels: {
    columnGap: spacing.md,
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.xs,
  },
  headerRow: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    paddingBottom: spacing.sm,
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: 8,
    justifyContent: 'center',
    padding: spacing.xs,
  },
  inlineRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  linkText: {
    color: colors.accent,
  },
  metaItem: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  nameInline: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: spacing.xs,
  },
  nameLinkText: {
    color: colors.accent,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  pageHeader: {
    gap: spacing.xs,
    marginBottom: spacing.lg,
  },
  pageSubtitle: {
    maxWidth: 520,
  },
  pageTitle: {
    color: colors.textPrimary,
  },
  panel: {
    overflow: 'hidden',
    padding: spacing.md,
  },
  pressed: {
    opacity: 0.7,
  },
  ruleContent: {
    flex: 1,
    gap: spacing.sm,
  },
  ruleMeta: {
    alignItems: 'center',
    columnGap: spacing.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.xs,
  },
  ruleRow: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  ruleRowSelected: {
    backgroundColor: colors.surfaceSelected,
  },
  scroll: {
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: spacing.lg,
  },
  secondaryButton: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  severityBadge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
    height: 44,
    width: '100%',
  },
  skeletonStack: {
    gap: spacing.sm,
  },
  table: {
    width: '100%',
  },
  badgeNeutralText: {
    color: colors.textSecondary,
  },
  badgeSuccessText: {
    color: colors.success,
  },
});

const badgeVariantStyles = StyleSheet.create<Record<BadgeVariant, ViewStyle>>({
  neutral: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
  success: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
});

const badgeTextStyles: Record<BadgeVariant, TextStyle> = {
  neutral: styles.badgeNeutralText,
  success: styles.badgeSuccessText,
};
