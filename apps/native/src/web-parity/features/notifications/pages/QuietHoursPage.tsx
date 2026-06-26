// QuietHoursPage — native parity port of
// web/src/features/notifications/pages/QuietHoursPage.tsx.
//
// Server-backed quiet hours / Do-Not-Disturb schedule (web doc comment L1-3).
// The web page is a thin orchestrator: it owns the `pendingSeed` hand-off state
// machine and wraps <AIQuietHoursSuggestion> (the propose-only AI advisor) over
// <QuietHoursPanel> (the canonical CRUD form). Every page-level state name
// (pendingSeed, handleApplyDraft, handleSeedConsumed), the propose-only
// contract (ADR-015 §I8: the panel still owns the canonical Save button — the
// AI hand-off only pre-fills the form), the usePageTitle call, and both
// notifications.quietHours.* i18n keys + English fallbacks are preserved
// verbatim.
//
// QuietHoursPanel (web/src/features/settings/components/QuietHoursPanel.tsx) is
// not yet converted on its own, so — matching the self-contained-page
// precedent set by AlertRulesPage in this same directory — it is inline-ported
// here in full: the CRUD over the native useQuietHours/useSaveQuietHours/
// useDeleteQuietHours hooks (/notifications/quiet-hours), the HH:MM + timezone +
// weekday-bitmask + bypass-severity form, the validateDraft / makeDraft /
// listTimezones / summarizeWindow / nextWindowChangeLabel / parseHHMM pure
// helpers, the seedDraft "Apply to form" consume-once effect, and every
// quietHours.* / toast.quietHours.* i18n key + fallback are ported verbatim.
//
// Native adaptations vs. the web sources (behaviour / state / keys / API kept):
//   - react-i18next useTranslation (page L7, panel L2) -> a native-safe
//     t(key, fallback) shim returning the English fallback (no i18n runtime in
//     this RN layer); every key is preserved as the first argument.
//   - @/components/layout PageContainer + its `copyLink` prop (page L8/36-40) ->
//     an inline RN PageContainer (ScrollView header: title/subtitle + the
//     already-ported native <CopyLinkButton> for the copyLink affordance; with
//     no host url/clipboard bridge it renders the documented disabled
//     unavailable state — conversion rule 7).
//   - @/hooks usePageTitle (page L9) -> a native-safe no-op (RN has no
//     document.title); the call site + argument are preserved.
//   - @/features/settings/components/QuietHoursPanel (page L10) -> the inline
//     native QuietHoursPanel below.
//   - @/components/ai/AIQuietHoursSuggestion (page L11) -> the already-converted
//     native component (../../../components/ai/AIQuietHoursSuggestion), wired by
//     onApplyDraft exactly as the web page wires it.
//   - panel @/components/ui GlassPanel/IconBox/Button/Toggle/Badge/Input/Select
//     -> canonical native GlassPanel + a violet SemanticIcon "moon" header chip
//     + an inline native PanelButton (primary/secondary/danger, decorative
//     SemanticIcon glyph + label) + a native Switch FieldToggle + an inline
//     native Badge(success/neutral/warning) + a native TextInput TimeInput
//     (HH:MM; RN has no <input type="time">, validateDraft's HHMM regex is the
//     gate) + the already-ported native <Select> (web-parity ui/Select).
//   - panel @/components/feedback Spinner/EmptyState (panel L14) -> an
//     ActivityIndicator loading row + an inline native EmptyState (SemanticIcon
//     "moon" + message).
//   - panel @/components/motion FadeIn (panel L15, framer-motion) -> an inline
//     reduced-motion-aware Animated FadeIn (delay 0.135s -> 135ms).
//   - panel @/components/feedback/Toast useToast (panel L16) -> the native
//     useSaveQuietHours/useDeleteQuietHours hooks already emit the equivalent
//     toast.quietHours.save.*/delete.* toasts via their built-in
//     useMutationToast (a native-architecture invariant), so the panel's own
//     toast.success/error calls (panel L284-292, L300-304) are subsumed; the
//     only retained call-site side effect is cancel() on save success. The web
//     fallback strings are preserved in the sidecar for coverage.
//   - lucide Moon/Plus/Trash2/Pencil/X/Check (panel L3) -> SemanticIcon
//     moon/add/delete/edit/close/confirm glyphs.
//   - the web HTML <ul>/<li>/<label>/<button>/<span> map to RN View/Pressable/
//     AppText; weekday + severity toggles become accessible Pressable chips
//     (accessibilityState.selected mirrors the web aria-pressed).
//
// No DOM / react-router / react-i18next / lucide / Recharts / Leaflet /
// framer-motion / old-web-UI import reaches this native output — only react,
// react-native primitives, the canonical AppText/GlassPanel/SemanticIcon +
// theme tokens, the native Select/CopyLinkButton/AIQuietHoursSuggestion ports,
// and the native notifications hooks + QuietHoursWindow(Input) types.

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
  Switch,
  TextInput,
  type TextStyle,
  View,
  type ViewStyle,
} from 'react-native';

