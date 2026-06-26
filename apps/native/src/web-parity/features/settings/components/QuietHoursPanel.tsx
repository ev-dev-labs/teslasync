// Native parity port of web/src/features/settings/components/QuietHoursPanel.tsx.
//
// The web module is the Quiet hours / Do-Not-Disturb settings panel: CRUD over
// /api/v1/notifications/quiet-hours (per-user; the caller's ForwardAuth subject
// is resolved server-side). Each row defines a local-time window (HH:MM start +
// end + IANA timezone), a weekday bitmask (Sun=1..Sat=64) and a list of
// severities that bypass the gate. A sibling AI advisor can seed the "Add
// window" form via the typed `seedDraft` prop; `onSeedConsumed` fires once the
// seed is copied into local form state.
//
// Native-safe substitutions (rule 5/7), documented in the parity sidecar:
//   • react-i18next useTranslation('settings') -> a local useTranslation() hook
//     whose t(key, fallback) returns the English fallback, preserving every
//     translation key verbatim at the call site (the native parity tree ships no
//     i18next runtime).
//   • @/components/feedback/Toast useToast() -> a local useToast() bridging
//     toast.success/error onto React Native's Alert.alert (the BackupRestorePage
//     / NotificationGroupRow precedent). `title` + `description` map to
//     Alert.alert(title, message). The Toast queue/duration have no RN analog.
//   • lucide-react Moon/Plus/Trash2/Pencil/X/Check -> SemanticIcon
//     moon/add/delete/pencil/close/confirm (native ships no SVG icon set; the
//     glyph box carries the visual intent). <IconBox color="purple"><Moon/></>
//     folds to a single <SemanticIcon name="moon"> (its violet tinted box is the
//     purple IconBox).
//   • @/components/ui GlassPanel -> the reused native GlassPanel.
//   • @/components/ui Button/Toggle/Badge/Select + @/components/feedback Spinner
//     -> inlined native Button (Pressable), Toggle (Pressable track/thumb), Badge
//     (View chip), Select (Pressable trigger + Modal option list — faithful to a
//     <select> dropdown and graceful for the long IANA timezone list), and
//     Spinner (ActivityIndicator).
//   • @/components/ui Input type="time" -> the already-ported native Input (a
//     <TextInput>) with an "HH:MM" placeholder + numeric-punctuation keyboard;
//     RN has no native time picker, so the HH:MM text field + the preserved
//     validateDraft() HHMM regex keep the same contract. web onChange={e=>
//     set(e.target.value)} becomes onChangeText={set}.
//   • @/components/feedback EmptyState -> the ported native EmptyState (icon +
//     message). @/components/motion FadeIn -> the ported native FadeIn (delay).
//   • Intl.DateTimeFormat().resolvedOptions().timeZone + Intl.supportedValuesOf
//     are used exactly as the source (both already guarded by try/catch +
//     typeof checks, so a Hermes build with partial Intl falls back to UTC + the
//     curated zone list, matching the web fallback path).
// Field access stays snake_case (the native request() camelCaseKeys keeps the
// original keys). No DOM elements, react-i18next, lucide-react, framer-motion,
// Recharts, Leaflet, react-dom, or web UI-kit modules are imported here.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {
  useQuietHours,
  useSaveQuietHours,
  useDeleteQuietHours,
  type QuietHoursWindow,
  type QuietHoursWindowInput,
} from '../../../api/hooks/useNotifications';
import { EmptyState } from '../../../components/feedback/EmptyState';
import { FadeIn } from '../../../components/motion/FadeIn';
import { Input } from '../../../components/ui/Input';
import { AppText } from '../../../../components/ui/AppText';
import { GlassPanel } from '../../../../components/ui/GlassPanel';
import { SemanticIcon } from '../../../../components/icons/SemanticIcon';
import { colors, spacing } from '../../../../theme/tokens';

/* ─── i18n fallback (web react-i18next useTranslation('settings')) ──────── */

type TFunc = (key: string, fallback: string) => string;

// Native stand-in for react-i18next's useTranslation: the parity bundle ships no
// i18n runtime, so `t` returns the English fallback while preserving every key
// at the call site. A stable useCallback identity keeps the hook honest.
function useTranslation(): { t: TFunc } {
  const t = useCallback<TFunc>((_key, fallback) => fallback, []);
  return { t };
}

