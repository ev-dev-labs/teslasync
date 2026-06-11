using System.Globalization;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.SharedSurfaces.DateTimeSurface;

/// <summary>
/// Time-zone display mode — the native port of the web <c>TzMode</c>
/// (web/src/lib/timezone.ts) and the <c>in</c> prop of
/// <c>components/data-display/format/DateTime.tsx</c>. It selects which zone a UTC instant is
/// rendered in while the underlying data stays UTC: the active vehicle's local zone, the user's
/// own zone, or UTC. Mirrors the settings <c>tz_display_default</c> values
/// (<see cref="TeslaSync.App.FeatureViews.TimeZoneDisplay"/> in the General-settings surface) but is
/// declared here so this surface owns its own seam types and never couples to a feature view.
/// </summary>
public enum DateTimeTzMode
{
    /// <summary>The active vehicle's local zone, falling back to the user zone when unknown (web <c>'vehicle'</c>).</summary>
    Vehicle,

    /// <summary>The user's own zone — their override, else the system zone (web <c>'user'</c>).</summary>
    User,

    /// <summary>Coordinated Universal Time (web <c>'utc'</c>).</summary>
    Utc,
}

/// <summary>
/// The branch the surface actually renders. The web source is a synchronous, side-effect-free
/// formatter — it performs no network read, so it has no loading / error / stale / offline chrome
/// (the same honest union the shipped <c>TimestampTool</c> surface documents). Its zone + locale are
/// resolved from already-cached settings + the selected vehicle and degrade gracefully (an unknown
/// vehicle zone falls back to the user zone; a blank locale falls back to en-US), so the only
/// visible branches are: there is no value to show, or there is.
/// </summary>
public enum DateTimeRenderState
{
    /// <summary>The value is <see langword="null"/> — the em-dash sentinel is shown (web <c>value</c> falsy → "—").</summary>
    Empty,

    /// <summary>A valid instant is present — the formatted timestamp is shown.</summary>
    Rendered,
}

/// <summary>
/// Canonical metadata for the DateTime surface — the native analogue of the (anonymous) web
/// <c>format/DateTime</c> component. The web component renders no titles or labels of its own and has
/// no <c>t()</c> call sites, so this carries only the diagnostics slug the surface registers under.
/// </summary>
public static class DateTimeRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "DateTime";
}

/// <summary>
/// Pure, locale- and zone-aware datetime formatting for the surface — the native port of the web
/// <c>format/DateTime</c> rendering plus the <c>lib/dateFormat</c>, <c>lib/timezone</c> and
/// <c>lib/locale</c> helpers it composes. The PURE path (no zone / locale override) delegates to the
/// shared <see cref="DateTimeFormatting"/> behaviour port (the same contract <c>TsDateTime</c> uses)
/// so the two stay byte-for-byte identical; the zone-aware path (<c>&lt;DateTime in=… /&gt;</c> /
/// <c>showTz</c>) renders the same variant patterns in a resolved <see cref="TimeZoneInfo"/> +
/// <see cref="CultureInfo"/>. Everything is static and <c>now</c>-injectable so the relative tiers and
/// the zone/locale resolution are unit-tested deterministically. Null inputs render the em-dash
/// sentinel; an unknown zone or blank locale falls back gracefully exactly as the web helpers do.
/// </summary>
public static class DateTimeSurfaceFormatting
{
    /// <summary>Em-dash sentinel for null / absent timestamps (web universal "—").</summary>
    public const string EmptyDisplay = DateTimeFormatting.DefaultEmptyDisplay;

    /// <summary>The default BCP-47 locale used when a settings locale is blank (web <c>resolveLocale</c>).</summary>
    public const string DefaultLocale = "en-US";

    /// <summary>The canonical UTC zone id (web <c>resolveTimezone</c> <c>'utc'</c> branch).</summary>
    public const string UtcZoneId = "UTC";

    // Variant patterns mirror DateTimeFormatting exactly so the zone-aware path matches the pure path
    // (and TsDateTime) field-for-field; only the source zone + culture differ.
    private const string FullPattern = "MMM d, yyyy hh:mm tt";
    private const string DatePattern = "MMM d, yyyy";
    private const string TimePattern = "hh:mm tt";
    private const string ShortPattern = "MMM d";
    private const string RelativeAbsolutePattern = "MMM d, hh:mm tt";