import {
  SemanticIcon,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {
  useDeleteQuietHours,
  useQuietHours,
  useSaveQuietHours,
  type QuietHoursSavePayload,
  type QuietHoursWindow,
} from '../../../api/hooks/useNotifications';
import type {QuietHoursWindowInput} from '../../../api/types';
import {AIQuietHoursSuggestion} from '../../../components/ai/AIQuietHoursSuggestion';
import {CopyLinkButton} from '../../../components/layout/CopyLinkButton';
import {Select, type SelectOption} from '../../../components/ui/Select';

// ─── Native-safe i18n fallback (web react-i18next useTranslation) ─────────────

type TFunction = (key: string, fallback: string) => string;

function useT(): TFunction {
  return useCallback((_key, fallback) => fallback, []);
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

// ─── Constants (panel L31-50, ported verbatim) ───────────────────────────────

const SEVERITY_CHOICES: ReadonlyArray<{
  value: 'info' | 'warn' | 'critical';
  labelKey: string;
  fallback: string;
}> = [
  {value: 'critical', labelKey: 'quietHours.severity.critical', fallback: 'Critical'},
  {value: 'warn', labelKey: 'quietHours.severity.warn', fallback: 'Warning'},
  {value: 'info', labelKey: 'quietHours.severity.info', fallback: 'Info'},
];

// Weekday bit positions match models.QuietHoursWeekday* on the server:
// Sun=1<<0..Sat=1<<6. Order matches Date#getDay().
/* eslint-disable no-bitwise -- weekday bitmask mirrors models.QuietHoursWeekday* (Sun=1<<0..Sat=1<<6) */
const WEEKDAYS: ReadonlyArray<{bit: number; key: string; fallback: string}> = [
  {bit: 1 << 0, key: 'quietHours.weekday.sun', fallback: 'Sun'},
  {bit: 1 << 1, key: 'quietHours.weekday.mon', fallback: 'Mon'},
  {bit: 1 << 2, key: 'quietHours.weekday.tue', fallback: 'Tue'},
  {bit: 1 << 3, key: 'quietHours.weekday.wed', fallback: 'Wed'},
  {bit: 1 << 4, key: 'quietHours.weekday.thu', fallback: 'Thu'},
  {bit: 1 << 5, key: 'quietHours.weekday.fri', fallback: 'Fri'},
  {bit: 1 << 6, key: 'quietHours.weekday.sat', fallback: 'Sat'},
];

function hasWeekday(weekdays: number, bit: number): boolean {
  return (weekdays & bit) !== 0;
}

function toggleWeekdayBit(weekdays: number, bit: number): number {
  return weekdays ^ bit;
}
/* eslint-enable no-bitwise */

const DEFAULT_BYPASS = ['critical'];
const ALL_WEEKDAYS = 127;

interface DraftWindow {
  id?: number;
  enabled: boolean;
  start_local: string;
  end_local: string;
  timezone: string;
  weekdays: number;
  bypass_severities: string[];
}

function makeDraft(initial?: QuietHoursWindow): DraftWindow {
  if (initial) {
    return {
      id: initial.id,
      enabled: initial.enabled,
      start_local: initial.start_local,
      end_local: initial.end_local,
      timezone: initial.timezone,
      weekdays: initial.weekdays,
      bypass_severities: initial.bypass_severities ?? [],
    };
  }
  let tz = 'UTC';
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    tz = 'UTC';
  }
  return {
    enabled: true,
    start_local: '23:00',
    end_local: '07:00',
    timezone: tz,
    weekdays: ALL_WEEKDAYS,
    bypass_severities: [...DEFAULT_BYPASS],
  };
}

function listTimezones(currentTz: string): SelectOption[] {
  // Intl.supportedValuesOf may not exist on older runtimes; fall back to a
  // small curated list plus the user's resolved timezone.
  const fallback = [
    'UTC',
    'Europe/London',
    'Europe/Paris',
    'Europe/Berlin',
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'Asia/Tokyo',
    'Asia/Shanghai',
    'Asia/Kolkata',
    'Australia/Sydney',
  ];
  let zones: string[] = fallback;
  const intlAny = Intl as unknown as {
    supportedValuesOf?: (key: string) => string[];
  };
  if (typeof intlAny.supportedValuesOf === 'function') {
    try {
      zones = intlAny.supportedValuesOf('timeZone');
    } catch {
      zones = fallback;
    }
  }
  if (currentTz && !zones.includes(currentTz)) {
    zones = [currentTz, ...zones];
  }
  return zones.map(z => ({value: z, label: z}));
}

interface ValidationResult {
  ok: boolean;
  message?: string;
  field?:
    | 'start_local'
    | 'end_local'
    | 'timezone'
    | 'weekdays'
    | 'bypass_severities';
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function validateDraft(d: DraftWindow): ValidationResult {
  if (!HHMM.test(d.start_local)) {
    return {ok: false, field: 'start_local', message: 'invalid'};
  }
  if (!HHMM.test(d.end_local)) {
    return {ok: false, field: 'end_local', message: 'invalid'};
  }
  if (d.start_local === d.end_local) {
    return {ok: false, field: 'end_local', message: 'equal'};
  }
  if (!d.timezone) {
    return {ok: false, field: 'timezone', message: 'required'};
  }
  if (d.weekdays <= 0 || d.weekdays > 127) {
    return {ok: false, field: 'weekdays', message: 'required'};
  }
  // Empty bypass is allowed — everything is deferred during the window. The
  // server accepts an empty array, so this passes.
  return {ok: true};
}

function summarizeWindow(w: QuietHoursWindow): string {
  return `${w.start_local} → ${w.end_local} (${w.timezone})`;
}

function parseHHMM(s: string): number | null {
  if (!HHMM.test(s)) {
    return null;
  }
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

// nextWindowChangeLabel returns a short human label for the next time the
// supplied window changes state ("starts at 23:00", "ends at 07:00" etc). Pure:
// the caller passes `now` so test code can pin the clock. Exported to mirror the
// web QuietHoursPanel's named export.
export function nextWindowChangeLabel(
  w: QuietHoursWindow,
  now: Date,
): string | null {
  if (!w.enabled) {
    return null;
  }
  const today = now.getDay(); // 0=Sun..6=Sat
  // eslint-disable-next-line no-bitwise -- weekday bit position for today (Sun=1<<0..Sat=1<<6)
  const todayBit = 1 << today;
  const onToday = hasWeekday(w.weekdays, todayBit);
  if (!onToday) {
    return null;
  }
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const start = parseHHMM(w.start_local);
  const end = parseHHMM(w.end_local);
  if (start == null || end == null) {
    return null;
  }
  const wraps = end <= start;
  if (wraps) {
    if (minutesNow < end) {
      return `ends at ${w.end_local}`;
    }
    if (minutesNow >= start) {
      return `ends tomorrow at ${w.end_local}`;
    }
    return `starts at ${w.start_local}`;
  }
  if (minutesNow < start) {
    return `starts at ${w.start_local}`;
  }
  if (minutesNow < end) {
    return `ends at ${w.end_local}`;
  }
  return `starts tomorrow at ${w.start_local}`;
}

// ─── Inline FadeIn (web @/components/motion FadeIn — framer-motion) ────────────

function FadeIn({
  children,
  delay = 0,
}: {
  children: ReactNode;
  delay?: number;
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
          delay,
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
  }, [delay, progress]);

  return (
    <Animated.View
      style={{
        opacity: progress,
        transform: [
          {
            translateY: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [10, 0],
            }),
          },
        ],
      }}>
      {children}
    </Animated.View>
  );
}

