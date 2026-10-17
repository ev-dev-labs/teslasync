import { useFormatting } from '@/hooks/useFormatting';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

interface CurrencyProps {
  /**
   * Amount in the user's preferred currency. The component does NOT perform
   * FX conversion — the value is rendered verbatim with the user's chosen
   * currency symbol from settings.
   */
  value?: number | null;
  /** Decimal places to render (defaults to the user's setting). */
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
 * The hover title uses the same precision and locale as the visible amount.
 */
export function Currency({
  value,
  precision,
  symbolOverride,
  className,
  fallback = '—',
}: CurrencyProps) {
  const { currencySymbol } = useFormatting();
  const { fmtNumber } = useNumberFormatting();
  if (value == null || !Number.isFinite(value)) {
    return <span className={className}>{fallback}</span>;
  }
  // Preserve explicit overrides, with invalid requests falling back to settings.
  const safePrecision = precision != null && Number.isFinite(precision)
    ? Math.min(20, Math.max(0, Math.floor(precision)))
    : undefined;
  const symbol = symbolOverride ?? currencySymbol;
  const display = fmtNumber(value, safePrecision);
  return (
    <span className={className} title={`${symbol}${display}`}>
      {symbol}{display}
    </span>
  );
}
