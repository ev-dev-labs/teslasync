// Native parity port of web/src/features/settings/components/AIUsageCard.tsx.
//
// The web module is the lightweight "Usage today" card on the Helix settings
// panel: it reads `/ai/usage/today` via useAiUsageToday() (TanStack Query, polled
// at INTERVALS.STANDARD) and renders the three top-line metrics (tokens in,
// tokens out, estimated cost in the user's locale currency). Empty / loading /
// error states all degrade to the long-em-dash placeholder so the layout stays
// stable. No per-feature withAiFeature wrapper — the `__usage__` meta-feature
// guard is enforced server-side.
//
// Native-safe substitutions (rule 7), documented in the parity sidecar:
//   • react-i18next useTranslation('settings') -> a local useTranslation() hook
//     whose t(key, fallback) returns the English fallback, preserving every
//     translation key verbatim at the call site (the native parity tree ships no
//     i18next runtime).
//   • @/components/ui Subhead / Caption (DOM h4 / span with Tailwind typography
//     role classes) -> AppText with the same resolved roles: Subhead =
//     text-sm font-medium text-secondary; Caption = text-xs text-muted.
//   • @/hooks/useFormatting formatCurrency -> derived from the native useSettings()
//     query exactly like the web hook: symbol = currency_symbol (trimmed) || '$';
//     precision = floor(decimal_precision >= 0) ?? 2; locale from settings.locale;
//     formatCurrency(amount) = `${symbol}${fmtNumber(amount, precision, locale)}`.
//   • @/lib/numberFormat fmtInt -> inlined fmtInt (+ safeNumber) reproducing the
//     web behaviour: non-finite -> 0, locale-aware integer formatting.
//   • @/api/hooks/useAiUsage useAiUsageToday -> the already-ported native hook.
//   • <section>/<div>/<span> + Tailwind classes -> React Native View/AppText with
//     StyleSheet + theme tokens (rounded-md border border-subtle p-4 space-y-1;
//     grid grid-cols-3 gap-3; flex-col cells). aria-label -> accessibilityLabel;
//     data-testid -> testID; aria-busy -> accessibilityState.busy.
// No DOM elements, react-i18next, Recharts, Leaflet, react-dom, or web UI-kit
// modules are imported into the native output.

import React, {useCallback} from 'react';
import {StyleSheet, View} from 'react-native';

import {useAiUsageToday} from '../../../api/hooks/useAiUsage';
import {useSettings} from '../../../api/hooks/useSettings';
import {AppText} from '../../../../components/ui/AppText';
import {colors} from '../../../../theme/tokens';

const PLACEHOLDER = '\u2014';
const DEFAULT_LOCALE = 'en-US';
const DEFAULT_PRECISION = 2;

/* ─── i18n fallback (web react-i18next useTranslation('settings')) ──────── */

type TFunc = (key: string, fallback: string) => string;

// Native stand-in for react-i18next's useTranslation: the parity bundle ships no
// i18n runtime, so `t` returns the English fallback while preserving every key at
// the call site. A stable useCallback identity keeps the hook honest.
function useTranslation(): {t: TFunc} {
  const t = useCallback<TFunc>((_key, fallback) => fallback, []);
  return {t};
}

/* ─── inlined @/lib/numberFormat fmtInt + fmtNumber ─────────────────────── */

/** Safe number extraction from unknown values, returns 0 for nullish/NaN. */
function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

