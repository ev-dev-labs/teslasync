using System.Globalization;

namespace TeslaSync.App.SharedSurfaces.TimeStampSurface;

/// <summary>
/// The visible-format selector — the native port of the web <c>TimeStampFormat</c>
/// (<c>'relative' | 'absolute' | 'auto'</c>, web/src/components/data-display/TimeStamp.tsx).
/// <see cref="Auto"/> honours the user's <c>time_format_default</c> Settings preference; the two
/// concrete values override it for a specific surface.
/// </summary>
public enum TimeStampFormat
{
    /// <summary>Honour the user's <c>time_format_default</c> preference (web <c>'auto'</c>, the default).</summary>
    Auto,

    /// <summary>Always render the relative tier ("2h ago") in the body (web <c>'relative'</c>).</summary>
    Relative,

    /// <summary>Always render the absolute timestamp ("Apr 4, 2026, 02:30 AM") in the body (web <c>'absolute'</c>).</summary>
    Absolute,
}

/// <summary>
/// Time-zone display mode — the native port of the web <c>TzMode</c> (web/src/lib/timezone.ts) and the
/// <c>in</c> prop of <c>TimeStamp</c>. It selects which zone a UTC instant is rendered in while the
/// underlying data stays UTC: the active vehicle's local zone, the user's own zone, or UTC. Mirrors the
/// settings <c>tz_display_default</c> values but is declared here so this surface owns its own seam types
/// and never couples to a feature view.
/// </summary>
public enum TimeStampTzMode
{
    /// <summary>The active vehicle's local zone, falling back to the user zone when unknown (web <c>'vehicle'</c>).</summary>
    Vehicle,

    /// <summary>The user's own zone — their override, else the system zone (web <c>'user'</c>).</summary>
    User,

    /// <summary>Coordinated Universal Time (web <c>'utc'</c>).</summary>
    Utc,
}

/// <summary>
/// The branch the surface actually renders. The web source is a synchronous, side-effect-free formatter
/// (<c>useTimeFormatPreference</c> + <c>useDateFormat</c> read already-cached settings; no network read),
/// so it has no loading / error / stale / offline chrome — the same honest union the shipped
/// <c>DateTime</c> sibling surface documents. Its zone + locale + preference degrade gracefully (an unknown
/// vehicle zone falls back to the user zone; a blank locale falls back to en-US; a missing preference falls
/// back to relative), so the only visible branches are: there is no value to show, or there is.
/// </summary>
public enum TimeStampRenderState
{
    /// <summary>The value is <see langword="null"/> — the em-dash sentinel is shown with no tooltip (web <c>value == null</c> → "—").</summary>
    Empty,

    /// <summary>A valid instant is present — the primary format is shown with the alternate format on hover.</summary>
    Rendered,
}

/// <summary>
/// Canonical metadata for the TimeStamp surface — the native analogue of the (anonymous) web
/// <c>TimeStamp</c> component. The web component renders no titles or labels of its own and has no
/// <c>t()</c> call sites, so this carries only the diagnostics slug the surface registers under.
/// </summary>
public static class TimeStampRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "TimeStamp";
}

/// <summary>
/// Pure, locale- and zone-aware timestamp formatting for the surface — the native port of the web
/// <c>TimeStamp</c> render plus the <c>lib/dateFormat</c> (<c>formatDateTime</c> / <c>formatRelative</c> /
/// <c>formatDate</c>), <c>lib/timezone</c> (<c>resolveTimezone</c>) and <c>lib/locale</c>
/// (<c>resolveLocale</c>) helpers it composes through <c>useDateFormat</c>. The relative tiers and the
/// effective-format resolution are <c>now</c>-injectable and static so they unit-test deterministically.
/// Because .NET / ICU does not reproduce <c>Intl</c>'s per-locale date skeletons byte-for-byte, the
/// absolute / date variants render the same fixed field pattern the web emits for en-US, localised through
/// the resolved <see cref="CultureInfo"/> (month names, AM/PM) — the same parity ceiling the
/// <c>DateTime</c> sibling documents. Null inputs render the em-dash sentinel; an unknown zone or blank
/// locale falls back gracefully exactly as the web helpers do.
/// </summary>
public static class TimeStampFormatting
{
    /// <summary>Em-dash sentinel for null / absent timestamps (web universal "—").</summary>
    public const string EmptyDisplay = "\u2014";

    /// <summary>The default BCP-47 locale used when a settings locale is blank (web <c>resolveLocale</c>).</summary>
    public const string DefaultLocale = "en-US";

    /// <summary>The canonical UTC zone id (web <c>resolveTimezone</c> <c>'utc'</c> branch).</summary>
    public const string UtcZoneId = "UTC";

    /// <summary>Relative tier shown for sub-minute deltas (web <c>formatRelative</c> <c>'just now'</c>, lower-case).</summary>
    public const string JustNow = "just now";

