// Native parity port of
// web/src/features/system/components/status/ScheduledMaintenanceCard.tsx.
//
// `ScheduledMaintenanceCard` surfaces upcoming + active maintenance windows on
// the system-status surface and lets the operator schedule a new one inline. It
// reads `GET /admin/maintenance` (mode + message + until) and writes
// `POST /admin/maintenance` (set / clear). Every behavioural detail of the web
// source is preserved 1:1:
//   - state names: showSchedule / whenLocal / duration / message, plus the
//     useId-derived startId / durationId field ids.
//   - derivations: `isActive = state?.mode === 'maintenance'`, the memoised
//     `untilTs` (Date.parse or null) + `minutesToStart`, the `within24h`
//     pre-banner guard, and the same ring colour ladder
//     (within24h amber -> active blue -> idle white).
//   - handlers: handleSchedule's empty/invalid guards, the
//     `Math.max(5, Number(duration) || 60)` clamp, the endMs ISO `until`, the
//     default `Scheduled maintenance \u00b7 ends \u2026` message, the
//     showSchedule/whenLocal/message reset (duration is intentionally NOT reset,
//     matching the source), and handleClear's `{mode:'ok', message:'', until:null}`.
//
// Browser-only / not-yet-ported dependencies are replaced with native-safe
// equivalents per conversion rules 4/5/6/7 and recorded in the sidecar:
//   - react `FormEvent` (the `<form onSubmit>` type) has no native analog — the
//     React Native control flow has no DOM form submit, so handleSchedule loses
//     its event param and the web `e.preventDefault()` is dropped; the submit
//     Button's `onPress` drives it instead (the CommandConfirmDialog precedent).
//   - lucide-react `CalendarClock` / `AlertTriangle` / `X` SVGs (react-native-svg
//     is not a dependency) -> decorative AppText glyphs flagged
//     accessibilityElementsHidden because adjacent text carries the meaning:
//     CalendarClock -> "\uD83D\uDDD3\uFE0F" (the AutomationCard/RegionSettings
//     emoji-glyph precedent; its colour-emoji presentation means the web's
//     state-driven blue/secondary tint may not render on the glyph itself, the
//     same documented limitation as the other emoji-glyph ports),
//     AlertTriangle -> "\u26A0\uFE0F" (SecurityAccessPage precedent),
//     X -> "\u00d7" (SearchInput close-glyph precedent, tinted amber inside the
//     clear button).
//   - `@/components/ui` GlassPanel (L28) -> the native GlassPanel primitive; the
//     web `ring-1 ring-*` is reproduced by overriding the panel's borderColor +
//     the bg-*/[0.04] tint via a style override.
//   - `@/components/ui` Button (L28) -> a local native ActionButton (Pressable +
//     AppText) preserving variant (ghost/primary), the sm sizing
//     (h-8 px-3 text-xs -> minHeight 32 / paddingHorizontal 12 / fontSize 12),
//     disabled dimming, the gap-1.5 leading glyph, and the amber label override
//     used by the clear button (the HealthProbesSection retry-button precedent).
//   - `@/components/ui` Input (L28) -> a local native FormInput (a bordered
//     TextInput reproducing Input.tsx's md geometry + focus border). React Native
//     has no `datetime-local` picker, so the Start field is a manual text input
//     that keeps the same `whenLocal` string contract — `Date.parse(whenLocal)`
//     is unchanged — with a "YYYY-MM-DDTHH:mm" placeholder hint; the native
//     date/time picker is UNAVAILABLE (rule 7, see nativeMaintenanceCapabilities).
//     The number field maps to keyboardType="numeric"; HTML min/max are advisory
//     (the handler's Math.max(5, …) clamp already enforces the floor, as on web).
//   - `@/components/ui` Badge (L28) -> the genuinely-ported native web-parity
//     Badge (variant="info" blue tint).
//   - `@/components/feedback/Toast` useToast (L29) -> a local lightweight in-panel
//     banner host preserving the `success(title)` / `error(title)` contract and
//     auto-dismiss (the RegionSettings/AppearanceSettings useToast precedent);
//     the web fixed bottom-right portal + framer entrance are web-only.
//   - `@/api/hooks/useAdmin` useMaintenanceState / useUpdateMaintenance (L30) ->
//     the native web-parity useAdmin ports (same /admin/maintenance request seam,
//     MaintenanceState shape, and mutateAsync input). The hook's own mutation
//     toast (Alert "Maintenance state updated") fires alongside this card's
//     specific toast, exactly as the two web toasts both fire.
//   - `@/hooks/useDateFormat` formatDateTime (L31) -> an inlined formatter
//     byte-identical to the web `@/lib/dateFormat` formatDateTime
//     (year/month/day/hour:2-digit/minute:2-digit, "\u2014" for empty/invalid),
//     the AutomationCard precedent. The native build has no settings/timezone
//     port, so it uses the device locale + zone (no per-call override).
//   - `@/lib/cn` cn() (L32) -> StyleSheet style arrays (React Native has no
//     className; the web hover/transition utilities have no native analog).
//
// The web source uses NO i18n (raw English literals), so there is no i18n
// surface to preserve — every string is kept verbatim. No DOM modules, HTML
// elements, Recharts, Leaflet, or old web UI components are imported.

