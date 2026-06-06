using System.Globalization;

namespace TeslaSync.App.Core.Units;

/// <summary>Render mode for <see cref="DateTimeFormatting"/> / <c>TsDateTime</c>.</summary>
public enum DateTimeVariant
{
    /// <summary>"Apr 4, 2026 02:30 PM".</summary>
    Full,

    /// <summary>"Apr 4, 2026".</summary>
    Date,

    /// <summary>"02:30 PM".</summary>
    Time,

    /// <summary>"Apr 4" (month + day).</summary>
    Short,

    /// <summary>"Just now" / "5m ago" / "3h ago" / absolute fallback.</summary>
    Relative,
}

/// <summary>
/// Locale-aware datetime display formatting backing <c>TsDateTime</c> — a 1:1 port
/// of the web <c>format/DateTime</c> + <c>lib/dateFormat</c> variants. Pure and
/// <c>now</c>-injectable so the relative tiers are unit-tested deterministically.
/// Null / unparseable inputs render the em-dash fallback.
/// </summary>
public static class DateTimeFormatting
{
    /// <summary>Em-dash fallback for null / invalid timestamps.</summary>
    public const string DefaultEmptyDisplay = "\u2014";

    private static readonly CultureInfo EnUs = CultureInfo.GetCultureInfo("en-US");

    /// <summary>Format a timestamp in the chosen variant relative to <paramref name="now"/>.</summary>
    public static string Format(DateTimeOffset? value, DateTimeVariant variant, DateTimeOffset now)
    {
        if (value is not { } d)
        {
            return DefaultEmptyDisplay;
        }

        DateTime local = d.LocalDateTime;
        return variant switch
        {
            DateTimeVariant.Date => local.ToString("MMM d, yyyy", EnUs),
            DateTimeVariant.Time => local.ToString("hh:mm tt", EnUs),
            DateTimeVariant.Short => local.ToString("MMM d", EnUs),
            DateTimeVariant.Relative => Relative(d, now),
            _ => local.ToString("MMM d, yyyy hh:mm tt", EnUs),
        };
    }

    private static string Relative(DateTimeOffset value, DateTimeOffset now)
    {
        long diffMin = (long)Math.Floor((now - value).TotalMinutes);
        if (diffMin < 1)
        {
            return "Just now";
        }

        if (diffMin < 60)
        {
            return $"{diffMin}m ago";
        }

        long diffHrs = diffMin / 60;
        if (diffHrs < 24)
        {
            return $"{diffHrs}h ago";
        }

        return value.LocalDateTime.ToString("MMM d, hh:mm tt", EnUs);
    }
}
