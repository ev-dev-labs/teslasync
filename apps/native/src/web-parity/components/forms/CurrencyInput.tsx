/**
 * Shared `<CurrencyInput>` primitive — React Native parity port of
 * web/src/components/forms/CurrencyInput.tsx.
 *
 * A currency-aware number field that:
 *   1. Stores its value in **integer micro-units** (1 USD = 1_000_000)
 *      to avoid floating-point round-trip loss across currencies that
 *      have 0/2/3/4 fractional digits — see the inlined currency helpers
 *      (native-safe port of web `lib/currencyFormat.ts`).
 *   2. Renders the value formatted with `Intl.NumberFormat`'s `style:
 *      'currency'` so the symbol / position / decimal separator match
 *      the user's locale ("$1.50" vs "1,50 €"). Hermes ships `Intl`, so
 *      the same formatting path works on native.
 *   3. Parses user-typed text on blur / submit (Enter), accepting:
 *        - the localized symbol on either side ("$1.50", "1,50 €")
 *        - the literal ISO code ("USD 1.50")
 *        - locale group separators ("1,234.56" en-US, "1.234,56" de-DE)
 *        - accounting parentheses for negatives ("($1.50)" → -1.5)
 *   4. Re-syncs from the parent's `valueMicro` whenever it changes
 *      WITHOUT clobbering text the user is currently typing — the
 *      resync only happens when the input is not focused.
 *
 * Use as a drop-in replacement for raw numeric `<TextInput>` patterns
 * that previously paired a number with a hand-rolled currency symbol.
 *
 * The web original imported `<Input>` from `@/components/ui` and the
 * currency helpers from `@/lib/currencyFormat`. Neither has a separate
 * native parity port yet, so both are reproduced locally here as
 * native-safe equivalents (documented in the parity sidecar).
 *
 * @example
 *   <CurrencyInput
 *     ariaLabel={t('settings.electricityCost', 'Electricity Cost (per kWh)')}
 *     valueMicro={form.tariffMicro}
 *     currency="USD"
 *     locale="en-US"
 *     onChange={({valueMicro}) => setForm({...form, tariffMicro: valueMicro})}
 *   />
 */

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
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

// ───────────────── currency helpers (native-safe port of web ─────────────────
// lib/currencyFormat.ts). Pure `Intl`-based logic, no DOM — reproduced here
// because the web `@/lib/currencyFormat` module has no separate native port yet.

const MICRO_SCALE = 1_000_000;

/** Convert a major-unit number to integer micro-units. */
function valueToMicro(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }
  // Round to nearest integer micro to prevent 0.1 + 0.2 style FP drift
  // from leaking into storage. Math.round handles negatives correctly.
  return Math.round(value * MICRO_SCALE);
}

/** Convert integer micro-units back to the major unit. */
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

/**
 * Format a major-unit value as currency text using `Intl.NumberFormat`.
 * Returns '' for null/non-finite. `useGrouping` defaults to false because
 * group separators inside an editable field cause cursor + round-trip pain.
 */
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
    // Invalid currency code (not ISO 4217) — fall back to a plain decimal
    // and prefix the literal code so the field still renders something.
    const plain = new Intl.NumberFormat(lc, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      useGrouping,
    }).format(value);
    return `${currency} ${plain}`.trim();
  }
}

/** Format a micro-unit value as currency text. */
function formatCurrencyMicro(
  micro: number | null | undefined,
  currency: string,
  locale: string,
  precision: number,
  options: {useGrouping?: boolean} = {},
): string {
  return formatCurrencyValue(microToValue(micro), currency, locale, precision, options);
}

/**
 * Returns the localized currency symbol for the given currency/locale,
 * e.g. ('USD','en-US') → '$'. Falls back to the literal code when
 * `Intl.NumberFormat` rejects the code (non-ISO 4217).
 */
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

/**
 * Strip the currency symbol, the literal ISO code, and any plain-letter
 * adornment surrounding the numeric portion. Case-insensitive on the code.
 */
