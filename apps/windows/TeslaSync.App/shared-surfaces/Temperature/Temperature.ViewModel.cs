using System.ComponentModel;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.SharedSurfaces.TemperatureSurface;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="Temperature"/> view — the native port of the web
/// component body (web/src/components/data-display/format/Temperature.tsx). The web component's only inputs
/// are its caller-supplied props (<c>c</c> / <c>f</c> / <c>precision</c>) plus the <c>useUnits()</c>
/// preference; this holder mirrors that by tracking the current <see cref="Model"/> and the
/// <see cref="UnitPref"/> from the shared <see cref="IUnitPreferenceSource"/> (P1/S8 seam). It exposes the
/// projected <see cref="Display"/> the view renders and raises <see cref="PropertyChanged"/> when the host
/// pushes new inputs (the web prop change) or when the user toggles °C ⇄ °F at runtime (the web hook
/// re-render). The view performs no I/O of its own. <see cref="Dispose"/> unsubscribes from the preference
/// source (the web effect cleanup).
/// </summary>
public sealed class TemperatureViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IUnitPreferenceSource _units;
    private readonly IDisposable _subscription;
    private TemperatureModel _model;
    private UnitPref _preferences;
    private TemperatureDisplay _display;
    private bool _disposed;

    /// <summary>Creates the holder over an initial model and the unit-preference source (P1/S8 seam).</summary>
    /// <param name="model">The initial render model (the web props).</param>
    /// <param name="units">The unit-preference source (web <c>useUnits</c>).</param>
    public TemperatureViewModel(TemperatureModel model, IUnitPreferenceSource units)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(units);

        _units = units;
        _model = model;
        _preferences = units.Preferences;
        _display = TemperatureProjection.Project(_model, _preferences);
        _subscription = units.Observe(OnPreferencesChanged);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>Temperature</c>).</summary>
    public static string Slug => TemperatureRegistration.Slug;

    /// <summary>The current render projection (the converted, formatted readout or the em dash).</summary>
    public TemperatureDisplay Display => _display;

    /// <summary>The unit preference the current projection was computed in.</summary>
    public UnitPref Preferences => _preferences;

    /// <summary>
    /// The current render inputs (the web props). Reassigning re-projects and raises
    /// <see cref="PropertyChanged"/>; a no-op when the model is unchanged.
    /// </summary>
    public TemperatureModel Model
    {
        get => _model;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            if (_model == value)
            {
                return;
            }

            _model = value;
            Reproject();
        }
    }

    /// <summary>Push a new canonical °C value (web <c>c</c> prop change), keeping the precision override.</summary>
    /// <param name="celsius">The temperature in °C, or null to clear to the em dash.</param>
    /// <param name="precision">The optional fraction-digit override (web <c>precision</c>).</param>
    public void SetCelsius(double? celsius, int? precision = null) =>
        Model = TemperatureModel.FromCelsius(celsius, precision);

    /// <summary>Push a new °F value (web <c>f</c> prop change), converted to °C before display.</summary>
    /// <param name="fahrenheit">The temperature in °F, or null to clear to the em dash.</param>
    /// <param name="precision">The optional fraction-digit override (web <c>precision</c>).</param>
    public void SetFahrenheit(double? fahrenheit, int? precision = null) =>
        Model = TemperatureModel.FromFahrenheit(fahrenheit, precision);

    /// <summary>Stop listening to the preference source (the web effect cleanup); idempotent.</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _subscription.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnPreferencesChanged(UnitPref preferences)
    {
        ArgumentNullException.ThrowIfNull(preferences);
        if (_preferences == preferences)
        {
            return;
        }

        _preferences = preferences;
        Reproject();
    }

    private void Reproject()
    {
        TemperatureDisplay next = TemperatureProjection.Project(_model, _preferences);
        if (next == _display)
        {
            return;
        }

        _display = next;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Display)));
    }
}
