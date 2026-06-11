using System.ComponentModel;

namespace TeslaSync.App.SharedSurfaces.DateTimeSurface;

/// <summary>
/// The reactive context the zone-aware DateTime path reads (P1/S8 state-holder seam) — the native
/// projection of exactly the three web hooks <c>format/DateTime</c> consults on its
/// <c>&lt;DateTime in=… /&gt;</c> / <c>showTz</c> branch: <c>useSettings()</c> (for <c>locale</c>,
/// <c>timezone_user</c> and <c>tz_display_default</c>) and <c>useSelectedVehicle()</c> (for the active
/// vehicle's <c>timezone</c>), combined by <c>useTimezone()</c>. The view never performs I/O — it binds
/// to this seam, and the app composes its live settings + selected-vehicle holders into one (see
/// <see cref="MutableDateTimeContext"/>). The canonical no-override default is
/// <see cref="SystemDateTimeContext"/>, which reproduces the web PURE path (browser/system defaults)
/// used by the hundreds of call sites that render <c>&lt;DateTime /&gt;</c> with no zone props.
/// </summary>
public interface IDateTimeContext
{
    /// <summary>Raised when any value changes, so a bound view-model recomputes (web hook re-render).</summary>
    event EventHandler? Changed;

    /// <summary>The user's BCP-47 display locale (web <c>settings.locale</c>); blank → en-US.</summary>
    string? Locale { get; }

    /// <summary>The user's IANA zone override (web <c>settings.timezone_user</c>); blank → system zone.</summary>
    string? UserTimezone { get; }

    /// <summary>The default zone mode when a call site sets no explicit <c>in</c> (web <c>settings.tz_display_default</c>).</summary>
    DateTimeTzMode DefaultMode { get; }

    /// <summary>The active vehicle's IANA zone (web <c>useSelectedVehicle().vehicle?.timezone</c>); null when unknown.</summary>
    string? VehicleTimezone { get; }
}

/// <summary>
/// The canonical no-override context — the native analogue of the web PURE path
/// (<c>&lt;DateTime /&gt;</c> with no <c>in</c> / <c>showTz</c>), which renders in the browser/system
/// locale + zone and reads no settings or vehicle. <see cref="DefaultMode"/> is
/// <see cref="DateTimeTzMode.Vehicle"/> to match the web <c>settings.tz_display_default ?? 'vehicle'</c>
/// default should a call site opt into the zone-aware path with this context; every other member is the
/// "unknown" default so resolution falls back to the system zone. It never raises <see cref="Changed"/>.
/// </summary>
public sealed class SystemDateTimeContext : IDateTimeContext
{
    /// <summary>The shared singleton (the process-wide system default).</summary>
    public static SystemDateTimeContext Instance { get; } = new();

    private SystemDateTimeContext()
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
    public DateTimeTzMode DefaultMode => DateTimeTzMode.Vehicle;

    /// <inheritdoc />
    public string? VehicleTimezone => null;
}

/// <summary>
/// An immutable context snapshot — the native analogue of a single render's view of
/// <c>useSettings()</c> + <c>useSelectedVehicle()</c>. Used to compose the zone-aware path from fixed
/// values and to pin every input in unit tests. It never raises <see cref="Changed"/> (a snapshot does
/// not move); use <see cref="MutableDateTimeContext"/> when the values must update live.
/// </summary>
public sealed class StaticDateTimeContext : IDateTimeContext
{
    /// <summary>Creates an immutable snapshot of the zone-aware inputs.</summary>
    public StaticDateTimeContext(
        string? locale = null,
        string? userTimezone = null,
        DateTimeTzMode defaultMode = DateTimeTzMode.Vehicle,
        string? vehicleTimezone = null)
    {
        Locale = locale;
        UserTimezone = userTimezone;
        DefaultMode = defaultMode;
        VehicleTimezone = vehicleTimezone;
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
    public DateTimeTzMode DefaultMode { get; }

    /// <inheritdoc />
    public string? VehicleTimezone { get; }
}

/// <summary>
/// A mutable context the app drives from its live settings + selected-vehicle state holders — the
/// native analogue of the web context updating when <c>useSettings()</c> or <c>useSelectedVehicle()</c>
/// changes. The shell adapts those holders by pushing each change through the setters here; every set
/// that actually changes a value raises <see cref="Changed"/> so all bound <c>DateTime</c> view-models
/// re-render (the web hook re-render). Drive it from one confinement (the UI thread).
/// </summary>
public sealed class MutableDateTimeContext : IDateTimeContext
{
    private string? _locale;
    private string? _userTimezone;
    private DateTimeTzMode _defaultMode;
    private string? _vehicleTimezone;

    /// <summary>Creates the context with optional initial values (the first settings + vehicle read).</summary>
    public MutableDateTimeContext(
        string? locale = null,
        string? userTimezone = null,
        DateTimeTzMode defaultMode = DateTimeTzMode.Vehicle,
        string? vehicleTimezone = null)
    {
        _locale = locale;
        _userTimezone = userTimezone;
        _defaultMode = defaultMode;
        _vehicleTimezone = vehicleTimezone;
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
    public DateTimeTzMode DefaultMode
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
