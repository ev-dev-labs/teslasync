// Native parity port of web/src/components/forms/UnitInput.tsx.
//
// The web source is a number-with-unit field built on the @/components/ui
// <Input> DOM primitive (label + <input type="text"> + suffix <span>), the
// @/hooks/useSettings hook, and the @/lib/unitInput parser/formatter/symbol
// helpers. It stores a CANONICAL metric value (miles, mph, °C, kWh, percent,
// currency-as-typed) and renders/parses it in the user's preferred display
// unit, with a local text buffer so live typing is never clobbered by an
// external value/settings change while the field is focused.
//
// This port reproduces the same state machine, canonical-storage contract,
// locale-aware parsing, suffix tolerance, and visual intent with React Native
// View/TextInput primitives, the design tokens, and AppText -- with no DOM,
// no recharts/leaflet, and no web UI components.
//
// Native-safe adaptations (documented in the sidecar):
//   * No native parity module exists yet for web's @/lib/unitInput, so its
//     pure helpers (parseForUnit / formatForUnit / unitSymbol + the private
//     conversion/locale-number helpers) are inlined here verbatim -- the same
//     approach the data-display/format/Currency.tsx port took for
//     lib/numberFormat. They are also re-exported so a future <UnitInput>
//     consumer keeps the same import surface.
//   * Web reads `const { settings } = useSettings()` from @/hooks/useSettings.
//     Native parity exposes settings via the TanStack Query hook in
//     ../../api/hooks/useSettings, which returns `{ data }`; the value is
//     resolved against UNIT_INPUT_SETTINGS_DEFAULTS (mirroring web's defaults)
//     so the helpers always receive the unit-relevant fields they read.
//   * The web `<Input>` wrapper (label / suffix / error / hint) is rebuilt
//     inline: an AppText label, a bordered field row holding the TextInput +
//     the aria-hidden unit symbol (testID="unit-input-symbol"), and an
//     error/hint message line. Web-only Input affordances (className, size,
//     help icon) have no native analogue and no consumer requires them, so
//     they are intentionally dropped; the data-bearing props are preserved.
//   * Web `onKeyDown` Enter-to-commit becomes RN `onSubmitEditing` (the
//     reliable single-line return event); blur still commits. `focusedRef`
//     is preserved exactly (a ref, not state) so focus changes do not trigger
//     the extra re-render the source deliberately avoids.

import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, spacing, typography} from '../../../theme/tokens';
import {useSettings, type AppSettings} from '../../api/hooks/useSettings';

/* ── Unit kind + inlined parser/formatter/symbol helpers ─────────────────────
 * Faithful port of web/src/lib/unitInput.ts. No native parity module exists for
 * it yet, so the pure helpers live here (re-exported below for callers).
 *
 * Canonical units (same as the rest of TeslaSync):
 *   distance     → miles      (display: 'mi' or 'km')
 *   speed        → mph        (display: 'mph' or 'km/h')
 *   temperature  → Celsius    (display: '°C' or '°F')
 *   energy       → kWh        (no per-user conversion)
 *   percent      → 0..100     (no per-user conversion)
 *   currency     → as-typed   (no FX; symbol from settings.currency_symbol)
 */

export type UnitKind =
  | 'distance'
  | 'energy'
  | 'temperature'
  | 'speed'
  | 'percent'
  | 'currency';

export interface ParseOptions {
  /**
   * When true, parse with plain `Number()` only (no locale-aware separator
   * handling). The Blocked-Path escape for adopters whose input data uses
   * separators that collide with the user's locale.
   */
  strict?: boolean;
}

/**
 * The unit-relevant subset of AppSettings the helpers actually read. Web's
 * helpers take the full AppSettings but only touch these fields, so accepting
 * the subset is behavior-equivalent and lets the component pass a resolved
 * default when the settings query has not loaded yet.
 */
type UnitInputSettings = Pick<
  AppSettings,
  'unit_of_length' | 'unit_of_temp' | 'decimal_precision' | 'locale' | 'currency_symbol'
