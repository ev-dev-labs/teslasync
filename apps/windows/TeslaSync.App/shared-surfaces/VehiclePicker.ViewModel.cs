using System.ComponentModel;
using System.Globalization;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="VehiclePicker"/> view — the native port of the web
/// <c>VehiclePicker</c> component body (web/src/components/layout/VehiclePicker.tsx). It binds the shared P1/S8
/// <see cref="VehicleSelectState"/> holder (the native equivalent of the web <c>useSelectedVehicle()</c> store:
/// the cached fleet plus the clamped scope id) and the <see cref="IVehiclePinSource"/> seam (the web
/// <c>usePinned('vehicle')</c> read), and reproduces the web source's behaviour: it floats pinned vehicles to
/// the top in pin-position order and projects the fleet into 📌-prefixed, render-ready options through the
/// shared, unit-tested <see cref="VehiclePickerProjection"/> (web <c>sorted</c> + <c>options</c> memos), exposes
/// the selected option value the trigger round-trips (<see cref="SelectedValue"/>, web
/// <c>value={vehicleId != null ? String(vehicleId) : ''}</c>), commits a chosen value back to the store with the
/// web's positive-finite guard (<see cref="SelectByValue"/>, web
/// <c>setVehicleId(Number.isFinite(next) &amp;&amp; next &gt; 0 ? next : null)</c>), and — the defining behaviour —
/// collapses to <see cref="VehiclePickerStatus.Hidden"/> whenever the fleet holds at most one vehicle (web
/// <c>if (vehicles.length &lt;= 1) return null;</c>). Every caption resolves through the i18n facade
/// (<see cref="ILocalizer"/>, P1/S10). The view binds the projected state and never performs I/O. Drive it from
/// one confinement (the UI thread).
/// </summary>
public sealed class VehiclePickerViewModel : INotifyPropertyChanged, IDisposable
{
    private static readonly PropertyChangedEventArgs AllProperties = new(string.Empty);

    private readonly VehicleSelectState _state;
    private readonly IVehiclePinSource _pins;
    private readonly ILocalizer _localizer;
    private readonly string? _ariaOverride;

    private IReadOnlyList<VehiclePickerItem> _items;
    private bool _disposed;

    /// <summary>Creates the holder over the shared fleet state, the pin seam and the i18n facade.</summary>
    /// <param name="state">The shared P1/S8 fleet + scope holder (web <c>useSelectedVehicle()</c>).</param>
    /// <param name="pins">The pin seam (web <c>usePinned('vehicle')</c>).</param>
    /// <param name="localizer">The i18n facade every caption resolves through (P1/S10).</param>
    /// <param name="ariaLabel">Optional override for the trigger's accessible name; blank falls back to the i18n key.</param>
    public VehiclePickerViewModel(
        VehicleSelectState state,
        IVehiclePinSource pins,
        ILocalizer localizer,
        string? ariaLabel = null)
    {
        ArgumentNullException.ThrowIfNull(state);
        ArgumentNullException.ThrowIfNull(pins);
        ArgumentNullException.ThrowIfNull(localizer);

        _state = state;
        _pins = pins;
        _localizer = localizer;
        _ariaOverride = string.IsNullOrWhiteSpace(ariaLabel) ? null : ariaLabel;
        _items = VehiclePickerProjection.ToItems(_state.Vehicles, _pins.Pins);

        _state.PropertyChanged += OnStateChanged;
        _pins.Changed += OnPinsChanged;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The projected, pin-ordered, render-ready fleet options (web <c>options</c>).</summary>
    public IReadOnlyList<VehiclePickerItem> Items => _items;

    /// <summary>
    /// The single state the surface renders. <see cref="VehiclePickerStatus.Ready"/> only when the fleet holds
    /// two or more vehicles; every other case (zero / one vehicle, still loading, resolved empty, or failed)
    /// collapses to <see cref="VehiclePickerStatus.Hidden"/> — the native reproduction of the web
    /// <c>if (vehicles.length &lt;= 1) return null;</c>.
    /// </summary>
    public VehiclePickerStatus Status =>
        _state.Vehicles.Count <= 1 ? VehiclePickerStatus.Hidden : VehiclePickerStatus.Ready;

    /// <summary>Whether the picker is shown (web: rendered iff <c>vehicles.length &gt; 1</c>).</summary>
    public bool IsVisible => Status == VehiclePickerStatus.Ready;

    /// <summary>The currently-selected scope id, or null when none is selected.</summary>
    public long? SelectedId => _state.SelectedId;

    /// <summary>The selected option value the trigger round-trips (web <c>vehicleId != null ? String(vehicleId) : ''</c>).</summary>
    public string SelectedValue =>
        _state.SelectedId is { } id ? id.ToString(CultureInfo.InvariantCulture) : string.Empty;

    /// <summary>The trigger's accessible name — the override, else the resolved <c>vehiclePicker.aria</c> key (web verbatim).</summary>
    public string AriaLabel =>
        _ariaOverride ?? _localizer.GetString(VehiclePickerRegistration.AriaKey, VehiclePickerRegistration.AriaFallback);

    /// <summary>
    /// Commit a trigger value back to the shared scope (web <c>onChange</c>). The value is parsed and guarded by
    /// the web positive-finite rule and then clamped to a known fleet id by the holder; an unknown value clears
    /// the scope. Returns true when the committed scope id changed.
    /// </summary>
    public bool SelectByValue(string? value)
    {
        var before = _state.SelectedId;
        _state.SelectedId = VehiclePickerProjection.ParseValue(value);
        return _state.SelectedId != before;
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _state.PropertyChanged -= OnStateChanged;
        _pins.Changed -= OnPinsChanged;
        GC.SuppressFinalize(this);
    }

    private void OnStateChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (string.IsNullOrEmpty(e.PropertyName) || e.PropertyName == nameof(VehicleSelectState.Vehicles))
        {
            _items = VehiclePickerProjection.ToItems(_state.Vehicles, _pins.Pins);
        }

        PropertyChanged?.Invoke(this, AllProperties);
    }

    private void OnPinsChanged(object? sender, EventArgs e)
    {
        _items = VehiclePickerProjection.ToItems(_state.Vehicles, _pins.Pins);
        PropertyChanged?.Invoke(this, AllProperties);
    }
}