    // Field patterns mirror web lib/dateFormat exactly for en-US:
    //   formatDateTime → toLocaleString({year,month:'short',day,hour:'2-digit',minute:'2-digit'}) → "Apr 4, 2026, 02:30 AM"
    //   formatDate     → toLocaleDateString({year,month:'short',day})                              → "Apr 4, 2026"
    // Only the source zone + culture differ from the literal pattern.
    private const string AbsolutePattern = "MMM d, yyyy, hh:mm tt";
    private const string DatePattern = "MMM d, yyyy";

    /// <summary>
    /// Resolve the visible format for a call site — the native port of the web
    /// <c>effective = format === 'auto' ? pref : format</c>. <see cref="TimeStampFormat.Auto"/> defers to
    /// <paramref name="preference"/> (the user's <c>time_format_default</c>); the concrete values override
    /// it. The result is always a concrete tier — a degenerate <see cref="TimeStampFormat.Auto"/>
    /// preference falls back to <see cref="TimeStampFormat.Relative"/> (web default).
    /// </summary>
    public static TimeStampFormat ResolveEffectiveFormat(TimeStampFormat format, TimeStampFormat preference)
    {
        TimeStampFormat resolved = format == TimeStampFormat.Auto ? preference : format;
        return resolved == TimeStampFormat.Auto ? TimeStampFormat.Relative : resolved;
    }

    /// <summary>
    /// Resolve a settings locale to a usable <see cref="CultureInfo"/> — the native port of the web
    /// <c>resolveLocale</c> (web/src/lib/locale.ts): a blank or whitespace-only value (the settings API can
    /// return <c>locale: ''</c>) falls back to <see cref="DefaultLocale"/> rather than throwing, and an
    /// unrecognised tag also falls back instead of crashing the render tree.
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
    /// <item><c>Vehicle</c> → the vehicle zone, falling back to the user zone when the vehicle has not been
    /// polled yet (a blank zone or the literal <see cref="UtcZoneId"/>).</item>
    /// </list>
    /// </summary>
    public static string ResolveZoneId(
        TimeStampTzMode mode,
        string? vehicleZoneId,
        string? userZoneId,
        string systemZoneId)
    {
        if (mode == TimeStampTzMode.Utc)
        {
            return UtcZoneId;
        }

        string userZone = string.IsNullOrWhiteSpace(userZoneId) ? systemZoneId : userZoneId.Trim();
        if (mode == TimeStampTzMode.User)
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
    /// Render the absolute timestamp — the native port of the web <c>formatDateTime</c>
    /// (<c>useDateFormat().formatDateTime</c>): the instant converted to <paramref name="zone"/> and
    /// rendered "MMM d, yyyy, hh:mm tt" through <paramref name="culture"/> (e.g. "Apr 4, 2026, 02:30 AM").
    /// </summary>
    public static string FormatAbsolute(DateTimeOffset value, TimeZoneInfo zone, CultureInfo culture)
    {
        ArgumentNullException.ThrowIfNull(zone);
        ArgumentNullException.ThrowIfNull(culture);

        return TimeZoneInfo.ConvertTime(value, zone).ToString(AbsolutePattern, culture);
    }

    /// <summary>
    /// Render the relative tier — the native port of the web <c>formatRelative</c>
    /// (<c>useDateFormat().formatRelative</c>): "just now" (&lt; 1 min), "{n}m ago" (&lt; 1 h),
    /// "{n}h ago" (&lt; 1 day), "{n}d ago" (&lt; 7 days), then the absolute date fallback
    /// ("MMM d, yyyy") rendered in <paramref name="zone"/> + <paramref name="culture"/>. The tier buckets
    /// are an instant difference and so are zone-independent; only the &gt; 7-day date fallback is rendered
    /// in zone. A future instant (negative delta) reads "just now", matching the web's unguarded
    /// <c>seconds &lt; 60</c> branch.
    /// </summary>
    public static string FormatRelative(DateTimeOffset value, DateTimeOffset now, TimeZoneInfo zone, CultureInfo culture)
    {
        ArgumentNullException.ThrowIfNull(zone);
        ArgumentNullException.ThrowIfNull(culture);

        long seconds = (long)Math.Floor((now - value).TotalSeconds);
        if (seconds < 60)
        {
            return JustNow;
        }

        long minutes = seconds / 60;
        if (minutes < 60)
        {
            return string.Create(CultureInfo.InvariantCulture, $"{minutes}m ago");
        }

        long hours = minutes / 60;
        if (hours < 24)
        {
            return string.Create(CultureInfo.InvariantCulture, $"{hours}h ago");
        }

        long days = hours / 24;
        if (days < 7)
        {
            return string.Create(CultureInfo.InvariantCulture, $"{days}d ago");
        }

        return TimeZoneInfo.ConvertTime(value, zone).ToString(DatePattern, culture);
    }
}

/// <summary>
/// PII-safe diagnostics for the TimeStamp surface (P1/S11 diagnostics contract). A rendered timestamp can
/// be sensitive (it can pin a drive, a charge or a user's presence to a moment), so the collector records
/// only the operational <c>view.opened</c> event with the surface slug — never the value, the zone, the
/// preference or the formatted string. Thread-safe.
/// </summary>
public sealed class TimeStampDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public TimeStampDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=TimeStamp</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={TimeStampRegistration.Slug}");
    }
}
