// Native parity port of web/src/features/settings/components/GeneralSettings.tsx.
//
// `<GeneralSettings>` is the "Application" settings card: units (distance /
// temperature / pressure / preferred range), decimal precision (with a live
// preview), language, currency, number/date locale, time-zone display + an IANA
// override, electricity cost (per kWh), gas price (+ per gallon/liter unit) and
// a comparison-vehicle MPG — committed via `useSaveSettings`. It also offers a
// one-tap "Sync from Car" that copies the vehicle's display units into the app
// settings, a read-only "Car clock format" notice, and a draft-recovery banner.
//
// The web version composes the shared GlassPanel/Button/IconBox/Input/Select
// from `@/components/ui`, the shared <CurrencyInput> (@/components/forms), the
// <Skeleton>/<DraftRecoveryBanner> (@/components/feedback), <FadeIn>
// (@/components/motion), the <SettingField>/<HelpIcon> wrappers, the in-house
// useToast queue, the localStorage-backed useFormDraft + the router
// useNavigationGuard, the parseSettingEnum + currencyFormat libs, react-i18next
// (`useTranslation('settings')`), and lucide SVGs (Settings/Save/Download/Car/
// CheckCircle/Clock). React Native has none of those DOM-bound pieces (no <div>/
// <h2>/<p>/<span>, no <select>/<input>/<button>, no Tailwind/CSS-vars, no
// localStorage/Intl-symbol spans, no lucide SVGs, no react-router guard, no
// react-i18next provider), so this self-contained port reproduces the same
// behavioural + visual contract with RN primitives + the existing native theme:
//   - GlassPanel is the already-ported native bordered surface; FadeIn reuses
//     the shared native `useMotionPreference` (fade-in + slide-up entrance).
//   - The shared <Select> dropdowns become a reusable inline <SelectField>:
//     a Pressable trigger showing the current option label that opens a
//     transparent popover of accessible Pressable rows (the established
//     DashboardSettingsModal/SignalConfigModal popover idiom). onChange(e) =>
//     e.target.value maps onto onValueChange(value).
//   - The shared <Input> become labelled <TextInput>s (numeric / default
//     keyboards); onChange(e) => e.target.value maps onto onChangeText.
//   - The shared <CurrencyInput> becomes an inline <CurrencyField> backed by
//     the ported micro-unit currencyFormat helpers (Intl.NumberFormat), keeping
//     the canonical micro storage + locale-aware parse/format-on-blur contract.
//   - <SettingField>/<HelpIcon> become a native FieldLabel + a "?" help glyph
//     that surfaces the help copy through Alert; <Skeleton> is a faint fill;
//     <IconBox> is a small accent-tinted rounded box; the lucide SVGs become
//     compact unicode glyphs (the native "no SVG icons" idiom).
//
// Native-safe adaptations (documented in the sidecar):
//   - react-i18next is not wired in native, so `useTranslation('settings')` is
//     replaced by a native `useSettingsTranslation()` returning each call's
//     English fallback (with {{var}} interpolation for the draft banner). Every
//     i18n key + fallback is preserved verbatim.
//   - useToast → React Native Alert.alert(title, message) (the established
//     native toast primitive, see _toastHelpers); the success/info/error call
//     sites are preserved.
//   - useFormDraft → a native-safe in-memory mirror of the {value,setValue,
//     hasDraft,draftSavedAt,discardDraft,flush} contract. localStorage-backed
//     persistence + cross-tab recovery are browser-only and UNAVAILABLE on
//     native, so a stored draft is never recovered (hasDraft stays false → the
//     component takes the "hydrate from server" path) but in-session editing,
//     the skipPersist guard signature, and discardDraft/flush all behave.
//   - useNavigationGuard → a native-safe no-op (the react-router in-app guard
//     dialog has no analog without a navigation-guard provider).
//   - Tailwind utility classes + CSS custom properties (var(--text-primary/
//     muted), text-neon-cyan/amber, emerald-300) resolve to StyleSheet styles
//     against the native theme tokens; the responsive `sm:grid-cols-2` form grid
//     renders as a single stacked column (the phone breakpoint).

import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type KeyboardTypeOptions,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, shadows, spacing} from '../../../../theme/tokens';
import {
  useCarPreferences,
  useSaveSettings,
  useSettings,
  useVehicles,
  type AppSettings,
} from '../../../api/hooks/useSettings';

// ---------------------------------------------------------------------------
// Resolved palette. The web uses Tailwind tokens / CSS vars; native carries the
// literal hexes / token references so the visual intent survives without
// Tailwind.
// ---------------------------------------------------------------------------

const NEON_CYAN = colors.accent; // text-neon-cyan / border-neon-cyan
const NEON_AMBER = colors.warning; // text-neon-amber
const EMERALD_300 = '#6ee7b7'; // text-emerald-300 (saved indicator)
const CYAN_BANNER_BG = 'rgba(53, 213, 255, 0.05)'; // bg-neon-cyan/5
const CYAN_BANNER_BORDER = 'rgba(53, 213, 255, 0.2)'; // border-neon-cyan/20
const HAIRLINE_FAINT = 'rgba(255, 255, 255, 0.06)'; // border-white/[0.06]
const FILL_FAINT = 'rgba(255, 255, 255, 0.03)'; // bg-white/[0.03]
const FIELD_FILL = 'rgba(255, 255, 255, 0.04)'; // input surface

// lucide affordances rendered as unicode glyphs (the native "no SVG icons"
// idiom — see SignalConfigModal).
const SETTINGS_GLYPH = '\u2699'; // ⚙ Settings
const SAVE_GLYPH = '\uD83D\uDCBE'; // 💾 Save
const DOWNLOAD_GLYPH = '\u2913'; // ⤓ Download (Sync from Car)
const CAR_GLYPH = '\uD83D\uDE97'; // 🚗 Car
const CLOCK_GLYPH = '\u23F1'; // ⏱ Clock
const CHECK_GLYPH = '\u2713'; // ✓ CheckCircle
const CHEVRON_GLYPH = '\u25BE'; // ▾ Select caret
const HELP_GLYPH = '?'; // HelpIcon

// ---------------------------------------------------------------------------
// Map the user's stored currency_symbol glyph to an ISO 4217 code so the
// CurrencyField can use Intl.NumberFormat with style:'currency'. The glyphs come
// from the dropdown below — keep the two in sync (verbatim from the web source).
// ---------------------------------------------------------------------------