>;

const UNIT_INPUT_SETTINGS_DEFAULTS: UnitInputSettings = {
  unit_of_length: 'km',
  unit_of_temp: 'C',
  decimal_precision: 2,
  locale: 'en-US',
  currency_symbol: '$',
};

const KM_PER_MI = 1.609344;

function distanceDisplayToCanonical(displayValue: number): number {
  return displayValue / KM_PER_MI;
}

function distanceCanonicalToDisplay(canonicalValue: number): number {
  return canonicalValue * KM_PER_MI;
}

function tempDisplayToCanonical(displayValue: number): number {
  return ((displayValue - 32) * 5) / 9;
}

function tempCanonicalToDisplay(canonicalValue: number): number {
  return (canonicalValue * 9) / 5 + 32;
}

/**
 * Locale resolution helper — single source of truth for BCP-47 fallback.
 * The settings API can return `locale: ''`; `??` does not catch empty strings,
 * and `new Intl.NumberFormat('')` throws, so degrade to en-US instead.
 */
function resolveLocale(locale: string | null | undefined): string {
  if (typeof locale === 'string' && locale.trim().length > 0) {
    return locale;
  }
  return 'en-US';
}

/** Longest-first so 'km/h' is stripped before 'km', 'kwh' before 'kw'. */
const STRIPPABLE_SUFFIXES = [
  'km/h',
  'kwh',
  'mph',
  '°c',
  '°f',
  'kw',
  'mi',
  'km',
  '°',
] as const;

/**
 * Parse a user-entered string into the canonical metric value for the given
 * unit kind. Returns `null` for empty / unparseable input. Handles leading/
 * trailing whitespace, locale-aware decimal/group separators (unless strict),
 * trailing unit suffixes, a leading currency symbol, trailing '%', and
 * accounting parentheses for negative currency ("($10)" → -10).
 */
export function parseForUnit(
  text: string,
  unit: UnitKind,
  settings: UnitInputSettings,
  options: ParseOptions = {},
): number | null {
  let raw = (text ?? '').trim();
  if (!raw) {
    return null;
  }

  if (unit === 'currency') {
    const symbol = (settings.currency_symbol ?? '').trim() || '$';
    if (raw.startsWith(symbol)) {
      raw = raw.slice(symbol.length).trim();
    }
    // Accounting parens: "(123.45)" → "-123.45"
    if (raw.startsWith('(') && raw.endsWith(')')) {
      raw = '-' + raw.slice(1, -1).trim();
      // Re-strip currency symbol if it was inside the parens, e.g. "($10)"
      if (raw.startsWith('-' + symbol)) {
        raw = '-' + raw.slice(1 + symbol.length).trim();
      }
    }
  }

  if (unit === 'percent' && raw.endsWith('%')) {
    raw = raw.slice(0, -1).trim();
  }

  // Strip a trailing unit symbol (case-insensitive longest match).
  const lower = raw.toLowerCase();
  for (const sfx of STRIPPABLE_SUFFIXES) {
    if (lower.endsWith(sfx)) {
      raw = raw.slice(0, raw.length - sfx.length).trim();
      break;
    }
  }

  if (!raw) {
    return null;
  }

  const n = options.strict
    ? Number(raw)
    : parseLocaleNumber(raw, resolveLocale(settings.locale));

  if (!Number.isFinite(n)) {
    return null;
  }

  switch (unit) {
    case 'distance':
    case 'speed':
      // Display unit → canonical (miles/mph).
      return settings.unit_of_length === 'km'
        ? distanceDisplayToCanonical(n)
        : n;
    case 'temperature':
      // Display unit → canonical (°C).
      return settings.unit_of_temp === 'F' ? tempDisplayToCanonical(n) : n;
    case 'energy':
    case 'percent':
    case 'currency':
      return n;
  }
}

/**
 * Format a canonical metric value as display text for the input field. Uses
 * `Intl.NumberFormat` so the decimal separator matches the user's locale.
 * Group separators are intentionally OFF (cursor/parse round-trip behaviour).
 * Returns '' for null / non-finite values so the field shows blank.
 */