// web fmtNumber(value, decimals?, locale?): locale-aware fixed-decimal formatting
// with non-finite inputs coerced to 0; a bad locale tag falls back to en-US so a
// string is always produced.
function fmtNumber(
  v: unknown,
  decimals: number = DEFAULT_PRECISION,
  locale: string = DEFAULT_LOCALE,
): string {
  const n = safeNumber(v);
  try {
    return n.toLocaleString(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return n.toLocaleString(DEFAULT_LOCALE, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }
}

// web fmtInt(value) = fmtNumber(value, 0).
function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

/* ─── inlined @/hooks/useFormatting (settings-derived formatCurrency) ────── */

function deriveLocale(locale: string | undefined): string {
  return typeof locale === 'string' && locale.trim().length > 0
    ? locale
    : DEFAULT_LOCALE;
}

function derivePrecision(decimalPrecision: unknown): number {
  if (
    typeof decimalPrecision === 'number' &&
    Number.isFinite(decimalPrecision) &&
    decimalPrecision >= 0
  ) {
    return Math.floor(decimalPrecision);
  }
  return DEFAULT_PRECISION;
}

function deriveCurrencySymbol(symbol: string | undefined): string {
  return symbol && symbol.trim() ? symbol : '$';
}

/* ─── usage-cell helpers (ported verbatim from the web module) ──────────── */

function microCentsToDollars(mc: number | null | undefined): number {
  if (mc == null || !Number.isFinite(mc)) {
    return 0;
  }
  return mc / 1_000_000;
}

function formatCount(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) {
    return PLACEHOLDER;
  }
  return fmtInt(n);
}

export function AIUsageCard() {
  const {t} = useTranslation();
  const {data: settings} = useSettings();
  const locale = deriveLocale(settings?.locale);
  const precision = derivePrecision(settings?.decimal_precision);
  const currencySymbol = deriveCurrencySymbol(settings?.currency_symbol);
  // web useFormatting.formatCurrency: `${symbol}${fmtNumber(amount, decimals ?? precision)}`.
  const formatCurrency = useCallback(
    (amount: number, decimals?: number): string =>
      `${currencySymbol}${fmtNumber(amount, decimals ?? precision, locale)}`,
    [currencySymbol, precision, locale],
  );

  const {data, isLoading, isError} = useAiUsageToday();

  const tokensIn = !data || isError ? PLACEHOLDER : formatCount(data.input_tokens);
  const tokensOut =
    !data || isError ? PLACEHOLDER : formatCount(data.output_tokens);
  const cost =
    !data || isError
      ? PLACEHOLDER
      : formatCurrency(microCentsToDollars(data.cost_micro_cents));

  return (
    <View
      accessibilityLabel={t('ai.settings.usage.title', 'Usage today')}
      style={styles.section}
      testID="ai-usage-card">
      <AppText style={styles.subhead}>
        {t('ai.settings.usage.title', 'Usage today')}
      </AppText>
      <View style={styles.grid}>
        <UsageCell
          isLoading={isLoading}
          label={t('ai.settings.usage.tokensIn', 'Tokens in')}
          value={tokensIn}
        />
        <UsageCell
          isLoading={isLoading}
          label={t('ai.settings.usage.tokensOut', 'Tokens out')}
          value={tokensOut}
        />
        <UsageCell
          isLoading={isLoading}
          label={t('ai.settings.usage.cost', 'Estimated cost')}
          value={cost}
        />
      </View>
      <AppText style={styles.caption}>
        {data && data.call_count > 0
          ? `${formatCount(data.call_count)} ${t(
              'ai.settings.usage.liveSuffix',
              'Helix calls today.',
            )}`
          : t(
              'ai.settings.usage.placeholder',
              'Usage populates as features run. Live numbers arrive in a follow-up update.',
            )}
      </AppText>
    </View>
  );
}
AIUsageCard.displayName = 'AIUsageCard';

function UsageCell({
  label,
  value,
  isLoading,
}: {
  label: string;
  value: string;
  isLoading: boolean;
}) {
  return (
    <View style={styles.cell}>
      <AppText style={styles.cellLabel}>{label}</AppText>
      <AppText
        accessibilityState={{busy: isLoading || undefined}}
        style={styles.cellValue}
        testID="ai-usage-value">
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    gap: 4,
    padding: 16,
  },
  subhead: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
  grid: {
    flexDirection: 'row',
    gap: 12,
  },
  cell: {
    flex: 1,
    flexDirection: 'column',
  },
  cellLabel: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  cellValue: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
  caption: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
  },
});