// ─── Inline Badge (web @/components/ui Badge) ─────────────────────────────────

type BadgeTone = 'success' | 'neutral' | 'warning';

function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: BadgeTone;
}): React.ReactElement {
  return (
    <View style={[styles.badge, badgeToneStyles[tone]]}>
      <AppText style={badgeTextStyles[tone]} variant="caption" weight="semibold">
        {children}
      </AppText>
    </View>
  );
}

// ─── Inline PanelButton (web @/components/ui Button variants) ──────────────────

type PanelButtonVariant = 'primary' | 'secondary' | 'danger';

function PanelButton({
  label,
  icon,
  onPress,
  variant = 'secondary',
  disabled = false,
  testID,
}: {
  label: string;
  icon: SemanticIconName;
  onPress: () => void;
  variant?: PanelButtonVariant;
  disabled?: boolean;
  testID?: string;
}): React.ReactElement {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{disabled}}
      disabled={disabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.panelButton,
        panelButtonVariantStyles[variant],
        disabled && styles.panelButtonDisabled,
        pressed && !disabled && styles.panelButtonPressed,
      ]}
      testID={testID}>
      <SemanticIcon decorative name={icon} size="sm" />
      <AppText
        style={panelButtonTextStyles[variant]}
        variant="caption"
        weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

