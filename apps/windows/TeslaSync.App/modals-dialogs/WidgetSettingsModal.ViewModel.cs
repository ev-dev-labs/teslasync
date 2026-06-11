using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// The render state of the vehicle-scope dropdown's backing fleet read — the native projection of the web
/// <c>useVehicles</c> query lifecycle onto the states the prompt requires every surface to render. Loaded / Empty
/// are terminal success branches; Stale / Offline keep the cached fleet visible while signalling freshness; Error
/// surfaces the retry affordance.
/// </summary>
public enum WidgetSettingsVehiclesState
{
    /// <summary>The fleet is loading and no cached list is visible yet (web query <c>isLoading</c>, no data).</summary>
    Loading,

    /// <summary>A fresh fleet is loaded (web query <c>data</c> with a current network result).</summary>
    Loaded,

    /// <summary>The fleet resolved with no vehicles (web <c>vehicles ?? []</c> empty).</summary>
    Empty,

    /// <summary>The fleet load failed with no cached list to fall back to (web query <c>isError</c>).</summary>
    Error,

    /// <summary>A cached fleet is shown while a background refresh runs (cache past its freshness window).</summary>
    Stale,

    /// <summary>The network failed but a cached fleet remains usable (offline).</summary>
    Offline,
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="WidgetSettingsModal"/> view — the native port of the
/// web <c>WidgetSettingsModal</c> component (web/src/features/dashboard/components/WidgetSettingsModal.tsx). It
/// owns the working <see cref="WidgetConfig"/> (the web <c>useState&lt;WidgetConfig&gt;(widget.config ?? {})</c>),
/// derives the conditional sections from the widget category (web <c>isVehicleWidget</c> / <c>isChartWidget</c>),
/// projects the three dropdowns + the show-title toggle, drives the cache-then-network vehicle read that
/// populates the vehicle dropdown (web <c>useVehicles</c>) through every render state, and raises the save / close
/// callbacks (web <c>onSave(config)</c> + <c>onClose()</c>). The save path is a pure callback — there is no write
/// query — so the only network-backed states are those of the vehicle list. Drive it from one confinement (the
/// UI thread); it is not internally synchronised.
/// </summary>
public sealed class WidgetSettingsModalViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly WidgetCatalogEntry _def;
    private readonly IWidgetSettingsVehicleSource _vehicleSource;
    private readonly ILocalizer _localizer;
    private readonly WidgetSettingsModalDiagnostics _diagnostics;
    private readonly CancellationTokenSource _cts = new();

    private WidgetConfig _config;
    private IReadOnlyList<VehicleOption> _vehicles = Array.Empty<VehicleOption>();
    private IReadOnlyList<WidgetSettingsOption> _vehicleOptions;
    private WidgetSettingsVehiclesState _vehiclesState = WidgetSettingsVehiclesState.Loading;
    private string? _vehiclesErrorMessage;
    private bool _disposed;

