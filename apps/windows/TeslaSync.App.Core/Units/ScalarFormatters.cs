using System.Globalization;

namespace TeslaSync.App.Core.Units;

/// <summary>
/// Display formatters for SI quantities that need no unit conversion (the unit is
/// already SI or dimensionless): plain numbers, percentages, currency, voltage and
/// current. They reuse <see cref="NumberFormatting"/> so grouping/rounding match the
/// converted SI formatters exactly. null / NaN / non-finite -&gt; empty fallback.
/// </summary>
public static class ScalarFormatters
{
    /// <summary>Default fraction digits for a bare number readout.</summary>
    public const int PrecisionNumber = 0;
    private const int PrecisionPercentage = 0;
    private const int PrecisionCurrency = 2;
    private const int PrecisionVoltage = 1;
    private const int PrecisionCurrent = 1;

    /// <summary>Format a dimensionless number with en-US grouping.</summary>
    public static string FormatNumber(double? value, int precision = PrecisionNumber, string empty = UnitFormatters.DefaultEmptyDisplay)
    {
        if (!IsFinite(value))
        {
            return empty;
        }

        return NumberFormatting.Format(value!.Value, null, NonNegative(precision));
    }

    /// <summary>Format a percentage value (already 0..100) with a trailing %.</summary>
    public static string FormatPercentage(double? value, int precision = PrecisionPercentage, string empty = UnitFormatters.DefaultEmptyDisplay)
    {
        if (!IsFinite(value))
        {
            return empty;
        }

        return $"{NumberFormatting.Format(value!.Value, null, NonNegative(precision))}%";
    }

    /// <summary>Format a currency amount with a leading symbol (default "$").</summary>
    public static string FormatCurrency(double? value, string symbol = "$", int precision = PrecisionCurrency, string empty = UnitFormatters.DefaultEmptyDisplay)
    {
        if (!IsFinite(value))
        {
            return empty;
        }

        return $"{symbol}{NumberFormatting.Format(value!.Value, null, NonNegative(precision))}";
    }

    /// <summary>Format an SI voltage (volts) with a trailing "V".</summary>
    public static string FormatVoltage(double? volts, int precision = PrecisionVoltage, string empty = UnitFormatters.DefaultEmptyDisplay)
    {
        if (!IsFinite(volts))
        {
            return empty;
        }

        return $"{NumberFormatting.Format(volts!.Value, null, NonNegative(precision))} V";
    }

    /// <summary>Format an SI current (amperes) with a trailing "A".</summary>
    public static string FormatCurrent(double? amps, int precision = PrecisionCurrent, string empty = UnitFormatters.DefaultEmptyDisplay)
    {
        if (!IsFinite(amps))
        {
            return empty;
        }

        return $"{NumberFormatting.Format(amps!.Value, null, NonNegative(precision))} A";
    }

    /// <summary>
    /// Format an SI-seconds duration as a compact clock string (e.g. "1h 05m",
    /// "12m 30s", "45s"). Used by playback/scrubber surfaces where the unit-bag
    /// duration formatter's single-unit output is too coarse.
    /// </summary>
    public static string FormatClock(double? seconds, string empty = UnitFormatters.DefaultEmptyDisplay)
    {
        if (!IsFinite(seconds))
        {
            return empty;
        }

        long total = (long)Math.Round(Math.Max(0, seconds!.Value), MidpointRounding.AwayFromZero);
        long h = total / 3600;
        long m = total % 3600 / 60;
        long s = total % 60;
        if (h > 0)
        {
            return $"{h}h {m.ToString("D2", CultureInfo.InvariantCulture)}m";
        }

        if (m > 0)
        {
            return $"{m}m {s.ToString("D2", CultureInfo.InvariantCulture)}s";
        }

        return $"{s}s";
    }

    private static bool IsFinite(double? v) => v is { } d && !double.IsNaN(d) && !double.IsInfinity(d);

    private static int NonNegative(int precision) => precision < 0 ? 0 : precision;
}