    /// <summary>
    /// Resolve a settings locale to a usable <see cref="CultureInfo"/> — the native port of the web
    /// <c>resolveLocale</c> (web/src/lib/locale.ts): a blank or whitespace-only value (the settings API
    /// can return <c>locale: ''</c>) falls back to <see cref="DefaultLocale"/> rather than throwing, and
    /// an unrecognised tag also falls back instead of crashing the render tree.
    /// </summary>
    public static CultureInfo ResolveLocale(string? locale)
    {
        if (string.IsNullOrWhiteSpace(locale))
        {
            return CultureInfo.GetCultureInfo(DefaultLocale);
        }

        try
        {
            return CultureInfo.GetCultureInfo(locale.Trim());
        }
        catch (CultureNotFoundException)
        {
            return CultureInfo.GetCultureInfo(DefaultLocale);
        }
    }

    /// <summary>
    /// Compute the zone id for a mode + the vehicle's reported zone + the user's optional override — a
    /// faithful port of the web pure <c>resolveTimezone</c> (web/src/lib/timezone.ts):
    /// <list type="bullet">
    /// <item><c>Utc</c> → <see cref="UtcZoneId"/>.</item>
    /// <item><c>User</c> → the user override when set, else <paramref name="systemZoneId"/> (web browser zone).</item>
    /// <item><c>Vehicle</c> → the vehicle zone, falling back to the user zone when the vehicle has not
    /// been polled yet (a blank zone or the literal <see cref="UtcZoneId"/>).</item>
    /// </list>
    /// </summary>
    public static string ResolveZoneId(
        DateTimeTzMode mode,
        string? vehicleZoneId,
        string? userZoneId,
        string systemZoneId)
    {
        if (mode == DateTimeTzMode.Utc)
        {
            return UtcZoneId;
        }

        string userZone = string.IsNullOrWhiteSpace(userZoneId) ? systemZoneId : userZoneId.Trim();
        if (mode == DateTimeTzMode.User)
        {
            return userZone;
        }

        if (string.IsNullOrWhiteSpace(vehicleZoneId) || string.Equals(vehicleZoneId.Trim(), UtcZoneId, StringComparison.OrdinalIgnoreCase))
        {
            return userZone;
        }

        return vehicleZoneId.Trim();
    }

    /// <summary>
    /// Resolve a zone id (IANA or Windows) to a <see cref="TimeZoneInfo"/>, falling back to
    /// <paramref name="fallback"/> when the id is unknown — the native analogue of the web helpers
    /// tolerating an invalid IANA tag (they catch and fall back to browser-local rather than throwing).
    /// </summary>
    public static TimeZoneInfo ResolveZone(string? zoneId, TimeZoneInfo fallback)
    {
        ArgumentNullException.ThrowIfNull(fallback);

        if (string.IsNullOrWhiteSpace(zoneId))
        {
            return fallback;
        }

        if (string.Equals(zoneId.Trim(), UtcZoneId, StringComparison.OrdinalIgnoreCase))
        {
            return TimeZoneInfo.Utc;
        }

        try
        {
            return TimeZoneInfo.FindSystemTimeZoneById(zoneId.Trim());
        }
        catch (TimeZoneNotFoundException)
        {
            return fallback;
        }
        catch (InvalidTimeZoneException)
        {
            return fallback;
        }
    }

    /// <summary>
    /// Format an instant for display. The PURE path (<paramref name="zone"/> / <paramref name="culture"/>
    /// unset) delegates to the shared <see cref="DateTimeFormatting"/> port (system zone + en-US), keeping
    /// the no-override call sites identical to <c>TsDateTime</c>; the zone-aware path renders the same
    /// variant patterns after converting to <paramref name="zone"/> with <paramref name="culture"/>. A
    /// null value renders the em-dash sentinel for either path (web <c>value</c> falsy → "—").
    /// </summary>
    public static string Format(
        DateTimeOffset? value,
        DateTimeVariant variant,
        DateTimeOffset now,
        TimeZoneInfo? zone = null,
        CultureInfo? culture = null)
    {
        if (value is not { } instant)
        {
            return EmptyDisplay;
        }

        if (zone is null || culture is null)
        {
            return DateTimeFormatting.Format(value, variant, now);
        }

        DateTimeOffset local = TimeZoneInfo.ConvertTime(instant, zone);
        return variant switch
        {
            DateTimeVariant.Date => local.ToString(DatePattern, culture),
            DateTimeVariant.Time => local.ToString(TimePattern, culture),
            DateTimeVariant.Short => local.ToString(ShortPattern, culture),
            DateTimeVariant.Relative => RelativeInZone(instant, now, zone, culture),
            _ => local.ToString(FullPattern, culture),
        };
    }