/* ─── useToast (web @/components/feedback/Toast) ────────────────────────── */

interface ToastApi {
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
}

// Web toast queue -> native Alert.alert (the _toastHelpers / NotificationGroupRow
// precedent). Fired only from mutation onSuccess/onError handlers (user
// interaction), never at render. useMemo keeps the identity stable.
function useToast(): ToastApi {
  return useMemo<ToastApi>(
    () => ({
      success: (title, message) => Alert.alert(title, message),
      error: (title, message) => Alert.alert(title, message),
    }),
    [],
  );
}

/* ─── select option type (web @/components/ui SelectOption) ─────────────── */

interface SelectOption {
  value: string;
  label: string;
}

// Quiet hours / Do-Not-Disturb settings panel.
//
// CRUD over /api/v1/notifications/quiet-hours. Per-user; uses the
// caller's ForwardAuth subject server-side. Each row defines a local-
// time window (HH:MM start + end + IANA timezone), a weekday bitmask
// (Sun=1..Sat=64), and a list of severities that bypass the gate.

const SEVERITY_CHOICES: ReadonlyArray<{
  value: 'info' | 'warn' | 'critical';
  labelKey: string;
  fallback: string;
}> = [
  {
    value: 'critical',
    labelKey: 'quietHours.severity.critical',
    fallback: 'Critical',
  },
  { value: 'warn', labelKey: 'quietHours.severity.warn', fallback: 'Warning' },
  { value: 'info', labelKey: 'quietHours.severity.info', fallback: 'Info' },
];

// Weekday bit positions match models.QuietHoursWeekday* on the server:
// Sun=1<<0..Sat=1<<6. Order matches Date#getDay().
const WEEKDAYS: ReadonlyArray<{ bit: number; key: string; fallback: string }> =
  [
    { bit: 1 << 0, key: 'quietHours.weekday.sun', fallback: 'Sun' },
    { bit: 1 << 1, key: 'quietHours.weekday.mon', fallback: 'Mon' },
    { bit: 1 << 2, key: 'quietHours.weekday.tue', fallback: 'Tue' },
    { bit: 1 << 3, key: 'quietHours.weekday.wed', fallback: 'Wed' },
    { bit: 1 << 4, key: 'quietHours.weekday.thu', fallback: 'Thu' },
    { bit: 1 << 5, key: 'quietHours.weekday.fri', fallback: 'Fri' },
    { bit: 1 << 6, key: 'quietHours.weekday.sat', fallback: 'Sat' },
  ];

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
  // Intl.supportedValuesOf may not exist on older browsers / Hermes; fall back
  // to a small curated list plus the user's resolved timezone.
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
  return zones.map(z => ({ value: z, label: z }));
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
    return { ok: false, field: 'start_local', message: 'invalid' };
  }
  if (!HHMM.test(d.end_local)) {
    return { ok: false, field: 'end_local', message: 'invalid' };
  }
  if (d.start_local === d.end_local) {
    return { ok: false, field: 'end_local', message: 'equal' };
  }
  if (!d.timezone) {
    return { ok: false, field: 'timezone', message: 'required' };
  }
  if (d.weekdays <= 0 || d.weekdays > 127) {
    return { ok: false, field: 'weekdays', message: 'required' };
  }
  if (d.bypass_severities.length === 0) {
    // Allowed — empty bypass means everything is deferred during the
    // window. Still pass — server accepts empty array.
  }
  return { ok: true };
}

function summarizeWindow(w: QuietHoursWindow): string {
  return `${w.start_local} → ${w.end_local} (${w.timezone})`;
}

