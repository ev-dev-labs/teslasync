using System.Globalization;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The display state one of the two timestamp input fields can be in — the honest union of the
/// branches the web source actually renders. The tool's only hook is <c>useTranslation</c> and it
/// performs no I/O (web/src/features/admin/components/devtools/tools/TimestampTool.tsx), so there is no
/// loading / error / stale / offline branch to reproduce: each field's <c>useMemo</c> collapses to a
/// nullable <c>Date</c> that the view gates with <c>{fromUnix &amp;&amp; (…)}</c> / <c>{fromIso &amp;&amp; (…)}</c>,
/// giving exactly these three outcomes.
/// </summary>
public enum TimestampFieldState
{
    /// <summary>No input yet — the conversion block is not rendered (web falsy memo); the field + label stay visible.</summary>
    Empty,

    /// <summary>The input parsed to a valid instant — the conversion block shows the derived values.</summary>
    Valid,

    /// <summary>The input is present but does not parse to a valid instant — the conversion block is hidden (web <c>null</c> memo).</summary>
    Invalid,
}

/// <summary>
/// Pure, UI-free timestamp conversion — the native port of the web tool's <c>fromUnix</c> / <c>fromIso</c>
/// memos plus the <c>getRelativeTime</c> / <c>formatDateTime</c> helpers it renders with. Reproduces the
/// browser semantics the web relies on: a Unix string longer than 10 characters is milliseconds, otherwise
/// seconds (×1000); an ISO string is parsed leniently; <c>toISOString()</c> always emits UTC with three
/// millisecond digits and a trailing <c>Z</c>; the relative label buckets the absolute difference into
/// <c>Ns/Nm/Nh/Nd ago</c>. Deterministic (every "now" is injected) so it is fully unit-testable without a
/// UI host. .NET's representable instant range (years 1–9999) is narrower than the JS <c>Date</c> range, so
/// values outside it are treated as unparseable — for every realistic 10–13 digit timestamp the two agree.
/// </summary>
public static class TimestampConverter
{
    // DateTimeOffset.FromUnixTimeMilliseconds throws outside this inclusive range (years 1..9999); the web
    // new Date(ms) would yield an "Invalid Date" beyond its own (wider) range, which the memo maps to null.
    private const long UnixMillisecondsMin = -62135596800000L;
    private const long UnixMillisecondsMax = 253402300799999L;

    /// <summary>
    /// Parse a Unix timestamp string exactly as the web <c>fromUnix</c> memo does: empty → null; otherwise
    /// JS <c>parseInt(value, 10)</c> (leading whitespace + optional sign + digit run, anything else → null),
    /// treated as milliseconds when the raw string is longer than 10 characters and seconds (×1000)
    /// otherwise, with an out-of-range instant mapped to null.
    /// </summary>
    public static DateTimeOffset? ParseUnix(string? value)
    {
        if (string.IsNullOrEmpty(value))
        {
            return null;
        }

        if (!TryParseLeadingInteger(value, out long parsed))
        {
            return null;
        }

        long milliseconds;
        if (value.Length > 10)
        {
            milliseconds = parsed;
        }
        else
        {
            try
            {
                milliseconds = checked(parsed * 1000L);
            }
            catch (OverflowException)
            {
                return null;
            }
        }

        if (milliseconds < UnixMillisecondsMin || milliseconds > UnixMillisecondsMax)
        {
            return null;
        }

        return DateTimeOffset.FromUnixTimeMilliseconds(milliseconds);
    }

    /// <summary>
    /// Parse an ISO 8601 timestamp string as the web <c>fromIso</c> memo does (<c>new Date(iso)</c>): empty
    /// or unparseable → null. An explicit <c>Z</c> / offset is honoured; a value without an offset is
    /// interpreted in the local zone (matching the browser for a date-time without a zone designator).
    /// </summary>
    public static DateTimeOffset? ParseIso(string? value)
    {
        if (string.IsNullOrEmpty(value))
        {
            return null;
        }

        if (DateTimeOffset.TryParse(
                value,
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeLocal,
                out DateTimeOffset parsed))
        {
            return parsed;
        }

        return null;
    }

    /// <summary>Whole Unix seconds for an instant (web <c>Math.floor(d.getTime() / 1000)</c>, flooring toward negative infinity).</summary>
    public static long ToUnixSeconds(DateTimeOffset instant)
    {
        long milliseconds = instant.ToUnixTimeMilliseconds();
        long seconds = milliseconds / 1000L;
        if (milliseconds < 0 && milliseconds % 1000L != 0)
        {
            seconds--;
        }

        return seconds;
    }

