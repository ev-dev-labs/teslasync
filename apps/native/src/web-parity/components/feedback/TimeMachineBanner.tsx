// Native parity port of web/src/components/feedback/TimeMachineBanner.tsx.
//
// Global "viewing data as of …" banner.
//
// Visible whenever the app is operating in time-machine mode (the web SPA keys
// this off the `?as_of=` URL query parameter; see the native bridge note below).
// The banner exists so users — and especially diagnostics operators
// reconstructing post-incident state — never lose track of the fact that what
// they are looking at is a historical snapshot rather than live data.
//
// Mounted in the layout shell ABOVE the service-status banner so the
// historical-mode warning sits at the top of the main content column. Reuses the
// AlertBanner `info` tone so it matches the app's other contextual notices.
//
// Inline picker: the "Pick a date" button toggles a small date/time entry row
// attached to the banner. The same UI is opened from the command palette via the
// TIME_MACHINE_OPEN_PICKER_EVENT so users can both reveal AND change the
// historical anchor without leaving the current screen.
//
// Every browser-only dependency is reduced to an explicit native-safe analog and
// documented in the .parity.json sidecar:
//   - @/hooks/useAsOfDate (URL `?as_of=` state via useUrlState): React Native has
//     no URL/query-string router, so the canonical as-of timestamp is backed by a
//     module-level store with the same { asOf, setAsOf, clear } contract and the
//     same RFC-3339 validation. AS_OF_QUERY_PARAM ('as_of') is preserved verbatim
//     so a native data layer can still attach `as_of` to request URLs and reroute
//     reads through signal_log.
//   - window.addEventListener(TIME_MACHINE_OPEN_PICKER_EVENT): RN has no `window`,
//     so the DOM event bus is replaced by a module-level subscribe/emit registry
//     (subscribeTimeMachineOpenPicker / emitTimeMachineOpenPicker). The command
//     palette calls emitTimeMachineOpenPicker() exactly as the web dispatches the
//     window event. The event name constant is preserved verbatim.
//   - @/lib/dateFormat formatDateTime / toLocalDatetimeStr: ported here as
//     native-safe TypeScript with identical behaviour (Intl.DateTimeFormat for the
//     human label; zero-padded local "YYYY-MM-DDTHH:mm:ss" for the picker seed).
//     The web passes { locale: i18n.language }; native has no react-i18next i18n,
//     so the host's default locale is used (documented reduction).
//   - react-i18next useTranslation: replaced by a native-safe t(key, default, params)
//     that interpolates i18next-style {{when}} placeholders so the title keeps its
//     i18n intent.
//   - <input type="datetime-local">: RN has no datetime-local control and no date
//     picker dependency is installed, so the field is a free-form TextInput that
//     accepts the same "YYYY-MM-DDTHH:mm" local-time format the web input emits;
//     localInputToRfc3339 parses it identically. (Explicit native-safe state.)
//   - lucide-react History / Clock: the tone-coloured History glyph renders as a
//     decorative monochrome AppText character that inherits the info tone; the
//     small decorative Clock icon on the pick button is dropped (no monochrome
//     clock dingbat inherits colour) — the label alone is self-describing.
//   - AlertBanner (info) + Button: reproduced inline with RN View / Pressable /
//     AppText styled from the design tokens (the closest existing native tokens),
//     since neither web component has a native parity port.

import React, {useCallback, useEffect, useState} from 'react';
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type TextStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';

// ── native translation fallback (native-safe port of react-i18next) ──
type NativeTParams = Record<string, string | number>;

type NativeTFunction = (
  key: string,
  fallback: string,
  params?: NativeTParams,
) => string;

/** Interpolates i18next-style `{{name}}` placeholders, mirroring t(key, def, opts). */
function interpolate(template: string, params?: NativeTParams): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback(
    (_key: string, fallback: string, params?: NativeTParams) =>
      interpolate(fallback, params),
    [],
  );
}