    /// <summary>Creates the holder over the widget definition, initial config, vehicle source, localizer and sink.</summary>
    /// <param name="def">The widget definition (web <c>def</c>) — supplies the title name and the category.</param>
    /// <param name="initialConfig">The widget's persisted config (web <c>widget.config</c>), or null for empty.</param>
    /// <param name="vehicleSource">The fleet read port (web <c>useVehicles</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink (defaults to a no-op collector).</param>
    public WidgetSettingsModalViewModel(
        WidgetCatalogEntry def,
        WidgetConfig? initialConfig,
        IWidgetSettingsVehicleSource vehicleSource,
        ILocalizer localizer,
        WidgetSettingsModalDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(def);
        ArgumentNullException.ThrowIfNull(vehicleSource);
        ArgumentNullException.ThrowIfNull(localizer);

        _def = def;
        _config = initialConfig ?? WidgetConfig.Empty;
        _vehicleSource = vehicleSource;
        _localizer = localizer;
        _diagnostics = diagnostics ?? new WidgetSettingsModalDiagnostics();

        RefreshOptions = WidgetSettingsProjection.RefreshOptions(localizer);
        TimeRangeOptions = WidgetSettingsProjection.TimeRangeOptions(localizer);
        _vehicleOptions = WidgetSettingsProjection.VehicleOptions(_vehicles, localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised when the user saves (web <c>onSave(config)</c>): carries the working config.</summary>
    public event EventHandler<WidgetConfig>? SettingsSaved;

    /// <summary>Raised when the modal should close (web <c>onClose()</c>): after a save or a cancel.</summary>
    public event EventHandler? CloseRequested;

    /// <summary>The canonical surface slug (<c>WidgetSettingsModal</c>).</summary>
    public static string SurfaceId => WidgetSettingsRegistration.Slug;

    // ── Header / section copy (the Narrator-label source) ────────────────────────────────────────────────

    /// <summary>Modal title (web <c>`${def.name} Settings`</c>).</summary>
    public string Title => WidgetSettingsRegistration.Title(_def.Name, _localizer);

    /// <summary>Vehicle section title (web <c>dashboard.settings.vehicle</c>).</summary>
    public string VehicleLabel => WidgetSettingsRegistration.VehicleLabel(_localizer);

    /// <summary>Refresh-interval section title (web <c>dashboard.settings.refreshInterval</c>).</summary>
    public string RefreshIntervalLabel => WidgetSettingsRegistration.RefreshIntervalLabel(_localizer);

    /// <summary>Time-range section title (web <c>dashboard.settings.timeRange</c>).</summary>
    public string TimeRangeLabel => WidgetSettingsRegistration.TimeRangeLabel(_localizer);

    /// <summary>Appearance section title (web <c>dashboard.settings.appearance</c>).</summary>
    public string AppearanceLabel => WidgetSettingsRegistration.AppearanceLabel(_localizer);

    /// <summary>Show-title toggle label (web <c>dashboard.settings.showTitle</c>).</summary>
    public string ShowTitleToggleLabel => WidgetSettingsRegistration.ShowTitleLabel(_localizer);

    /// <summary>Cancel button label (web <c>common.cancel</c>).</summary>
    public string CancelLabel => WidgetSettingsRegistration.CancelLabel(_localizer);

    /// <summary>Save button label (web <c>common.save</c>).</summary>
    public string SaveLabel => WidgetSettingsRegistration.SaveLabel(_localizer);

    /// <summary>Vehicle-list loading caption.</summary>
    public string VehiclesLoadingLabel => WidgetSettingsRegistration.VehiclesLoadingLabel(_localizer);

    /// <summary>Vehicle-list empty-state title.</summary>
    public string VehiclesEmptyTitle => WidgetSettingsRegistration.VehiclesEmptyTitle(_localizer);

    /// <summary>Vehicle-list empty-state message.</summary>
    public string VehiclesEmptyMessage => WidgetSettingsRegistration.VehiclesEmptyMessage(_localizer);

    /// <summary>Vehicle-list error-state title.</summary>
    public string VehiclesErrorTitle => WidgetSettingsRegistration.VehiclesErrorTitle(_localizer);

    /// <summary>Vehicle-list retry affordance label.</summary>
    public string RetryLabel => WidgetSettingsRegistration.RetryLabel(_localizer);

    /// <summary>Vehicle-list stale chip caption.</summary>
    public string VehiclesStaleLabel => WidgetSettingsRegistration.VehiclesStaleLabel(_localizer);

    /// <summary>Vehicle-list offline chip caption.</summary>
    public string VehiclesOfflineLabel => WidgetSettingsRegistration.VehiclesOfflineLabel(_localizer);

    // ── Conditional sections (web isVehicleWidget / isChartWidget) ───────────────────────────────────────

    /// <summary>True when the vehicle selector renders (web <c>isVehicleWidget</c>).</summary>
    public bool ShowVehicleSection => WidgetSettingsProjection.IsVehicleWidget(_def.Category);

    /// <summary>True when the time-range selector renders (web <c>isChartWidget</c>).</summary>
    public bool ShowTimeRangeSection => WidgetSettingsProjection.IsChartWidget(_def.Category);

    // ── Options ──────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>The vehicle dropdown options (the "all" sentinel + each loaded vehicle).</summary>
    public IReadOnlyList<WidgetSettingsOption> VehicleOptions => _vehicleOptions;

    /// <summary>The refresh-interval dropdown options (default + 5/15/30/60 seconds).</summary>
    public IReadOnlyList<WidgetSettingsOption> RefreshOptions { get; }

    /// <summary>The time-range dropdown options (24h / 7d / 30d / 90d).</summary>
    public IReadOnlyList<WidgetSettingsOption> TimeRangeOptions { get; }

    // ── Selections (web config-derived values) ───────────────────────────────────────────────────────────

    /// <summary>The working config (exposed for hosting / tests; mutated through the selection setters).</summary>
    public WidgetConfig Config => _config;

    /// <summary>The selected vehicle dropdown token (web <c>config.vehicleId?.toString() ?? 'all'</c>).</summary>
    public string SelectedVehicleValue
    {
        get => WidgetSettingsProjection.VehicleSelectionValue(_config);
        set
        {
            WidgetConfig next = WidgetSettingsProjection.WithVehicleSelection(_config, value);
            if (next != _config)
            {
                _config = next;
                Raise(nameof(SelectedVehicleValue));
                Raise(nameof(Config));
            }
        }
    }

    /// <summary>The selected refresh dropdown token (web <c>config.refreshRate?.toString() ?? 'default'</c>).</summary>
    public string SelectedRefreshValue
    {
        get => WidgetSettingsProjection.RefreshSelectionValue(_config);
        set
        {
            WidgetConfig next = WidgetSettingsProjection.WithRefreshSelection(_config, value);
            if (next != _config)
            {
                _config = next;
                Raise(nameof(SelectedRefreshValue));
                Raise(nameof(Config));
            }
        }
    }

    /// <summary>The selected time-range dropdown token (web <c>config.timeRange ?? '7d'</c>).</summary>
    public string SelectedTimeRangeValue
    {
        get => WidgetSettingsProjection.TimeRangeSelectionValue(_config);
        set
        {
            WidgetConfig next = WidgetSettingsProjection.WithTimeRangeSelection(_config, value);
            if (next != _config)
            {
                _config = next;
                Raise(nameof(SelectedTimeRangeValue));
                Raise(nameof(Config));
            }
        }
    }

    /// <summary>Whether the show-title toggle is on (web <c>config.showTitle !== false</c>; default on).</summary>
    public bool ShowTitle
    {
        get => WidgetSettingsProjection.ShowTitleValue(_config);
        set
        {
            WidgetConfig next = WidgetSettingsProjection.WithShowTitle(_config, value);
            if (next != _config)
            {
                _config = next;
                Raise(nameof(ShowTitle));
                Raise(nameof(Config));
            }
        }
    }

    // ── Vehicle-list state (web useVehicles lifecycle) ───────────────────────────────────────────────────

    /// <summary>The render state of the vehicle list (loading / loaded / empty / error / stale / offline).</summary>
    public WidgetSettingsVehiclesState VehiclesState
    {
        get => _vehiclesState;
        private set
        {
            if (Set(ref _vehiclesState, value))
            {
                Raise(nameof(IsVehiclesLoading));
                Raise(nameof(IsVehiclesLoaded));
                Raise(nameof(IsVehiclesEmpty));
                Raise(nameof(HasVehiclesError));
                Raise(nameof(IsVehiclesStale));
                Raise(nameof(IsVehiclesOffline));
            }
        }
    }

    /// <summary>The localized error message shown on a hard fleet-load failure, else null.</summary>
    public string? VehiclesErrorMessage
    {
        get => _vehiclesErrorMessage;
        private set => Set(ref _vehiclesErrorMessage, value);
    }

    /// <summary>True while the fleet is loading with nothing cached to show.</summary>
    public bool IsVehiclesLoading => _vehiclesState == WidgetSettingsVehiclesState.Loading;

    /// <summary>True when a fresh fleet is loaded.</summary>
    public bool IsVehiclesLoaded => _vehiclesState == WidgetSettingsVehiclesState.Loaded;

    /// <summary>True when the fleet resolved empty.</summary>
    public bool IsVehiclesEmpty => _vehiclesState == WidgetSettingsVehiclesState.Empty;

    /// <summary>True when the fleet load hard-failed with no cached list.</summary>
    public bool HasVehiclesError => _vehiclesState == WidgetSettingsVehiclesState.Error;

    /// <summary>True when a cached fleet is shown while refreshing.</summary>
    public bool IsVehiclesStale => _vehiclesState == WidgetSettingsVehiclesState.Stale;

    /// <summary>True when a cached fleet is shown without connectivity.</summary>
    public bool IsVehiclesOffline => _vehiclesState == WidgetSettingsVehiclesState.Offline;

    /// <summary>The loaded fleet backing the vehicle dropdown.</summary>
    public IReadOnlyList<VehicleOption> Vehicles => _vehicles;

    // ── Commands ─────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>Record that the surface was opened (web mount) — emits the <c>view.opened</c> diagnostics event.</summary>
    public void NotifyOpened()
    {
        if (!_disposed)
        {
            _diagnostics.RecordViewOpened();
        }
    }

    /// <summary>
    /// Run the cache-then-network vehicle load that populates the dropdown (web <c>useVehicles</c>), folding every
    /// emission into the state matrix. A no-op for non-vehicle widgets, whose selector never renders. A superseding
    /// load cancels the prior one.
    /// </summary>
    /// <param name="cancellationToken">Cancellation linked to the surface lifetime.</param>
    public async Task LoadVehiclesAsync(CancellationToken cancellationToken = default)
    {
        if (_disposed || !ShowVehicleSection)
        {
            return;
        }

        if (!HasContent())
        {
            VehiclesState = WidgetSettingsVehiclesState.Loading;
        }

        using var linked = CancellationTokenSource.CreateLinkedTokenSource(_cts.Token, cancellationToken);
        try
        {
            await foreach (RepositoryResult<IReadOnlyList<VehicleOption>> result in
                _vehicleSource.StreamVehiclesAsync(linked.Token).ConfigureAwait(false))
            {
                Apply(result);
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop silently (web parity for an aborted query).
        }
    }

    /// <summary>Retry the fleet load after a failure — re-runs the cache-then-network read from the top.</summary>
    /// <param name="cancellationToken">Cancellation linked to the surface lifetime.</param>
    public Task RetryVehiclesAsync(CancellationToken cancellationToken = default) =>
        LoadVehiclesAsync(cancellationToken);

    /// <summary>
    /// Save the working config (web <c>handleSave</c>): raises <see cref="SettingsSaved"/> with the current config,
    /// records the diagnostics counter and then raises <see cref="CloseRequested"/> (web <c>onSave</c> then
    /// <c>onClose</c>).
    /// </summary>
    public void Save()
    {
        if (_disposed)
        {
            return;
        }

        SettingsSaved?.Invoke(this, _config);
        _diagnostics.RecordSettingsSaved();
        CloseRequested?.Invoke(this, EventArgs.Empty);
    }

    /// <summary>Dismiss the modal without saving (web <c>Cancel</c> / <c>onClose</c>).</summary>
    public void RequestClose()
    {
        if (!_disposed)
        {
            CloseRequested?.Invoke(this, EventArgs.Empty);
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
        _cts.Cancel();
        _cts.Dispose();
    }

    private bool HasContent() => _vehiclesState is WidgetSettingsVehiclesState.Loaded
        or WidgetSettingsVehiclesState.Empty
        or WidgetSettingsVehiclesState.Stale
        or WidgetSettingsVehiclesState.Offline;

    private void Apply(RepositoryResult<IReadOnlyList<VehicleOption>> result)
    {
        switch (result.Status)
        {
            case LoadStatus.Loading:
                if (!HasContent())
                {
                    VehiclesState = WidgetSettingsVehiclesState.Loading;
                }

                break;

            case LoadStatus.Cached:
                ApplyFleet(result.Value, result.IsStale
                    ? WidgetSettingsVehiclesState.Stale
                    : WidgetSettingsVehiclesState.Loaded, error: null);
                break;

            case LoadStatus.Refreshing:
                ApplyFleet(result.Value, WidgetSettingsVehiclesState.Stale, error: null);
                break;

            case LoadStatus.Loaded:
                ApplyFleet(result.Value, WidgetSettingsVehiclesState.Loaded, error: null);
                break;

            case LoadStatus.Empty:
                SetVehicles(Array.Empty<VehicleOption>());
                VehiclesErrorMessage = null;
                VehiclesState = WidgetSettingsVehiclesState.Empty;
                break;

            case LoadStatus.Offline:
                ApplyFleet(
                    result.Value,
                    WidgetSettingsVehiclesState.Offline,
                    error: WidgetSettingsRegistration.VehiclesOfflineLabel(_localizer));
                break;

            default:
                VehiclesErrorMessage = WidgetSettingsRegistration.VehiclesErrorTitle(_localizer);
                VehiclesState = WidgetSettingsVehiclesState.Error;
                break;
        }
    }

    private void ApplyFleet(IReadOnlyList<VehicleOption>? fleet, WidgetSettingsVehiclesState state, string? error)
    {
        IReadOnlyList<VehicleOption> vehicles = fleet ?? Array.Empty<VehicleOption>();
        if (vehicles.Count == 0)
        {
            SetVehicles(vehicles);
            VehiclesErrorMessage = null;
            VehiclesState = WidgetSettingsVehiclesState.Empty;
            return;
        }

        SetVehicles(vehicles);
        VehiclesErrorMessage = error;
        VehiclesState = state;
    }

    private void SetVehicles(IReadOnlyList<VehicleOption> vehicles)
    {
        _vehicles = vehicles;
        _vehicleOptions = WidgetSettingsProjection.VehicleOptions(vehicles, _localizer);
        Raise(nameof(Vehicles));
        Raise(nameof(VehicleOptions));
    }

    private bool Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return false;
        }

        field = value;
        Raise(name);
        return true;
    }

    private void Raise(string? name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
