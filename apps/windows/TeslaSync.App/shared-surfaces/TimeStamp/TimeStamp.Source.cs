using System.ComponentModel;

namespace TeslaSync.App.SharedSurfaces.TimeStampSurface;

/// <summary>
/// The reactive context the surface reads (P1/S8 state-holder seam) — the native projection of exactly
/// the two web hooks <c>TimeStamp</c> consults: <c>useTimeFormatPreference()</c> (the user's
/// <c>time_format_default</c>, projected as <see cref="FormatPreference"/>) and <c>useDateFormat(in)</c>,
/// which itself composes <c>useSettings()</c> (for <c>locale</c>, <c>timezone_user</c> and
/// <c>tz_display_default</c>) and <c>useSelectedVehicle()</c> (the active vehicle's <c>timezone</c>) via
/// <c>useTimezone()</c>. The view never performs I/O — it binds to this seam, and the app composes its
/// live settings + selected-vehicle holders into one (see <see cref="MutableTimeStampContext"/>). The
/// canonical default is <see cref="SystemTimeStampContext"/>, which reproduces the web defaults
/// (system locale/zone, <c>'vehicle'</c> tz mode, <c>'relative'</c> preference).
/// </summary>
public interface ITimeStampContext
{
    /// <summary>Raised when any value changes, so a bound view-model recomputes (web hook re-render).</summary>
    event EventHandler? Changed;

    /// <summary>The user's BCP-47 display locale (web <c>settings.locale</c>); blank → en-US.</summary>
    string? Locale { get; }

    /// <summary>The user's IANA zone override (web <c>settings.timezone_user</c>); blank → system zone.</summary>
    string? UserTimezone { get; }

    /// <summary>The default zone mode when a call site sets no explicit <c>in</c> (web <c>settings.tz_display_default</c>).</summary>
    TimeStampTzMode DefaultMode { get; }

    /// <summary>The active vehicle's IANA zone (web <c>useSelectedVehicle().vehicle?.timezone</c>); null when unknown.</summary>
    string? VehicleTimezone { get; }

    /// <summary>
    /// The user's preferred default format for <c>format='auto'</c> call sites — the native projection of
    /// <c>useTimeFormatPreference()</c> (web <c>settings.time_format_default</c>). Always a concrete tier
    /// (<see cref="TimeStampFormat.Relative"/> or <see cref="TimeStampFormat.Absolute"/>); the web hook
    /// falls back to <see cref="TimeStampFormat.Relative"/> when the field is missing or unknown.
    /// </summary>
    TimeStampFormat FormatPreference { get; }
}

/// <summary>
/// The canonical no-override context — the native analogue of the web defaults read by the hundreds of
/// call sites that render <c>&lt;TimeStamp value=… /&gt;</c> with no <c>in</c> override: the system
/// locale + zone, <see cref="TimeStampTzMode.Vehicle"/> (web <c>settings.tz_display_default ?? 'vehicle'</c>)
/// and <see cref="TimeStampFormat.Relative"/> (web <c>useTimeFormatPreference</c> fallback). It never
/// raises <see cref="Changed"/>.
/// </summary>
public sealed class SystemTimeStampContext : ITimeStampContext
{
    /// <summary>The shared singleton (the process-wide system default).</summary>
    public static SystemTimeStampContext Instance { get; } = new();

    private SystemTimeStampContext()
    {
    }

    /// <inheritdoc />
    public event EventHandler? Changed
    {
        add { }
        remove { }
    }

    /// <inheritdoc />
    public string? Locale => null;

    /// <inheritdoc />
    public string? UserTimezone => null;

    /// <inheritdoc />
    public TimeStampTzMode DefaultMode => TimeStampTzMode.Vehicle;

    /// <inheritdoc />
    public string? VehicleTimezone => null;

    /// <inheritdoc />
    public TimeStampFormat FormatPreference => TimeStampFormat.Relative;
}