export function formatForUnit(
  value: number | null | undefined,
  unit: UnitKind,
  settings: UnitInputSettings,
): string {
  if (value == null || !Number.isFinite(value)) {
    return '';
  }
  const locale = resolveLocale(settings.locale);
  const decimals = settings.decimal_precision ?? 2;

  const display = ((): number => {
    switch (unit) {
      case 'distance':
      case 'speed':
        return settings.unit_of_length === 'km'
          ? distanceCanonicalToDisplay(value)
          : value;
      case 'temperature':
        return settings.unit_of_temp === 'F'
          ? tempCanonicalToDisplay(value)
          : value;
      case 'energy':
      case 'percent':
      case 'currency':
        return value;
    }
  })();

  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.max(0, decimals),
    useGrouping: false,
  }).format(display);
}

/**
 * Returns the unit symbol shown in the input adornment.
 *   distance → 'mi' | 'km'; speed → 'mph' | 'km/h'; temperature → '°C' | '°F';
 *   energy → 'kWh'; percent → '%'; currency → settings.currency_symbol (or '$').
 */
export function unitSymbol(unit: UnitKind, settings: UnitInputSettings): string {
  switch (unit) {
    case 'distance':
      return settings.unit_of_length === 'km' ? 'km' : 'mi';
    case 'speed':
      return settings.unit_of_length === 'km' ? 'km/h' : 'mph';
    case 'temperature':
      return settings.unit_of_temp === 'F' ? '°F' : '°C';
    case 'energy':
      return 'kWh';
    case 'percent':
      return '%';
    case 'currency':
      return (settings.currency_symbol ?? '').trim() || '$';
  }
}

/**
 * Parse `text` as a number using the locale's decimal & group separators.
 * Falls back to plain `Number()` when the locale cannot be inspected.
 *   parseLocaleNumber('1,234.56', 'en-US') → 1234.56
 *   parseLocaleNumber('1.234,56', 'de-DE') → 1234.56
 */
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
    // keep en-US defaults
  }

  let normalized = text;
  if (groupSep && groupSep !== decimalSep) {
    normalized = normalized.split(groupSep).join('');
  }
  if (decimalSep !== '.') {
    normalized = normalized.split(decimalSep).join('.');
  }
  return Number(normalized);
}

/* ── Props ───────────────────────────────────────────────────────────────── */

export interface UnitInputProps
  extends Omit<
    TextInputProps,
    'value' | 'onChange' | 'onChangeText' | 'defaultValue'
  > {
  /** Canonical metric value (miles, mph, °C, kWh, percent, or currency). */
  value: number | null;
  /** Called with the canonical metric value (or null when blank). */
  onChange: (next: number | null) => void;
  /** Which unit family this input represents. */
  unit: UnitKind;
  /**
   * Pass `true` to disable locale-aware decimal/group separator normalisation.
   * Use as the Blocked-Path escape when input data uses ambiguous separators
   * that collide with the user's locale.
   */
  parseStrict?: boolean;
  /** Field label rendered above the input (parity for web Input `label`). */
  label?: string;
  /** Error message rendered below the input (parity for web Input `error`). */
  error?: string;
  /** Hint message rendered below the input when there is no error. */
  hint?: string;
  /** Style override for the outer field container. */
  containerStyle?: StyleProp<ViewStyle>;
}

/* ── Component ───────────────────────────────────────────────────────────────
 * UnitInput keeps a local text buffer separate from the parent's canonical
 * value so the user can type freely (no per-keystroke parse/re-format that
 * would jump the caret) while the field still re-syncs to the latest
 * canonical-formatted display whenever the parent value or the user's unit
 * preference changes — UNLESS the user is currently focused and editing.
 */
