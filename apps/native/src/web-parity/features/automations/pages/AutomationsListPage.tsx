// AutomationsListPage — native parity port of
// web/src/features/automations/pages/AutomationsListPage.tsx.
//
// The automations hub: a stats bar, status/search filters, an auto-disabled
// warning banner, a collapsible quick-start preset gallery, the automation card
// list (toggle / test-run / re-enable / delete, pin-ordered), and a live
// activity feed. Behavior, state names (statusFilter/search), the computeStats /
// buildVehicleLookup helpers, the pin-ordered sort, the API mutation wiring, and
// every i18n key + English fallback are preserved verbatim.
//
// Sibling-component status: this is the FIRST automations file converted, so the
// three web siblings imported by the page — AutomationCard (web pages/
// AutomationCard.tsx), AutomationActivityFeed (web pages/
// AutomationActivityFeed.tsx) and PresetGallery (web pages/PresetGallery.tsx) —
// have no standalone native parity file yet. To keep this single-file conversion
// self-contained and pass the project-wide typecheck/lint/test gates without
// importing unconverted siblings (the established convention — see
// WeeklyDigestPage.tsx.parity.json), native-safe equivalents of those three
// presentational components + the useAutomationEvents hook are ported inline
// here. Their canonical standalone native files remain owned by their own
// conversion turns.
//
// Native adaptations vs. the web source (behavior/state/keys/API intent kept):
//   - react-router-dom `useNavigate` (web L8) -> a native-safe no-op navigate
//     (RN routes through the native navigation manifest, not react-router); the
//     navigate('/automations/new') call sites (Create button + empty-state CTA)
//     are preserved.
//   - react-i18next `useTranslation` (web L9) -> a native-safe t(key, fallback,
//     options?) fallback preserving every automations.* key, the English
//     defaults, and {{message}}/{{count}}/{{name}} interpolation.
//   - `@/components/layout` PageContainer (web L10) -> an inline RN PageScaffold
//     (ScrollView header: title/subtitle/actions, then loading-spinner gating,
//     then a PageErrorBoundary mirroring the web wrapper).
//   - `@/components/ui` GlassPanel/Button/Input/Select/Badge (web L11) ->
//     canonical native GlassPanel + inline native ActionButton (Pressable),
//     TextInput, Modal-based Select, and Badge.
//   - `@/components/data-display` StatCard (web L12) -> an inline native StatCard.
//   - `@/components/feedback` EmptyState (web L13) -> an inline native EmptyState
//     (icon glyph + message + optional action button, since the shared native
//     EmptyState exposes only title/message).
//   - `@/components/motion` FadeIn/StaggerContainer/StaggerItem (web L14-16,
//     framer-motion) -> an inline reduced-motion-aware Animated FadeIn; stagger
//     wrappers collapse to structural Views (the entrance flourish is
//     non-essential on native).
//   - `@/hooks/usePageTitle` (web L17) -> a native-safe no-op (RN has no
//     document.title); the call site + argument are preserved.
//   - `@/hooks/useAutomationEvents` (web L18) -> an inline native-safe
//     useAutomationEvents: there is no native automation SSE singleton wired yet,
//     so it returns the explicit unavailable state (no events, empty firingNow,
//     connectionState 'reconnecting'); the {maxEvents} option + return shape
//     (events/connectionState/firingNow/clearEvents) are preserved.
//   - lucide-react icons (web L32-34) -> SemanticIcon glyphs (lucide is
//     browser-only).
//   - the file-based import flow (web L42-46 envelope type, L96-101 validators,
//     L122-156 importInputRef + handleImportFile) depends on a hidden
//     <input type=file>, the browser File API, window.location.reload and
//     window.alert — all DOM-only. It is represented natively by an explicit
//     "import unavailable" Alert (rule 7), preserving the automations.import key.
//     The POST /automations/import contract is documented but not reachable from
//     native (no document picker dependency is added).
//
// No DOM/react-router/react-i18next/lucide/Recharts/framer-motion/old-web-UI
// import reaches the native output — only react, react-native primitives, the
// canonical AppText/GlassPanel/SemanticIcon + theme tokens, and the native
// automations/vehicles/pinned hooks.

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
  Alert,
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {SemanticIcon, type SemanticIconName} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {
  useAutomationHistory,
  useAutomationPresets,
  useAutomations,
  useDeleteAutomation,
  useReEnableAutomation,
  useTestRunAutomation,
  useToggleAutomation,
  type Automation,
  type AutomationHistory,
  type AutomationHistoryStats,
  type AutomationPreset,
  type AutomationTriggerKind,
} from '../../../api/hooks/useAutomations';
import {usePinned} from '../../../api/hooks/usePinned';
import {useVehicles} from '../../../api/hooks/useVehicles';

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
    // No document.title in React Native; intentional no-op. The title dependency
    // mirrors the web hook so the effect re-runs on title changes.
  }, [title]);
}

// ─── Native-safe navigate (web react-router-dom useNavigate) ──────────────────

/**
 * Web uses react-router's `navigate('/automations/new')` for the Create button
 * and the empty-state CTA. React Native routes through the native navigation
 * manifest rather than react-router, so this is a documented no-op preserving
 * the call sites; a future wire-up maps the path to the native builder route.
 */
function useNativeNavigateFallback(): (path: string) => void {
  return useCallback((_path: string) => {
    // Intentional native-safe no-op — see doc comment above.
  }, []);
}

// ─── Inline formatters (web @/lib/dateFormat + @/lib/numberFormat) ────────────

const FALLBACK_DASH = '—';

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** web numberFormat.fmtNumber — locale-grouped fixed-decimal, '—' on non-finite. */
function fmtNumber(value: unknown, decimals?: number): string {
  if (!isFiniteNumber(value)) {
    return FALLBACK_DASH;
  }
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals ?? 0,
    maximumFractionDigits: decimals ?? (Number.isInteger(value) ? 0 : 2),
  });
}

/** web numberFormat.fmtPercent — `${fmtNumber(v, decimals)}%`. */
function fmtPercent(value: unknown, decimals?: number): string {
  return `${fmtNumber(value, decimals)}%`;
}