// ─── Inline ToggleChip (web weekday / severity <button aria-pressed>) ──────────

function ToggleChip({
  label,
  on,
  onPress,
  tone,
  testID,
}: {
  label: string;
  on: boolean;
  onPress: () => void;
  tone: 'violet' | 'amber';
  testID?: string;
}): React.ReactElement {
  const onStyle = tone === 'violet' ? styles.chipVioletOn : styles.chipAmberOn;
  const onTextStyle =
    tone === 'violet' ? styles.chipVioletText : styles.chipAmberText;
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{selected: on}}
      onPress={onPress}
      style={({pressed}) => [
        styles.chip,
        on ? onStyle : styles.chipOff,
        pressed && styles.panelButtonPressed,
      ]}
      testID={testID}>
      <AppText
        style={on ? onTextStyle : styles.chipOffText}
        variant="caption"
        weight={on ? 'semibold' : 'regular'}>
        {label}
      </AppText>
    </Pressable>
  );
}

// ─── Inline EmptyState (web @/components/feedback EmptyState) ──────────────────

function EmptyState({message}: {message: string}): React.ReactElement {
  return (
    <View accessibilityRole="summary" style={styles.emptyState}>
      <SemanticIcon decorative name="moon" size="lg" />
      <AppText style={styles.emptyText} tone="muted" variant="caption">
        {message}
      </AppText>
    </View>
  );
}

// ─── Inline QuietHoursPanel (web settings/components/QuietHoursPanel.tsx) ──────

interface QuietHoursPanelProps {
  seedDraft?: QuietHoursWindowInput | null;
  onSeedConsumed?: () => void;
}