    /// <summary>ISO 8601 rendering matching JS <c>Date.toISOString()</c>: UTC, three millisecond digits, trailing <c>Z</c>.</summary>
    public static string ToIsoString(DateTimeOffset instant) =>
        instant.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);

    /// <summary>
    /// Localized wall-clock rendering of an instant in the given zone — the native port of the web
    /// <c>formatDateTime</c> (<c>toLocaleString</c> with year/short-month/day + 2-digit hour/minute). The
    /// pattern localizes the month name and AM/PM marker through <paramref name="culture"/>.
    /// </summary>
    public static string FormatLocal(DateTimeOffset instant, TimeZoneInfo zone, CultureInfo culture)
    {
        ArgumentNullException.ThrowIfNull(zone);
        ArgumentNullException.ThrowIfNull(culture);

        DateTimeOffset local = TimeZoneInfo.ConvertTime(instant, zone);
        return local.ToString("MMM d, yyyy, hh:mm tt", culture);
    }

    /// <summary>
    /// Relative-time label, a faithful port of the web <c>getRelativeTime</c> helper: the absolute
    /// difference between <paramref name="now"/> and <paramref name="instant"/> bucketed into
    /// <c>{n}s ago</c> (&lt; 60s), <c>{n}m ago</c> (&lt; 60m), <c>{n}h ago</c> (&lt; 24h), otherwise
    /// <c>{n}d ago</c>. The web helper uses <c>Math.abs</c>, so a future instant also reads "ago".
    /// </summary>
    public static string GetRelativeTime(DateTimeOffset instant, DateTimeOffset now)
    {
        long difference = Math.Abs(now.ToUnixTimeMilliseconds() - instant.ToUnixTimeMilliseconds());

        long seconds = difference / 1000L;
        if (seconds < 60)
        {
            return string.Create(CultureInfo.InvariantCulture, $"{seconds}s ago");
        }

        long minutes = seconds / 60L;
        if (minutes < 60)
        {
            return string.Create(CultureInfo.InvariantCulture, $"{minutes}m ago");
        }

        long hours = minutes / 60L;
        if (hours < 24)
        {
            return string.Create(CultureInfo.InvariantCulture, $"{hours}h ago");
        }

        long days = hours / 24L;
        return string.Create(CultureInfo.InvariantCulture, $"{days}d ago");
    }

    // JS parseInt(value, 10): skip leading whitespace, read an optional sign, then a run of decimal digits.
    // No digit run → NaN (here: false). A digit run too large for Int64 would exceed the representable
    // instant range anyway, so it is reported as unparseable rather than truncated like the JS double.
    private static bool TryParseLeadingInteger(string value, out long result)
    {
        result = 0;

        int index = 0;
        int length = value.Length;
        while (index < length && IsJsWhitespace(value[index]))
        {
            index++;
        }

        int sign = 1;
        if (index < length && (value[index] == '+' || value[index] == '-'))
        {
            if (value[index] == '-')
            {
                sign = -1;
            }

            index++;
        }

        int digitsStart = index;
        while (index < length && value[index] >= '0' && value[index] <= '9')
        {
            index++;
        }

        if (index == digitsStart)
        {
            return false;
        }

        if (!long.TryParse(
                value.AsSpan(digitsStart, index - digitsStart),
                NumberStyles.None,
                CultureInfo.InvariantCulture,
                out long magnitude))
        {
            return false;
        }

        result = sign * magnitude;
        return true;
    }

    private static bool IsJsWhitespace(char c) =>
        char.IsWhiteSpace(c) || c == '\uFEFF';
}

/// <summary>
/// Canonical identity + presentation metadata for the timestamp surface — the native mirror of the web
/// tool's registry entry (id <c>timestamp</c>, Lucide <c>Clock</c> icon, accent <c>green</c>, titles
/// <c>Timestamp</c> / <c>Timestamp Desc</c>) as registered in the web <c>useToolList</c> hook and the
/// native <c>ClientUtilityToolSource</c> catalog. Surfaced as constants so the values are asserted in unit
/// tests and consumed token-first by the view.
/// </summary>
public static class TimestampToolRegistration
{
    /// <summary>Stable surface id (web tool <c>id</c>).</summary>
    public const string Id = "timestamp";

    /// <summary>Surface category (the web devtools "client utilities" group).</summary>
    public const string Category = "devtools";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "TimestampTool";

    /// <summary>Segoe Fluent "Clock" glyph — the native stand-in for the web Lucide <c>Clock</c> icon (card + ISO field + live row).</summary>
    public const string IconGlyph = "\uE823";

    /// <summary>Segoe Fluent number glyph — the native stand-in for the web Lucide <c>Hash</c> icon on the Unix field.</summary>
    public const string UnixIconGlyph = "\uE8EF";

    /// <summary>Segoe Fluent "Clock" glyph for the ISO field (web Lucide <c>Clock</c>).</summary>
    public const string IsoIconGlyph = "\uE823";

    /// <summary>Accent name (web <c>color="green"</c>); resolves to the success token family.</summary>
    public const string AccentName = "green";

    /// <summary>Accent colour token key (green) backing the icon chip tint — the web 'green' <c>ICON_COLOR_MAP</c> entry.</summary>
    public const string AccentColorKey = "TsColorSuccessColor";

    /// <summary>Accent brush token key (green) for the icon glyph foreground.</summary>
    public const string AccentBrushKey = "TsColorSuccessBrush";

    /// <summary>Example value shown in the empty Unix field (the web empty-field example "1700000000", a numeric sample, not localized).</summary>
    public const string UnixHint = "1700000000";

    /// <summary>Example value shown in the empty ISO field (the web empty-field example "2024-01-01T00:00:00Z", a format sample, not localized).</summary>
    public const string IsoHint = "2024-01-01T00:00:00Z";

    /// <summary>Localized card title (web <c>t('Timestamp')</c>).</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("Timestamp", "Timestamp");
    }

    /// <summary>Localized card description (web <c>t('Timestamp Desc')</c>).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("Timestamp Desc", "Timestamp Desc");
    }
}
