using System.Globalization;
using System.Text;

namespace TeslaSync.App.Core.Units;

/// <summary>
/// Reproduces <c>Intl.NumberFormat(locale, { min == max == digits })</c> for the
/// en-US display contract. ECMAScript rounds the SHORTEST decimal representation
/// of the value with the default <c>halfExpand</c> mode (round half away from
/// zero), then groups the integer part in threes. This is a 1:1 port of the
/// shared Kotlin <c>formatNumber</c> so the C# render output is provably
/// identical to the web truth (verified by the golden-vector test).
/// </summary>
public static class NumberFormatting
{
    /// <summary>
    /// Formats <paramref name="value"/> with exactly <paramref name="fractionDigits"/>
    /// fixed fraction digits and en-US grouping.
    /// </summary>
    public static string Format(double value, string? locale, int fractionDigits)
    {
        // Only the en-US grouping/separator contract is reproduced here (the web
        // display contract). The locale argument is accepted for API parity;
        // non-en-US locales still receive deterministic en-US grouping.
        _ = locale;
        bool negative = value < 0.0 || (value == 0.0 && double.IsNegative(value));
        var (intDigits, fracDigits) = RoundHalfExpand(Math.Abs(value), fractionDigits);
        string grouped = GroupThousands(intDigits);
        string body = fractionDigits > 0 ? $"{grouped}.{fracDigits}" : grouped;
        return negative ? $"-{body}" : body;
    }

    private static (string IntDigits, string FracDigits) RoundHalfExpand(double absValue, int digits)
    {
        string plain = ToPlainDecimal(absValue);
        int dot = plain.IndexOf('.', StringComparison.Ordinal);
        string intPart = dot < 0 ? plain : plain[..dot];
        string fracPart = dot < 0 ? string.Empty : plain[(dot + 1)..];

        string keptFrac = fracPart.Length >= digits
            ? fracPart[..digits]
            : fracPart + new string('0', digits - fracPart.Length);

        // halfExpand: round away from zero when the first dropped digit is >= 5.
        bool roundUp = fracPart.Length > digits && fracPart[digits] >= '5';

        string combined = intPart + keptFrac;
        if (roundUp)
        {
            combined = IncrementDecimal(combined);
        }

        string fracOut = digits == 0 ? string.Empty : combined[^digits..];
        string intOut = digits == 0 ? combined : combined[..^digits];
        string intNormalized = intOut.TrimStart('0');
        if (intNormalized.Length == 0)
        {
            intNormalized = "0";
        }

        return (intNormalized, fracOut);
    }

    private static string IncrementDecimal(string digits)
    {
        char[] chars = digits.ToCharArray();
        int i = chars.Length - 1;
        while (i >= 0)
        {
            if (chars[i] == '9')
            {
                chars[i] = '0';
                i--;
            }
            else
            {
                chars[i] = (char)(chars[i] + 1);
                return new string(chars);
            }
        }

        return "1" + new string(chars);
    }

    private static string GroupThousands(string intDigits)
    {
        if (intDigits.Length <= 3)
        {
            return intDigits;
        }

        var sb = new StringBuilder();
        int firstGroup = intDigits.Length % 3;
        int idx = 0;
        if (firstGroup > 0)
        {
            sb.Append(intDigits, 0, firstGroup);
            idx = firstGroup;
        }

        while (idx < intDigits.Length)
        {
            if (sb.Length > 0)
            {
                sb.Append(',');
            }

            sb.Append(intDigits, idx, 3);
            idx += 3;
        }

        return sb.ToString();
    }

    /// <summary>
    /// Expands a non-negative finite value to a plain (non-exponential) decimal
    /// string using .NET's shortest round-trip <see cref="double.ToString(IFormatProvider)"/>.
    /// The shortest decimal matches the value ECMAScript rounds, keeping the
    /// formatter aligned with the web's <c>Intl.NumberFormat</c>.
    /// </summary>
    private static string ToPlainDecimal(double value)
    {
        string s = value.ToString(CultureInfo.InvariantCulture);
        int eIdx = s.IndexOfAny(['e', 'E']);
        if (eIdx < 0)
        {
            return s;
        }

        string mantissa = s[..eIdx];
        int exp = int.Parse(s[(eIdx + 1)..], CultureInfo.InvariantCulture);
        int pointIdx = mantissa.IndexOf('.', StringComparison.Ordinal);
        string mantInt = pointIdx < 0 ? mantissa : mantissa[..pointIdx];
        string mantFrac = pointIdx < 0 ? string.Empty : mantissa[(pointIdx + 1)..];
        string combined = mantInt + mantFrac;
        int pointPos = mantInt.Length + exp;

        if (pointPos <= 0)
        {
            return "0." + new string('0', -pointPos) + combined;
        }

        if (pointPos >= combined.Length)
        {
            return combined + new string('0', pointPos - combined.Length);
        }

        return combined[..pointPos] + "." + combined[pointPos..];
    }
}