function stripCurrencyAdornments(raw: string, currency: string, locale: string): string {
  const symbol = currencySymbol(currency, locale);
  const code = currency.trim();

  // Symbol stripping — try start AND end since locales like de-DE
  // suffix the symbol ("1,50 €").
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

/**
 * Parse `text` as a number using the locale's decimal & group separators.
 *
 *   parseLocaleNumber('1,234.56', 'en-US') → 1234.56
 *   parseLocaleNumber('1.234,56', 'de-DE') → 1234.56
 *   parseLocaleNumber('1 234,56', 'fr-FR') → 1234.56
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
    // keep defaults
  }

  let normalized = text;
  // fr-FR uses U+00A0 (NBSP) as group separator; users typing in the
  // field will press the regular space bar. Normalise both to nothing.
  if (groupSep === '\u00A0' || groupSep === ' ') {
    normalized = normalized.split('\u00A0').join('').split(' ').join('');
  } else if (groupSep && groupSep !== decimalSep) {
    normalized = normalized.split(groupSep).join('');
  }
  if (decimalSep !== '.') {
    normalized = normalized.split(decimalSep).join('.');
  }
  // Strip any remaining whitespace that may have hitch-hiked from a paste.
  normalized = normalized.replace(/\s+/g, '');
  return Number(normalized);
}

/**
 * Parse a user-typed string as a major-unit number for the given
 * currency/locale. Returns `null` for empty / unparseable input.
 */
function parseCurrencyText(text: string, currency: string, locale: string): number | null {
  let raw = (text ?? '').trim();
  if (!raw) {
    return null;
  }

  // Accounting parens before symbol stripping so "($1.50)" → "-$1.50".
  let negative = false;
  if (raw.startsWith('(') && raw.endsWith(')')) {
    negative = true;
    raw = raw.slice(1, -1).trim();
  }

  raw = stripCurrencyAdornments(raw, currency, locale);
  if (!raw) {
    return null;
  }

  // A leading sign may sit between the symbol and the digits ("$-1.50")
  // or at the very front ("-$1.50"); collapse to one canonical leading sign.
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

/** Parse user-typed text directly into integer micro-units. */
function parseCurrencyTextToMicro(
  text: string,
  currency: string,
  locale: string,
): number | null {
  return valueToMicro(parseCurrencyText(text, currency, locale));
}

// ───────────────── Input (native-safe port of web ui/Input.tsx) ──────────────
// The web `<Input>` is not yet present as its own native parity port. This
// local, native-safe equivalent reproduces the slots CurrencyInput relies on
// (label, leading icon, the editable field, error/hint) using a RN TextInput.

type InputSize = 'sm' | 'md' | 'lg';

export interface InputProps extends Omit<TextInputProps, 'onChange'> {
  label?: string;
  error?: string;
  hint?: string;
  icon?: ReactNode;
  suffix?: ReactNode;
  /** Sizing scale. Defaults to `'md'`. (Web's density-driven `'auto'` is not ported.) */
  size?: InputSize;
  /** Native style override applied to the field container (web maps className here). */
  containerStyle?: StyleProp<ViewStyle>;
}

const Input = forwardRef<TextInput, InputProps>(function Input(
  {
    label,
    error,
    hint,
    icon,
    suffix,
    size = 'md',
    containerStyle,
    editable,
    style,
    ...props
  },
  ref,
) {
  const disabled = editable === false;
  return (
    <View style={[styles.root, containerStyle]}>
      {label ? (
        <View style={styles.labelRow}>
          <AppText style={styles.label} tone="secondary" weight="semibold">
            {label}
          </AppText>
        </View>
      ) : null}
      <View
        style={[
          styles.field,
          sizeFieldStyles[size],
          error ? styles.fieldError : null,
          disabled ? styles.fieldDisabled : null,
        ]}>
        {icon ? <View style={styles.icon}>{icon}</View> : null}
        <TextInput
          ref={ref}
          editable={editable}
          placeholderTextColor={colors.textMuted}
          style={[styles.input, sizeInputStyles[size], style]}
          {...props}
        />
        {suffix ? <View style={styles.suffix}>{suffix}</View> : null}
      </View>
      {error ? (
        <AppText style={styles.error} tone="danger" variant="caption">
          {error}
        </AppText>
      ) : null}
      {hint && !error ? (
        <AppText style={styles.hint} tone="muted" variant="caption">
          {hint}
        </AppText>
      ) : null}
    </View>
  );
});

Input.displayName = 'Input';

// Event payload aliases derived from RN's TextInputProps so the wrapped
// handlers always match the field's focus/blur/submit signatures. (RN's
// blur/focus events are `NativeSyntheticEvent<TargetedEvent>` and do NOT
// carry the field text — see the textRef mirror used to commit on blur.)
type FieldFocusEvent = Parameters<NonNullable<TextInputProps['onFocus']>>[0];
type FieldBlurEvent = Parameters<NonNullable<TextInputProps['onBlur']>>[0];
type FieldSubmitEvent = Parameters<NonNullable<TextInputProps['onSubmitEditing']>>[0];

// ───────────────────────────── CurrencyInput ─────────────────────────────────

export interface CurrencyInputChangePayload {
  valueMicro: number | null;
}

export interface CurrencyInputProps
  extends Omit<
    InputProps,
    'value' | 'onChange' | 'onChangeText' | 'suffix' | 'icon' | 'accessibilityLabel'
  > {
  /** Canonical integer micro-units (1 major unit = 1_000_000). Null when empty. */
  valueMicro: number | null;
  /** Called with the new canonical micro value (or null when blank). */
  onChange: (next: CurrencyInputChangePayload) => void;
  /** ISO 4217 currency code: 'USD', 'EUR', 'GBP', etc. */
  currency: string;
  /**
   * BCP-47 locale tag for `Intl.NumberFormat`. Defaults to the device /
   * `Intl` locale on native, 'en-US' as the final fallback.
   */
  locale?: string;
  /** Fractional digits to display. Storage keeps full micro precision. */
  precision?: number;
  /**
   * Required for accessibility — applied as the field's `accessibilityLabel`
   * (the web `aria-label`). Existing pages with a separate label wrapper
   * should still pass `ariaLabel` so screen readers announce the field.
   */
  ariaLabel: string;
}

/**
 * CurrencyInput keeps a local text buffer separate from the parent's
 * canonical micro value so:
 *   - the user can type freely without each keystroke triggering a
 *     parse / re-format round-trip (which would jump the cursor);
 *   - the field re-syncs to the latest formatted display whenever the
 *     parent value, currency, locale, or precision changes — UNLESS
 *     the user is currently focused and editing.
 */
export const CurrencyInput = forwardRef<TextInput, CurrencyInputProps>(
  function CurrencyInput(
    {
      valueMicro,
      onChange,
      currency,
      locale,
      precision,
      ariaLabel,
      onBlur,
      onSubmitEditing,
      onFocus,
      label,
      ...rest
    },
    ref,
  ) {
    const effectiveLocale = useMemo(() => resolveLocale(locale), [locale]);
    const effectivePrecision = precision ?? 2;

    const display = useMemo(
      () => formatCurrencyMicro(valueMicro, currency, effectiveLocale, effectivePrecision),
      [valueMicro, currency, effectiveLocale, effectivePrecision],
    );
    const symbol = useMemo(
      () => currencySymbol(currency, effectiveLocale),
      [currency, effectiveLocale],
    );

    const [text, setText] = useState<string>(display);

    // Mirror the controlled buffer in a ref so blur/submit can commit the
    // latest typed value — RN's blur/focus events don't carry the field text
    // the way the web `e.currentTarget.value` did.
    const textRef = useRef<string>(display);

    // Track focus internally so an external value/locale/currency change
    // while the user is typing does NOT clobber the in-progress text. A ref
    // avoids the extra re-render a `useState<boolean>` would trigger.
    const focusedRef = useRef(false);

    // Resync local buffer when the formatted display changes — but only when
    // the user is NOT currently editing the field, so an external setting
    // change doesn't clobber in-progress input.
    useEffect(() => {
      if (focusedRef.current) {
        return;
      }
      textRef.current = display;
      setText(display);
    }, [display]);

    const commit = useCallback(
      (raw: string) => {
        const parsedMicro = parseCurrencyTextToMicro(raw, currency, effectiveLocale);
        onChange({valueMicro: parsedMicro});
        // Renormalise the visible text to the canonical-rounded form so
        // typing "1.5001" → blur → "$1.50" feels predictable.
        const formatted = formatCurrencyMicro(
          parsedMicro,
          currency,
          effectiveLocale,
          effectivePrecision,
        );
        textRef.current = formatted;
        setText(formatted);
      },
      [onChange, currency, effectiveLocale, effectivePrecision],
    );

    const handleChangeText = useCallback((next: string) => {
      textRef.current = next;
      setText(next);
    }, []);

    const handleFocus = useCallback(
      (e: FieldFocusEvent) => {
        focusedRef.current = true;
        onFocus?.(e);
      },
      [onFocus],
    );

    const handleBlur = useCallback(
      (e: FieldBlurEvent) => {
        focusedRef.current = false;
        commit(textRef.current);
        onBlur?.(e);
      },
      [commit, onBlur],
    );

    // Web committed on Enter via onKeyDown; native maps that to onSubmitEditing.
    const handleSubmitEditing = useCallback(
      (e: FieldSubmitEvent) => {
        commit(textRef.current);
        onSubmitEditing?.(e);
      },
      [commit, onSubmitEditing],
    );

    return (
      <Input
        ref={ref}
        label={label}
        keyboardType="decimal-pad"
        autoComplete="off"
        autoCorrect={false}
        autoCapitalize="none"
        accessibilityLabel={ariaLabel}
        value={text}
        onChangeText={handleChangeText}
        onBlur={handleBlur}
        onSubmitEditing={handleSubmitEditing}
        onFocus={handleFocus}
        icon={
          <AppText
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.symbol}
            testID="currency-input-symbol"
            tone="muted">
            {symbol}
          </AppText>
        }
        {...rest}
      />
    );
  },
);

CurrencyInput.displayName = 'CurrencyInput';

/**
 * Resolve the BCP-47 locale tag. Prefers an explicit prop, then a
 * `navigator.language` (react-native-web), then the device `Intl` locale,
 * then 'en-US'. Defensive against environments where neither is available.
 */
function resolveLocale(explicit?: string): string {
  if (explicit && explicit.trim()) {
    return explicit;
  }
  const nav = (globalThis as {navigator?: {language?: string}}).navigator;
  if (nav && typeof nav.language === 'string' && nav.language) {
    return nav.language;
  }
  try {
    const resolved = new Intl.DateTimeFormat().resolvedOptions().locale;
    if (resolved) {
      return resolved;
    }
  } catch {
    // fall through to the default
  }
  return 'en-US';
}

const SIZE_PADDING: Record<InputSize, {vertical: number; horizontal: number}> = {
  sm: {vertical: spacing.xs + 2, horizontal: spacing.sm},
  md: {vertical: spacing.sm, horizontal: spacing.md},
  lg: {vertical: spacing.md, horizontal: spacing.md + 4},
};

const SIZE_FONT: Record<InputSize, number> = {
  sm: typography.caption,
  md: typography.body,
  lg: typography.body + 2,
};

const sizeFieldStyles = StyleSheet.create<Record<InputSize, ViewStyle>>({
  sm: {paddingHorizontal: SIZE_PADDING.sm.horizontal},
  md: {paddingHorizontal: SIZE_PADDING.md.horizontal},
  lg: {paddingHorizontal: SIZE_PADDING.lg.horizontal},
});

const sizeInputStyles = StyleSheet.create({
  sm: {fontSize: SIZE_FONT.sm, paddingVertical: SIZE_PADDING.sm.vertical},
  md: {fontSize: SIZE_FONT.md, paddingVertical: SIZE_PADDING.md.vertical},
  lg: {fontSize: SIZE_FONT.lg, paddingVertical: SIZE_PADDING.lg.vertical},
});

const styles = StyleSheet.create({
  error: {
    marginTop: spacing.xs,
  },
  field: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
  },
  fieldDisabled: {
    opacity: 0.5,
  },
  fieldError: {
    borderColor: colors.danger,
  },
  hint: {
    marginTop: spacing.xs,
  },
  icon: {
    marginRight: spacing.xs,
  },
  input: {
    color: colors.textPrimary,
    flex: 1,
    padding: 0,
  },
  label: {
    fontSize: typography.caption,
  },
  labelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginBottom: spacing.xs,
  },
  root: {
    rowGap: spacing.xs,
  },
  suffix: {
    marginLeft: spacing.xs,
  },
  symbol: {
    fontSize: typography.caption,
  },
});
