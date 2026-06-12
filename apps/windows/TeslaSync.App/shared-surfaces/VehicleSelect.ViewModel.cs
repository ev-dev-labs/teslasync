using System.ComponentModel;
using System.Globalization;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="VehicleSelect"/> view — the native port of the web
/// <c>VehicleSelect</c> component body (web/src/components/forms/VehicleSelect.tsx). It binds the shared P1/S8
/// <see cref="VehicleSelectState"/> holder (the native equivalent of the web <c>useSelectedVehicle()</c>
/// store: the cached fleet plus the clamped scope id) and reproduces the web source's behaviour: it projects
/// the fleet into render-ready options through the shared, unit-tested <see cref="VehicleSelectProjection"/>
/// (web <c>vehicles.map(...)</c>), exposes the selected option value the trigger round-trips
/// (<see cref="SelectedValue"/>, web <c>value={vehicleId != null ? String(vehicleId) : ''}</c>), commits a
/// chosen value back to the store with the web's positive-finite guard (<see cref="SelectByValue"/>, web
/// <c>setVehicleId(Number.isFinite(next) &amp;&amp; next &gt; 0 ? next : null)</c>), and surfaces the optional
/// leading <c>Car</c> icon flag (<see cref="WithIcon"/>, web <c>withIcon</c>). Beyond the web primitive it
/// projects the holder's loading / empty / error / loaded transitions into a single <see cref="Status"/> and
/// resolves every caption through the i18n facade (<see cref="ILocalizer"/>, P1/S10). The view binds the
/// projected state and never performs I/O. Drive it from one confinement (the UI thread).
/// </summary>
public sealed class VehicleSelectViewModel : INotifyPropertyChanged, IDisposable
{
    private static readonly PropertyChangedEventArgs AllProperties = new(string.Empty);

    private readonly VehicleSelectState _state;
    private readonly ILocalizer _localizer;
    private readonly string? _ariaOverride;

    private IReadOnlyList<VehicleSelectItem> _items;
    private bool _disposed;

