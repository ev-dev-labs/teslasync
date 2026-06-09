using System.Globalization;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// A faithful port of ECMAScript's global <c>parseFloat</c> — the exact parse the web
/// <c>ByteSizeConverterTool</c> applies to the typed value (<c>parseFloat(value)</c>). It is intentionally
/// looser than <see cref="double.TryParse(string, out double)"/>: it skips leading whitespace, accepts an
/// optional sign, reads the longest valid leading decimal (integer / fraction / exponent or the literal
/// <c>Infinity</c>) and ignores any trailing garbage, returning <see cref="double.NaN"/> only when no
/// number begins the string. Reproducing these quirks (e.g. <c>"1,024" → 1</c>, <c>".5" → 0.5</c>,
/// <c>"12abc" → 12</c>) keeps the native converter's empty / populated decision identical to the web's
/// <c>isNaN(num)</c> guard.
/// </summary>
public static class JsNumber
{
    /// <summary>Parses <paramref name="input"/> exactly as ECMAScript <c>parseFloat</c>, else <see cref="double.NaN"/>.</summary>
    public static double ParseFloat(string? input)
    {
        if (string.IsNullOrEmpty(input))
        {
            return double.NaN;
        }

        int n = input.Length;
        int i = 0;
        while (i < n && char.IsWhiteSpace(input[i]))
        {
            i++;
        }

        int start = i;
        if (i < n && (input[i] == '+' || input[i] == '-'))
        {
            i++;
        }

        const string infinity = "Infinity";
        if (i + infinity.Length <= n && string.CompareOrdinal(input, i, infinity, 0, infinity.Length) == 0)
        {
            return start < i && input[start] == '-' ? double.NegativeInfinity : double.PositiveInfinity;
        }

        int mantissaStart = i;
        while (i < n && IsAsciiDigit(input[i]))
        {
            i++;
        }

        if (i < n && input[i] == '.')
        {
            i++;
            while (i < n && IsAsciiDigit(input[i]))
            {
                i++;
            }
        }

        if (!HasAsciiDigit(input, mantissaStart, i))
        {
            return double.NaN;
        }

        if (i < n && (input[i] == 'e' || input[i] == 'E'))
        {
            int exponentMark = i;
            int j = i + 1;
            if (j < n && (input[j] == '+' || input[j] == '-'))
            {
                j++;
            }

            int exponentDigits = j;
            while (j < n && IsAsciiDigit(input[j]))
            {
                j++;
            }

            // A bare 'e' with no exponent digits is not part of the number (parseFloat("1e") === 1).
            i = j > exponentDigits ? j : exponentMark;
        }

        string token = input.Substring(start, i - start);
        return double.TryParse(token, NumberStyles.Float, CultureInfo.InvariantCulture, out double value)
            ? value
            : double.NaN;
    }

    private static bool IsAsciiDigit(char c) => c is >= '0' and <= '9';

    private static bool HasAsciiDigit(string s, int startInclusive, int endExclusive)
    {
        for (int i = startInclusive; i < endExclusive; i++)
        {
            if (IsAsciiDigit(s[i]))
            {
                return true;
            }
        }

        return false;
    }
}

/// <summary>
/// The pure byte-size conversion engine — the native "data adapter" the
/// <see cref="ByteSizeConverterViewModel"/> projects through (P1/S8: the view binds the projection, it
/// never computes inline). It is a 1:1 port of the web component's <c>useMemo</c>
/// (web/src/features/admin/components/devtools/tools/ByteSizeConverter.tsx): parse the value as ECMAScript
/// <c>parseFloat</c>; on <c>NaN</c> or an unknown unit return <c>null</c> (the empty branch); otherwise
/// promote to bytes (<c>num * 1024^unitIndex</c>) and ladder back down across every unit
/// (<c>bytes / 1024^i</c>), formatting each magnitude with the shared <see cref="NumberFormatting"/>
/// helper — the byte-exact port of the web <c>fmtNumber</c> — at zero fraction digits for bytes and four
/// for every larger unit (web <c>i === 0 ? 0 : 4</c>). Kept UI-free so the value math and the
/// active-unit flag are unit-tested without a XAML host.
/// </summary>
public static class ByteSizeProjection
{
    /// <summary>Fraction digits the web applies to the byte (index 0) cell.</summary>
    private const int BytesFractionDigits = 0;

    /// <summary>Fraction digits the web applies to every larger unit (KB and up).</summary>
    private const int LargerUnitFractionDigits = 4;

    /// <summary>
    /// Project <paramref name="value"/> + <paramref name="unit"/> into the five-cell conversion ladder, or
    /// <c>null</c> when the value is not a number or the unit is unknown (the web <c>conversions === null</c>
    /// branch).
    /// </summary>
    public static IReadOnlyList<ByteConversion>? Project(string? value, string? unit)
    {
        double number = JsNumber.ParseFloat(value);
        if (double.IsNaN(number))
        {
            return null;
        }

        int unitIndex = ByteSizeUnits.IndexOf(unit);
        if (unitIndex < 0)
        {
            return null;
        }

        double bytes = number * Math.Pow(1024, unitIndex);
        var cells = new ByteConversion[ByteSizeUnits.All.Count];
        for (int i = 0; i < ByteSizeUnits.All.Count; i++)
        {
            string symbol = ByteSizeUnits.All[i];
            double magnitude = bytes / Math.Pow(1024, i);
            int fractionDigits = i == 0 ? BytesFractionDigits : LargerUnitFractionDigits;
            string formatted = NumberFormatting.Format(SafeNumber(magnitude), null, fractionDigits);
            bool isActive = string.Equals(symbol, unit, StringComparison.Ordinal);
            cells[i] = new ByteConversion(symbol, formatted, isActive);
        }

        return cells;
    }

    // Mirrors the web `fmtNumber`'s `safeNumber` guard: a non-finite magnitude (an overflow to Infinity, or
    // a NaN) formats as 0 rather than throwing, so an extreme input degrades exactly as the web does.
    private static double SafeNumber(double value) => double.IsFinite(value) ? value : 0.0;
}