import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors} from '../../../../../theme/tokens';
import {
  useMaintenanceState,
  useUpdateMaintenance,
} from '../../../../api/hooks/useAdmin';
import {Badge} from '../../../../components/ui/Badge';

interface ScheduledMaintenanceCardProps {
  now: number;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Documents which web capabilities are unavailable in this native port.
export const nativeMaintenanceCapabilities = {
  dateTimeLocalPickerAvailable: false,
  toastPortalAvailable: false,
} as const;

// Decorative lucide-react glyph stand-ins (react-native-svg is not a dependency).
const CALENDAR_CLOCK_GLYPH = '\uD83D\uDDD3\uFE0F';
const ALERT_TRIANGLE_GLYPH = '\u26A0\uFE0F';
const CLOSE_GLYPH = '\u00d7';

// ── formatDateTime (inlined from web @/hooks/useDateFormat -> @/lib/dateFormat) ─
// "Apr 4, 2026, 2:30 AM" — byte-identical to the web formatter for the Date
// values this card renders (endMs / untilTs); "\u2014" for empty/invalid.
function formatDateTime(value: Date | string | number | null | undefined): string {
  if (value == null || value === '') {
    return '\u2014';
  }
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) {
    return '\u2014';
  }
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ── useToast (web @/components/feedback/Toast useToast) ─────────────────────
// Lightweight in-panel banner host preserving the `success(title)` /
// `error(title)` contract; auto-dismisses after a few seconds.
interface ActiveToast {
  id: number;
  type: 'success' | 'error';
  title: string;
}

function useToast() {
  const [active, setActive] = useState<ActiveToast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  const show = useCallback((next: ActiveToast) => {
    if (timer.current) {
      clearTimeout(timer.current);
    }
    setActive(next);
    timer.current = setTimeout(
      () => setActive(null),
      next.type === 'error' ? 6000 : 5000,
    );
  }, []);

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    },
    [],
  );

  const success = useCallback(
    (title: string) => {
      seq.current += 1;
      show({id: seq.current, type: 'success', title});
    },
    [show],
  );

  const error = useCallback(
    (title: string) => {
      seq.current += 1;
      show({id: seq.current, type: 'error', title});
    },
    [show],
  );

  const node = active ? (
    <View style={styles.toastWrap}>
      <GlassPanel
        style={[
          styles.toast,
          active.type === 'error' ? styles.toastError : styles.toastSuccess,
        ]}>
        <AppText style={styles.toastTitle} weight="semibold">
          {active.title}
        </AppText>
      </GlassPanel>
    </View>
  ) : null;

  return {success, error, node};
}

// ── FormInput (web @/components/ui Input, md size) ─────────────────────────
// A bordered TextInput reproducing Input.tsx's md geometry (px-3 py-2 text-sm,
// rounded-md, --glass-border border, --surface-1 bg) with a focus border swap.
interface FormInputProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'numeric';
  maxLength?: number;
  nativeID?: string;
  accessibilityLabel?: string;
}

const FOCUS_BORDER = 'rgba(59, 130, 246, 0.5)'; // focus:ring-blue-500

function FormInput({
  value,
  onChangeText,
  placeholder,
  keyboardType = 'default',
  maxLength,
  nativeID,
  accessibilityLabel,
}: FormInputProps) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      accessibilityLabel={accessibilityLabel}
      keyboardType={keyboardType}
      maxLength={maxLength}
      nativeID={nativeID}
      onBlur={() => setFocused(false)}
      onChangeText={onChangeText}
      onFocus={() => setFocused(true)}
      placeholder={placeholder}
      placeholderTextColor={colors.textMuted}
      style={[styles.input, focused ? styles.inputFocused : null]}
      value={value}
    />
  );
}