const CURRENCY_SYMBOL_TO_ISO: Record<string, string> = {
  $: 'USD',
  '\u20AC': 'EUR', // €
  '\u00A3': 'GBP', // £
  C$: 'CAD',
  A$: 'AUD',
  '\u00A5': 'JPY', // ¥
  '\u5143': 'CNY', // 元
  CHF: 'CHF',
  kr: 'SEK',
  '\u20B9': 'INR', // ₹
};

function symbolToIsoCode(symbol: string | undefined): string {
  return CURRENCY_SYMBOL_TO_ISO[(symbol ?? '$').trim()] ?? 'USD';
}

const DEFAULT_FORM: AppSettings = {
  unit_of_length: 'km',
  unit_of_temp: 'C',
  unit_of_pressure: 'bar',
  preferred_range: 'rated',
  language: 'en',
  base_cost_per_kwh: 0.12,
  api_suspended: false,
  theme: 'neon-cyan',
  mode: 'dark',
  custom_primary: '#00b4d8',
  custom_accent: '#e63946',
  gas_price_per_unit: 3.5,
  gas_unit: 'gallon',
  gas_efficiency_mpg: 25,
  decimal_precision: 2,
  quiet_hours_enabled: false,
  quiet_hours_start: '22:00',
  quiet_hours_end: '07:00',
  alert_digest_mode: 'instant',
  currency_symbol: '$',
  locale: 'en-US',
  tz_display_default: 'vehicle',
  timezone_user: '',
  tab_badge_enabled: true,
  critical_flash_enabled: true,
  ui_density: 'comfortable',
};

// ---------------------------------------------------------------------------
// parseSettingEnum + detectors — ported verbatim from web/src/lib/parseSettingEnum.ts.
// ---------------------------------------------------------------------------

const enumMappings: Record<string, Record<string, string>> = {
  distance: {
    distanceunitmiles: 'Miles',
    distanceunitkilometers: 'Kilometers',
    distanceunitkm: 'Kilometers',
    miles: 'Miles',
    mi: 'Miles',
    km: 'Kilometers',
    kilometers: 'Kilometers',
  },
  temperature: {
    temperatureunitcelsius: 'Celsius',
    temperatureunitfahrenheit: 'Fahrenheit',
    celsius: 'Celsius',
    fahrenheit: 'Fahrenheit',
    c: 'Celsius',
    f: 'Fahrenheit',
  },
  charge: {
    chargeunitpercent: 'Percent',
    chargeunitmiles: 'Miles',
    chargeunitkilometers: 'Kilometers',
    percent: 'Percent',
    mi: 'Miles',
    km: 'Kilometers',
  },
  pressure: {
    pressureunitpsi: 'PSI',
    pressureunitbar: 'Bar',
    pressureunitkpa: 'kPa',
    psi: 'PSI',
    bar: 'Bar',
    kpa: 'kPa',
  },
};

function parseSettingEnum(
  value: string | undefined | null,
  category: keyof typeof enumMappings,
): string {
  if (!value) {
    return '\u2014';
  }
  const lower = value.toLowerCase().replace(/[^a-z]/g, '');
  return enumMappings[category]?.[lower] ?? value;
}

function isSettingMiles(value: string | undefined | null): boolean {
  if (!value) {
    return false;
  }
  return value.toLowerCase().includes('mile');
}

function isSettingFahrenheit(value: string | undefined | null): boolean {
  if (!value) {
    return false;
  }
  return value.toLowerCase().includes('fahr');
}

function isSettingPSI(value: string | undefined | null): boolean {
  if (!value) {
    return false;
  }
  return value.toLowerCase().includes('psi');
}

function isSettingBar(value: string | undefined | null): boolean {
  if (!value) {
    return false;
  }
  return value.toLowerCase().includes('bar');
}

// ---------------------------------------------------------------------------
// currencyFormat helpers — ported from web/src/lib/currencyFormat.ts (the subset
// this card uses). Canonical storage = integer micro-units (1 major = 1e6).
// ---------------------------------------------------------------------------

const MICRO_SCALE = 1_000_000;

function valueToMicro(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }
  return Math.round(value * MICRO_SCALE);
}

function microToValue(micro: number | null | undefined): number | null {
  if (micro == null || !Number.isFinite(micro)) {
    return null;
  }
  return micro / MICRO_SCALE;
}

function clampPrecision(precision: number | undefined): number {
  if (precision == null || !Number.isFinite(precision)) {
    return 2;
  }
  return Math.max(0, Math.min(20, Math.trunc(precision)));
}

function normaliseLocale(locale: string | undefined): string {
  return locale && locale.trim() ? locale : 'en-US';
}

function formatCurrencyValue(
  value: number | null | undefined,
  currency: string,
  locale: string,
  precision: number,
  options: {useGrouping?: boolean} = {},
): string {
  if (value == null || !Number.isFinite(value)) {
    return '';
  }
  const useGrouping = options.useGrouping ?? false;
  const digits = clampPrecision(precision);
  const lc = normaliseLocale(locale);
  try {
    return new Intl.NumberFormat(lc, {
      style: 'currency',
      currency,
      currencyDisplay: 'symbol',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      useGrouping,
    }).format(value);
  } catch {
    const plain = new Intl.NumberFormat(lc, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      useGrouping,
    }).format(value);
    return `${currency} ${plain}`.trim();
  }
}

function formatCurrencyMicro(
  micro: number | null | undefined,
  currency: string,
  locale: string,
  precision: number,
  options: {useGrouping?: boolean} = {},
): string {
  return formatCurrencyValue(
    microToValue(micro),
    currency,
    locale,
    precision,
    options,
  );
}

function currencySymbol(currency: string, locale: string): string {
  const lc = normaliseLocale(locale);
  try {
    const parts = new Intl.NumberFormat(lc, {
      style: 'currency',
      currency,
      currencyDisplay: 'symbol',
    }).formatToParts(0);
    const sym = parts.find(p => p.type === 'currency')?.value;
    return sym ?? currency;
  } catch {
    return currency;
  }
}