    /// <summary>
    /// The hover/title string for an instant — the native port of the web <c>renderSpan</c> title
    /// (<c>d.toISOString()</c>, optionally suffixed <c>(tz)</c> on the zone-aware path). The ISO is always
    /// the UTC instant with three millisecond digits and a trailing <c>Z</c> (JS <c>toISOString()</c>);
    /// <see langword="null"/> when there is no value (web computes the title only <c>if (value)</c>).
    /// </summary>
    public static string? IsoTitle(DateTimeOffset? value, string? zoneId = null)
    {
        if (value is not { } instant)
        {
            return null;
        }

        string iso = instant.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
        return string.IsNullOrWhiteSpace(zoneId) ? iso : $"{iso} ({zoneId.Trim()})";
    }

    /// <summary>
    /// The short zone designator appended when <c>showTz</c> is set — the native analogue of the web
    /// <c>tzAbbreviation</c>. .NET / ICU does not expose the political short names (e.g. "PST") that
    /// <c>Intl.DateTimeFormat(timeZoneName:'short')</c> emits for some zones, so this renders the
    /// canonical GMT-offset short name (e.g. "UTC", "GMT-8", "GMT+5:30") — exactly what <c>Intl</c> itself
    /// returns for the many zones without a political abbreviation. The offset is taken at
    /// <paramref name="value"/>, so it is DST-aware (a summer instant yields a different offset than a
    /// winter one for a daylight-saving zone). Empty when there is no value.
    /// </summary>
    public static string TzAbbreviation(DateTimeOffset? value, TimeZoneInfo zone)
    {
        ArgumentNullException.ThrowIfNull(zone);

        if (value is not { } instant)
        {
            return string.Empty;
        }

        TimeSpan offset = zone.GetUtcOffset(instant);
        if (offset == TimeSpan.Zero)
        {
            return UtcZoneId;
        }

        string sign = offset < TimeSpan.Zero ? "-" : "+";
        TimeSpan magnitude = offset.Duration();
        return magnitude.Minutes == 0
            ? string.Create(CultureInfo.InvariantCulture, $"GMT{sign}{magnitude.Hours}")
            : string.Create(CultureInfo.InvariantCulture, $"GMT{sign}{magnitude.Hours}:{magnitude.Minutes:D2}");
    }

    private static string RelativeInZone(DateTimeOffset value, DateTimeOffset now, TimeZoneInfo zone, CultureInfo culture)
    {
        // Buckets are zone-independent (a time difference); only the absolute fallback is rendered in zone.
        // Mirrors DateTimeFormatting.Relative / web formatRelativeTime: Just now / Nm / Nh / absolute.
        long diffMin = (long)Math.Floor((now - value).TotalMinutes);
        if (diffMin < 1)
        {
            return "Just now";
        }

        if (diffMin < 60)
        {
            return string.Create(CultureInfo.InvariantCulture, $"{diffMin}m ago");
        }

        long diffHrs = diffMin / 60;
        if (diffHrs < 24)
        {
            return string.Create(CultureInfo.InvariantCulture, $"{diffHrs}h ago");
        }

        return TimeZoneInfo.ConvertTime(value, zone).ToString(RelativeAbsolutePattern, culture);
    }
}

/// <summary>
/// PII-safe diagnostics for the DateTime surface (P1/S11 diagnostics contract). A rendered timestamp
/// can be sensitive (it can pin a drive, a charge or a user's presence to a moment), so the collector
/// records only the operational <c>view.opened</c> event with the surface slug — never the value, the
/// zone or the formatted string. Thread-safe.
/// </summary>
public sealed class DateTimeDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public DateTimeDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=DateTime</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={DateTimeRegistration.Slug}");
    }
}
