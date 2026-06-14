using System.Globalization;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.SharedSurfaces;

namespace TeslaSync.App.FeatureViews.Charging;

/// <summary>
/// The structured search mini-language for the Charging-list page — the native port of the web
/// <c>parseSearchQuery</c> / <c>matchesTokens</c> closures (web/src/lib/searchQuery.ts as bound in
/// ChargingListPage). Supports free-text terms plus <c>key:op?value</c> tokens (<c>charger</c>, <c>cost</c>,
/// <c>kwh</c>, <c>power</c>, <c>dur</c>, <c>in</c>, <c>at</c>, <c>free</c>) combined with AND semantics. Pure, so it
/// is unit-tested headlessly.
/// </summary>
public static class ChargingSearch
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

    /// <summary>True when <paramref name="session"/> matches every token (web AND semantics).</summary>
    /// <param name="session">The session under test.</param>
    /// <param name="tokens">The parsed tokens.</param>
    public static bool Matches(ChargingListSession session, IReadOnlyList<Token> tokens)
    {
        ArgumentNullException.ThrowIfNull(session);
        ArgumentNullException.ThrowIfNull(tokens);
        foreach (var token in tokens)
        {
            var result = token.IsKeyValue ? MatchKeyValue(session, token) : MatchText(session, token.Value);
            if (result == false)
            {
                return false;
            }
        }

        return true;
    }

    private static bool MatchText(ChargingListSession s, string text)
    {
        if (text.Length == 0)
        {
            return true;
        }

        var energy = (s.TotalEnergyAddedWh / 1000.0).ToString("0.#", CultureInfo.InvariantCulture);
        var cost = s.CostDecimal is { } c ? c.ToString("0.##", CultureInfo.InvariantCulture) : null;
        return Contains(s.StartPlace, text)
            || Contains(s.ChargerType, text)
            || Contains(energy, text)
            || Contains(cost, text);
    }

    private static bool? MatchKeyValue(ChargingListSession s, Token token)
    {
        switch (token.Key)
        {
            case "charger":
                return MatchCharger(s, token.Value);

            case "cost":
                return TryNumber(token.Value, out var costTarget)
                    ? Compare(s.CostDecimal ?? 0, token.Op, costTarget)
                    : null;

            case "kwh":
                return TryNumber(token.Value, out var kwhTarget)
                    ? Compare(s.TotalEnergyAddedWh / 1000.0, token.Op, kwhTarget)
                    : null;

            case "power":
                return TryNumber(token.Value, out var powerTarget)
                    ? Compare((s.PeakPowerW ?? 0) / 1000.0, token.Op, powerTarget)
                    : null;

            case "dur":
                return TryDuration(token.Value, out var durTarget)
                    ? Compare(ChargingAggregation.DurationMinutes(s), token.Op, durTarget)
                    : null;

            case "in":
                return ChargingAggregation.DayKey(s) is { } day && day.StartsWith(token.Value, StringComparison.Ordinal);

            case "at":
                return (s.StartPlace ?? string.Empty).Contains(token.Value, StringComparison.OrdinalIgnoreCase);

            case "free":
                return s.CostDecimal is null || s.CostDecimal == 0;

            default:
                // Unknown key: web returns null (no constraint) — treat as a no-op match.
                return true;
        }
    }

    private static bool MatchCharger(ChargingListSession s, string value)
    {
        var got = ChargingAggregation.GetChargerCategory(s.ChargerType);
        return string.Equals(value, "sc", StringComparison.Ordinal)
            ? got == ChargerCategory.Supercharger
            : string.Equals(CategoryKey(got), value, StringComparison.Ordinal);
    }

    private static string CategoryKey(ChargerCategory category) => category switch
    {
        ChargerCategory.Supercharger => "supercharger",
        ChargerCategory.Dc => "dc",
        ChargerCategory.Home => "home",
        _ => "unknown",
    };

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

    private static bool TryDuration(string value, out double minutes)
    {
        minutes = 0;
        if (value.Length == 0)
        {
            return false;
        }

        var unit = value[^1];
        var numberPart = char.IsLetter(unit) ? value[..^1] : value;
        if (!double.TryParse(numberPart, NumberStyles.Float, CultureInfo.InvariantCulture, out var n))
        {
            return false;
        }

        minutes = unit switch
        {
            'h' => n * 60,
            'd' => n * 60 * 24,
            _ => n,
        };
        return true;
    }

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