function parseLocaleNumber(text: string, locale: string): number {
  if (!text) {
    return NaN;
  }
  let groupSep = ',';
  let decimalSep = '.';
  try {
    const parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
    const g = parts.find(p => p.type === 'group')?.value;
    const d = parts.find(p => p.type === 'decimal')?.value;
    if (typeof g === 'string') {
      groupSep = g;
    }
    if (typeof d === 'string') {
      decimalSep = d;
    }
  } catch {
    // keep defaults
  }

  let normalized = text;
  if (groupSep === '\u00A0' || groupSep === ' ') {
    normalized = normalized.split('\u00A0').join('').split(' ').join('');
  } else if (groupSep && groupSep !== decimalSep) {
    normalized = normalized.split(groupSep).join('');
  }
  if (decimalSep !== '.') {
    normalized = normalized.split(decimalSep).join('.');
  }
  normalized = normalized.replace(/\s+/g, '');
  return Number(normalized);
}

function stripCurrencyAdornments(
  raw: string,
  currency: string,
  locale: string,
): string {
  const symbol = currencySymbol(currency, locale);
  const code = currency.trim();
  let out = raw;
  if (symbol && symbol !== code) {
    out = out.split(symbol).join('');
  }
  if (code) {
    const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(escaped, 'gi'), '');
  }
  return out.trim();
}

function parseCurrencyText(
  text: string,
  currency: string,
  locale: string,
): number | null {
  let raw = (text ?? '').trim();
  if (!raw) {
    return null;
  }

  let negative = false;
  if (raw.startsWith('(') && raw.endsWith(')')) {
    negative = true;
    raw = raw.slice(1, -1).trim();
  }

  raw = stripCurrencyAdornments(raw, currency, locale);
  if (!raw) {
    return null;
  }

  if (raw.startsWith('-')) {
    negative = !negative;
    raw = raw.slice(1).trim();
  } else if (raw.startsWith('+')) {
    raw = raw.slice(1).trim();
  }

  if (!raw) {
    return null;
  }

  const n = parseLocaleNumber(raw, normaliseLocale(locale));
  if (!Number.isFinite(n)) {
    return null;
  }
  return negative ? -n : n;
}

function parseCurrencyTextToMicro(
  text: string,
  currency: string,
  locale: string,
): number | null {
  return valueToMicro(parseCurrencyText(text, currency, locale));
}

// ---------------------------------------------------------------------------
// react-i18next is not wired in native; this fallback returns each call's
// English defaultValue (web: useTranslation('settings')) and interpolates
// `{{var}}` placeholders for the draft-recovery copy.
// ---------------------------------------------------------------------------

type TVars = Record<string, string | number>;
type NativeTFunction = (key: string, fallback: string, vars?: TVars) => string;

function useSettingsTranslation(): NativeTFunction {
  return useCallback((_key: string, fallback: string, vars?: TVars) => {
    if (!vars) {
      return fallback;
    }
    return fallback.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (match, name: string) =>
      Object.prototype.hasOwnProperty.call(vars, name)
        ? String(vars[name])
        : match,
    );
  }, []);
}

// ---------------------------------------------------------------------------
// useToast → React Native Alert.alert (the established native toast primitive).
// ---------------------------------------------------------------------------

interface ToastApi {
  success: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
}

function useToast(): ToastApi {
  return useMemo(
    () => ({
      success: (title: string, message?: string) => Alert.alert(title, message),
      info: (title: string, message?: string) => Alert.alert(title, message),
      error: (title: string, message?: string) => Alert.alert(title, message),
    }),
    [],
  );
}

// ---------------------------------------------------------------------------
// useFormDraft → native-safe in-memory mirror of the web hook's public contract.
// localStorage persistence + cross-tab crash-recovery are browser-only and
// UNAVAILABLE on native, so a stored draft is never recovered (hasDraft stays
// false → the component hydrates from the server snapshot). In-session edits,
// the skipPersist guard signature, discardDraft and flush all behave.
// ---------------------------------------------------------------------------

interface FormDraftOptions<T> {
  version?: number;
  debounceMs?: number;
  maxAgeMs?: number;
  skipPersist?: (value: T) => boolean;
}

interface FormDraftState<T> {
  value: T;
  setValue: (updater: T | ((prev: T) => T)) => void;
  hasDraft: boolean;
  draftSavedAt: Date | null;
  discardDraft: () => void;
  flush: () => void;
}

function useFormDraft<T>(
  _key: string,
  initial: T,
  _opts: FormDraftOptions<T> = {},
): FormDraftState<T> {
  const [value, setValueState] = useState<T>(initial);
  const initialRef = useRef(initial);
  initialRef.current = initial;

  const setValue = useCallback((updater: T | ((prev: T) => T)) => {
    setValueState(prev =>
      typeof updater === 'function'
        ? (updater as (p: T) => T)(prev)
        : updater,
    );
  }, []);

  const discardDraft = useCallback(() => {
    setValueState(initialRef.current);
  }, []);

  const flush = useCallback(() => {
    // No persistent backend on native — flush is a no-op.
  }, []);

  return {
    value,
    setValue,
    // Persistence is unavailable on native: no draft is ever recovered.
    hasDraft: false,
    draftSavedAt: null,
    discardDraft,
    flush,
  };
}

// ---------------------------------------------------------------------------
// useNavigationGuard → native-safe no-op. The react-router in-app guard dialog
// has no analog without a navigation-guard provider.
// ---------------------------------------------------------------------------

function useNavigationGuard(_isDirty: boolean, _message?: string): void {
  // Intentionally empty on native.
}

// ---------------------------------------------------------------------------
// Small relative-time helper for the (native-dormant) draft banner copy.
// ---------------------------------------------------------------------------

