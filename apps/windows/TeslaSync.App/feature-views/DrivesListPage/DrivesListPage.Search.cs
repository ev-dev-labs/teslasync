using System.Globalization;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>
/// The structured search mini-language for the Drives-list page — the native port of the web
/// <c>parseSearchQuery</c> / <c>matchesTokens</c> closures (web/src/lib/searchQuery.ts as bound in DrivesListPage).
/// Supports free-text terms (addresses, grade label, display-distance) plus <c>key:op?value</c> tokens
/// (<c>score</c>, <c>from</c>, <c>distance</c>) combined with AND semantics. Pure (display unit is passed in), so it
/// is unit-tested headlessly.
/// </summary>
public static class DriveSearch
{
    /// <summary>One parsed search token: a free-text term or a structured key/op/value triple.</summary>
    /// <param name="IsKeyValue">True for a <c>key:value</c> token, false for a free-text term.</param>
    /// <param name="Key">The lower-cased key for a kv token, else empty.</param>
    /// <param name="Op">The comparison operator for a kv token (<c>&gt;</c>, <c>&lt;</c>, <c>&gt;=</c>, <c>&lt;=</c>, <c>=</c>).</param>
    /// <param name="Value">The value (kv) or the term text (free-text), lower-cased.</param>
    public sealed record Token(bool IsKeyValue, string Key, string Op, string Value);

    /// <summary>Parse a raw query into AND-combined tokens (empty / blank query → no tokens).</summary>
    /// <param name="query">The raw search text.</param>
    public static IReadOnlyList<Token> Parse(string? query)
    {
        if (string.IsNullOrWhiteSpace(query))
        {
            return Array.Empty<Token>();
        }

        var tokens = new List<Token>();
        foreach (var raw in SplitTerms(query))
        {
            var term = raw.Trim();
            if (term.Length == 0)
            {
                continue;
            }

            var colon = term.IndexOf(':', StringComparison.Ordinal);
            if (colon > 0)
            {
                var key = term[..colon].Trim().ToLowerInvariant();
                var rest = term[(colon + 1)..].Trim();
                var (op, value) = SplitOp(rest);
                tokens.Add(new Token(true, key, op, value.ToLowerInvariant()));
            }
            else
            {
                tokens.Add(new Token(false, string.Empty, "=", term.ToLowerInvariant()));
            }
        }

        return tokens;
    }

    /// <summary>True when <paramref name="drive"/> matches every token (web AND semantics).</summary>
    /// <param name="drive">The drive under test.</param>
    /// <param name="tokens">The parsed tokens.</param>
    /// <param name="distanceUnit">The active display distance unit (for the distance comparisons + free-text).</param>
    public static bool Matches(DriveListItem drive, IReadOnlyList<Token> tokens, DistanceUnit distanceUnit)
    {
        ArgumentNullException.ThrowIfNull(drive);
        ArgumentNullException.ThrowIfNull(tokens);
        foreach (var token in tokens)
        {
            var result = token.IsKeyValue ? MatchKeyValue(drive, token, distanceUnit) : MatchText(drive, token.Value, distanceUnit);
            if (result == false)
            {
                return false;
            }
        }

        return true;
    }

    private static bool MatchText(DriveListItem d, string text, DistanceUnit unit)
    {
        if (text.Length == 0)
        {
            return true;
        }

        var grade = DrivesAggregation.GradeFromEfficiency(DrivesAggregation.GetEfficiency(d)).Label;
        var displayDistance = FormatDisplayDistance(d.DistanceM, unit);
        return Contains(d.StartAddress, text)
            || Contains(d.EndAddress, text)
            || Contains(grade, text)
            || Contains(displayDistance, text);
    }

    private static bool? MatchKeyValue(DriveListItem d, Token token, DistanceUnit unit)
    {
        switch (token.Key)
        {
            case "score":
                {
                    var grade = DrivesAggregation.GradeFromEfficiency(DrivesAggregation.GetEfficiency(d)).Label.ToLowerInvariant();
                    return string.Equals(grade, token.Value.Trim(), StringComparison.Ordinal);
                }

            case "from":
                {
                    var day = DrivesAggregation.DayKey(d);
                    if (day is null)
                    {
                        return false;
                    }

                    var monthLabel = FormatLongDay(day).ToLowerInvariant();
                    return monthLabel.Contains(token.Value.Trim(), StringComparison.Ordinal);
                }

            case "distance":
                return TryNumber(token.Value, out var target)
                    ? Compare(UnitConverters.DistanceFromSi(d.DistanceM, unit), token.Op, target)
                    : null;

            default:
                // Unknown key: web returns null (no constraint) — treat as a no-op match.
                return true;
        }
    }

    private static string FormatDisplayDistance(double meters, DistanceUnit unit) =>
        UnitConverters.DistanceFromSi(meters, unit).ToString("0.#", CultureInfo.InvariantCulture);

    private static string FormatLongDay(string dayKey)
    {
        if (DateTime.TryParseExact(dayKey, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var dt))
        {
            return dt.ToString("MMM d, yyyy", CultureInfo.InvariantCulture);
        }

        return dayKey;
    }

    private static bool Contains(string? haystack, string needle) =>
        !string.IsNullOrEmpty(haystack) && haystack.Contains(needle, StringComparison.OrdinalIgnoreCase);

    private static bool Compare(double value, string op, double target) => op switch
    {
        ">" => value > target,
        "<" => value < target,
        ">=" => value >= target,
        "<=" => value <= target,
        _ => Math.Abs(value - target) < 0.0001,
    };

    private static bool TryNumber(string value, out double target) =>
        double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out target);

    private static (string Op, string Value) SplitOp(string rest)
    {
        if (rest.StartsWith(">=", StringComparison.Ordinal) || rest.StartsWith("<=", StringComparison.Ordinal))
        {
            return (rest[..2], rest[2..].Trim());
        }

        if (rest.StartsWith('>') || rest.StartsWith('<') || rest.StartsWith('='))
        {
            return (rest[..1], rest[1..].Trim());
        }

        return ("=", rest);
    }

    private static List<string> SplitTerms(string query)
    {
        var terms = new List<string>();
        var current = new System.Text.StringBuilder();
        var inQuote = false;
        foreach (var ch in query)
        {
            if (ch == '"')
            {
                inQuote = !inQuote;
                continue;
            }

            if (char.IsWhiteSpace(ch) && !inQuote)
            {
                if (current.Length > 0)
                {
                    terms.Add(current.ToString());
                    current.Clear();
                }

                continue;
            }

            current.Append(ch);
        }

        if (current.Length > 0)
        {
            terms.Add(current.ToString());
        }

        return terms;
    }
}
