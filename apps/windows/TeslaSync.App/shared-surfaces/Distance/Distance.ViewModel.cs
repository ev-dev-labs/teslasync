using System.ComponentModel;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The UI-thread-free state holder backing the WinUI <see cref="Distance"/> view — the native port of the web
/// component body (web/src/components/data-display/format/Distance.tsx). It observes the bound
/// <see cref="IDistanceUnitsSource"/> (the P1/S8 seam carrying the <c>useUnits().unitPrefs</c> preference) and
/// holds the caller-supplied distance "props" (<c>miles</c> / <c>km</c> / <c>precision</c>), projecting every
/// change through <see cref="DistanceProjection"/> into a render-ready <see cref="Projection"/>. Pushing a new
/// distance (<see cref="SetMiles"/> / <see cref="SetKilometers"/> / <see cref="SetPrecision"/>) or a unit
/// preference change re-projects and raises <see cref="PropertyChanged"/> only for the facets that actually
/// changed. It carries no view-framework dependency so it is verified headlessly; the WinUI view marshals its
/// notifications onto the dispatcher. <see cref="Dispose"/> detaches from the units seam (the web effect
/// cleanup); idempotent.
/// </summary>
public sealed class DistanceViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IDistanceUnitsSource _units;
    private double? _miles;
    private double? _km;
    private int? _precision;
    private DistanceProjection _projection;
    private bool _disposed;

    /// <summary>Creates the holder over its units seam and the initial caller distance, projecting the first frame.</summary>
    /// <param name="units">The unit-preference seam (the web <c>useUnits</c>).</param>
    /// <param name="miles">The initial value in miles (web <c>miles</c> prop), or null.</param>
    /// <param name="km">The initial value in kilometres (web <c>km</c> prop), or null.</param>
    /// <param name="precision">The initial fraction-digit override (web <c>precision</c> prop), or null.</param>
    public DistanceViewModel(IDistanceUnitsSource units, double? miles = null, double? km = null, int? precision = null)
    {
        ArgumentNullException.ThrowIfNull(units);
        _units = units;
        _miles = miles;
        _km = km;
        _precision = precision;
        _projection = Project();
        _units.Changed += OnUnitsChanged;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>Distance</c>).</summary>
    public static string Slug => DistanceRegistration.Slug;

    /// <summary>The current render projection (resolved unit + formatted readout + tooltip).</summary>
    public DistanceProjection Projection => _projection;

    /// <summary>Which render branch is showing (web dash vs formatted readout).</summary>
    public DistanceState State => _projection.State;

    /// <summary>True while the formatted readout is showing (a finite value was supplied).</summary>
    public bool HasValue => _projection.HasValue;

    /// <summary>The visible text (<c>{number} {unit}</c> or the em dash).</summary>
    public string Display => _projection.Display;

    /// <summary>The raw-value tooltip (web <c>title</c>), or null in the empty state.</summary>
    public string? Title => _projection.Title;

    /// <summary>The resolved display-unit label (web <c>distanceUnit</c>).</summary>
    public string UnitLabel => _projection.UnitLabel;

    /// <summary>The surface's accessible name (the visible text).</summary>
    public string AccessibleName => _projection.AccessibleName;

    /// <summary>The current value in miles (web <c>miles</c> prop), or null.</summary>
    public double? Miles => _miles;

    /// <summary>The current value in kilometres (web <c>km</c> prop), or null.</summary>
    public double? Kilometers => _km;

    /// <summary>The current explicit fraction-digit override (web <c>precision</c> prop), or null.</summary>
    public int? Precision => _precision;

    /// <summary>Push a new miles value (web <c>miles</c> prop change) and re-project.</summary>
    /// <param name="miles">The new value in miles, or null.</param>
    public void SetMiles(double? miles)
    {
        _miles = miles;
        Reproject();
    }

    /// <summary>Push a new kilometres value (web <c>km</c> prop change) and re-project.</summary>
    /// <param name="km">The new value in kilometres, or null.</param>
    public void SetKilometers(double? km)
    {
        _km = km;
        Reproject();
    }

    /// <summary>Push a new precision override (web <c>precision</c> prop change) and re-project.</summary>
    /// <param name="precision">The new fraction-digit override, or null to use the preference default.</param>
    public void SetPrecision(int? precision)
    {
        _precision = precision;
        Reproject();
    }

    /// <summary>Detach from the units seam (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _units.Changed -= OnUnitsChanged;
        GC.SuppressFinalize(this);
    }

    private void OnUnitsChanged(object? sender, EventArgs e) => Reproject();

    private DistanceProjection Project() =>
        DistanceProjection.Project(_miles, _km, _precision, _units.Preferences);

    private void Reproject()
    {
        DistanceProjection next = Project();
        if (next.Equals(_projection))
        {
            return;
        }

        bool stateChanged = next.State != _projection.State;
        bool displayChanged = !string.Equals(next.Display, _projection.Display, StringComparison.Ordinal);
        bool titleChanged = !string.Equals(next.Title, _projection.Title, StringComparison.Ordinal);
        bool unitChanged = !string.Equals(next.UnitLabel, _projection.UnitLabel, StringComparison.Ordinal);

        _projection = next;

        Raise(ProjectionChangedArgs);
        if (stateChanged)
        {
            Raise(StateChangedArgs);
            Raise(HasValueChangedArgs);
        }

        if (displayChanged)
        {
            Raise(DisplayChangedArgs);
            Raise(AccessibleNameChangedArgs);
        }

        if (titleChanged)
        {
            Raise(TitleChangedArgs);
        }

        if (unitChanged)
        {
            Raise(UnitLabelChangedArgs);
        }
    }

    private void Raise(PropertyChangedEventArgs args) => PropertyChanged?.Invoke(this, args);

    private static readonly PropertyChangedEventArgs ProjectionChangedArgs = new(nameof(Projection));
    private static readonly PropertyChangedEventArgs StateChangedArgs = new(nameof(State));
    private static readonly PropertyChangedEventArgs HasValueChangedArgs = new(nameof(HasValue));
    private static readonly PropertyChangedEventArgs DisplayChangedArgs = new(nameof(Display));
    private static readonly PropertyChangedEventArgs TitleChangedArgs = new(nameof(Title));
    private static readonly PropertyChangedEventArgs UnitLabelChangedArgs = new(nameof(UnitLabel));
    private static readonly PropertyChangedEventArgs AccessibleNameChangedArgs = new(nameof(AccessibleName));
}