export const UnitInput = forwardRef<TextInput, UnitInputProps>(function UnitInput(
  {
    value,
    onChange,
    unit,
    parseStrict,
    onBlur,
    onFocus,
    onSubmitEditing,
    label,
    error,
    hint,
    containerStyle,
    style,
    editable,
    ...rest
  },
  ref,
) {
  const {data: settingsData} = useSettings();
  const settings = settingsData ?? UNIT_INPUT_SETTINGS_DEFAULTS;

  const display = useMemo(
    () => formatForUnit(value, unit, settings),
    [value, unit, settings],
  );
  const symbol = useMemo(() => unitSymbol(unit, settings), [unit, settings]);

  const [text, setText] = useState<string>(display);

  // Track focus internally so an external value/settings change while the user
  // is typing does NOT clobber the in-progress text. A ref avoids the extra
  // re-render that a `useState<boolean>` would trigger on every focus/blur.
  const focusedRef = useRef(false);

  // Mirror the live buffer into a ref so the blur handler can read the latest
  // typed text (RN blur events do not carry the field value the way the web
  // `e.currentTarget.value` does).
  const textRef = useRef(display);
  const applyText = useCallback((next: string) => {
    textRef.current = next;
    setText(next);
  }, []);

  // Resync local buffer when the formatted display changes — but only when the
  // user is NOT currently editing, so an external setting change doesn't
  // clobber in-progress input.
  useEffect(() => {
    if (focusedRef.current) {
      return;
    }
    applyText(display);
  }, [applyText, display]);

  const commit = useCallback(
    (raw: string) => {
      const parsed = parseForUnit(raw, unit, settings, {strict: !!parseStrict});
      onChange(parsed);
      // Renormalise the visible text to the canonical-rounded form so typing
      // "60.0001" → blur → "60" feels predictable.
      applyText(formatForUnit(parsed, unit, settings));
    },
    [applyText, onChange, parseStrict, settings, unit],
  );

  const handleFocus = useCallback<NonNullable<TextInputProps['onFocus']>>(
    e => {
      focusedRef.current = true;
      onFocus?.(e);
    },
    [onFocus],
  );

  const handleBlur = useCallback<NonNullable<TextInputProps['onBlur']>>(
    e => {
      focusedRef.current = false;
      commit(textRef.current);
      onBlur?.(e);
    },
    [commit, onBlur],
  );

  const handleSubmitEditing = useCallback<
    NonNullable<TextInputProps['onSubmitEditing']>
  >(
    e => {
      commit(e.nativeEvent.text);
      onSubmitEditing?.(e);
    },
    [commit, onSubmitEditing],
  );

  const isEditable = editable ?? true;

  return (
    <View style={[styles.container, containerStyle]}>
      {label ? (
        <AppText
          variant="caption"
          tone="secondary"
          weight="semibold"
          style={styles.label}>
          {label}
        </AppText>
      ) : null}

      <View
        style={[
          styles.field,
          !isEditable && styles.fieldDisabled,
          !!error && styles.fieldError,
        ]}>
        <TextInput
          ref={ref}
          {...rest}
          value={text}
          editable={isEditable}
          onChangeText={applyText}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onSubmitEditing={handleSubmitEditing}
          inputMode="decimal"
          autoComplete="off"
          autoCorrect={false}
          autoCapitalize="none"
          placeholderTextColor={colors.textMuted}
          style={[styles.input, style]}
        />
        <AppText
          variant="caption"
          tone="muted"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          testID="unit-input-symbol"
          style={styles.symbol}>
          {symbol}
        </AppText>
      </View>

      {error ? (
        <AppText variant="caption" tone="danger" style={styles.message}>
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="caption" tone="muted" style={styles.message}>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
});

UnitInput.displayName = 'UnitInput';

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  label: {
    marginBottom: spacing.xs / 2,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    minHeight: 40,
  },
  fieldDisabled: {
    opacity: 0.5,
  },
  fieldError: {
    borderColor: colors.danger,
  },
  input: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: typography.body,
    paddingVertical: spacing.sm,
  },
  symbol: {
    marginLeft: spacing.sm,
  },
  message: {
    marginTop: spacing.xs / 2,
  },
});