function QuietHoursPanel({
  seedDraft,
  onSeedConsumed,
}: QuietHoursPanelProps): React.ReactElement {
  const t = useT();
  const {data: rawWindows, isLoading} = useQuietHours();
  const save = useSaveQuietHours();
  const remove = useDeleteQuietHours();
  const windows = useMemo(() => rawWindows ?? [], [rawWindows]);

  const [draft, setDraft] = useState<DraftWindow | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Apply a seedDraft from the AI advisor exactly once per identity. The "Apply
  // to form" handler in <AIQuietHoursSuggestion> forwards a typed
  // QuietHoursWindowInput; the panel copies the typed scalars into local form
  // state so the user can tweak the proposed values and then press the canonical
  // Save button. The Save button is the sole write path; the AI surface never
  // persists state directly.
  const lastConsumedSeed = useRef<QuietHoursWindowInput | null>(null);
  useEffect(() => {
    if (!seedDraft) {
      return;
    }
    if (lastConsumedSeed.current === seedDraft) {
      return;
    }
    lastConsumedSeed.current = seedDraft;
    setEditingId(null);
    const base = makeDraft();
    setDraft({
      enabled: seedDraft.enabled ?? true,
      start_local: seedDraft.start_local ?? base.start_local,
      end_local: seedDraft.end_local ?? base.end_local,
      timezone: seedDraft.timezone ?? base.timezone,
      weekdays: seedDraft.weekdays ?? ALL_WEEKDAYS,
      bypass_severities: [...(seedDraft.bypass_severities ?? DEFAULT_BYPASS)],
    });
    setValidationError(null);
    onSeedConsumed?.();
  }, [seedDraft, onSeedConsumed]);

  const tzOptions = useMemo(
    () => listTimezones(draft?.timezone ?? 'UTC'),
    [draft?.timezone],
  );

  const startEdit = (w: QuietHoursWindow) => {
    setEditingId(w.id);
    setDraft(makeDraft(w));
    setValidationError(null);
  };

  const startCreate = () => {
    setEditingId(null);
    setDraft(makeDraft());
    setValidationError(null);
  };

  const cancel = () => {
    setDraft(null);
    setEditingId(null);
    setValidationError(null);
  };

  const submit = () => {
    if (!draft) {
      return;
    }
    const v = validateDraft(draft);
    if (!v.ok) {
      const messages: Record<string, string> = {
        start_local: t(
          'quietHours.error.startInvalid',
          'Start must be HH:MM (24-hour).',
        ),
        end_local:
          v.message === 'equal'
            ? t('quietHours.error.endEqual', 'End must differ from start.')
            : t('quietHours.error.endInvalid', 'End must be HH:MM (24-hour).'),
        timezone: t('quietHours.error.timezoneRequired', 'Timezone is required.'),
        weekdays: t(
          'quietHours.error.weekdaysRequired',
          'Pick at least one weekday.',
        ),
        bypass_severities: t(
          'quietHours.error.bypassRequired',
          'Pick at least one severity.',
        ),
      };
      setValidationError(messages[v.field ?? 'start_local'] ?? messages.start_local);
      return;
    }
    setValidationError(null);
    const payload: QuietHoursSavePayload = {
      enabled: draft.enabled,
      start_local: draft.start_local,
      end_local: draft.end_local,
      timezone: draft.timezone,
      weekdays: draft.weekdays,
      bypass_severities: draft.bypass_severities,
    };
    if (draft.id) {
      payload.id = draft.id;
    }
    // The native useSaveQuietHours hook emits the toast.quietHours.save.*
    // toast + cache invalidation via its built-in useMutationToast; the only
    // call-site side effect the web panel adds on success is closing the form.
    save.mutate(payload, {
      onSuccess: () => {
        cancel();
      },
    });
  };

  const removeWindow = (w: QuietHoursWindow) => {
    // The native useDeleteQuietHours hook emits the toast.quietHours.delete.*
    // toast + invalidation internally.
    remove.mutate(w.id);
  };

  const toggleWeekday = (bit: number) => {
    if (!draft) {
      return;
    }
    setDraft({...draft, weekdays: toggleWeekdayBit(draft.weekdays, bit)});
  };

  const toggleSeverity = (sev: string) => {
    if (!draft) {
      return;
    }
    const has = draft.bypass_severities.includes(sev);
    setDraft({
      ...draft,
      bypass_severities: has
        ? draft.bypass_severities.filter(s => s !== sev)
        : [...draft.bypass_severities, sev],
    });
  };

  const now = new Date();

  return (
    <FadeIn delay={135}>
      <GlassPanel style={styles.panel}>
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <SemanticIcon decorative name="moon" size="md" />
            <View style={styles.headerText}>
              <AppText weight="semibold">
                {t('quietHours.title', 'Quiet hours / Do-Not-Disturb')}
              </AppText>
              <AppText tone="muted" variant="caption">
                {t(
                  'quietHours.subtitle',
                  'Defer non-critical notifications during sleep, meetings, or other time-of-day windows.',
                )}
              </AppText>
            </View>
          </View>
          {!draft ? (
            <PanelButton
              icon="add"
              label={t('quietHours.addWindow', 'Add window')}
              onPress={startCreate}
              testID="quiet-hours-add"
              variant="primary"
            />
          ) : null}
        </View>

        {isLoading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.accent} size="small" />
            <AppText tone="muted" variant="caption">
              {t('quietHours.loading', 'Loading quiet-hours windows…')}
            </AppText>
          </View>
        ) : windows.length === 0 && !draft ? (
          <EmptyState
            message={t(
              'quietHours.empty',
              'No quiet-hours windows yet. Add one to defer non-critical notifications during sleep or meetings.',
            )}
          />
        ) : (
          <View style={styles.list} testID="quiet-hours-list">
            {windows.map(w => {
              const nextLabel = nextWindowChangeLabel(w, now);
              return (
                <View
                  key={w.id}
                  style={styles.rowCard}
                  testID={`quiet-hours-row-${w.id}`}>
                  <View style={styles.rowHeader}>
                    <View style={styles.rowMeta}>
                      <Badge tone={w.enabled ? 'success' : 'neutral'}>
                        {w.enabled
                          ? t('quietHours.enabled', 'Enabled')
                          : t('quietHours.disabled', 'Disabled')}
                      </Badge>
                      <AppText variant="caption" weight="semibold">
                        {summarizeWindow(w)}
                      </AppText>
                      {nextLabel ? (
                        <AppText tone="muted" variant="caption">
                          {nextLabel}
                        </AppText>
                      ) : null}
                    </View>
                    <View style={styles.rowActions}>
                      <PanelButton
                        icon="edit"
                        label={t('quietHours.edit', 'Edit')}
                        onPress={() => startEdit(w)}
                        variant="secondary"
                      />
                      <PanelButton
                        disabled={remove.isPending}
                        icon="delete"
                        label={t('quietHours.delete', 'Delete')}
                        onPress={() => removeWindow(w)}
                        variant="danger"
                      />
                    </View>
                  </View>
                  <View style={styles.wrapRow}>
                    {WEEKDAYS.map(({bit, key, fallback}) => {
                      const on = hasWeekday(w.weekdays, bit);
                      return (
                        <View
                          key={bit}
                          style={[styles.tag, on ? styles.tagOn : styles.tagOff]}>
                          <AppText
                            style={on ? styles.tagOnText : styles.tagOffText}
                            variant="caption"
                            weight={on ? 'semibold' : 'regular'}>
                            {t(key, fallback)}
                          </AppText>
                        </View>
                      );
                    })}
                  </View>
                  {w.bypass_severities.length > 0 ? (
                    <View style={styles.bypassRow}>
                      <AppText tone="muted" variant="caption">
                        {t('quietHours.bypassLabel', 'Always allow:')}
                      </AppText>
                      {w.bypass_severities.map(s => (
                        <Badge key={s} tone="warning">
                          {s}
                        </Badge>
                      ))}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        )}

        {draft ? (
          <View style={styles.formCard} testID="quiet-hours-form">
            <View style={styles.formHeaderRow}>
              <AppText weight="semibold">
                {editingId
                  ? t('quietHours.form.editTitle', 'Edit window')
                  : t('quietHours.form.addTitle', 'New quiet-hours window')}
              </AppText>
              <View style={styles.toggleRow}>
                <Switch
                  accessibilityLabel={t('quietHours.form.enabled', 'Enabled')}
                  onValueChange={value => setDraft({...draft, enabled: value})}
                  thumbColor={draft.enabled ? colors.accent : undefined}
                  trackColor={{false: colors.border, true: colors.accentSoft}}
                  value={draft.enabled}
                />
                <AppText variant="caption" weight="semibold">
                  {t('quietHours.form.enabled', 'Enabled')}
                </AppText>
              </View>
            </View>

            <View style={styles.gridRow}>
              <View style={styles.gridCol}>
                <AppText style={styles.fieldLabel} tone="muted" variant="caption">
                  {t('quietHours.form.start', 'Start')}
                </AppText>
                <TextInput
                  accessibilityLabel={t('quietHours.form.start', 'Start')}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="numbers-and-punctuation"
                  maxLength={5}
                  onChangeText={text => setDraft({...draft, start_local: text})}
                  placeholder="HH:MM"
                  placeholderTextColor={colors.textMuted}
                  style={styles.input}
                  value={draft.start_local}
                />
              </View>
              <View style={styles.gridCol}>
                <AppText style={styles.fieldLabel} tone="muted" variant="caption">
                  {t('quietHours.form.end', 'End')}
                </AppText>
                <TextInput
                  accessibilityLabel={t('quietHours.form.end', 'End')}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="numbers-and-punctuation"
                  maxLength={5}
                  onChangeText={text => setDraft({...draft, end_local: text})}
                  placeholder="HH:MM"
                  placeholderTextColor={colors.textMuted}
                  style={styles.input}
                  value={draft.end_local}
                />
              </View>
            </View>

            <View>
              <AppText style={styles.fieldLabel} tone="muted" variant="caption">
                {t('quietHours.form.timezone', 'Timezone (IANA)')}
              </AppText>
              <Select
                onValueChange={tz => setDraft({...draft, timezone: tz})}
                options={tzOptions}
                value={draft.timezone}
              />
            </View>

            <View>
              <AppText style={styles.sectionLabel} tone="muted" variant="caption">
                {t('quietHours.form.weekdays', 'Weekdays')}
              </AppText>
              <View style={styles.wrapRow}>
                {WEEKDAYS.map(({bit, key, fallback}) => (
                  <ToggleChip
                    key={bit}
                    label={t(key, fallback)}
                    on={hasWeekday(draft.weekdays, bit)}
                    onPress={() => toggleWeekday(bit)}
                    testID={`qh-weekday-${bit}`}
                    tone="violet"
                  />
                ))}
              </View>
            </View>

            <View>
              <AppText style={styles.sectionLabel} tone="muted" variant="caption">
                {t(
                  'quietHours.form.bypass',
                  'Always allow these severities through',
                )}
              </AppText>
              <View style={styles.wrapRow}>
                {SEVERITY_CHOICES.map(({value, labelKey, fallback}) => (
                  <ToggleChip
                    key={value}
                    label={t(labelKey, fallback)}
                    on={draft.bypass_severities.includes(value)}
                    onPress={() => toggleSeverity(value)}
                    testID={`qh-severity-${value}`}
                    tone="amber"
                  />
                ))}
              </View>
            </View>

            {validationError ? (
              <AppText
                accessibilityRole="alert"
                style={styles.validationText}
                testID="quiet-hours-error"
                variant="caption">
                {validationError}
              </AppText>
            ) : null}

            <View style={styles.formActions}>
              <PanelButton
                icon="close"
                label={t('quietHours.form.cancel', 'Cancel')}
                onPress={cancel}
                variant="secondary"
              />
              <PanelButton
                disabled={save.isPending}
                icon="confirm"
                label={
                  editingId
                    ? t('quietHours.form.update', 'Update')
                    : t('quietHours.form.create', 'Create')
                }
                onPress={submit}
                testID="quiet-hours-save"
                variant="primary"
              />
            </View>
          </View>
        ) : null}
      </GlassPanel>
    </FadeIn>
  );
}

// ─── Inline PageContainer (web @/components/layout PageContainer) ──────────────

function PageContainer({
  title,
  subtitle,
  copyLink,
  children,
}: {
  title: string;
  subtitle?: string;
  copyLink?: boolean;
  children: ReactNode;
}): React.ReactElement {
  return (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      style={styles.scroll}>
      <View style={styles.pageHeader}>
        <View style={styles.pageHeaderRow}>
          <AppText style={styles.pageTitle} variant="display" weight="bold">
            {title}
          </AppText>
          {copyLink ? <CopyLinkButton /> : null}
        </View>
        {subtitle ? (
          <AppText style={styles.pageSubtitle} tone="muted" variant="caption">
            {subtitle}
          </AppText>
        ) : null}
      </View>
      <View style={styles.pageBody}>{children}</View>
    </ScrollView>
  );
}

// ─── Page (web L14-48) ────────────────────────────────────────────────────────

/**
 * QuietHoursPage — server-backed quiet hours / Do-Not-Disturb schedule.
 *
 * Owns the `pendingSeed` hand-off between the AI advisor's "Apply to form"
 * action and the canonical QuietHoursPanel form: handleApplyDraft stores the
 * proposed typed window, the panel consumes it once via an identity-change
 * effect and fires onSeedConsumed, which clears it back to null so the panel
 * does not re-seed on subsequent renders. The propose-only contract means the
 * panel still owns the canonical Save button — this hand-off only pre-fills the
 * form fields.
 */
export default function QuietHoursPage(): React.ReactElement {
  const t = useT();
  usePageTitle(t('notifications.quietHours.title', 'Quiet hours'));

  const [pendingSeed, setPendingSeed] = useState<QuietHoursWindowInput | null>(
    null,
  );
  const handleApplyDraft = useCallback((patch: QuietHoursWindowInput) => {
    setPendingSeed(patch);
  }, []);
  const handleSeedConsumed = useCallback(() => {
    setPendingSeed(null);
  }, []);

  return (
    <PageContainer
      copyLink
      subtitle={t(
        'notifications.quietHours.subtitle',
        'Suppress non-critical notifications during a configurable window.',
      )}
      title={t('notifications.quietHours.title', 'Quiet hours')}>
      <AIQuietHoursSuggestion onApplyDraft={handleApplyDraft} />
      <QuietHoursPanel
        onSeedConsumed={handleSeedConsumed}
        seedDraft={pendingSeed}
      />
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
  bypassRow: {
    alignItems: 'center',
    columnGap: spacing.xs,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.xs,
  },
  chip: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  chipAmberOn: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
  chipAmberText: {
    color: colors.warning,
  },
  chipOff: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  chipOffText: {
    color: colors.textSecondary,
  },
  chipVioletOn: {
    backgroundColor: colors.violetSurface,
    borderColor: colors.violetBorder,
  },
  chipVioletText: {
    color: colors.violet,
  },
  emptyState: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  emptyText: {
    maxWidth: 360,
    textAlign: 'center',
  },
  fieldLabel: {
    marginBottom: spacing.xs,
  },
  formActions: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
    paddingTop: spacing.sm,
  },
  formCard: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
  },
  formHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  gridCol: {
    flex: 1,
  },
  gridRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  headerLeft: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    color: colors.textPrimary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  list: {
    gap: spacing.md,
  },
  loadingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  pageBody: {
    gap: spacing.lg,
  },
  pageHeader: {
    gap: spacing.xs,
    marginBottom: spacing.lg,
  },
  pageHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  pageSubtitle: {
    maxWidth: 520,
  },
  pageTitle: {
    color: colors.textPrimary,
  },
  panel: {
    gap: spacing.lg,
    overflow: 'hidden',
    padding: spacing.lg,
  },
  panelButton: {
    alignItems: 'center',
    borderRadius: 10,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  panelButtonDisabled: {
    opacity: 0.5,
  },
  panelButtonPressed: {
    opacity: 0.8,
  },
  rowActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  rowCard: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  rowHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  rowMeta: {
    alignItems: 'center',
    columnGap: spacing.sm,
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.xs,
  },
  scroll: {
    backgroundColor: colors.background,
  },
  scrollContent: {
    padding: spacing.lg,
  },
  sectionLabel: {
    marginBottom: spacing.sm,
  },
  tag: {
    alignItems: 'center',
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  tagOff: {
    borderColor: colors.border,
  },
  tagOffText: {
    color: colors.textMuted,
  },
  tagOn: {
    backgroundColor: colors.violetSurface,
    borderColor: colors.violetBorder,
  },
  tagOnText: {
    color: colors.violet,
  },
  toggleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  validationText: {
    color: colors.danger,
  },
  wrapRow: {
    columnGap: spacing.xs,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.xs,
  },
});

const badgeToneStyles = StyleSheet.create<Record<BadgeTone, ViewStyle>>({
  neutral: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
  success: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  warning: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
});

const badgeTextStyles: Record<BadgeTone, TextStyle> = {
  neutral: {color: colors.textSecondary},
  success: {color: colors.success},
  warning: {color: colors.warning},
};

const panelButtonVariantStyles = StyleSheet.create<
  Record<PanelButtonVariant, ViewStyle>
>({
  danger: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderWidth: 1,
  },
  primary: {
    backgroundColor: colors.accent,
  },
  secondary: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderWidth: 1,
  },
});

const panelButtonTextStyles: Record<PanelButtonVariant, TextStyle> = {
  danger: {color: colors.danger},
  primary: {color: colors.background},
  secondary: {color: colors.textPrimary},
};
