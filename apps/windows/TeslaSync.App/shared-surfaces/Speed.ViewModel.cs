using System.ComponentModel;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="Speed"/> view — the native port of the web component
/// body (web/src/components/data-display/format/Speed.tsx). The web component's render inputs are the
/// caller-supplied <c>mph</c> / <c>kmh</c> / <c>precision</c> props plus the <c>useUnits()</c> preference; this
/// holder mirrors that by tracking those inputs and the current <see cref="UnitPref"/> from the shared
/// <see cref="IUnitPreferenceSource"/> (P1/S8 seam — the <c>useUnits</c> analog). It exposes the projected
/// <see cref="SpeedProjection"/> the view renders and raises <see cref="PropertyChanged"/> when the host pushes a
/// new input (web prop change) or when the user switches their measurement system at runtime (web <c>useUnits</c>
/// re-render). The view performs no I/O of its own. <see cref="Dispose"/> unsubscribes from the preference source
/// (the web hook's effect cleanup).
/// </summary>
public sealed class SpeedViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IDisposable _unitSubscription;
    private UnitPref _pref;
    private double? _mph;
    private double? _kmh;
    private int? _precision;
    private SpeedProjection _projection;
    private bool _disposed;

    /// <summary>
    /// Creates the holder over the full set of web props and the unit-preference source (P1/S8 seam).
    /// </summary>
    /// <param name="mph">The speed in miles-per-hour (web <c>mph</c>), or null.</param>
    /// <param name="kmh">The speed in kilometres-per-hour (web <c>kmh</c>), or null.</param>
    /// <param name="precision">The per-call fraction-digit override (web <c>precision</c>), or null.</param>
    /// <param name="units">The unit-preference source.</param>
    public SpeedViewModel(double? mph, double? kmh, int? precision, IUnitPreferenceSource units)
    {
        ArgumentNullException.ThrowIfNull(units);

        _mph = mph;
        _kmh = kmh;
        _precision = precision;
        _pref = units.Current;
        _projection = SpeedProjection.Project(_mph, _kmh, _precision, _pref);
        _unitSubscription = units.Observe(OnUnitPreferenceChanged);
    }

    /// <summary>Creates the holder for an mph reading with the default precision and the supplied source.</summary>
    /// <param name="mph">The speed in miles-per-hour (web <c>mph</c>).</param>
    /// <param name="units">The unit-preference source.</param>
    public SpeedViewModel(double mph, IUnitPreferenceSource units)
        : this(mph, kmh: null, precision: null, units)
    {
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>Speed</c>).</summary>
    public static string Slug => SpeedRegistration.Slug;

    /// <summary>The current render projection (converted + formatted value, title, unit, precision).</summary>
    public SpeedProjection Projection => _projection;

    /// <summary>The current miles-per-hour input (web <c>mph</c>), or null.</summary>
    public double? Mph => _mph;

    /// <summary>The current kilometres-per-hour input (web <c>kmh</c>), or null.</summary>
    public double? Kmh => _kmh;

    /// <summary>The current per-call precision override (web <c>precision</c>), or null.</summary>
    public int? Precision => _precision;

    /// <summary>The current unit preference bag (web <c>useUnits().unitPrefs</c>).</summary>
    public UnitPref UnitPreference => _pref;

    /// <summary>Whether a finite speed is currently displayed (false renders the empty fallback).</summary>
    public bool HasValue => _projection.HasValue;

    /// <summary>The full visible readout (<c>"{number} {unit}"</c> or the empty fallback).</summary>
    public string DisplayText => _projection.DisplayText;

    /// <summary>The hover title (raw source value + source unit), or null in the empty state.</summary>
    public string? Title => _projection.Title;

    /// <summary>The accessible name the view exposes to Narrator (equals <see cref="DisplayText"/>).</summary>
    public string AccessibleName => _projection.AccessibleName;

    /// <summary>
    /// Push a new miles-per-hour reading (web <c>mph</c> prop change). Re-projects and raises
    /// <see cref="PropertyChanged"/> when anything visible changes. A no-op when the value is unchanged.
    /// </summary>
    /// <param name="mph">The new miles-per-hour value, or null to clear it.</param>
    public void SetMph(double? mph)
    {
        if (NullableEquals(_mph, mph))
        {
            return;
        }

        _mph = mph;
        Raise(nameof(Mph));
        Reproject();
    }

    /// <summary>
    /// Push a new kilometres-per-hour reading (web <c>kmh</c> prop change). Re-projects and raises
    /// <see cref="PropertyChanged"/> when anything visible changes. A no-op when the value is unchanged.
    /// </summary>
    /// <param name="kmh">The new kilometres-per-hour value, or null to clear it.</param>
    public void SetKmh(double? kmh)
    {
        if (NullableEquals(_kmh, kmh))
        {
            return;
        }

        _kmh = kmh;
        Raise(nameof(Kmh));
        Reproject();
    }

    /// <summary>
    /// Push a new per-call precision override (web <c>precision</c> prop change). Re-projects and raises
    /// <see cref="PropertyChanged"/> when anything visible changes. A no-op when the value is unchanged.
    /// </summary>
    /// <param name="precision">The new fraction-digit override, or null to fall back to the default.</param>
    public void SetPrecision(int? precision)
    {
        if (_precision == precision)
        {
            return;
        }

        _precision = precision;
        Raise(nameof(Precision));
        Reproject();
    }

    /// <summary>Stop listening to the preference source (the web effect cleanup); idempotent.</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _unitSubscription.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnUnitPreferenceChanged(UnitPref pref)
    {
        if (pref is null || _pref.Equals(pref))
        {
            return;
        }

        _pref = pref;
        Raise(nameof(UnitPreference));
        Reproject();
    }

    private void Reproject()
    {
        SpeedProjection next = SpeedProjection.Project(_mph, _kmh, _precision, _pref);
        if (next == _projection)
        {
            return;
        }

        bool displayChanged = !string.Equals(next.DisplayText, _projection.DisplayText, StringComparison.Ordinal);
        bool titleChanged = !string.Equals(next.Title, _projection.Title, StringComparison.Ordinal);
        bool hasValueChanged = next.HasValue != _projection.HasValue;
        _projection = next;

        Raise(nameof(Projection));
        if (displayChanged)
        {
            Raise(nameof(DisplayText));
            Raise(nameof(AccessibleName));
        }

        if (titleChanged)
        {
            Raise(nameof(Title));
        }

        if (hasValueChanged)
        {
            Raise(nameof(HasValue));
        }
    }

    private static bool NullableEquals(double? a, double? b)
    {
        if (a is null)
        {
            return b is null;
        }

        return b is { } y && a.Value.Equals(y);
    }

    private void Raise(string propertyName) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
}