function formatRelativeShort(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) {
    return 'just now';
  }
  if (mins < 60) {
    return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  }
  const hours = Math.round(mins / 60);
  if (hours < 24) {
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

// ---------------------------------------------------------------------------
// FadeIn — the web framer-motion entrance (opacity 0->1 + slide-up, optional
// delay) is a visual-only flourish with no behavioural contract. Following the
// established native idiom (the Toggle/Checkbox ports drop their CSS transitions
// "to stay deterministic under --detectOpenHandles"), it renders its children
// statically in their final state on native — no Animated timers, no leaked
// post-teardown handles. The `delay` prop is accepted for source parity.
// ---------------------------------------------------------------------------

function FadeIn({
  children,
}: {
  children: React.ReactNode;
  delay?: number;
}): React.ReactElement {
  return <View>{children}</View>;
}

// ---------------------------------------------------------------------------
// IconBox — small accent-tinted rounded container (web cyan h-10 w-10 rounded-xl
// ring). Wraps a glyph.
// ---------------------------------------------------------------------------

function IconBox({children}: {children: React.ReactNode}) {
  return <View style={styles.iconBox}>{children}</View>;
}

// ---------------------------------------------------------------------------
// Skeleton — faint fill placeholder (web <Skeleton className="h-16" />).
// ---------------------------------------------------------------------------

function Skeleton({testID}: {testID?: string}) {
  return <View style={styles.skeleton} testID={testID} />;
}

// ---------------------------------------------------------------------------
// FieldLabel — uppercase muted label (web Input/Select/SettingField label) with
// an optional inline help "?" glyph that surfaces the help copy through Alert
// (web <HelpIcon>).
// ---------------------------------------------------------------------------

interface FieldHelp {
  i18nKey?: string;
  content?: string;
  for?: string;
}

function FieldLabel({label, help}: {label: string; help?: FieldHelp}) {
  return (
    <View style={styles.labelRow}>
      <AppText style={styles.fieldLabel}>{label}</AppText>
      {help ? (
        <Pressable
          accessibilityLabel={`${label} help`}
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => Alert.alert(label, help.content)}
          style={styles.helpGlyphWrap}
          testID={help.for ? `help-${help.for}` : undefined}>
          <AppText style={styles.helpGlyph}>{HELP_GLYPH}</AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// SettingField — label (+ optional help) above arbitrary children (web
// SettingField.tsx).
// ---------------------------------------------------------------------------

function SettingField({
  label,
  help,
  children,
}: {
  label: string;
  help?: FieldHelp;
  children: React.ReactNode;
}) {
  return (
    <View>
      <FieldLabel help={help} label={label} />
      {children}
    </View>
  );
}

// ---------------------------------------------------------------------------
// SelectField — native replacement for the shared web <Select> (no DOM <select>
// on native). A Pressable trigger showing the current option label opens a
// transparent popover of accessible Pressable rows.
// ---------------------------------------------------------------------------

interface SelectOption {
  value: string;
  label: string;
}

interface SelectFieldProps {
  label?: string;
  value: string;
  options: SelectOption[];
  onValueChange: (value: string) => void;
  accessibilityLabel: string;
  placeholder?: string;
  testID?: string;
}

function SelectField({
  label,
  value,
  options,
  onValueChange,
  accessibilityLabel,
  placeholder,
  testID,
}: SelectFieldProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find(o => o.value === value);
  const triggerLabel = selected?.label ?? placeholder ?? '';

  const choose = (next: string) => {
    setOpen(false);
    onValueChange(next);
  };

  return (
    <View>
      {label ? <FieldLabel label={label} /> : null}
      <Pressable
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        accessibilityState={{expanded: open}}
        onPress={() => setOpen(true)}
        style={({pressed}) => [styles.selectTrigger, pressed && styles.pressed]}
        testID={testID}>
        <AppText numberOfLines={1} style={styles.selectTriggerText}>
          {triggerLabel}
        </AppText>
        <AppText accessible={false} allowFontScaling={false} style={styles.selectCaret}>
          {CHEVRON_GLYPH}
        </AppText>
      </Pressable>

      <Modal
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        transparent
        visible={open}>
        <View style={styles.popoverOverlay}>
          <Pressable
            accessibilityLabel={accessibilityLabel}
            accessibilityRole="button"
            onPress={() => setOpen(false)}
            style={styles.backdrop}
          />
          <View
            accessibilityLabel={accessibilityLabel}
            accessibilityRole="menu"
            style={styles.popoverMenu}
            testID={testID ? `${testID}-menu` : undefined}>
            <ScrollView
              bounces={false}
              contentContainerStyle={styles.popoverList}
              keyboardShouldPersistTaps="handled">
              {options.map(opt => {
                const isActive = opt.value === value;
                return (
                  <Pressable
                    accessibilityRole="menuitem"
                    accessibilityState={{selected: isActive}}
                    key={opt.value || '__placeholder__'}
                    onPress={() => choose(opt.value)}
                    style={({pressed}) => [
                      styles.popoverItem,
                      isActive && styles.popoverItemActive,
                      pressed && styles.popoverItemPressed,
                    ]}
                    testID={
                      testID ? `${testID}-option-${opt.value}` : undefined
                    }>
                    <AppText
                      style={[
                        styles.popoverItemText,
                        isActive && styles.popoverItemTextActive,
                      ]}>
                      {opt.label}
                    </AppText>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ---------------------------------------------------------------------------
// TextField — labelled <TextInput> replacement for the shared web <Input>.
// ---------------------------------------------------------------------------

interface TextFieldProps {
  label?: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  accessibilityLabel: string;
  testID?: string;
}

function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  accessibilityLabel,
  testID,
}: TextFieldProps) {
  return (
    <View>
      {label ? <FieldLabel label={label} /> : null}
      <TextInput
        accessibilityLabel={accessibilityLabel}
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

// ---------------------------------------------------------------------------
// CurrencyField — native port of the shared <CurrencyInput>. Stores canonical
// integer micro-units, renders the value with Intl currency formatting, and
// parses user-typed text on blur / submit without clobbering in-progress typing.
// ---------------------------------------------------------------------------

interface CurrencyFieldProps {
  ariaLabel: string;
  currency: string;
  locale: string;
  precision: number;
  valueMicro: number | null;
  onChange: (next: {valueMicro: number | null}) => void;
  testID?: string;
}

function CurrencyField({
  ariaLabel,
  currency,
  locale,
  precision,
  valueMicro,
  onChange,
  testID,
}: CurrencyFieldProps) {
  const effectiveLocale = normaliseLocale(locale);

  const display = useMemo(
    () => formatCurrencyMicro(valueMicro, currency, effectiveLocale, precision),
    [valueMicro, currency, effectiveLocale, precision],
  );
  const symbol = useMemo(
    () => currencySymbol(currency, effectiveLocale),
    [currency, effectiveLocale],
  );

  const [text, setText] = useState(display);
  const focusedRef = useRef(false);

  useEffect(() => {
    if (focusedRef.current) {
      return;
    }
    setText(display);
  }, [display]);

  const commit = useCallback(
    (raw: string) => {
      const parsedMicro = parseCurrencyTextToMicro(raw, currency, effectiveLocale);
      onChange({valueMicro: parsedMicro});
      setText(
        formatCurrencyMicro(parsedMicro, currency, effectiveLocale, precision),
      );
    },
    [onChange, currency, effectiveLocale, precision],
  );

  return (
    <View style={styles.currencyRow}>
      <AppText accessible={false} style={styles.currencySymbol} testID="currency-input-symbol">
        {symbol}
      </AppText>
      <TextInput
        accessibilityLabel={ariaLabel}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="decimal-pad"
        onBlur={() => {
          focusedRef.current = false;
          commit(text);
        }}
        onChangeText={setText}
        onFocus={() => {
          focusedRef.current = true;
        }}
        onSubmitEditing={() => commit(text)}
        placeholderTextColor={colors.textMuted}
        style={styles.currencyInput}
        testID={testID}
        value={text}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// ActionButton — primary button (web <Button variant="primary">) with a leading
// glyph + label, two sizes, and a loading state.
// ---------------------------------------------------------------------------

function ActionButton({
  label,
  glyph,
  onPress,
  size = 'md',
  loading = false,
  testID,
}: {
  label: string;
  glyph: string;
  onPress: () => void;
  size?: 'sm' | 'md';
  loading?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{disabled: loading, busy: loading}}
      disabled={loading}
      onPress={onPress}
      style={({pressed}) => [
        styles.primaryButton,
        size === 'sm' && styles.primaryButtonSm,
        loading && styles.buttonDisabled,
        pressed && !loading && styles.pressed,
      ]}
      testID={testID}>
      {loading ? (
        <ActivityIndicator color={colors.background} size="small" />
      ) : (
        <AppText accessible={false} allowFontScaling={false} style={styles.primaryButtonGlyph}>
          {glyph}
        </AppText>
      )}
      <AppText style={styles.primaryButtonText} weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// DraftRecoveryBanner — native port of the inline draft-restored notice. Native
// draft persistence is unavailable so `hasDraft` is always false and this banner
// stays dormant, but the restore/discard contract is preserved for parity.
// ---------------------------------------------------------------------------

function DraftRecoveryBanner({
  hasDraft,
  draftSavedAt,
  onDiscard,
  itemNoun,
  t,
}: {
  hasDraft: boolean;
  draftSavedAt: Date | null;
  onDiscard: () => void;
  itemNoun?: string;
  t: NativeTFunction;
}) {
  const [dismissed, setDismissed] = useState(false);
  if (!hasDraft || dismissed) {
    return null;
  }

  const when = draftSavedAt
    ? formatRelativeShort(draftSavedAt)
    : t('draft.unknownTime', 'a moment ago');

  const message = itemNoun
    ? t('draft.restoredItem', '{{noun}} draft restored from {{when}}.', {
        noun: itemNoun,
        when,
      })
    : t('draft.restored', 'Draft restored from {{when}}.', {when});

  return (
    <View style={styles.draftBanner}>
      <AppText style={styles.draftMessage}>{message}</AppText>
      <View style={styles.draftActions}>
        <Pressable
          accessibilityRole="button"
          hitSlop={6}
          onPress={() => setDismissed(true)}
          style={({pressed}) => [styles.ghostButton, pressed && styles.pressed]}>
          <AppText style={styles.ghostButtonText}>
            {t('draft.useDraft', 'Use draft')}
          </AppText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          hitSlop={6}
          onPress={() => {
            setDismissed(true);
            onDiscard();
          }}
          style={({pressed}) => [styles.ghostButton, pressed && styles.pressed]}>
          <AppText style={styles.ghostButtonText}>
            {t('draft.discardDraft', 'Discard draft')}
          </AppText>
        </Pressable>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// GeneralSettings
// ---------------------------------------------------------------------------

export function GeneralSettings() {
  const t = useSettingsTranslation();
  const toast = useToast();
  const {data: settings, isLoading} = useSettings();
  const settingsMut = useSaveSettings();

  // Persist form drafts (browser: localStorage). On native this is an in-memory
  // mirror — see useFormDraft above. None of the persisted fields are server
  // credentials.
  const {
    value: form,
    setValue: setForm,
    hasDraft,
    draftSavedAt,
    discardDraft,
  } = useFormDraft<AppSettings>('settings:general', DEFAULT_FORM, {
    version: 1,
    debounceMs: 800,
    maxAgeMs: 24 * 60 * 60 * 1000,
    skipPersist: value => {
      if (settingsMut.isPending) {
        return true;
      }
      if (!settings) {
        return true;
      }
      try {
        return JSON.stringify(value) === JSON.stringify(settings);
      } catch {
        return false;
      }
    },
  });
  const [saved, setSaved] = useState(false);

  // In-app navigation guard. The settings form has no explicit isDirty flag, so
  // diff the in-progress draft against the persisted server snapshot.
  const isDirty = useMemo(() => {
    if (!settings) {
      return false;
    }
    if (settingsMut.isPending) {
      return false;
    }
    try {
      return JSON.stringify(form) !== JSON.stringify(settings);
    } catch {
      return false;
    }
  }, [form, settings, settingsMut.isPending]);
  useNavigationGuard(isDirty, t('forms.unsavedSettings', 'You have unsaved settings.'));

  const [formInited, setFormInited] = useState(false);
  if (settings && !formInited) {
    // Only hydrate from the server snapshot if no draft was restored.
    if (!hasDraft) {
      setForm(settings);
    }
    setFormInited(true);
  }

  // Sync from Car
  const {data: vehicles} = useVehicles();
  const firstVehicleId = vehicles?.[0]?.id ?? null;
  const {data: carPrefs} = useCarPreferences(firstVehicleId);

  function syncUnitsFromCar() {
    if (!carPrefs) {
      return;
    }
    const updates: Partial<AppSettings> = {};

    if (isSettingMiles(carPrefs.setting_distance_unit)) {
      updates.unit_of_length = 'mi';
    } else if (carPrefs.setting_distance_unit) {
      updates.unit_of_length = 'km';
    }

    if (isSettingFahrenheit(carPrefs.setting_temperature_unit)) {
      updates.unit_of_temp = 'F';
    } else if (carPrefs.setting_temperature_unit) {
      updates.unit_of_temp = 'C';
    }

    if (isSettingPSI(carPrefs.setting_tire_pressure_unit)) {
      updates.unit_of_pressure = 'psi';
    } else if (isSettingBar(carPrefs.setting_tire_pressure_unit)) {
      updates.unit_of_pressure = 'bar';
    }

    if (Object.keys(updates).length > 0) {
      const newForm = {...form, ...updates};
      setForm(newForm);
      settingsMut.mutate(newForm);
      toast.success(
        t('toast.unitsSynced', 'Units synced from car'),
        `${t('distance', 'Distance')}: ${
          updates.unit_of_length === 'mi'
            ? t('miles', 'Miles')
            : t('kilometers', 'Kilometers')
        }, ${t('temperature', 'Temperature')}: ${
          updates.unit_of_temp === 'F'
            ? t('fahrenheit', 'Fahrenheit')
            : t('celsius', 'Celsius')
        }, ${t('pressure', 'Pressure')}: ${
          updates.unit_of_pressure === 'psi' ? 'PSI' : 'Bar'
        }`,
      );
    } else {
      toast.info(
        t('toast.noChanges', 'No changes'),
        t('toast.noChangesDesc', 'Could not detect car unit preferences'),
      );
    }
  }

  const showCarSyncBanner =
    !!carPrefs &&
    (!!carPrefs.setting_distance_unit || !!carPrefs.setting_temperature_unit);
  const showClockBanner = !!carPrefs && carPrefs.setting_24hr_time != null;

  return (
    <FadeIn delay={0.1}>
      <GlassPanel style={styles.panel}>
        <View style={styles.panelStack}>
          <View style={styles.header}>
            <IconBox>
              <AppText accessible={false} allowFontScaling={false} style={styles.headerGlyph}>
                {SETTINGS_GLYPH}
              </AppText>
            </IconBox>
            <View style={styles.headerText}>
              <AppText style={styles.title} weight="semibold">
                {t('app.title', 'Application')}
              </AppText>
              <AppText style={styles.subtitle}>
                {t('app.subtitle', 'Units, language, and cost preferences')}
              </AppText>
            </View>
          </View>

          <DraftRecoveryBanner
            draftSavedAt={draftSavedAt}
            hasDraft={hasDraft}
            itemNoun={t('draft.noun.settings', 'Settings')}
            onDiscard={() => {
              discardDraft();
              if (settings) {
                setForm(settings);
              }
            }}
            t={t}
          />

          {isLoading ? (
            <View style={styles.skeletonGrid}>
              {[1, 2, 3, 4, 5].map(i => (
                <Skeleton key={i} testID="settings-skeleton" />
              ))}
            </View>
          ) : (
            <>
              {showCarSyncBanner ? (
                <View style={styles.carBanner}>
                  <View style={styles.carBannerInfo}>
                    <AppText accessible={false} allowFontScaling={false} style={styles.carGlyph}>
                      {CAR_GLYPH}
                    </AppText>
                    <View style={styles.carBannerTextWrap}>
                      <AppText style={styles.carBannerTitle}>
                        {t('app.carUses', 'Car uses')}{' '}
                        {parseSettingEnum(carPrefs?.setting_distance_unit, 'distance')} /{' '}
                        {parseSettingEnum(
                          carPrefs?.setting_temperature_unit,
                          'temperature',
                        )}{' '}
                        / {parseSettingEnum(carPrefs?.setting_tire_pressure_unit, 'pressure')}
                      </AppText>
                      <AppText style={styles.carBannerHint}>
                        {t(
                          'app.syncHint',
                          "Sync your app's units to match your vehicle's display settings",
                        )}
                      </AppText>
                    </View>
                  </View>
                  <ActionButton
                    glyph={DOWNLOAD_GLYPH}
                    label={t('app.syncFromCar', 'Sync from Car')}
                    onPress={syncUnitsFromCar}
                    size="sm"
                    testID="settings-sync-from-car"
                  />
                </View>
              ) : null}

              {showClockBanner ? (
                <View style={styles.clockBanner}>
                  <AppText accessible={false} allowFontScaling={false} style={styles.clockGlyph}>
                    {CLOCK_GLYPH}
                  </AppText>
                  <View style={styles.clockTextWrap}>
                    <AppText style={styles.clockText}>
                      {t('app.carClockFormat', 'Car clock format')}:{' '}
                      <AppText style={styles.clockTextStrong} weight="semibold">
                        {carPrefs?.setting_24hr_time
                          ? t('app.clock24h', '24-hour')
                          : t('app.clock12h', '12-hour')}
                      </AppText>
                    </AppText>
                    <AppText style={styles.clockHint}>
                      {t(
                        'app.clockFormatHint',
                        "Your vehicle's time display preference (read-only)",
                      )}
                    </AppText>
                  </View>
                </View>
              ) : null}

              <View style={styles.fieldGrid}>
                <SelectField
                  accessibilityLabel={t('app.distanceUnit', 'Distance Unit')}
                  label={t('app.distanceUnit', 'Distance Unit')}
                  onValueChange={next => setForm({...form, unit_of_length: next})}
                  options={[
                    {value: 'km', label: t('app.kilometers', 'Kilometers')},
                    {value: 'mi', label: t('app.miles', 'Miles')},
                  ]}
                  testID="settings-distance-unit"
                  value={form.unit_of_length}
                />
                <SelectField
                  accessibilityLabel={t('app.temperatureUnit', 'Temperature Unit')}
                  label={t('app.temperatureUnit', 'Temperature Unit')}
                  onValueChange={next => setForm({...form, unit_of_temp: next})}
                  options={[
                    {value: 'C', label: t('app.celsius', 'Celsius')},
                    {value: 'F', label: t('app.fahrenheit', 'Fahrenheit')},
                  ]}
                  testID="settings-temperature-unit"
                  value={form.unit_of_temp}
                />
                <SelectField
                  accessibilityLabel={t('app.pressureUnit', 'Pressure Unit')}
                  label={t('app.pressureUnit', 'Pressure Unit')}
                  onValueChange={next => setForm({...form, unit_of_pressure: next})}
                  options={[
                    {value: 'bar', label: t('app.bar', 'Bar')},
                    {value: 'psi', label: t('app.psi', 'PSI')},
                  ]}
                  testID="settings-pressure-unit"
                  value={form.unit_of_pressure ?? 'bar'}
                />
                <SelectField
                  accessibilityLabel={t('app.preferredRange', 'Preferred Range')}
                  label={t('app.preferredRange', 'Preferred Range')}
                  onValueChange={next => setForm({...form, preferred_range: next})}
                  options={[
                    {value: 'rated', label: t('app.rated', 'Rated')},
                    {value: 'ideal', label: t('app.ideal', 'Ideal')},
                  ]}
                  testID="settings-preferred-range"
                  value={form.preferred_range}
                />

                <View>
                  <TextField
                    accessibilityLabel={t('app.decimalPrecision', 'Decimal Precision')}
                    keyboardType="number-pad"
                    label={t('app.decimalPrecision', 'Decimal Precision')}
                    onChangeText={text =>
                      setForm({
                        ...form,
                        decimal_precision: Math.max(
                          0,
                          Math.min(20, Number(text) || 0),
                        ),
                      })
                    }
                    placeholder="e.g. 2"
                    testID="settings-decimal-precision"
                    value={String(form.decimal_precision)}
                  />
                  <AppText style={styles.previewText}>
                    {t('app.preview', 'Preview')}:{' '}
                    {(14.248539).toFixed(clampPrecision(form.decimal_precision))}
                  </AppText>
                </View>

                <SelectField
                  accessibilityLabel={t('app.language', 'Language')}
                  label={t('app.language', 'Language')}
                  onValueChange={next => setForm({...form, language: next})}
                  options={[
                    {value: 'en', label: 'English'},
                    {value: 'de', label: 'Deutsch'},
                    {value: 'fr', label: 'Fran\u00E7ais'},
                    {value: 'es', label: 'Espa\u00F1ol'},
                    {value: 'zh', label: '\u4E2D\u6587'},
                  ]}
                  testID="settings-language"
                  value={form.language}
                />

                <SelectField
                  accessibilityLabel={t('app.currency', 'Currency')}
                  label={t('app.currency', 'Currency')}
                  onValueChange={next => setForm({...form, currency_symbol: next})}
                  options={[
                    {value: '$', label: 'USD ($)'},
                    {value: '\u20AC', label: 'EUR (\u20AC)'},
                    {value: '\u00A3', label: 'GBP (\u00A3)'},
                    {value: 'C$', label: 'CAD (C$)'},
                    {value: 'A$', label: 'AUD (A$)'},
                    {value: '\u00A5', label: 'JPY (\u00A5)'},
                    {value: '\u5143', label: 'CNY (\u5143)'},
                    {value: 'CHF', label: 'CHF (CHF)'},
                    {value: 'kr', label: 'SEK / NOK / DKK (kr)'},
                    {value: '\u20B9', label: 'INR (\u20B9)'},
                  ]}
                  testID="settings-currency"
                  value={form.currency_symbol ?? '$'}
                />

                <SelectField
                  accessibilityLabel={t('app.locale', 'Number & Date Locale')}
                  label={t('app.locale', 'Number & Date Locale')}
                  onValueChange={next => setForm({...form, locale: next})}
                  options={[
                    {value: 'en-US', label: 'English (US) \u2014 1,234.56'},
                    {value: 'en-GB', label: 'English (UK) \u2014 1,234.56'},
                    {value: 'de-DE', label: 'Deutsch (DE) \u2014 1.234,56'},
                    {value: 'fr-FR', label: 'Fran\u00E7ais (FR) \u2014 1 234,56'},
                    {value: 'es-ES', label: 'Espa\u00F1ol (ES) \u2014 1.234,56'},
                    {value: 'ja-JP', label: '\u65E5\u672C\u8A9E (JP) \u2014 1,234.56'},
                    {value: 'zh-CN', label: '\u7B80\u4F53\u4E2D\u6587 (CN) \u2014 1,234.56'},
                  ]}
                  testID="settings-locale"
                  value={form.locale ?? 'en-US'}
                />

                <SelectField
                  accessibilityLabel={t('app.tzDisplayDefault', 'Time Zone Display')}
                  label={t('app.tzDisplayDefault', 'Time Zone Display')}
                  onValueChange={next =>
                    setForm({
                      ...form,
                      tz_display_default: next as 'vehicle' | 'user' | 'utc',
                    })
                  }
                  options={[
                    {
                      value: 'vehicle',
                      label: t('app.tzVehicle', "Vehicle's local time (recommended)"),
                    },
                    {value: 'user', label: t('app.tzUser', 'My local time')},
                    {value: 'utc', label: t('app.tzUtc', 'UTC')},
                  ]}
                  testID="settings-tz-display"
                  value={form.tz_display_default ?? 'vehicle'}
                />

                <SettingField label={t('app.timezoneUser', 'My Time Zone Override')}>
                  <TextField
                    accessibilityLabel={t('app.timezoneUser', 'My Time Zone Override')}
                    onChangeText={text => setForm({...form, timezone_user: text})}
                    placeholder={t(
                      'app.timezoneUserPlaceholder',
                      'e.g. America/Los_Angeles (leave blank for browser default)',
                    )}
                    testID="settings-timezone-user"
                    value={form.timezone_user ?? ''}
                  />
                  <AppText style={styles.fieldHint}>
                    {t(
                      'app.timezoneUserHint',
                      "IANA tz name. Useful when travelling but you'd rather see times in your home zone.",
                    )}
                  </AppText>
                </SettingField>

                <SettingField
                  help={{
                    i18nKey: 'help.fields.settings.electricityCost',
                    content:
                      'Cost per kWh used to compute charging spend across drives, charging sessions, and TCO analytics. Currency follows the Currency setting above.',
                    for: 'electricity-cost',
                  }}
                  label={t('app.electricityCost', 'Electricity Cost (per kWh)')}>
                  <CurrencyField
                    ariaLabel={t('app.electricityCost', 'Electricity Cost (per kWh)')}
                    currency={symbolToIsoCode(form.currency_symbol)}
                    locale={form.locale ?? 'en-US'}
                    onChange={({valueMicro}) =>
                      setForm({
                        ...form,
                        base_cost_per_kwh: microToValue(valueMicro) ?? 0,
                      })
                    }
                    precision={form.decimal_precision ?? 2}
                    testID="settings-electricity-cost"
                    valueMicro={valueToMicro(form.base_cost_per_kwh)}
                  />
                </SettingField>

                <SettingField
                  label={t('app.gasPrice', 'Gas Price (for EV vs ICE comparison)')}>
                  <View style={styles.gasRow}>
                    <View style={styles.gasPriceWrap}>
                      <CurrencyField
                        ariaLabel={t('app.gasPrice', 'Gas Price (for EV vs ICE comparison)')}
                        currency={symbolToIsoCode(form.currency_symbol)}
                        locale={form.locale ?? 'en-US'}
                        onChange={({valueMicro}) =>
                          setForm({
                            ...form,
                            gas_price_per_unit: microToValue(valueMicro) ?? 0,
                          })
                        }
                        precision={form.decimal_precision ?? 2}
                        testID="settings-gas-price"
                        valueMicro={valueToMicro(form.gas_price_per_unit)}
                      />
                    </View>
                    <View style={styles.gasUnitWrap}>
                      <SelectField
                        accessibilityLabel={t('app.gasUnit', 'Gas unit')}
                        onValueChange={next => setForm({...form, gas_unit: next})}
                        options={[
                          {value: 'gallon', label: t('app.perGallon', '/ gallon')},
                          {value: 'liter', label: t('app.perLiter', '/ liter')},
                        ]}
                        testID="settings-gas-unit"
                        value={form.gas_unit}
                      />
                    </View>
                  </View>
                </SettingField>

                <SettingField label={t('app.comparisonMPG', 'Comparison Vehicle MPG')}>
                  <TextField
                    accessibilityLabel={t('app.comparisonMPG', 'Comparison Vehicle MPG')}
                    keyboardType="decimal-pad"
                    onChangeText={text =>
                      setForm({...form, gas_efficiency_mpg: parseFloat(text) || 0})
                    }
                    placeholder={t('app.mpgPlaceholder', 'Average MPG of equivalent gas car')}
                    testID="settings-comparison-mpg"
                    value={String(form.gas_efficiency_mpg)}
                  />
                </SettingField>
              </View>
            </>
          )}

          <View style={styles.footer}>
            <ActionButton
              glyph={SAVE_GLYPH}
              label={t('app.save', 'Save Settings')}
              loading={settingsMut.isPending}
              onPress={() =>
                settingsMut.mutate(form, {
                  onSuccess: () => {
                    toast.success(
                      t('toast.saved', 'Settings saved'),
                      t('toast.savedDesc', 'Your preferences have been updated'),
                    );
                    setSaved(true);
                    setTimeout(() => setSaved(false), 3000);
                  },
                  onError: () =>
                    toast.error(
                      t('toast.saveFailed', 'Failed to save'),
                      t('toast.saveFailedDesc', 'Could not update settings'),
                    ),
                })
              }
              testID="settings-save"
            />
            {saved ? (
              <View style={styles.savedIndicator}>
                <AppText accessible={false} allowFontScaling={false} style={styles.savedGlyph}>
                  {CHECK_GLYPH}
                </AppText>
                <AppText style={styles.savedText}>
                  {t('app.settingsSaved', 'Settings saved')}
                </AppText>
              </View>
            ) : null}
          </View>
        </View>
      </GlassPanel>
    </FadeIn>
  );
}

GeneralSettings.displayName = 'GeneralSettings';

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  carBanner: {
    alignItems: 'center',
    backgroundColor: CYAN_BANNER_BG,
    borderColor: CYAN_BANNER_BORDER,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  carBannerHint: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
  },
  carBannerInfo: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: spacing.md,
  },
  carBannerTextWrap: {
    flex: 1,
  },
  carBannerTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    marginBottom: 2,
  },
  carGlyph: {
    color: NEON_CYAN,
    fontSize: 18,
  },
  clockBanner: {
    alignItems: 'center',
    backgroundColor: FILL_FAINT,
    borderColor: HAIRLINE_FAINT,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  clockGlyph: {
    color: NEON_AMBER,
    fontSize: 16,
  },
  clockHint: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
  },
  clockText: {
    color: colors.textPrimary,
    fontSize: 14,
    marginBottom: 2,
  },
  clockTextStrong: {
    color: colors.textPrimary,
  },
  clockTextWrap: {
    flex: 1,
  },
  currencyInput: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 14,
    paddingVertical: spacing.sm,
  },
  currencyRow: {
    alignItems: 'center',
    backgroundColor: FIELD_FILL,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  currencySymbol: {
    color: colors.textMuted,
    fontSize: 12,
  },
  draftActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  draftBanner: {
    backgroundColor: 'rgba(56, 189, 248, 0.08)',
    borderColor: 'rgba(56, 189, 248, 0.3)',
    borderRadius: 12,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  draftMessage: {
    color: colors.textPrimary,
    fontSize: 13,
  },
  fieldGrid: {
    gap: spacing.lg,
  },
  fieldHint: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 14,
    marginTop: 4,
  },
  fieldLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  footer: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  gasPriceWrap: {
    flex: 1,
  },
  gasRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  gasUnitWrap: {
    width: 124,
  },
  ghostButton: {
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  ghostButtonText: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  headerGlyph: {
    color: NEON_CYAN,
    fontSize: 20,
  },
  headerText: {
    flex: 1,
  },
  helpGlyph: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
  helpGlyphWrap: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    height: 16,
    justifyContent: 'center',
    width: 16,
  },
  iconBox: {
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
    borderColor: CYAN_BANNER_BORDER,
    borderRadius: 12,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  input: {
    backgroundColor: FIELD_FILL,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 14,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  labelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    marginBottom: 6,
  },
  panel: {
    padding: spacing.lg,
  },
  panelStack: {
    gap: spacing.lg,
  },
  popoverItem: {
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  popoverItemActive: {
    backgroundColor: colors.surfaceSelected,
  },
  popoverItemPressed: {
    backgroundColor: colors.surfaceHover,
  },
  popoverItemText: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  popoverItemTextActive: {
    color: colors.textPrimary,
  },
  popoverList: {
    gap: 2,
    padding: spacing.xs,
  },
  popoverMenu: {
    ...shadows.panel,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    maxHeight: 360,
    maxWidth: 360,
    minWidth: 240,
  },
  popoverOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  pressed: {
    opacity: 0.82,
  },
  previewText: {
    color: colors.textMuted,
    fontSize: 10,
    marginTop: 4,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: 12,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.lg,
  },
  primaryButtonGlyph: {
    color: colors.background,
    fontSize: 15,
  },
  primaryButtonSm: {
    minHeight: 34,
    paddingHorizontal: spacing.md,
  },
  primaryButtonText: {
    color: colors.background,
    fontSize: 14,
  },
  savedGlyph: {
    color: EMERALD_300,
    fontSize: 14,
  },
  savedIndicator: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  savedText: {
    color: EMERALD_300,
    fontSize: 14,
  },
  selectCaret: {
    color: colors.textMuted,
    fontSize: 12,
    marginLeft: spacing.sm,
  },
  selectTrigger: {
    alignItems: 'center',
    backgroundColor: FIELD_FILL,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  selectTriggerText: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 14,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
    height: 64,
  },
  skeletonGrid: {
    gap: spacing.md,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 12,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 16,
  },
});

export default GeneralSettings;