// formatNextChange returns a short human label for the next time the
// supplied window changes state ("starts at 23:00", "ends at 07:00"
// etc). Pure: caller passes `now` so test code can pin the clock.
export function nextWindowChangeLabel(
  w: QuietHoursWindow,
  now: Date,
): string | null {
  if (!w.enabled) {
    return null;
  }
  const today = now.getDay(); // 0=Sun..6=Sat
  const todayBit = 1 << today;
  const onToday = (w.weekdays & todayBit) !== 0;
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

function parseHHMM(s: string): number | null {
  if (!HHMM.test(s)) {
    return null;
  }
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

// QuietHoursPanelProps lets a sibling AI surface (the
// quiet-hours-suggestion advisor on QuietHoursPage) seed the
// "Add window" form with a typed draft via "Apply to form". The
// seed is applied imperatively when its identity changes — the
// panel always retains the user's manual control over the Save
// button and the canonical write path.
//
// `onSeedConsumed` is fired AFTER the seed has been copied into
// local form state so the parent can clear its own pending-seed
// pointer and keep the React data flow one-way (no infinite
// re-seeding loop).
export interface QuietHoursPanelProps {
  seedDraft?: QuietHoursWindowInput | null;
  onSeedConsumed?: () => void;
}

export function QuietHoursPanel(props: QuietHoursPanelProps = {}) {
  const { seedDraft, onSeedConsumed } = props;
  const { t } = useTranslation();
  const toast = useToast();
  const { data: rawWindows, isLoading } = useQuietHours();
  const save = useSaveQuietHours();
  const remove = useDeleteQuietHours();
  const windows = useMemo(() => rawWindows ?? [], [rawWindows]);

  const [draft, setDraft] = useState<DraftWindow | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Apply a seedDraft from the AI advisor exactly once per
  // identity. The "Apply to form" handler in
  // <AIQuietHoursSuggestion> forwards a typed
  // QuietHoursWindowInput through `seedDraft`; the panel copies
  // the typed scalars into local form state so the user can
  // tweak the proposed values and then press the canonical Save
  // button. The Save button is the sole write path; the AI
  // surface never persists state directly.
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
        timezone: t(
          'quietHours.error.timezoneRequired',
          'Timezone is required.',
        ),
        weekdays: t(
          'quietHours.error.weekdaysRequired',
          'Pick at least one weekday.',
        ),
        bypass_severities: t(
          'quietHours.error.bypassRequired',
          'Pick at least one severity.',
        ),
      };
      setValidationError(
        messages[v.field ?? 'start_local'] ?? messages.start_local,
      );
      return;
    }
    setValidationError(null);
    const payload: QuietHoursWindowInput & { id?: number } = {
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
    save.mutate(payload, {
      onSuccess: () => {
        toast.success(
          payload.id
            ? t('toast.quietHours.updated', 'Quiet hours window updated')
            : t('toast.quietHours.created', 'Quiet hours window created'),
        );
        cancel();
      },
      onError: (err: Error) => {
        toast.error(
          t('toast.quietHours.saveError', 'Failed to save quiet hours window'),
          err.message,
        );
      },
    });
  };

  const removeWindow = (w: QuietHoursWindow) => {
    remove.mutate(w.id, {
      onSuccess: () => {
        toast.success(
          t('toast.quietHours.deleted', 'Quiet hours window removed'),
        );
      },
      onError: (err: Error) => {
        toast.error(
          t(
            'toast.quietHours.deleteError',
            'Failed to delete quiet hours window',
          ),
          err.message,
        );
      },
    });
  };

  const toggleWeekday = (bit: number) => {
    if (!draft) {
      return;
    }
    setDraft({ ...draft, weekdays: draft.weekdays ^ bit });
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
    <FadeIn delay={0.135}>
      <GlassPanel style={styles.panel}>
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <SemanticIcon name="moon" size="md" decorative />
            <View style={styles.headerText}>
              <AppText style={styles.title}>
                {t('quietHours.title', 'Quiet hours / Do-Not-Disturb')}
              </AppText>
              <AppText style={styles.subtitle}>
                {t(
                  'quietHours.subtitle',
                  'Defer non-critical notifications during sleep, meetings, or other time-of-day windows.',
                )}
              </AppText>
            </View>
          </View>
          {!draft ? (
            <Button
              variant="primary"
              size="sm"
              icon={<SemanticIcon name="add" size="sm" decorative />}
              onPress={startCreate}
              testID="quiet-hours-add"
            >
              {t('quietHours.addWindow', 'Add window')}
            </Button>
          ) : null}
        </View>

        {isLoading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={colors.accent} />
            <AppText style={styles.mutedText}>
              {t('quietHours.loading', 'Loading quiet-hours windows…')}
            </AppText>
          </View>
        ) : windows.length === 0 && !draft ? (
          <EmptyState
            icon={<SemanticIcon name="moon" size="lg" decorative />}
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
                  style={styles.row}
                  testID={`quiet-hours-row-${w.id}`}
                >
                  <View style={styles.rowHeader}>
                    <View style={styles.rowHeaderLeft}>
                      <Badge variant={w.enabled ? 'success' : 'neutral'}>
                        {w.enabled
                          ? t('quietHours.enabled', 'Enabled')
                          : t('quietHours.disabled', 'Disabled')}
                      </Badge>
                      <AppText style={styles.rowTitle}>
                        {summarizeWindow(w)}
                      </AppText>
                      {nextLabel ? (
                        <AppText style={styles.mutedText}>{nextLabel}</AppText>
                      ) : null}
                    </View>
                    <View style={styles.rowActions}>
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={
                          <SemanticIcon name="pencil" size="sm" decorative />
                        }
                        onPress={() => startEdit(w)}
                      >
                        {t('quietHours.edit', 'Edit')}
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        icon={
                          <SemanticIcon name="delete" size="sm" decorative />
                        }
                        onPress={() => removeWindow(w)}
                        disabled={remove.isPending}
                      >
                        {t('quietHours.delete', 'Delete')}
                      </Button>
                    </View>
                  </View>
                  <View style={styles.chipWrap}>
                    {WEEKDAYS.map(({ bit, key, fallback }) => {
                      const on = (w.weekdays & bit) !== 0;
                      return (
                        <View
                          key={bit}
                          style={[
                            styles.dayPill,
                            on ? styles.dayPillOn : styles.dayPillOff,
                          ]}
                        >
                          <AppText
                            style={
                              on ? styles.dayPillTextOn : styles.dayPillTextOff
                            }
                          >
                            {t(key, fallback)}
                          </AppText>
                        </View>
                      );
                    })}
                  </View>
                  {w.bypass_severities.length > 0 ? (
                    <View style={styles.bypassRow}>
                      <AppText style={styles.mutedText}>
                        {t('quietHours.bypassLabel', 'Always allow:')}{' '}
                      </AppText>
                      {w.bypass_severities.map(s => (
                        <Badge
                          key={s}
                          variant="warning"
                          style={styles.bypassBadge}
                        >
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
          <View style={styles.form} testID="quiet-hours-form">
            <View style={styles.formHeader}>
              <AppText style={styles.formTitle}>
                {editingId
                  ? t('quietHours.form.editTitle', 'Edit window')
                  : t('quietHours.form.addTitle', 'New quiet-hours window')}
              </AppText>
              <Toggle
                checked={draft.enabled}
                onChange={v => setDraft({ ...draft, enabled: v })}
                label={t('quietHours.form.enabled', 'Enabled')}
              />
            </View>

            <View style={styles.formGrid}>
              <View style={styles.formCol}>
                <AppText style={styles.fieldLabel}>
                  {t('quietHours.form.start', 'Start')}
                </AppText>
                <Input
                  id="qh-start"
                  accessibilityLabel={t('quietHours.form.start', 'Start')}
                  placeholder="HH:MM"
                  keyboardType="numbers-and-punctuation"
                  autoCapitalize="none"
                  maxLength={5}
                  value={draft.start_local}
                  onChangeText={text =>
                    setDraft({ ...draft, start_local: text })
                  }
                />
              </View>
              <View style={styles.formCol}>
                <AppText style={styles.fieldLabel}>
                  {t('quietHours.form.end', 'End')}
                </AppText>
                <Input
                  id="qh-end"
                  accessibilityLabel={t('quietHours.form.end', 'End')}
                  placeholder="HH:MM"
                  keyboardType="numbers-and-punctuation"
                  autoCapitalize="none"
                  maxLength={5}
                  value={draft.end_local}
                  onChangeText={text => setDraft({ ...draft, end_local: text })}
                />
              </View>
            </View>

            <View>
              <AppText style={styles.fieldLabel}>
                {t('quietHours.form.timezone', 'Timezone (IANA)')}
              </AppText>
              <Select
                id="qh-tz"
                accessibilityLabel={t(
                  'quietHours.form.timezone',
                  'Timezone (IANA)',
                )}
                value={draft.timezone}
                onChange={value => setDraft({ ...draft, timezone: value })}
                options={tzOptions}
              />
            </View>

            <View>
              <AppText style={styles.fieldLabel}>
                {t('quietHours.form.weekdays', 'Weekdays')}
              </AppText>
              <View style={styles.chipWrap}>
                {WEEKDAYS.map(({ bit, key, fallback }) => {
                  const on = (draft.weekdays & bit) !== 0;
                  return (
                    <Pressable
                      key={bit}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      onPress={() => toggleWeekday(bit)}
                      testID={`qh-weekday-${bit}`}
                      style={({ pressed }) => [
                        styles.toggleChip,
                        on ? styles.toggleChipDayOn : styles.toggleChipOff,
                        pressed ? styles.chipPressed : null,
                      ]}
                    >
                      <AppText
                        style={
                          on
                            ? styles.toggleChipTextDayOn
                            : styles.toggleChipTextOff
                        }
                      >
                        {t(key, fallback)}
                      </AppText>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View>
              <AppText style={styles.fieldLabel}>
                {t(
                  'quietHours.form.bypass',
                  'Always allow these severities through',
                )}
              </AppText>
              <View style={styles.chipWrap}>
                {SEVERITY_CHOICES.map(({ value, labelKey, fallback }) => {
                  const on = draft.bypass_severities.includes(value);
                  return (
                    <Pressable
                      key={value}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      onPress={() => toggleSeverity(value)}
                      testID={`qh-severity-${value}`}
                      style={({ pressed }) => [
                        styles.toggleChip,
                        on ? styles.toggleChipSevOn : styles.toggleChipOff,
                        pressed ? styles.chipPressed : null,
                      ]}
                    >
                      <AppText
                        style={
                          on
                            ? styles.toggleChipTextSevOn
                            : styles.toggleChipTextOff
                        }
                      >
                        {t(labelKey, fallback)}
                      </AppText>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {validationError ? (
              <AppText
                accessibilityRole="alert"
                style={styles.errorText}
                testID="quiet-hours-error"
              >
                {validationError}
              </AppText>
            ) : null}

            <View style={styles.formFooter}>
              <Button
                variant="secondary"
                size="sm"
                icon={<SemanticIcon name="close" size="sm" decorative />}
                onPress={cancel}
              >
                {t('quietHours.form.cancel', 'Cancel')}
              </Button>
              <Button
                variant="primary"
                size="sm"
                icon={<SemanticIcon name="confirm" size="sm" decorative />}
                onPress={submit}
                disabled={save.isPending}
                testID="quiet-hours-save"
              >
                {editingId
                  ? t('quietHours.form.update', 'Update')
                  : t('quietHours.form.create', 'Create')}
              </Button>
            </View>
          </View>
        ) : null}
      </GlassPanel>
    </FadeIn>
  );
}

QuietHoursPanel.displayName = 'QuietHoursPanel';

/* ─── Inlined @/components/ui Button (DOM <button> -> Pressable) ────────── */

type ButtonVariant = 'primary' | 'secondary' | 'danger';

interface ButtonProps {
  variant?: ButtonVariant;
  /** Web cosmetic size; accepted for call-site parity, only `sm` is used here. */
  size?: 'sm' | 'md';
  icon?: ReactNode;
  disabled?: boolean;
  onPress?: () => void;
  testID?: string;
  children?: ReactNode;
}

const BUTTON_TONES: Record<
  ButtonVariant,
  { bg: string; border: string; text: string }
> = {
  primary: {
    bg: colors.accent,
    border: colors.accent,
    text: colors.background,
  },
  secondary: {
    bg: colors.surfaceRaised,
    border: colors.border,
    text: colors.textSecondary,
  },
  danger: { bg: colors.danger, border: colors.danger, text: colors.background },
};

function Button({
  variant = 'primary',
  icon,
  disabled,
  onPress,
  testID,
  children,
}: ButtonProps) {
  const tone = BUTTON_TONES[variant];
  const hasLabel = children != null && children !== false;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: tone.bg, borderColor: tone.border },
        disabled ? styles.btnDisabled : null,
        pressed && !disabled ? styles.btnPressed : null,
      ]}
    >
      {icon ? (
        <View style={hasLabel ? styles.btnIconWrap : null}>{icon}</View>
      ) : null}
      {hasLabel ? (
        <AppText
          style={[styles.btnText, { color: tone.text }]}
          weight="semibold"
        >
          {children}
        </AppText>
      ) : null}
    </Pressable>
  );
}

/* ─── Inlined @/components/ui Badge (DOM <span> -> View chip) ───────────── */

type BadgeVariant = 'success' | 'neutral' | 'warning';

interface BadgeProps {
  variant?: BadgeVariant;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}

const BADGE_TONES: Record<
  BadgeVariant,
  { bg: string; border: string; text: string }
> = {
  success: {
    bg: colors.successSurface,
    border: colors.successBorder,
    text: colors.success,
  },
  neutral: {
    bg: colors.surfaceRaised,
    border: colors.border,
    text: colors.textSecondary,
  },
  warning: {
    bg: colors.warningSurface,
    border: colors.warningBorder,
    text: colors.warning,
  },
};

function Badge({ variant = 'neutral', style, children }: BadgeProps) {
  const tone = BADGE_TONES[variant];
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: tone.bg, borderColor: tone.border },
        style,
      ]}
    >
      <AppText
        style={[styles.badgeText, { color: tone.text }]}
        weight="semibold"
      >
        {children}
      </AppText>
    </View>
  );
}

/* ─── Inlined @/components/ui Toggle (DOM switch -> Pressable track) ────── */

interface ToggleProps {
  label?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function Toggle({ label, checked, onChange }: ToggleProps) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      onPress={() => onChange(!checked)}
      style={styles.toggleRow}
    >
      <View style={[styles.toggleTrack, checked ? styles.toggleTrackOn : null]}>
        <View
          style={[styles.toggleThumb, checked ? styles.toggleThumbOn : null]}
        />
      </View>
      {label ? (
        <AppText style={styles.toggleLabel} tone="secondary">
          {label}
        </AppText>
      ) : null}
    </Pressable>
  );
}

/* ─── Inlined @/components/ui Select (DOM <select> -> Modal picker) ─────── */

interface SelectProps {
  id?: string;
  accessibilityLabel?: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
}

// RN ships no <select>; a Pressable trigger that opens a Modal scroll list
// faithfully reproduces the web dropdown contract (value/onChange/options) and
// stays usable for the long IANA timezone list. onChange receives the chosen
// option value, mirroring the web `e.target.value` payload.
function Select({
  id,
  accessibilityLabel,
  value,
  onChange,
  options,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find(o => o.value === value);
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        nativeID={id}
        onPress={() => setOpen(true)}
        testID={id}
        style={({ pressed }) => [
          styles.selectTrigger,
          pressed ? styles.chipPressed : null,
        ]}
      >
        <AppText style={styles.selectValue} numberOfLines={1}>
          {selected?.label ?? value}
        </AppText>
        <AppText style={styles.selectChevron}>{'\u2304'}</AppText>
      </Pressable>
      {open ? (
        <Modal
          animationType="fade"
          transparent
          visible={open}
          onRequestClose={() => setOpen(false)}
        >
          <Pressable
            accessibilityRole="button"
            style={styles.modalBackdrop}
            onPress={() => setOpen(false)}
          >
            <View style={styles.modalSheet}>
              <ScrollView style={styles.modalScroll}>
                {options.map(opt => {
                  const active = opt.value === value;
                  return (
                    <Pressable
                      key={opt.value}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      onPress={() => {
                        onChange(opt.value);
                        setOpen(false);
                      }}
                      style={({ pressed }) => [
                        styles.modalOption,
                        active ? styles.modalOptionActive : null,
                        pressed ? styles.modalOptionPressed : null,
                      ]}
                    >
                      <AppText
                        style={
                          active
                            ? styles.modalOptionTextActive
                            : styles.modalOptionText
                        }
                        weight={active ? 'semibold' : 'regular'}
                      >
                        {opt.label}
                      </AppText>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          </Pressable>
        </Modal>
      ) : null}
    </View>
  );
}

const VIOLET_SURFACE = 'rgba(167, 139, 250, 0.1)';
const VIOLET_SURFACE_STRONG = 'rgba(167, 139, 250, 0.15)';
const VIOLET_BORDER = 'rgba(167, 139, 250, 0.3)';
const VIOLET_BORDER_STRONG = 'rgba(167, 139, 250, 0.4)';
const WARNING_SURFACE_STRONG = 'rgba(251, 191, 36, 0.15)';
const WARNING_BORDER_STRONG = 'rgba(251, 191, 36, 0.4)';
const ROW_SURFACE = 'rgba(255, 255, 255, 0.02)';
const FORM_SURFACE = 'rgba(255, 255, 255, 0.03)';

const styles = StyleSheet.create({
  panel: {
    gap: spacing.lg,
    padding: spacing.lg + spacing.xs,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  headerLeft: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: spacing.md,
  },
  headerText: {
    flex: 1,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  loadingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  mutedText: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  list: {
    gap: spacing.md,
  },
  row: {
    backgroundColor: ROW_SURFACE,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  rowHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  rowHeaderLeft: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  rowTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 18,
  },
  rowActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  dayPill: {
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  dayPillOn: {
    backgroundColor: VIOLET_SURFACE,
    borderColor: VIOLET_BORDER,
  },
  dayPillOff: {
    backgroundColor: 'transparent',
    borderColor: colors.border,
  },
  dayPillTextOn: {
    color: colors.violet,
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 14,
  },
  dayPillTextOff: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 14,
  },
  bypassRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  bypassBadge: {
    marginLeft: spacing.xs,
  },
  form: {
    backgroundColor: FORM_SURFACE,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
  },
  formHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  formTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 18,
  },
  formGrid: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  formCol: {
    flex: 1,
  },
  fieldLabel: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
    marginBottom: spacing.xs,
  },
  toggleChip: {
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  toggleChipOff: {
    backgroundColor: 'transparent',
    borderColor: colors.border,
  },
  toggleChipDayOn: {
    backgroundColor: VIOLET_SURFACE_STRONG,
    borderColor: VIOLET_BORDER_STRONG,
  },
  toggleChipSevOn: {
    backgroundColor: WARNING_SURFACE_STRONG,
    borderColor: WARNING_BORDER_STRONG,
  },
  toggleChipTextOff: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
  },
  toggleChipTextDayOn: {
    color: colors.violet,
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
  },
  toggleChipTextSevOn: {
    color: colors.warning,
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
  },
  chipPressed: {
    opacity: 0.7,
  },
  errorText: {
    color: colors.danger,
    fontSize: 12,
    lineHeight: 16,
  },
  formFooter: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
    paddingTop: spacing.sm,
  },
  btn: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    minHeight: 32,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  btnPressed: {
    opacity: 0.85,
  },
  btnIconWrap: {
    marginRight: 6,
  },
  btnText: {
    fontSize: 12,
    lineHeight: 16,
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 12,
    lineHeight: 16,
  },
  toggleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  toggleTrack: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 999,
    height: 24,
    justifyContent: 'center',
    paddingHorizontal: 3,
    width: 44,
  },
  toggleTrackOn: {
    backgroundColor: colors.accentSoft,
  },
  toggleThumb: {
    backgroundColor: colors.textMuted,
    borderRadius: 999,
    height: 18,
    width: 18,
  },
  toggleThumbOn: {
    alignSelf: 'flex-end',
    backgroundColor: colors.accent,
  },
  toggleLabel: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 18,
  },
  selectTrigger: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  selectValue: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 14,
    lineHeight: 18,
  },
  selectChevron: {
    color: colors.textMuted,
    fontSize: 14,
    marginLeft: spacing.sm,
  },
  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalSheet: {
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    maxHeight: 360,
    overflow: 'hidden',
    width: '100%',
  },
  modalScroll: {
    flexGrow: 0,
  },
  modalOption: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  modalOptionActive: {
    backgroundColor: colors.surfaceSelected,
  },
  modalOptionPressed: {
    backgroundColor: colors.surfaceHover,
  },
  modalOptionText: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 18,
  },
  modalOptionTextActive: {
    color: colors.accent,
    fontSize: 14,
    lineHeight: 18,
  },
});