// ── ActionButton (web @/components/ui Button, sm size) ─────────────────────
// Pressable + AppText preserving variant (ghost/primary), the sm geometry, the
// optional leading glyph (gap-1.5), disabled dimming, and a label colour
// override (the amber clear button).
interface ActionButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'ghost' | 'primary';
  disabled?: boolean;
  icon?: string;
  labelColor?: string;
}

function ActionButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  icon,
  labelColor,
}: ActionButtonProps) {
  const isPrimary = variant === 'primary';
  const resolvedColor = isPrimary ? '#ffffff' : labelColor ?? colors.textPrimary;
  const textStyle: StyleProp<TextStyle> = {color: resolvedColor};
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{disabled}}
      disabled={disabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.button,
        isPrimary ? styles.buttonPrimary : styles.buttonGhost,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
      ]}>
      {icon ? (
        <AppText
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.buttonIcon, textStyle]}>
          {icon}
        </AppText>
      ) : null}
      <AppText style={[styles.buttonLabel, textStyle]}>{label}</AppText>
    </Pressable>
  );
}

export function ScheduledMaintenanceCard({
  now,
}: ScheduledMaintenanceCardProps): React.ReactElement {
  const {data: state} = useMaintenanceState();
  const mutation = useUpdateMaintenance();
  const toast = useToast();
  const startId = useId();
  const durationId = useId();
  const [showSchedule, setShowSchedule] = useState(false);
  const [whenLocal, setWhenLocal] = useState('');
  const [duration, setDuration] = useState('60');
  const [message, setMessage] = useState('');

  const isActive = state?.mode === 'maintenance';
  const untilTs = useMemo(
    () => (state?.maintenance_until ? Date.parse(state.maintenance_until) : null),
    [state],
  );
  const minutesToStart = useMemo(() => {
    if (!untilTs || !isActive) {
      return null;
    }
    return Math.floor((untilTs - now) / 60_000);
  }, [untilTs, now, isActive]);

  const handleSchedule = async () => {
    if (!whenLocal) {
      toast.error('Pick a start time.');
      return;
    }
    const startMs = Date.parse(whenLocal);
    if (!Number.isFinite(startMs)) {
      toast.error('Invalid start time.');
      return;
    }
    const durMin = Math.max(5, Number(duration) || 60);
    const endMs = startMs + durMin * 60_000;
    try {
      await mutation.mutateAsync({
        mode: 'maintenance',
        message:
          message.trim() ||
          `Scheduled maintenance \u00b7 ends ${formatDateTime(new Date(endMs))}`,
        until: new Date(endMs).toISOString(),
      });
      setShowSchedule(false);
      setWhenLocal('');
      setMessage('');
      toast.success('Maintenance window scheduled.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to schedule');
    }
  };

  const handleClear = async () => {
    try {
      await mutation.mutateAsync({mode: 'ok', message: '', until: null});
      toast.success('Maintenance cleared.');
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to clear maintenance',
      );
    }
  };

  const within24h =
    isActive && untilTs != null && untilTs - now <= ONE_DAY_MS && untilTs - now > 0;
  const ringStyle = within24h
    ? styles.ringWithin24h
    : isActive
    ? styles.ringActive
    : styles.ringIdle;

  return (
    <>
      <GlassPanel style={[styles.panel, ringStyle]}>
        <View style={styles.headerLeft}>
          <AppText
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[
              styles.headerIcon,
              isActive ? styles.headerIconActive : styles.headerIconIdle,
            ]}>
            {CALENDAR_CLOCK_GLYPH}
          </AppText>
          <AppText style={styles.title} weight="semibold">
            Scheduled maintenance
          </AppText>
          {isActive ? <Badge variant="info">Maintenance active</Badge> : null}
          {within24h ? (
            <View style={styles.within24hChip}>
              <AppText
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={styles.within24hIcon}>
                {ALERT_TRIANGLE_GLYPH}
              </AppText>
              <AppText style={styles.within24hText}>Within 24h</AppText>
            </View>
          ) : null}
        </View>

        <View style={styles.body}>
          {isActive && state?.maintenance_message ? (
            <AppText style={styles.messageText}>
              {state.maintenance_message}
            </AppText>
          ) : null}
          {isActive && untilTs != null ? (
            <AppText style={styles.untilText}>
              {minutesToStart != null && minutesToStart > 0
                ? `Active until ${formatDateTime(new Date(untilTs))} (${minutesToStart} min remaining)`
                : `Until ${formatDateTime(new Date(untilTs))}`}
            </AppText>
          ) : null}
          {!isActive && !showSchedule ? (
            <AppText style={styles.descriptionText}>
              {
                'Schedule a window for upgrades or hardware moves. The status banner will switch to blue \u201cMaintenance\u201d instead of red \u201cDown\u201d.'
              }
            </AppText>
          ) : null}

          {!isActive && !showSchedule ? (
            <View style={styles.scheduleTriggerRow}>
              <ActionButton
                icon={CALENDAR_CLOCK_GLYPH}
                label="Schedule a window"
                onPress={() => setShowSchedule(true)}
                variant="ghost"
              />
            </View>
          ) : null}

          {!isActive && showSchedule ? (
            <View style={styles.form}>
              <View style={styles.formRow}>
                <View style={styles.formCol}>
                  <AppText style={styles.fieldLabel}>Start (local)</AppText>
                  <FormInput
                    accessibilityLabel="Start (local)"
                    nativeID={startId}
                    onChangeText={setWhenLocal}
                    placeholder="YYYY-MM-DDTHH:mm"
                    value={whenLocal}
                  />
                </View>
                <View style={styles.formCol}>
                  <AppText style={styles.fieldLabel}>Duration (minutes)</AppText>
                  <FormInput
                    accessibilityLabel="Duration (minutes)"
                    keyboardType="numeric"
                    nativeID={durationId}
                    onChangeText={setDuration}
                    value={duration}
                  />
                </View>
              </View>
              <FormInput
                maxLength={500}
                onChangeText={setMessage}
                placeholder="What's happening (optional)"
                value={message}
              />
              <View style={styles.buttonRow}>
                <ActionButton
                  disabled={mutation.isPending}
                  label="Cancel"
                  onPress={() => setShowSchedule(false)}
                  variant="ghost"
                />
                <ActionButton
                  disabled={mutation.isPending}
                  label={mutation.isPending ? 'Scheduling\u2026' : 'Schedule'}
                  onPress={handleSchedule}
                  variant="primary"
                />
              </View>
            </View>
          ) : null}

          {isActive ? (
            <View style={styles.scheduleTriggerRow}>
              <ActionButton
                disabled={mutation.isPending}
                icon={CLOSE_GLYPH}
                label={
                  mutation.isPending ? 'Clearing\u2026' : 'Clear maintenance'
                }
                labelColor="#fde68a"
                onPress={handleClear}
                variant="ghost"
              />
            </View>
          ) : null}
        </View>
      </GlassPanel>
      {toast.node}
    </>
  );
}