// ── date helpers (native-safe port of @/lib/dateFormat) ──
/** Universal placeholder returned for unrenderable input (mirrors the web FALLBACK). */
const EM_DASH = '\u2014';

/** Full date + time: "Apr 4, 2026, 2:30 AM". Returns "—" for nullish/invalid input. */
function formatDateTime(
  value: string | Date | null | undefined,
  locale?: string,
): string {
  if (!value) {
    return EM_DASH;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return EM_DASH;
  }
  const resolvedLocale =
    typeof locale === 'string' && locale.trim().length > 0 ? locale : undefined;
  return date.toLocaleString(resolvedLocale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Local datetime string for the picker seed: "2026-04-04T14:30:00". */
function toLocalDatetimeStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
    d.getDate(),
  )}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ── as-of timestamp bridge (native-safe port of @/hooks/useAsOfDate) ──
/** Preserved verbatim from the web hook — the canonical request query parameter. */
export const AS_OF_QUERY_PARAM = 'as_of';

const ISO_RFC3339_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Strict RFC 3339 sniff used to drop pasted garbage before it reaches the wire. */
function looksLikeIso(value: string): boolean {
  if (!ISO_RFC3339_RE.test(value)) {
    return false;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

// Native stand-in for the URL `?as_of=` parameter: a module-level value that lives
// for the JS runtime. Web mounts the timestamp on the URL so a deep link / back /
// forward replays the same historical view; native has no URL, so a host wires the
// shared store through useAsOfDate (setAsOf / clear) instead.
let asOfValue: string | null = null;
const asOfListeners = new Set<() => void>();

function notifyAsOf(): void {
  for (const listener of [...asOfListeners]) {
    listener();
  }
}

function writeAsOf(next: string | null): void {
  asOfValue = next;
  notifyAsOf();
}

function subscribeAsOf(listener: () => void): () => void {
  asOfListeners.add(listener);
  return () => {
    asOfListeners.delete(listener);
  };
}

export interface UseAsOfDateResult {
  /** Current as-of timestamp as an RFC 3339 string, or null when in live mode. */
  asOf: string | null;
  /** Replace the as-of timestamp. Pass null to return to live state. */
  setAsOf: (iso: string | null) => void;
  /** Convenience alias for setAsOf(null) — returns to live state. */
  clear: () => void;
}

export function useAsOfDate(): UseAsOfDateResult {
  const [value, setValue] = useState<string | null>(() => asOfValue);

  useEffect(() => subscribeAsOf(() => setValue(asOfValue)), []);

  const setAsOf = useCallback((iso: string | null) => {
    if (iso === null || iso === '') {
      writeAsOf(null);
      return;
    }
    if (!looksLikeIso(iso)) {
      // Refuse to write malformed values. Callers should present a picker that
      // emits well-formed RFC 3339.
      return;
    }
    writeAsOf(iso);
  }, []);

  const clear = useCallback(() => writeAsOf(null), []);

  return {asOf: value, setAsOf, clear};
}

// ── open-picker event bridge (native-safe port of the DOM window event) ──
/** Preserved verbatim from the web file as the canonical event name. */
export const TIME_MACHINE_OPEN_PICKER_EVENT = 'time-machine.open-picker';

type TimeMachineOpenPickerListener = () => void;
const openPickerListeners = new Set<TimeMachineOpenPickerListener>();

/**
 * Native analog of `window.dispatchEvent(new Event(TIME_MACHINE_OPEN_PICKER_EVENT))`.
 * The command palette calls this to reveal AND prefill the picker, exactly as the
 * web dispatches the window event.
 */
export function emitTimeMachineOpenPicker(): void {
  for (const listener of [...openPickerListeners]) {
    listener();
  }
}

/** Native analog of `window.addEventListener`; returns the unsubscribe fn. */
export function subscribeTimeMachineOpenPicker(
  listener: TimeMachineOpenPickerListener,
): () => void {
  openPickerListeners.add(listener);
  return () => {
    openPickerListeners.delete(listener);
  };
}

/** Test-only helper: reset the module-level as-of store and event listeners. */
export function __resetTimeMachineForTests(): void {
  asOfValue = null;
  asOfListeners.clear();
  openPickerListeners.clear();
}

function localInputToRfc3339(value: string): string | null {
  if (!value) {
    return null;
  }
  // The picker emits "YYYY-MM-DDTHH:mm" in LOCAL time with no zone; the
  // new Date(...) constructor interprets the string in the host's local zone,
  // then toISOString() converts to UTC.
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

// ── inline button (native-safe port of the web @/components/ui Button) ──
type BannerButtonVariant = 'primary' | 'outline' | 'ghost';

interface BannerButtonProps {
  label: string;
  onPress: () => void;
  variant: BannerButtonVariant;
  disabled?: boolean;
  testID?: string;
}

function BannerButton({
  label,
  onPress,
  variant,
  disabled = false,
  testID,
}: BannerButtonProps) {
  const labelStyle: TextStyle =
    variant === 'primary'
      ? styles.buttonPrimaryText
      : variant === 'outline'
      ? styles.buttonOutlineText
      : styles.buttonGhostText;

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{disabled}}
      disabled={disabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.button,
        variant === 'primary' && styles.buttonPrimary,
        variant === 'outline' && styles.buttonOutline,
        variant === 'ghost' && styles.buttonGhost,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
      ]}
      testID={testID}>
      <AppText style={[styles.buttonLabel, labelStyle]} weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

export interface TimeMachineBannerProps {
  /**
   * Test seam — overrides the live store-derived asOf so spec files can render
   * the picker open/closed without driving the module store. Production callers
   * never set this.
   */
  testHookAsOf?: string | null;
  /**
   * Test seam — forces the picker open on initial render. Production code sets
   * this only via the {@link TIME_MACHINE_OPEN_PICKER_EVENT} bridge.
   */
  testHookPickerOpen?: boolean;
}

export function TimeMachineBanner({
  testHookAsOf,
  testHookPickerOpen = false,
}: TimeMachineBannerProps = {}) {
  const t = useNativeTranslationFallback();
  const {asOf, setAsOf, clear} = useAsOfDate();
  const [pickerOpen, setPickerOpen] = useState<boolean>(testHookPickerOpen);
  const [draft, setDraft] = useState<string>('');

  const effective = testHookAsOf !== undefined ? testHookAsOf : asOf;

  useEffect(() => {
    function onOpen() {
      // Pre-fill the picker with the current asOf if any, otherwise yesterday at
      // noon — a sensible default that lands inside the supported lookback window
      // without requiring a manual entry.
      const seed =
        effective != null
          ? new Date(effective)
          : (() => {
              const d = new Date();
              d.setDate(d.getDate() - 1);
              d.setHours(12, 0, 0, 0);
              return d;
            })();
      setDraft(toLocalDatetimeStr(seed));
      setPickerOpen(true);
    }
    return subscribeTimeMachineOpenPicker(onOpen);
  }, [effective]);

  const handleSubmit = useCallback(() => {
    const iso = localInputToRfc3339(draft);
    if (!iso) {
      return;
    }
    setAsOf(iso);
    setPickerOpen(false);
  }, [draft, setAsOf]);

  const handleReturnToLive = useCallback(() => {
    clear();
    setPickerOpen(false);
  }, [clear]);

  // Guardrail: only render in time-machine mode OR when the picker is explicitly
  // open from the command palette. In live mode with a closed picker the banner is
  // invisible — no extra UI noise.
  if (effective == null && !pickerOpen) {
    return null;
  }

  const formatted = effective != null ? formatDateTime(effective) : '';
  const title = t('timeMachine.banner.title', 'Viewing data as of {{when}}', {
    when: formatted,
  });
  const body =
    effective != null
      ? t('timeMachine.banner.body', 'Read-only point-in-time mode.')
      : t(
          'timeMachine.banner.pickPrompt',
          'Pick a point in time to view historical data.',
        );
  const pickLabel = t('timeMachine.banner.pick', 'Pick a date');
  const returnLabel = t('timeMachine.banner.returnToLive', 'Return to live');
  const submitLabel = t('timeMachine.banner.submit', 'View as of date');
  const cancelLabel = t('timeMachine.banner.cancel', 'Cancel');
  const inputLabel = t('timeMachine.banner.inputLabel', 'Date and time');

  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityValue={{text: effective ?? ''}}
      style={styles.wrapper}
      testID="time-machine-banner">
      <View style={styles.banner}>
        <View style={styles.bannerRow}>
          <AppText importantForAccessibility="no" style={styles.icon}>
            {'\u21BA'}
          </AppText>
          <View style={styles.bannerBody}>
            <AppText style={styles.title} weight="semibold">
              {title}
            </AppText>
            <View style={styles.contentCol}>
              <AppText
                style={styles.body}
                testID="time-machine-banner-body"
                tone="secondary">
                {body}
              </AppText>
              <View style={styles.buttonRow}>
                <BannerButton
                  label={pickLabel}
                  onPress={() => setPickerOpen(prev => !prev)}
                  testID="time-machine-banner-pick"
                  variant="outline"
                />
                {effective != null ? (
                  <BannerButton
                    label={returnLabel}
                    onPress={handleReturnToLive}
                    testID="time-machine-banner-return"
                    variant="ghost"
                  />
                ) : null}
              </View>
              {pickerOpen ? (
                <View style={styles.picker} testID="time-machine-banner-picker">
                  <View style={styles.inputCol}>
                    <AppText style={styles.inputLabel} tone="secondary">
                      {inputLabel}
                    </AppText>
                    <TextInput
                      accessibilityLabel={inputLabel}
                      autoCapitalize="none"
                      autoCorrect={false}
                      onChangeText={setDraft}
                      placeholder="YYYY-MM-DDTHH:mm"
                      placeholderTextColor={colors.textMuted}
                      style={styles.input}
                      testID="time-machine-banner-input"
                      value={draft}
                    />
                  </View>
                  <BannerButton
                    disabled={!draft}
                    label={submitLabel}
                    onPress={handleSubmit}
                    testID="time-machine-banner-submit"
                    variant="primary"
                  />
                  <BannerButton
                    label={cancelLabel}
                    onPress={() => setPickerOpen(false)}
                    testID="time-machine-banner-cancel"
                    variant="ghost"
                  />
                </View>
              ) : null}
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
  },
  bannerBody: {
    flex: 1,
    minWidth: 0,
  },
  bannerRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
  },
  body: {
    fontSize: 12,
    lineHeight: 16,
  },
  button: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    justifyContent: 'center',
    minHeight: 32,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  buttonDisabled: {
    opacity: 0.48,
  },
  buttonGhost: {
    backgroundColor: 'transparent',
  },
  buttonGhostText: {
    color: colors.textSecondary,
  },
  buttonLabel: {
    fontSize: 12,
    lineHeight: 16,
  },
  buttonOutline: {
    backgroundColor: 'transparent',
    borderColor: colors.borderAccent,
    borderWidth: 1,
  },
  buttonOutlineText: {
    color: colors.accent,
  },
  buttonPressed: {
    opacity: 0.82,
  },
  buttonPrimary: {
    backgroundColor: colors.accent,
  },
  buttonPrimaryText: {
    color: colors.background,
  },
  buttonRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  contentCol: {
    gap: spacing.sm,
    marginTop: 2,
  },
  icon: {
    color: colors.accent,
    fontSize: 16,
    lineHeight: 20,
    marginTop: 2,
  },
  input: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 12,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  inputCol: {
    gap: 4,
  },
  inputLabel: {
    fontSize: 12,
    lineHeight: 16,
  },
  picker: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingTop: 2,
  },
  title: {
    color: colors.accent,
    fontSize: 14,
    lineHeight: 20,
  },
  wrapper: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
});

export default TimeMachineBanner;