    /// <summary>Creates the holder over the shared fleet state, the i18n facade and the optional-icon flag.</summary>
    /// <param name="state">The shared P1/S8 fleet + scope holder (web <c>useSelectedVehicle()</c>).</param>
    /// <param name="localizer">The i18n facade every caption resolves through (P1/S10).</param>
    /// <param name="withIcon">When true, the view prefixes a small decorative <c>Car</c> icon (web <c>withIcon</c>).</param>
    /// <param name="ariaLabel">Optional override for the trigger's accessible name (web <c>ariaLabel</c>); blank falls back to the i18n key.</param>
    public VehicleSelectViewModel(
        VehicleSelectState state,
        ILocalizer localizer,
        bool withIcon = false,
        string? ariaLabel = null)
    {
        ArgumentNullException.ThrowIfNull(state);
        ArgumentNullException.ThrowIfNull(localizer);

        _state = state;
        _localizer = localizer;
        WithIcon = withIcon;
        _ariaOverride = string.IsNullOrWhiteSpace(ariaLabel) ? null : ariaLabel;
        _items = VehicleSelectProjection.ToItems(_state.Vehicles);

        _state.PropertyChanged += OnStateChanged;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Whether the view prefixes a small decorative <c>Car</c> icon (web <c>withIcon</c>).</summary>
    public bool WithIcon { get; }

    /// <summary>The projected, render-ready fleet options (web <c>options</c>).</summary>
    public IReadOnlyList<VehicleSelectItem> Items => _items;

    /// <summary>The single state the surface renders, projected from the shared fleet holder.</summary>
    public VehicleSelectStatus Status =>
        _state.HasError ? VehicleSelectStatus.Error
        : _state.IsLoading ? VehicleSelectStatus.Loading
        : _state.HasVehicles ? VehicleSelectStatus.Ready
        : _state.IsEmpty ? VehicleSelectStatus.Empty
        : VehicleSelectStatus.Loading;

    /// <summary>True while the fleet is loading (or before the first load) — the busy chrome.</summary>
    public bool IsLoading => Status == VehicleSelectStatus.Loading;

    /// <summary>True when the fleet loaded with at least one vehicle — the populated picker.</summary>
    public bool IsReady => Status == VehicleSelectStatus.Ready;

    /// <summary>True when the fleet resolved with no vehicles — the empty surface.</summary>
    public bool IsEmpty => Status == VehicleSelectStatus.Empty;

    /// <summary>True when the fleet load failed — the error surface.</summary>
    public bool HasError => Status == VehicleSelectStatus.Error;

    /// <summary>Whether a retry of the fleet load is currently allowed.</summary>
    public bool CanRetry => _state.CanRetry;

    /// <summary>The currently-selected scope id, or null when none is selected.</summary>
    public long? SelectedId => _state.SelectedId;

    /// <summary>The selected option value the trigger round-trips (web <c>vehicleId != null ? String(vehicleId) : ''</c>).</summary>
    public string SelectedValue =>
        _state.SelectedId is { } id ? id.ToString(CultureInfo.InvariantCulture) : string.Empty;

    /// <summary>The trigger's accessible name — the override, else the resolved <c>vehicleSelect.aria</c> key (web verbatim).</summary>
    public string AriaLabel =>
        _ariaOverride ?? L(VehicleSelectRegistration.AriaKey, VehicleSelectRegistration.AriaFallback);

    /// <summary>The unselected-state prompt shown in the closed trigger.</summary>
    public string PromptText => L(VehicleSelectRegistration.PromptKey, VehicleSelectRegistration.PromptFallback);

    /// <summary>The loading caption shown while the fleet is in flight.</summary>
    public string LoadingText => L(VehicleSelectRegistration.LoadingKey, VehicleSelectRegistration.LoadingFallback);

    /// <summary>The empty-state heading shown when the fleet resolved with no vehicles.</summary>
    public string EmptyTitle => L(VehicleSelectRegistration.EmptyTitleKey, VehicleSelectRegistration.EmptyTitleFallback);

    /// <summary>The empty-state message shown when the fleet resolved with no vehicles.</summary>
    public string EmptyMessage => L(VehicleSelectRegistration.EmptyMessageKey, VehicleSelectRegistration.EmptyMessageFallback);

    /// <summary>The error-state heading shown when the fleet load failed.</summary>
    public string ErrorTitle => L(VehicleSelectRegistration.ErrorTitleKey, VehicleSelectRegistration.ErrorTitleFallback);

    /// <summary>The localized fleet-load failure detail, falling back to the error heading when none is set.</summary>
    public string ErrorMessage =>
        string.IsNullOrEmpty(_state.ErrorMessage) ? ErrorTitle : _state.ErrorMessage;

    /// <summary>The retry affordance label shown in the error state.</summary>
    public string RetryText => L(VehicleSelectRegistration.RetryKey, VehicleSelectRegistration.RetryFallback);

    /// <summary>
    /// Commit a trigger value back to the shared scope (web <c>onChange</c>). The value is parsed and guarded
    /// by the web positive-finite rule and then clamped to a known fleet id by the holder; an unknown value
    /// clears the scope. Returns true when the committed scope id changed.
    /// </summary>
    public bool SelectByValue(string? value)
    {
        var before = _state.SelectedId;
        _state.SelectedId = VehicleSelectProjection.ParseValue(value);
        return _state.SelectedId != before;
    }

    /// <summary>Request a retry of the fleet load (no-op unless the surface is in the error state).</summary>
    public void Retry()
    {
        if (_state.CanRetry)
        {
            _state.Retry();
        }
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
        GC.SuppressFinalize(this);
    }

    private string L(string key, string fallback) => _localizer.GetString(key, fallback);

    private void OnStateChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (string.IsNullOrEmpty(e.PropertyName) || e.PropertyName == nameof(VehicleSelectState.Vehicles))
        {
            _items = VehicleSelectProjection.ToItems(_state.Vehicles);
        }

        PropertyChanged?.Invoke(this, AllProperties);
    }
}
