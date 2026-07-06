import { useFormatting } from '@/hooks/useFormatting';
import { fmtNumber } from '@/lib/numberFormat';

interface CurrencyProps {
  /**
   * Amount in the user's preferred currency. The component does NOT perform
   * FX conversion — the value is rendered verbatim with the user's chosen
   * currency symbol from settings.
   */
  value?: number | null;
  /** Decimal places to render (defaults to 2 — the standard for fiat amounts). */
  precision?: number;
  /**
   * Override the symbol prefix. Useful when a chart axis or tooltip needs a
   * forced symbol that differs from the global setting (rare).
   */
  symbolOverride?: string;
  className?: string;
  /** Custom rendering when value is null/undefined/NaN. Defaults to "—". */
  fallback?: string;
}

/**
 * Currency renderer that uses the user's preferred symbol from settings and
 * formats the numeric portion with the global locale (so 1 234,56 € works in
 * de-DE just like $1,234.56 in en-US).
 *
 * Always exposes the canonical numeric value via the `title` attribute so
 * tooltips remain unambiguous regardless of locale.
 */
export function Currency({
  value,
  precision = 2,
  symbolOverride,
  className,
  fallback = '—',
}: CurrencyProps) {
  const { currencySymbol } = useFormatting();
  if (value == null || !Number.isFinite(value)) {
    return <span className={className}>{fallback}</span>;
  }
  // Clamp to the fraction-digit range shared by `Number.toFixed` and
  // `Intl.NumberFormat` (0–20). An out-of-range or non-finite `precision` prop
  // would otherwise throw a RangeError out of `fmtNumber`/`toFixed` and blank
  // the surrounding panel instead of rendering an amount.
  const safePrecision = Number.isFinite(precision)
    ? Math.min(20, Math.max(0, Math.floor(precision)))
    : 2;
  const symbol = symbolOverride ?? currencySymbol;
  const display = fmtNumber(value, safePrecision);
  return (
    <span className={className} title={`${symbol}${value.toFixed(safePrecision)}`}>
      {symbol}{display}
    </span>
  );
}