/** web dateFormat.formatDurationMs — "—" | "{ms}ms" | "{s}s". */
function formatDurationMs(ms: number | null | undefined): string {
  if (!isFiniteNumber(ms)) {
    return FALLBACK_DASH;
  }
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

/** web dateFormat.formatDateTime — "Apr 4, 2026, 09:30 PM", "—" on empty/invalid. */
function formatDateTime(iso: string | null | undefined): string {
  if (!iso) {
    return FALLBACK_DASH;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return FALLBACK_DASH;
  }
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Shared "x ago" relative label (web AutomationCard/AutomationActivityFeed). */
function timeAgo(iso: string | null): string {
  if (!iso) {
    return FALLBACK_DASH;
  }
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) {
    return 'just now';
  }
  if (mins < 60) {
    return `${mins}m ago`;
  }
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return `${Math.floor(hours / 24)}d ago`;
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

type BadgeVariant = 'neutral' | 'success' | 'danger';

function Badge({
  children,
  variant = 'neutral',
}: {
  children: ReactNode;
  variant?: BadgeVariant;
}): React.ReactElement {
  return (
    <View style={[styles.badge, badgeVariantStyles[variant]]}>
      <AppText style={badgeTextStyles[variant]} variant="caption" weight="semibold">
        {children}
      </AppText>
    </View>
  );
}

// ─── Inline ActionButton (web @/components/ui Button) ─────────────────────────

function ActionButton({
  label,
  glyph,
  onPress,
  variant = 'ghost',
  tone,
  testID,
}: {
  label: string;
  glyph?: SemanticIconName;
  onPress: () => void;
  variant?: 'primary' | 'ghost';
  tone?: 'default' | 'danger' | 'accent';
  testID?: string;
}): React.ReactElement {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({pressed}) => [
        styles.actionButton,
        variant === 'primary' ? styles.actionButtonPrimary : styles.actionButtonGhost,
        pressed && styles.pressed,
      ]}
      testID={testID}>
      {glyph ? <SemanticIcon decorative name={glyph} size="sm" style={styles.actionButtonIcon} /> : null}
      <AppText
        style={
          variant === 'primary'
            ? styles.actionButtonPrimaryText
            : tone === 'danger'
              ? styles.actionButtonDangerText
              : tone === 'accent'
                ? styles.actionButtonAccentText
                : styles.actionButtonGhostText
        }
        variant="caption"
        weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

// ─── Inline StatCard (web @/components/data-display StatCard) ──────────────────

function StatCard({
  label,
  value,
  glyph,
  glyphTone = 'neutral',
  highlight = false,
}: {
  label: string;
  value: number | string;
  glyph: SemanticIconName;
  glyphTone?: 'neutral' | 'success' | 'danger';
  highlight?: boolean;
}): React.ReactElement {
  return (
    <View style={[styles.statCard, highlight && styles.statCardHighlight]}>
      <View style={styles.statCardHeader}>
        <SemanticIcon decorative name={glyph} size="sm" />
        <AppText style={styles.statCardLabel} tone="muted" variant="caption" weight="semibold">
          {label}
        </AppText>
      </View>
      <AppText style={statCardValueTone[glyphTone]} variant="title" weight="bold">
        {value}
      </AppText>
    </View>
  );
}

// ─── Inline EmptyState (web @/components/feedback EmptyState) ──────────────────

function EmptyState({
  glyph,
  message,
  actionLabel,
  onAction,
}: {
  glyph: SemanticIconName;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}): React.ReactElement {
  return (
    <View style={styles.emptyState}>
      <SemanticIcon decorative name={glyph} size="lg" />
      <AppText style={styles.emptyStateMessage} tone="muted">
        {message}
      </AppText>
      {actionLabel && onAction ? (
        <ActionButton glyph="add" label={actionLabel} onPress={onAction} variant="primary" />
      ) : null}
    </View>
  );
}

// ─── Inline Select (web @/components/ui Select) ───────────────────────────────

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
  accessibilityLabel: string;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const active = options.find(o => o.value === value);

  const handleSelect = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <>
      <Pressable
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        style={styles.selectTrigger}>
        <AppText style={styles.selectTriggerText} variant="caption" weight="semibold">
          {active?.label ?? ''}
        </AppText>
        <AppText style={styles.selectChevron}>▾</AppText>
      </Pressable>
      <Modal
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        transparent
        visible={open}>
        <Pressable
          accessibilityLabel={accessibilityLabel}
          onPress={() => setOpen(false)}
          style={styles.overlay}>
          <View style={styles.modalCard}>
            {options.map(option => {
              const selected = option.value === value;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{selected}}
                  key={option.value}
                  onPress={() => handleSelect(option.value)}
                  style={({pressed}) => [
                    styles.optionRow,
                    selected && styles.optionRowActive,
                    pressed && styles.pressed,
                  ]}>
                  <AppText style={selected ? styles.optionLabelActive : styles.optionLabel}>
                    {option.label}
                  </AppText>
                  {selected ? <AppText style={styles.optionCheck}>✓</AppText> : null}
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

// ─── Native-safe useAutomationEvents (web @/hooks/useAutomationEvents) ─────────

/** A single automation SSE event (web AutomationActivityEvent shape, native). */
export interface AutomationActivityEventData {
  automation_id: number;
  name?: string;
  error?: string;
  reason?: string;
}

export interface AutomationActivityEvent {
  id: string;
  type: string;
  data: AutomationActivityEventData;
  receivedAt: Date;
}

interface UseAutomationEventsOptions {
  maxEvents?: number;
  enabled?: boolean;
  modeFilter?: 'live' | 'test' | null;
}

interface UseAutomationEventsReturn {
  events: AutomationActivityEvent[];
  connectionState: 'connected' | 'reconnecting';
  firingNow: Set<number>;
  clearEvents: () => void;
}

/**
 * Web `useAutomationEvents` subscribes to the dedicated automation SSE stream
 * (`@/lib/automationSSE`) and exposes recent events, a connection state, the set
 * of automations "firing now" (auto-cleared after 5s) and a clearEvents() reset.
 *
 * No native automation SSE singleton is wired yet, so this native port returns
 * the explicit unavailable state — no events, an empty firingNow set, and
 * connectionState 'reconnecting' (the feed renders the honest "Reconnecting"
 * chip). The {maxEvents}/{enabled}/{modeFilter} options and the full return
 * shape are preserved so a future SSE wire-up drops in here without touching the
 * call site.
 */
function useAutomationEvents(
  _options: UseAutomationEventsOptions = {},
): UseAutomationEventsReturn {
  const events = useMemo<AutomationActivityEvent[]>(() => [], []);
  const firingNow = useMemo(() => new Set<number>(), []);
  const clearEvents = useCallback(() => {
    // No event buffer to clear in the native-safe state.
  }, []);

  return {events, connectionState: 'reconnecting', firingNow, clearEvents};
}

// ─── Filter types (web L38-53) ────────────────────────────────────────────────

type StatusFilter = 'all' | 'active' | 'disabled' | 'auto-disabled';

const statusFilterOptions: {value: StatusFilter; key: string; fallback: string}[] = [
  {value: 'all', key: 'automations.filters.all', fallback: 'All'},
  {value: 'active', key: 'automations.filters.active', fallback: 'Active'},
  {value: 'disabled', key: 'automations.filters.disabled', fallback: 'Disabled'},
  {value: 'auto-disabled', key: 'automations.filters.autoDisabled', fallback: 'Auto-Disabled'},
];

// ─── Stats computation (web L55-80) ───────────────────────────────────────────

interface AutomationStats {
  total: number;
  active: number;
  disabled: number;
  autoDisabled: number;
}

function computeStats(automations: Automation[]): AutomationStats {
  let active = 0;
  let disabled = 0;
  let autoDisabled = 0;

  for (const a of automations) {
    if (a.auto_disabled) {
      autoDisabled++;
    } else if (a.enabled) {
      active++;
    } else {
      disabled++;
    }
  }

  return {total: automations.length, active, disabled, autoDisabled};
}

// ─── Vehicle lookup helper (web L82-90) ───────────────────────────────────────

function buildVehicleLookup(
  vehicles: {id: number; display_name: string}[],
): Map<number, string> {
  const map = new Map<number, string>();
  for (const v of vehicles) {
    map.set(v.id, v.display_name);
  }
  return map;
}

// ─── Inline AutomationCard (web pages/AutomationCard.tsx) ──────────────────────

type AutomationUIStatus = 'active' | 'disabled' | 'auto-disabled';

function getUIStatus(a: Automation): AutomationUIStatus {
  if (a.auto_disabled) {
    return 'auto-disabled';
  }
  if (!a.enabled) {
    return 'disabled';
  }
  return 'active';
}

const statusStyles: Record<AutomationUIStatus, {label: string; variant: BadgeVariant}> = {
  active: {label: 'Active', variant: 'success'},
  disabled: {label: 'Disabled', variant: 'neutral'},
  'auto-disabled': {label: 'Auto-Disabled', variant: 'danger'},
};

interface AutomationCardProps {
  automation: Automation;
  isFiring: boolean;
  vehicleName?: string;
  onToggle: (id: number, enabled: boolean) => void;
  onReEnable: (id: number) => void;
  onDelete: (id: number) => void;
  onTestRun: (id: number) => void;
  t: NativeTFunction;
}

function AutomationCard({
  automation: a,
  isFiring,
  vehicleName,
  onToggle,
  onReEnable,
  onDelete,
  onTestRun,
  t,
}: AutomationCardProps): React.ReactElement {
  const uiStatus = useMemo(() => getUIStatus(a), [a]);
  const status = statusStyles[uiStatus];
  const conflicts = a.conflicts ?? [];

  const handleToggle = useCallback(
    (checked: boolean) => {
      if (a.auto_disabled && checked) {
        onReEnable(a.id);
      } else {
        onToggle(a.id, checked);
      }
    },
    [a.auto_disabled, a.id, onReEnable, onToggle],
  );

  const confirmDelete = useCallback(() => {
    Alert.alert(
      t('automations.deleteTitle', 'Delete Automation'),
      t(
        'automations.deleteMessage',
        'Are you sure you want to delete "{{name}}"? This cannot be undone.',
        {name: a.name},
      ),
      [
        {text: t('common.cancel', 'Cancel'), style: 'cancel'},
        {
          text: t('automations.deleteConfirm', 'Delete'),
          style: 'destructive',
          onPress: () => onDelete(a.id),
        },
      ],
    );
  }, [a.id, a.name, onDelete, t]);

  return (
    <GlassPanel
      style={[
        styles.card,
        isFiring && styles.cardFiring,
        uiStatus === 'auto-disabled' && styles.cardAutoDisabled,
      ]}>
      {/* Header row */}
      <View style={styles.cardHeaderRow}>
        <View style={styles.cardHeaderText}>
          <View style={styles.cardTitleRow}>
            <AppText numberOfLines={1} style={styles.cardTitle} weight="semibold">
              {a.name}
            </AppText>
            <Badge variant={status.variant}>
              {t(`automations.status.${uiStatus}`, status.label)}
            </Badge>
            {isFiring ? (
              <View style={styles.firingChip}>
                <SemanticIcon decorative name="bolt" size="sm" />
                <AppText style={styles.firingText} variant="caption" weight="semibold">
                  {t('automations.firing', 'Firing')}
                </AppText>
              </View>
            ) : null}
          </View>
          {a.description ? (
            <AppText numberOfLines={1} style={styles.cardDescription} tone="secondary" variant="caption">
              {a.description}
            </AppText>
          ) : null}
        </View>

        <Switch
          accessibilityLabel={t('automations.toggleLabel', 'Toggle automation')}
          ios_backgroundColor={colors.border}
          onValueChange={handleToggle}
          thumbColor={colors.textPrimary}
          trackColor={{false: colors.border, true: colors.accent}}
          value={a.auto_disabled ? false : a.enabled}
        />
      </View>

      {/* Vehicle row */}
      <View style={styles.cardMetaRow}>
        {vehicleName ? (
          <View style={styles.cardMetaItem}>
            <SemanticIcon decorative name="vehicle" size="sm" />
            <AppText style={styles.cardMetaText} tone="secondary" variant="caption">
              {vehicleName}
            </AppText>
          </View>
        ) : (
          <AppText style={styles.cardMetaText} tone="secondary" variant="caption">
            {t('automations.allVehicles', 'All vehicles')}
          </AppText>
        )}
      </View>

      {/* Stats row */}
      <View style={styles.cardMetaRow}>
        <View style={styles.cardMetaItem}>
          {a.last_triggered_at ? (
            <>
              <SemanticIcon decorative name="successFilled" size="sm" />
              <AppText style={styles.cardMetaText} tone="secondary" variant="caption">
                {t('automations.lastRun', 'Last')}: {timeAgo(a.last_triggered_at)}
              </AppText>
            </>
          ) : (
            <>
              <SemanticIcon decorative name="skipForward" size="sm" />
              <AppText style={styles.cardMetaText} tone="secondary" variant="caption">
                {t('automations.neverRun', 'Never run')}
              </AppText>
            </>
          )}
        </View>
        <AppText style={styles.cardMetaText} tone="secondary" variant="caption">
          {t('automations.runs', 'Runs')}: {a.execution_count}
        </AppText>
        {a.failure_count > 0 ? (
          <View style={styles.cardMetaItem}>
            <SemanticIcon decorative name="error" size="sm" />
            <AppText style={styles.cardMetaDanger} variant="caption">
              {t('automations.fails', 'Fails')}: {a.failure_count}
            </AppText>
          </View>
        ) : null}
        {a.next_fire_time ? (
          <AppText style={styles.cardMetaAccent} variant="caption">
            {t('automations.nextFire', 'Next')}: {formatDateTime(a.next_fire_time)}
          </AppText>
        ) : null}
      </View>

      {/* Auto-disabled warning */}
      {a.auto_disabled && a.auto_disabled_reason ? (
        <View style={styles.cardWarning}>
          <SemanticIcon decorative name="warning" size="sm" />
          <AppText style={styles.cardWarningText} variant="caption">
            {a.auto_disabled_reason}
          </AppText>
        </View>
      ) : null}

      {/* Conflicts */}
      {conflicts.length > 0 ? (
        <View style={styles.cardConflicts}>
          {conflicts.map((c, i) => (
            <View
              key={`conflict-${a.id}-${i}`}
              style={[
                styles.cardConflict,
                c.severity === 'warning' ? styles.cardConflictWarning : styles.cardConflictInfo,
              ]}>
              <SemanticIcon decorative name="warning" size="sm" />
              <AppText style={styles.cardConflictText} variant="caption">
                {t('automations.conflictWith', 'Conflict with')} "{c.automation_name}" — {c.reason}
              </AppText>
            </View>
          ))}
        </View>
      ) : null}

      {/* Actions */}
      <View style={styles.cardActions}>
        <ActionButton
          glyph="play"
          label={t('automations.testRun', 'Test Run')}
          onPress={() => onTestRun(a.id)}
          tone="default"
        />
        {a.auto_disabled ? (
          <ActionButton
            glyph="undoAlt"
            label={t('automations.reEnable', 'Re-enable')}
            onPress={() => onReEnable(a.id)}
            tone="accent"
          />
        ) : null}
        <ActionButton
          glyph="delete"
          label={t('automations.delete', 'Delete')}
          onPress={confirmDelete}
          tone="danger"
        />
      </View>
    </GlassPanel>
  );
}

// ─── Inline AutomationActivityFeed (web pages/AutomationActivityFeed.tsx) ──────

const historyStatusConfig: Record<string, {glyph: SemanticIconName; label: string}> = {
  success: {glyph: 'successFilled', label: 'Succeeded'},
  partial: {glyph: 'warning', label: 'Partial'},
  failed: {glyph: 'error', label: 'Failed'},
  skipped: {glyph: 'skipForward', label: 'Skipped'},
  test: {glyph: 'bolt', label: 'Test'},
  undo: {glyph: 'clock', label: 'Undo'},
  running: {glyph: 'activity', label: 'Running'},
  cancelled: {glyph: 'error', label: 'Cancelled'},
};

function HistoryRow({item}: {item: AutomationHistory}): React.ReactElement {
  const cfg = historyStatusConfig[item.status] ?? historyStatusConfig.running;
  return (
    <View style={styles.historyRow}>
      <SemanticIcon decorative name={cfg.glyph} size="sm" />
      <View style={styles.historyRowMain}>
        <AppText numberOfLines={1} style={styles.historyName} weight="semibold">
          {item.automation_name}
        </AppText>
        {item.error ? (
          <AppText numberOfLines={1} style={styles.historyError} variant="caption">
            — {item.error}
          </AppText>
        ) : null}
      </View>
      <AppText style={styles.historyMeta} tone="muted" variant="caption">
        {timeAgo(item.triggered_at)}
      </AppText>
      <AppText style={styles.historyMeta} tone="muted" variant="caption">
        {formatDurationMs(item.duration_ms)}
      </AppText>
      {item.actions_total > 0 ? (
        <AppText style={styles.historyMeta} tone="muted" variant="caption">
          {item.actions_succeeded}/{item.actions_total}
        </AppText>
      ) : null}
    </View>
  );
}

const liveEventConfig: Record<string, SemanticIconName> = {
  'automation.triggered': 'bolt',
  'automation.succeeded': 'successFilled',
  'automation.failed': 'error',
  'automation.skipped': 'skipForward',
  'automation.state_changed': 'activity',
};

function LiveEventRow({event}: {event: AutomationActivityEvent}): React.ReactElement {
  const glyph = liveEventConfig[event.type] ?? 'bolt';
  const name = event.data.name ?? `#${event.data.automation_id}`;
  return (
    <View style={styles.liveRow}>
      <SemanticIcon decorative name={glyph} size="sm" />
      <View style={styles.historyRowMain}>
        <AppText numberOfLines={1} style={styles.historyName} weight="semibold">
          {name}
        </AppText>
        {event.data.error ? (
          <AppText numberOfLines={1} style={styles.historyError} variant="caption">
            — {event.data.error}
          </AppText>
        ) : event.data.reason ? (
          <AppText numberOfLines={1} style={styles.historyMeta} tone="muted" variant="caption">
            — {event.data.reason}
          </AppText>
        ) : null}
      </View>
      <Badge variant="neutral">{event.type.replace('automation.', '')}</Badge>
    </View>
  );
}

interface AutomationActivityFeedProps {
  history: AutomationHistory[];
  historyStats: AutomationHistoryStats | null;
  isLoading: boolean;
  liveEvents: AutomationActivityEvent[];
  connectionState: 'connected' | 'reconnecting';
  t: NativeTFunction;
}

function AutomationActivityFeed({
  history,
  historyStats,
  isLoading,
  liveEvents,
  connectionState,
  t,
}: AutomationActivityFeedProps): React.ReactElement {
  const recentLive = useMemo(() => liveEvents.slice(0, 5), [liveEvents]);
  const items = history;

  return (
    <FadeIn>
      <GlassPanel style={styles.feedPanel}>
        {/* Header */}
        <View style={styles.feedHeader}>
          <View style={styles.feedHeaderTitle}>
            <SemanticIcon decorative name="activity" size="sm" />
            <AppText style={styles.feedTitle} variant="title" weight="semibold">
              {t('automations.recentActivity', 'Recent Activity')}
            </AppText>
            {connectionState === 'connected' ? (
              <View style={styles.connChip}>
                <SemanticIcon decorative name="wifi" size="sm" />
                <AppText style={styles.connLive} variant="caption" weight="semibold">
                  {t('automations.live', 'Live')}
                </AppText>
              </View>
            ) : (
              <View style={styles.connChip}>
                <SemanticIcon decorative name="wifiOff" size="sm" />
                <AppText style={styles.connReconnecting} variant="caption" weight="semibold">
                  {t('automations.reconnecting', 'Reconnecting')}
                </AppText>
              </View>
            )}
          </View>
          {historyStats && historyStats.total_executions > 0 ? (
            <View style={styles.feedStats}>
              <AppText style={styles.feedStat} tone="secondary" variant="caption">
                {historyStats.total_executions} {t('automations.totalRuns', 'total')}
              </AppText>
              <AppText style={styles.feedStatSuccess} variant="caption">
                {fmtPercent(historyStats.success_rate, 0)} {t('automations.successRate', 'success')}
              </AppText>
              <AppText style={styles.feedStat} tone="secondary" variant="caption">
                {formatDurationMs(historyStats.avg_duration_ms)} {t('automations.avgDuration', 'avg')}
              </AppText>
            </View>
          ) : null}
        </View>

        {/* Live events (SSE) */}
        {recentLive.length > 0 ? (
          <View style={styles.liveList}>
            {recentLive.map(evt => (
              <LiveEventRow event={evt} key={evt.id} />
            ))}
          </View>
        ) : null}

        {/* History items */}
        {isLoading ? (
          <View style={styles.skeletonList}>
            {Array.from({length: 5}).map((_, i) => (
              <View key={`skel-${i}`} style={styles.skeletonRow} />
            ))}
          </View>
        ) : items.length > 0 ? (
          <View style={styles.historyList}>
            {items.map(item => (
              <HistoryRow item={item} key={item.id} />
            ))}
          </View>
        ) : (
          <EmptyState
            glyph="activity"
            message={t('automations.noHistory', 'No execution history yet')}
          />
        )}
      </GlassPanel>
    </FadeIn>
  );
}

// ─── Inline PresetGallery (web pages/PresetGallery.tsx) ────────────────────────

const presetIconMap: Record<string, SemanticIconName> = {
  Shield: 'security',
  Moon: 'moon',
  Sun: 'sun',
  ShieldCheck: 'securityCheck',
  Lock: 'locked',
  UserX: 'userX',
  CarFront: 'vehicle',
  Siren: 'securityAlert',
};

const triggerLabels: Record<AutomationTriggerKind, {key: string; fallback: string}> = {
  trigger_schedule: {key: 'automations.builder.triggerSchedule', fallback: 'Schedule'},
  trigger_event: {key: 'automations.builder.triggerEvent', fallback: 'Vehicle Event'},
  trigger_geofence: {key: 'automations.builder.triggerGeofence', fallback: 'Geofence'},
  trigger_signal: {key: 'automations.builder.triggerSignal', fallback: 'Signal Threshold'},
};

function PresetCard({
  preset,
  navigate,
  t,
}: {
  preset: AutomationPreset;
  navigate: (path: string) => void;
  t: NativeTFunction;
}): React.ReactElement {
  const glyph = presetIconMap[preset.icon] ?? 'security';
  const firstTrigger = preset.triggers[0];
  const triggerLabel = firstTrigger ? triggerLabels[firstTrigger.kind] : null;

  return (
    <GlassPanel style={styles.presetCard}>
      <View style={styles.presetCardHeader}>
        <SemanticIcon decorative name={glyph} size="md" />
        <View style={styles.presetCardHeaderText}>
          <AppText numberOfLines={1} style={styles.presetName} weight="semibold">
            {preset.name}
          </AppText>
          <AppText style={styles.presetTrigger} tone="secondary" variant="caption">
            {triggerLabel
              ? t(triggerLabel.key, triggerLabel.fallback)
              : t('automations.builder.noTrigger', 'No trigger configured')}
          </AppText>
        </View>
        <Badge variant="neutral">
          {t('automations.presets.actionCount', '{{count}} actions', {
            count: preset.actions.length,
          })}
        </Badge>
      </View>

      <AppText numberOfLines={2} style={styles.presetDescription} tone="secondary" variant="caption">
        {preset.description}
      </AppText>

      <ActionButton
        glyph="add"
        label={t('automations.presets.install', 'Install')}
        onPress={() => navigate(`/automations/new?preset=${preset.id}`)}
        variant="primary"
      />
    </GlassPanel>
  );
}

function PresetGallery({t}: {t: NativeTFunction}): React.ReactElement {
  const navigate = useNativeNavigateFallback();
  const {data, isLoading} = useAutomationPresets();
  const presetList = useMemo(() => data?.presets ?? [], [data]);

  if (isLoading) {
    return (
      <View style={styles.presetGrid}>
        {Array.from({length: 4}).map((_, i) => (
          <View key={`preset-skel-${i}`} style={styles.presetSkeleton} />
        ))}
      </View>
    );
  }

  if (presetList.length === 0) {
    return (
      <EmptyState
        glyph="timer"
        message={t('automations.presets.empty', 'No preset templates available')}
      />
    );
  }

  return (
    <View style={styles.presetGrid}>
      {presetList.map(preset => (
        <PresetCard key={preset.id} navigate={navigate} preset={preset} t={t} />
      ))}
    </View>
  );
}

// ─── Inline PageErrorBoundary (web @/components/feedback PageErrorBoundary) ─────

interface PageErrorBoundaryProps {
  pageName: string;
  children: ReactNode;
}

interface PageErrorBoundaryState {
  hasError: boolean;
}

class PageErrorBoundary extends React.Component<
  PageErrorBoundaryProps,
  PageErrorBoundaryState
> {
  state: PageErrorBoundaryState = {hasError: false};

  static getDerivedStateFromError(): PageErrorBoundaryState {
    return {hasError: true};
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[ErrorBoundary:page:${this.props.pageName}]`, {
      error: error.message,
      componentStack: info.componentStack,
    });
  }

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }
    return (
      <View accessibilityRole="alert" style={styles.pageError}>
        <AppText style={styles.pageErrorGlyph}>⚠</AppText>
        <AppText style={styles.pageErrorText} variant="caption">
          This page failed to render.
        </AppText>
      </View>
    );
  }
}

// ─── Page scaffold (web @/components/layout PageContainer) ─────────────────────

function PageScaffold({
  title,
  subtitle,
  actions,
  loading,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  loading?: boolean;
  children: ReactNode;
}): React.ReactElement {
  return (
    <ScrollView contentContainerStyle={styles.scrollContent} style={styles.scroll}>
      <View style={styles.pageHeader}>
        <View style={styles.pageHeaderText}>
          <AppText style={styles.pageTitle} variant="display" weight="bold">
            {title}
          </AppText>
          {subtitle ? (
            <AppText style={styles.pageSubtitle} tone="muted" variant="caption">
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {actions ? <View style={styles.headerActions}>{actions}</View> : null}
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : (
        <PageErrorBoundary pageName={title}>{children}</PageErrorBoundary>
      )}
    </ScrollView>
  );
}

// ─── Page (web L103-430) ──────────────────────────────────────────────────────

export default function AutomationsListPage(): React.ReactElement {
  const t = useNativeTranslationFallback();
  const navigate = useNativeNavigateFallback();
  usePageTitle(t('automations.title', 'Automations'));

  // Data hooks
  const {data: automations, isLoading} = useAutomations();
  const {data: historyResponse, isLoading: historyLoading} = useAutomationHistory(20);
  const {data: vehicles} = useVehicles();
  const {events: liveEvents, connectionState, firingNow} = useAutomationEvents({maxEvents: 50});

  // Mutations
  const toggleMutation = useToggleAutomation();
  const deleteMutation = useDeleteAutomation();
  const testRunMutation = useTestRunAutomation();
  const reEnableMutation = useReEnableAutomation();

  // File-based import (web hidden <input type=file> + File API + reload) is
  // browser-only; surface an explicit native-safe unavailable state (rule 7).
  const handleImport = useCallback(() => {
    Alert.alert(
      t('automations.import', 'Import'),
      t(
        'automations.importUnavailableNative',
        'Typed automation import requires a file picker, which is unavailable in this build. Use the web app to import automation export files.',
      ),
    );
  }, [t]);

  // Filters
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');

  // Safe data
  const items = useMemo(() => automations ?? [], [automations]);
  const localizedStatusFilterOptions = useMemo(
    () =>
      statusFilterOptions.map(option => ({
        value: option.value,
        label: t(option.key, option.fallback),
      })),
    [t],
  );
  const vehicleLookup = useMemo(() => buildVehicleLookup(vehicles ?? []), [vehicles]);
  const historyItems = historyResponse?.items ?? [];
  const historyStats = historyResponse?.summary ?? null;

  // Computed stats
  const stats = useMemo(() => computeStats(items), [items]);

  // Filtered list
  const filteredItems = useMemo(() => {
    let result = items;

    if (statusFilter !== 'all') {
      result = result.filter(a => {
        if (statusFilter === 'active') {
          return a.enabled && !a.auto_disabled;
        }
        if (statusFilter === 'disabled') {
          return !a.enabled && !a.auto_disabled;
        }
        if (statusFilter === 'auto-disabled') {
          return a.auto_disabled;
        }
        return true;
      });
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        a =>
          (a.name ?? '').toLowerCase().includes(q) ||
          (a.description ?? '').toLowerCase().includes(q),
      );
    }

    return result;
  }, [items, statusFilter, search]);

  const {data: automationPins = []} = usePinned('automation');
  const sortedItems = useMemo(() => {
    if (automationPins.length === 0) {
      return filteredItems;
    }
    const order = new Map<string, number>();
    automationPins.forEach(p => order.set(String(p.item_id), p.position));
    return [...filteredItems].sort((a, b) => {
      const ap = order.get(String(a.id));
      const bp = order.get(String(b.id));
      if (ap != null && bp != null) {
        return ap - bp;
      }
      if (ap != null) {
        return -1;
      }
      if (bp != null) {
        return 1;
      }
      return 0;
    });
  }, [filteredItems, automationPins]);

  // Callbacks
  const handleToggle = useCallback(
    (id: number, enabled: boolean) => {
      toggleMutation.mutate({id, enabled});
    },
    [toggleMutation],
  );

  const handleReEnable = useCallback(
    (id: number) => {
      reEnableMutation.mutate(id);
    },
    [reEnableMutation],
  );

  const handleDelete = useCallback(
    (id: number) => {
      deleteMutation.mutate(id);
    },
    [deleteMutation],
  );

  const handleTestRun = useCallback(
    (id: number) => {
      testRunMutation.mutate(id);
    },
    [testRunMutation],
  );

  // Preset gallery collapsible (web <details>/<summary>)
  const [presetsOpen, setPresetsOpen] = useState(false);

  const headerActions = (
    <View style={styles.headerActionsInner}>
      <ActionButton
        glyph="upload"
        label={t('automations.import', 'Import')}
        onPress={handleImport}
      />
      <ActionButton
        glyph="add"
        label={t('automations.create', 'Create')}
        onPress={() => navigate('/automations/new')}
        variant="primary"
      />
    </View>
  );

  const filtersActive = statusFilter !== 'all' || Boolean(search);

  return (
    <PageScaffold
      actions={headerActions}
      loading={isLoading}
      subtitle={t(
        'automations.subtitle',
        'Automate vehicle actions with typed triggers, conditions, and action chains',
      )}
      title={t('automations.title', 'Automations')}>
      {/* Stats bar */}
      <FadeIn>
        <View style={styles.statsGrid}>
          <StatCard glyph="filter" label={t('automations.stats.total', 'Total')} value={stats.total} />
          <StatCard
            glyph="power"
            glyphTone="success"
            label={t('automations.stats.active', 'Active')}
            value={stats.active}
          />
          <StatCard
            glyph="pause"
            label={t('automations.stats.disabled', 'Disabled')}
            value={stats.disabled}
          />
          <StatCard
            glyph="securityOff"
            glyphTone="danger"
            highlight={stats.autoDisabled > 0}
            label={t('automations.stats.autoDisabled', 'Auto-Disabled')}
            value={stats.autoDisabled}
          />
        </View>
      </FadeIn>

      {/* Filters */}
      <FadeIn>
        <GlassPanel style={styles.filtersPanel}>
          <View style={styles.filtersRow}>
            <Select
              accessibilityLabel={t('automations.filterStatus', 'Filter by status')}
              onChange={value => setStatusFilter(value as StatusFilter)}
              options={localizedStatusFilterOptions}
              value={statusFilter}
            />
            <TextInput
              onChangeText={setSearch}
              placeholder={t('automations.search', 'Search automations...')}
              placeholderTextColor={colors.textMuted}
              style={styles.searchInput}
              value={search}
            />
            {filtersActive ? (
              <Badge variant="neutral">
                {filteredItems.length} / {items.length}
              </Badge>
            ) : null}
          </View>
        </GlassPanel>
      </FadeIn>

      {/* Auto-disabled warning banner */}
      {stats.autoDisabled > 0 ? (
        <FadeIn>
          <View style={styles.warningBanner}>
            <SemanticIcon decorative name="warning" size="sm" />
            <AppText style={styles.warningBannerText} variant="caption">
              {t(
                'automations.autoDisabledWarning',
                `${stats.autoDisabled} automation(s) have been auto-disabled due to repeated failures.`,
              )}
            </AppText>
          </View>
        </FadeIn>
      ) : null}

      {/* Preset gallery (collapsible) */}
      <FadeIn>
        <GlassPanel style={styles.presetPanel}>
          <Pressable
            accessibilityHint={t(
              'automations.presets.toggleAria',
              'Show or hide quick start templates',
            )}
            accessibilityRole="button"
            accessibilityState={{expanded: presetsOpen}}
            onPress={() => setPresetsOpen(open => !open)}
            style={styles.presetSummary}>
            <AppText style={styles.presetChevron}>{presetsOpen ? '▾' : '▸'}</AppText>
            <SemanticIcon decorative name="sparkles" size="sm" />
            <AppText style={styles.presetSummaryTitle} weight="semibold">
              {t('automations.presets.title', 'Quick Start Templates')}
            </AppText>
            <AppText style={styles.presetSummaryHint} tone="muted" variant="caption">
              {t('automations.presets.hint', 'One-click install')}
            </AppText>
            <AppText style={styles.presetSummaryToggle} tone="muted" variant="caption">
              {presetsOpen
                ? t('automations.presets.collapse', 'Click to collapse')
                : t('automations.presets.expand', 'Click to expand')}
            </AppText>
          </Pressable>
          {presetsOpen ? (
            <View style={styles.presetBody}>
              <PresetGallery t={t} />
            </View>
          ) : null}
        </GlassPanel>
      </FadeIn>

      {/* Automation cards */}
      <FadeIn>
        {filteredItems.length > 0 ? (
          <View style={styles.cardList}>
            {sortedItems.map(a => (
              <AutomationCard
                automation={a}
                isFiring={firingNow.has(a.id)}
                key={a.id}
                onDelete={handleDelete}
                onReEnable={handleReEnable}
                onTestRun={handleTestRun}
                onToggle={handleToggle}
                t={t}
                vehicleName={a.vehicle_id != null ? vehicleLookup.get(a.vehicle_id) : undefined}
              />
            ))}
          </View>
        ) : (
          <GlassPanel style={styles.emptyPanel}>
            {items.length === 0 ? (
              <EmptyState
                actionLabel={t('automations.empty.cta', 'Create automation')}
                glyph="bolt"
                message={t(
                  'automations.empty',
                  'No automations yet. Create a typed automation to get started!',
                )}
                onAction={() => navigate('/automations/new')}
              />
            ) : (
              <EmptyState
                actionLabel={t('automations.noMatch.cta', 'Reset filters')}
                glyph="bolt"
                message={t('automations.noMatch', 'No automations match your filters')}
                onAction={() => {
                  setSearch('');
                  setStatusFilter('all');
                }}
              />
            )}
          </GlassPanel>
        )}
      </FadeIn>

      {/* Activity feed */}
      <AutomationActivityFeed
        connectionState={connectionState}
        history={historyItems}
        historyStats={historyStats}
        isLoading={historyLoading}
        liveEvents={liveEvents}
        t={t}
      />
    </PageScaffold>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scroll: {
    backgroundColor: colors.background,
    flex: 1,
  },
  scrollContent: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
    flexWrap: 'wrap',
  },
  pageHeaderText: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 180,
  },
  pageTitle: {
    color: colors.textPrimary,
  },
  pageSubtitle: {
    color: colors.textMuted,
  },
  headerActions: {
    alignItems: 'flex-end',
  },
  headerActionsInner: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  loadingWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
  },
  pageError: {
    alignItems: 'center',
    gap: spacing.xs,
    padding: spacing.lg,
  },
  pageErrorGlyph: {
    color: colors.warning,
    fontSize: 24,
  },
  pageErrorText: {
    color: colors.textMuted,
  },
  pressed: {
    opacity: 0.78,
  },

  // Badge
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },

  // ActionButton
  actionButton: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 36,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  actionButtonPrimary: {
    backgroundColor: colors.accent,
  },
  actionButtonGhost: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
  },
  actionButtonIcon: {
    marginRight: 2,
  },
  actionButtonPrimaryText: {
    color: colors.background,
  },
  actionButtonGhostText: {
    color: colors.textPrimary,
  },
  actionButtonDangerText: {
    color: colors.danger,
  },
  actionButtonAccentText: {
    color: colors.accent,
  },

  // StatCard
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  statCard: {
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    flexBasis: '47%',
    flexGrow: 1,
    gap: spacing.sm,
    minWidth: 140,
    padding: spacing.md,
  },
  statCardHighlight: {
    borderColor: colors.dangerBorder,
  },
  statCardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  statCardLabel: {
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },

  // EmptyState
  emptyState: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  emptyStateMessage: {
    textAlign: 'center',
  },

  // Select
  selectTrigger: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minWidth: 150,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  selectTriggerText: {
    color: colors.textPrimary,
    flex: 1,
  },
  selectChevron: {
    color: colors.textMuted,
  },
  overlay: {
    backgroundColor: 'rgba(2, 4, 9, 0.6)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    gap: 2,
    padding: spacing.sm,
  },
  optionRow: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  optionRowActive: {
    backgroundColor: colors.surfaceSelected,
  },
  optionLabel: {
    color: colors.textSecondary,
  },
  optionLabelActive: {
    color: colors.textPrimary,
  },
  optionCheck: {
    color: colors.accent,
  },

  // Filters
  filtersPanel: {
    padding: spacing.md,
  },
  filtersRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  searchInput: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    color: colors.textPrimary,
    flexGrow: 1,
    minWidth: 180,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },

  // Warning banner
  warningBanner: {
    alignItems: 'center',
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  warningBannerText: {
    color: colors.danger,
    flex: 1,
  },

  // Preset gallery
  presetPanel: {
    padding: spacing.lg,
  },
  presetSummary: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  presetChevron: {
    color: colors.textMuted,
  },
  presetSummaryTitle: {
    color: colors.textPrimary,
  },
  presetSummaryHint: {
    color: colors.textMuted,
  },
  presetSummaryToggle: {
    color: colors.textMuted,
    marginLeft: 'auto',
  },
  presetBody: {
    marginTop: spacing.md,
  },
  presetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  presetSkeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 18,
    flexBasis: '47%',
    flexGrow: 1,
    height: 132,
    minWidth: 150,
  },
  presetCard: {
    flexBasis: '47%',
    flexGrow: 1,
    gap: spacing.sm,
    minWidth: 150,
    padding: spacing.md,
  },
  presetCardHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  presetCardHeaderText: {
    flex: 1,
    gap: 2,
  },
  presetName: {
    color: colors.textPrimary,
  },
  presetTrigger: {
    color: colors.textSecondary,
  },
  presetDescription: {
    color: colors.textSecondary,
  },

  // Card list
  cardList: {
    gap: spacing.sm,
  },
  emptyPanel: {
    padding: spacing.xl,
  },
  card: {
    gap: spacing.sm,
    padding: spacing.md,
  },
  cardFiring: {
    borderColor: colors.borderAccent,
  },
  cardAutoDisabled: {
    borderColor: colors.dangerBorder,
  },
  cardHeaderRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  cardHeaderText: {
    flex: 1,
    gap: spacing.xs,
  },
  cardTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  cardTitle: {
    color: colors.textPrimary,
    flexShrink: 1,
  },
  cardDescription: {
    color: colors.textSecondary,
  },
  firingChip: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  firingText: {
    color: colors.accent,
  },
  cardMetaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  cardMetaItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  cardMetaText: {
    color: colors.textSecondary,
  },
  cardMetaDanger: {
    color: colors.danger,
  },
  cardMetaAccent: {
    color: colors.accent,
  },
  cardWarning: {
    alignItems: 'flex-start',
    backgroundColor: colors.dangerSurface,
    borderRadius: 10,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  cardWarningText: {
    color: colors.danger,
    flex: 1,
  },
  cardConflicts: {
    gap: spacing.xs,
  },
  cardConflict: {
    alignItems: 'flex-start',
    borderRadius: 10,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  cardConflictWarning: {
    backgroundColor: colors.warningSurface,
  },
  cardConflictInfo: {
    backgroundColor: colors.accentSoft,
  },
  cardConflictText: {
    color: colors.textSecondary,
    flex: 1,
  },
  cardActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },

  // Activity feed
  feedPanel: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  feedHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  feedHeaderTitle: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  feedTitle: {
    color: colors.textPrimary,
  },
  connChip: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  connLive: {
    color: colors.success,
  },
  connReconnecting: {
    color: colors.warning,
  },
  feedStats: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  feedStat: {
    color: colors.textSecondary,
  },
  feedStatSuccess: {
    color: colors.success,
  },
  liveList: {
    gap: spacing.xs,
  },
  liveRow: {
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
    borderRadius: 12,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  historyList: {
    gap: 2,
  },
  historyRow: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  historyRowMain: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  historyName: {
    color: colors.textPrimary,
  },
  historyError: {
    color: colors.danger,
  },
  historyMeta: {
    color: colors.textMuted,
  },
  skeletonList: {
    gap: spacing.sm,
  },
  skeletonRow: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
    height: 40,
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
  danger: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
});

const badgeTextStyles = StyleSheet.create<Record<BadgeVariant, TextStyle>>({
  neutral: {
    color: colors.textSecondary,
  },
  success: {
    color: colors.success,
  },
  danger: {
    color: colors.danger,
  },
});

const statCardValueTone = StyleSheet.create<Record<'neutral' | 'success' | 'danger', TextStyle>>({
  neutral: {
    color: colors.textPrimary,
  },
  success: {
    color: colors.success,
  },
  danger: {
    color: colors.danger,
  },
});
