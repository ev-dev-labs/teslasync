using System.Globalization;

namespace TeslaSync.App.Core.Forms;

/// <summary>
/// Currency math in integer micro-units (1 major unit = 1_000_000) backing
/// <c>TsCurrencyInput</c>. Storing micros avoids floating-point round-trip loss
/// across currencies with 0/2/3 fractional digits. Formatting and parsing are
/// culture-aware (group/decimal separators, accounting parentheses for
/// negatives) and currency-symbol aware.
/// </summary>
public static class CurrencyMicro
{
    /// <summary>Micro-units per major unit.</summary>
    public const long MicrosPerUnit = 1_000_000;

    private static readonly Dictionary<string, string> Symbols = new(StringComparer.OrdinalIgnoreCase)
    {
        ["USD"] = "$",
        ["CAD"] = "$",
        ["AUD"] = "$",
        ["EUR"] = "\u20AC",
        ["GBP"] = "\u00A3",
        ["JPY"] = "\u00A5",
        ["CNY"] = "\u00A5",
        ["CHF"] = "CHF",
        ["SEK"] = "kr",
        ["NOK"] = "kr",
        ["DKK"] = "kr",
        ["PLN"] = "z\u0142",
    };

    /// <summary>The display symbol for an ISO-4217 code (falls back to the code).</summary>
    public static string Symbol(string currencyCode) =>
        !string.IsNullOrEmpty(currencyCode) && Symbols.TryGetValue(currencyCode, out var sym)
            ? sym
            : currencyCode ?? string.Empty;

    /// <summary>Convert a major-unit decimal to micros (rounded half-away-from-zero).</summary>
    public static long ToMicros(decimal major) =>
        (long)decimal.Round(major * MicrosPerUnit, 0, MidpointRounding.AwayFromZero);

    /// <summary>Convert micros to a major-unit decimal.</summary>
    public static decimal ToMajor(long micros) => micros / (decimal)MicrosPerUnit;

    /// <summary>
    /// Format micros for display at the given precision using the supplied
    /// culture's number formatting. Returns an empty string for null.
    /// </summary>
    public static string Format(long? micros, string currencyCode, CultureInfo culture, int precision = 2)
    {
        ArgumentNullException.ThrowIfNull(culture);
        if (micros is null)
        {
            return string.Empty;
        }

        var major = ToMajor(micros.Value);
        var number = major.ToString("N" + precision.ToString(CultureInfo.InvariantCulture), culture);
        var symbol = Symbol(currencyCode);
        return string.IsNullOrEmpty(symbol) ? number : $"{symbol}{number}";
    }

    /// <summary>
    /// Parse user-typed text into micros. Accepts the currency symbol or ISO
    /// code on either side, locale group separators, the locale decimal
    /// separator and accounting parentheses for negatives. Returns null for
    /// blank/unparseable input.
    /// </summary>
    public static long? Parse(string? text, string currencyCode, CultureInfo culture)
    {
        ArgumentNullException.ThrowIfNull(culture);
        if (string.IsNullOrWhiteSpace(text))
        {
            return null;
        }

        var working = text.Trim();

        var negative = false;
        if (working.StartsWith('(') && working.EndsWith(')'))
        {
            negative = true;
            working = working[1..^1];
        }

        // Strip the currency symbol and ISO code.
        var symbol = Symbol(currencyCode);
        if (!string.IsNullOrEmpty(symbol))
        {
            working = working.Replace(symbol, string.Empty, StringComparison.OrdinalIgnoreCase);
        }

        if (!string.IsNullOrEmpty(currencyCode))
        {
            working = working.Replace(currencyCode, string.Empty, StringComparison.OrdinalIgnoreCase);
        }

        var decimalSep = culture.NumberFormat.NumberDecimalSeparator;
        var groupSep = culture.NumberFormat.NumberGroupSeparator;

        // Drop group separators and any character that is not a digit, sign or
        // the locale decimal separator.
        working = working.Replace(groupSep, string.Empty, StringComparison.Ordinal);
        var cleaned = new System.Text.StringBuilder(working.Length);
        foreach (var ch in working)
        {
            if (char.IsDigit(ch) || ch == '-' || ch == '+')
            {
                cleaned.Append(ch);
            }
            else if (decimalSep.Length == 1 && ch == decimalSep[0])
            {
                cleaned.Append('.');
            }
        }

        var candidate = cleaned.ToString();
        if (candidate.Length == 0 || candidate == "-" || candidate == "+")
        {
            return null;
        }

        if (!decimal.TryParse(
                candidate,
                NumberStyles.Number | NumberStyles.AllowLeadingSign,
                CultureInfo.InvariantCulture,
                out var major))
        {
            return null;
        }

        if (negative)
        {
            major = -Math.Abs(major);
        }

        return ToMicros(major);
    }
}