/// <summary>
/// An immutable context snapshot — the native analogue of a single render's view of
/// <c>useTimeFormatPreference()</c> + <c>useSettings()</c> + <c>useSelectedVehicle()</c>. Used to compose
/// the surface from fixed values and to pin every input in unit tests. It never raises <see cref="Changed"/>
/// (a snapshot does not move); use <see cref="MutableTimeStampContext"/> when the values must update live.
/// </summary>
public sealed class StaticTimeStampContext : ITimeStampContext
{
    /// <summary>Creates an immutable snapshot of the surface's inputs.</summary>
    public StaticTimeStampContext(
        string? locale = null,
        string? userTimezone = null,
        TimeStampTzMode defaultMode = TimeStampTzMode.Vehicle,
        string? vehicleTimezone = null,
        TimeStampFormat formatPreference = TimeStampFormat.Relative)
    {
        Locale = locale;
        UserTimezone = userTimezone;
        DefaultMode = defaultMode;
        VehicleTimezone = vehicleTimezone;
        FormatPreference = formatPreference;
    }

    /// <inheritdoc />
    public event EventHandler? Changed
    {
        add { }
        remove { }
    }

    /// <inheritdoc />
    public string? Locale { get; }

    /// <inheritdoc />
    public string? UserTimezone { get; }

    /// <inheritdoc />
    public TimeStampTzMode DefaultMode { get; }

    /// <inheritdoc />
    public string? VehicleTimezone { get; }

    /// <inheritdoc />
    public TimeStampFormat FormatPreference { get; }
}

/// <summary>
/// A mutable context the app drives from its live settings + selected-vehicle state holders — the native
/// analogue of the web context updating when <c>useTimeFormatPreference()</c>, <c>useSettings()</c> or
/// <c>useSelectedVehicle()</c> changes. The shell adapts those holders by pushing each change through the
/// setters here; every set that actually changes a value raises <see cref="Changed"/> so all bound
/// <c>TimeStamp</c> view-models re-render (the web hook re-render). Drive it from one confinement (the UI
/// thread).
/// </summary>
public sealed class MutableTimeStampContext : ITimeStampContext
{
    private string? _locale;
    private string? _userTimezone;
    private TimeStampTzMode _defaultMode;
    private string? _vehicleTimezone;
    private TimeStampFormat _formatPreference;

    /// <summary>Creates the context with optional initial values (the first settings + vehicle read).</summary>
    public MutableTimeStampContext(
        string? locale = null,
        string? userTimezone = null,
        TimeStampTzMode defaultMode = TimeStampTzMode.Vehicle,
        string? vehicleTimezone = null,
        TimeStampFormat formatPreference = TimeStampFormat.Relative)
    {
        _locale = locale;
        _userTimezone = userTimezone;
        _defaultMode = defaultMode;
        _vehicleTimezone = vehicleTimezone;
        _formatPreference = formatPreference;
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public string? Locale
    {
        get => _locale;
        set => SetField(ref _locale, value);
    }

    /// <inheritdoc />
    public string? UserTimezone
    {
        get => _userTimezone;
        set => SetField(ref _userTimezone, value);
    }

    /// <inheritdoc />
    public TimeStampTzMode DefaultMode
    {
        get => _defaultMode;
        set
        {
            if (_defaultMode == value)
            {
                return;
            }

            _defaultMode = value;
            Changed?.Invoke(this, EventArgs.Empty);
        }
    }

    /// <inheritdoc />
    public string? VehicleTimezone
    {
        get => _vehicleTimezone;
        set => SetField(ref _vehicleTimezone, value);
    }

    /// <inheritdoc />
    public TimeStampFormat FormatPreference
    {
        get => _formatPreference;
        set
        {
            if (_formatPreference == value)
            {
                return;
            }

            _formatPreference = value;
            Changed?.Invoke(this, EventArgs.Empty);
        }
    }

    private void SetField(ref string? field, string? value)
    {
        if (string.Equals(field, value, StringComparison.Ordinal))
        {
            return;
        }

        field = value;
        Changed?.Invoke(this, EventArgs.Empty);
    }
}