ScheduledMaintenanceCard.displayName = 'ScheduledMaintenanceCard';

const styles = StyleSheet.create({
  body: {
    gap: 12,
    marginTop: 12,
  },
  button: {
    alignItems: 'center',
    borderRadius: 6,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 32,
    paddingHorizontal: 12,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonGhost: {
    backgroundColor: 'transparent',
  },
  buttonIcon: {
    fontSize: 14,
    lineHeight: 16,
  },
  buttonLabel: {
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
  },
  buttonPressed: {
    opacity: 0.82,
  },
  buttonPrimary: {
    backgroundColor: '#2563eb',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'flex-end',
  },
  descriptionText: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  fieldLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
    marginBottom: 4,
  },
  form: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: 12,
    paddingTop: 12,
  },
  formCol: {
    flex: 1,
  },
  formRow: {
    flexDirection: 'row',
    gap: 12,
  },
  headerIcon: {
    fontSize: 16,
    lineHeight: 20,
  },
  headerIconActive: {
    color: '#93c5fd',
  },
  headerIconIdle: {
    color: colors.textSecondary,
  },
  headerLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  input: {
    backgroundColor: '#0e1727',
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    width: '100%',
  },
  inputFocused: {
    borderColor: FOCUS_BORDER,
  },
  messageText: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
  panel: {
    padding: 16,
  },
  ringActive: {
    backgroundColor: 'rgba(59, 130, 246, 0.04)',
    borderColor: 'rgba(96, 165, 250, 0.3)',
  },
  ringIdle: {
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  ringWithin24h: {
    backgroundColor: 'rgba(245, 158, 11, 0.04)',
    borderColor: 'rgba(251, 191, 36, 0.4)',
  },
  scheduleTriggerRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
  },
  title: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 20,
  },
  toast: {
    gap: 4,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  toastError: {
    borderColor: colors.dangerBorder,
  },
  toastSuccess: {
    borderColor: colors.successBorder,
  },
  toastTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 20,
  },
  toastWrap: {
    marginTop: 12,
  },
  untilText: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  within24hChip: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  within24hIcon: {
    color: '#fde68a',
    fontSize: 12,
    lineHeight: 16,
  },
  within24hText: {
    color: '#fde68a',
    fontSize: 12,
    lineHeight: 16,
  },
});

export default ScheduledMaintenanceCard;
