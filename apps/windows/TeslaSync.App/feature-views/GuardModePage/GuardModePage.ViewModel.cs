using System.Collections.Generic;
using System.ComponentModel;
using System.Globalization;
using System.Linq;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.VehicleSystems;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>GuardModePage</c> view — the native port of the web
/// page's data + command flow (web/src/features/vehicle-systems/pages/GuardModePage.tsx). It owns the guard
/// configuration, the events feed, the live vehicle state, the geofence list and the fleet scope, the four
/// data states (loading / empty / error / success), the editable settings form (web <c>useState</c> for
/// sensitivity / home geofence / auto-panic) and the arm/disarm, save, panic and acknowledge mutations.
/// Everything is read + written through the injected <see cref="IGuardModeFeed"/> and projected through
/// <see cref="GuardModeProjection"/> so the view is a thin renderer. A monotonic <see cref="ToastSequence"/>
/// surfaces the web <c>toast.*</c> notifications. Drive it from one confinement (the UI thread); it is not
/// internally synchronised.
/// </summary>
public sealed class GuardModePageViewModel : INotifyPropertyChanged, IDisposable
{
    private const string DefaultSensitivity = "medium";

    private readonly IGuardModeFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;
    private readonly GuardModeDiagnostics _diagnostics;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private long _vehicleId;
    private string? _vehicleName;
    private GuardConfig? _config;
    private IReadOnlyList<GuardEvent> _events = Array.Empty<GuardEvent>();
    private GuardVehicleState? _vehicleState;
    private IReadOnlyList<GuardGeofence> _geofences = Array.Empty<GuardGeofence>();

    private IReadOnlyList<VehicleOption> _vehicles = Array.Empty<VehicleOption>();
    private bool _vehiclesLoading = true;
    private string? _vehiclesError;

    private string _formSensitivity = string.Empty;
    private string _formGeofenceId = string.Empty;
    private bool _formAutoPanic;

    private bool _loading = true;
    private bool _hasError;
    private bool _savePending;
    private bool _panicPending;
    private long? _ackPendingId;

    private GuardModeState _state = GuardModeState.Loading;
    private GuardModeDisplay _display;
    private bool _isFetching;
    private DateTimeOffset? _updatedAt;

    private string _toastMessage = string.Empty;
    private bool _toastIsError;
    private int _toastSequence;

    /// <summary>Creates the holder over its data feed, localizer and (optional) clock / diagnostics.</summary>
    /// <param name="feed">The guard data + mutation port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="clock">Injectable clock for deterministic freshness / relative times in tests.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public GuardModePageViewModel(
        IGuardModeFeed feed,
        ILocalizer localizer,
        Func<DateTimeOffset>? clock = null,
        GuardModeDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _diagnostics = diagnostics ?? new GuardModeDiagnostics();
        _display = GuardModeProjection.Project(BuildModel(), _localizer, _clock());
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / empty / error / success).</summary>
    public GuardModeState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public GuardModeDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>True while a (re)fetch or mutation is in flight (the header freshness chip pulses).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the last load failed (drives the header freshness chip's error state).</summary>
    public bool IsError => _hasError;

    /// <summary>Last successful update timestamp surfaced in the header freshness chip.</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>The localized page title (web <c>t('guard.title')</c>).</summary>
    public string Title => GuardModeRegistration.Title(_localizer);

    /// <summary>The fleet options backing the scope picker (web <c>useVehicles</c>).</summary>
    public IReadOnlyList<VehicleOption> Vehicles => _vehicles;

    /// <summary>True while the fleet read is in flight (drives the picker's loading state).</summary>
    public bool VehiclesLoading => _vehiclesLoading;

    /// <summary>The localized fleet-load failure message, or null (drives the picker's error state).</summary>
    public string? VehiclesError => _vehiclesError;

    /// <summary>The currently-scoped vehicle id, or null when none is selected.</summary>
    public long? SelectedVehicleId => _vehicleId > 0 ? _vehicleId : null;

    /// <summary>The latest toast message (web <c>toast.*</c>); read together with <see cref="ToastSequence"/>.</summary>
    public string ToastMessage => _toastMessage;

    /// <summary>True when the latest toast is an error (web <c>toast.error</c>).</summary>
    public bool ToastIsError => _toastIsError;

    /// <summary>Monotonic counter bumped on every toast so the view can re-show an identical message.</summary>
    public int ToastSequence => _toastSequence;

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Run (or re-run) the full load: the fleet scope, then the vehicle-scoped guard reads + geofences.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);

        IsFetching = true;
        if (_config is null && _events.Count == 0)
        {
            _loading = true;
            Reproject();
        }

        try
        {
            await LoadFleetAsync(cts.Token).ConfigureAwait(false);
            await LoadGeofencesAsync(cts.Token).ConfigureAwait(false);
            await LoadVehicleScopedAsync(cts.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this result silently.
            return;
        }

        _loading = false;
        _updatedAt = _clock();
        IsFetching = false;
        UpdatedAt = _updatedAt;
        Reproject();
    }

    /// <summary>Refresh every read (web query refetch / Retry).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>Scope the page to a different vehicle (web <c>useSelectedVehicle</c> change): reset + reload.</summary>
    public Task SetVehicleAsync(long? vehicleId, CancellationToken cancellationToken = default)
    {
        long next = vehicleId is { } id && id > 0 ? id : 0;
        if (next == _vehicleId)
        {
            return Task.CompletedTask;
        }

        _vehicleId = next;
        _config = null;
        _events = Array.Empty<GuardEvent>();
        _vehicleState = null;
        _hasError = false;
        _formSensitivity = string.Empty;
        _formGeofenceId = string.Empty;
        _formAutoPanic = false;
        _vehicleName = _vehicles.FirstOrDefault(v => v.Id == next)?.DisplayName;
        Raise(nameof(SelectedVehicleId));
        return LoadAsync(cancellationToken);
    }

    /// <summary>Arm / disarm guard mode (web <c>handleToggleGuard → useSetGuardConfig</c>).</summary>
    public Task ToggleGuardAsync(CancellationToken cancellationToken = default)
    {
        if (_vehicleId <= 0)
        {
            return Task.CompletedTask;
        }

        var write = new GuardConfigWrite(
            Enabled: !IsArmed,
            HomeGeofenceId: ParseGeofenceId(EffectiveGeofenceId),
            Sensitivity: EffectiveSensitivity,
            AutoPanic: _formAutoPanic);

        return RunConfigWriteAsync(write, cancellationToken);
    }

    /// <summary>Save the settings form without changing the armed state (web <c>handleSaveSettings</c>).</summary>
    public Task SaveSettingsAsync(CancellationToken cancellationToken = default)
    {
        if (_vehicleId <= 0)
        {
            return Task.CompletedTask;
        }

        var write = new GuardConfigWrite(
            Enabled: IsArmed,
            HomeGeofenceId: ParseGeofenceId(EffectiveGeofenceId),
            Sensitivity: EffectiveSensitivity,
            AutoPanic: _formAutoPanic);

        return RunConfigWriteAsync(write, cancellationToken);
    }

    /// <summary>Trigger the panic command (web <c>handlePanic → useGuardPanic</c>).</summary>
    public async Task PanicAsync(CancellationToken cancellationToken = default)
    {
        if (_vehicleId <= 0 || _panicPending)
        {
            return;
        }

        _panicPending = true;
        IsFetching = true;
        Reproject();
        try
        {
            await _feed.PanicAsync(_vehicleId, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            _panicPending = false;
            IsFetching = false;
            Reproject();
            return;
        }
        catch (Exception)
        {
            // web: useGuardPanic onError → toast.error.
            _panicPending = false;
            PushToast(_localizer.GetString("guard.toast.panicFailed", "Failed to trigger panic"), isError: true);
            IsFetching = false;
            Reproject();
            return;
        }

        _panicPending = false;
        PushToast(_localizer.GetString("guard.toast.panicSuccess", "Panic alert triggered"), isError: false);
        await LoadAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Acknowledge a single guard event (web <c>handleAcknowledge → useAcknowledgeGuardEvent</c>).</summary>
    public async Task AcknowledgeAsync(long eventId, CancellationToken cancellationToken = default)
    {
        if (_vehicleId <= 0)
        {
            return;
        }

        _ackPendingId = eventId;
        IsFetching = true;
        Reproject();
        try
        {
            await _feed.AcknowledgeAsync(_vehicleId, eventId, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            _ackPendingId = null;
            IsFetching = false;
            Reproject();
            return;
        }
        catch (Exception)
        {
            // web: useAcknowledgeGuardEvent onError → toast.error.
            _ackPendingId = null;
            PushToast(_localizer.GetString("guard.toast.ackFailed", "Failed to acknowledge event"), isError: true);
            IsFetching = false;
            Reproject();
            return;
        }

        _ackPendingId = null;
        PushToast(_localizer.GetString("guard.toast.ackSuccess", "Event acknowledged"), isError: false);
        await LoadAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Update the sensitivity form selection (web <c>setSensitivity</c>) and re-project.</summary>
    public void SetSensitivity(string? value)
    {
        string next = value ?? string.Empty;
        if (string.Equals(_formSensitivity, next, StringComparison.Ordinal))
        {
            return;
        }

        _formSensitivity = next;
        Reproject();
    }

    /// <summary>Update the home-geofence form selection (web <c>setHomeGeofenceId</c>) and re-project.</summary>
    public void SetHomeGeofence(string? value)
    {
        string next = value ?? string.Empty;
        if (string.Equals(_formGeofenceId, next, StringComparison.Ordinal))
        {
            return;
        }

        _formGeofenceId = next;
        Reproject();
    }

    /// <summary>Update the auto-panic form toggle (web <c>setAutoPanic</c>) and re-project.</summary>
    public void SetAutoPanic(bool value)
    {
        if (_formAutoPanic == value)
        {
            return;
        }

        _formAutoPanic = value;
        Reproject();
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        var cts = Interlocked.Exchange(ref _cts, null);
        cts?.Cancel();
        cts?.Dispose();
    }

    private bool IsArmed => _config?.Enabled ?? false;

    private string EffectiveSensitivity => !string.IsNullOrEmpty(_formSensitivity)
        ? _formSensitivity
        : !string.IsNullOrEmpty(_config?.Sensitivity) ? _config!.Sensitivity! : DefaultSensitivity;

    private string EffectiveGeofenceId => !string.IsNullOrEmpty(_formGeofenceId)
        ? _formGeofenceId
        : _config?.HomeGeofenceId is { } gid ? gid.ToString(CultureInfo.InvariantCulture) : string.Empty;

    private async Task LoadFleetAsync(CancellationToken cancellationToken)
    {
        try
        {
            var vehicles = await _feed.FetchVehiclesAsync(cancellationToken).ConfigureAwait(false);
            cancellationToken.ThrowIfCancellationRequested();
            _vehicles = vehicles ?? Array.Empty<VehicleOption>();
            _vehiclesLoading = false;
            _vehiclesError = null;

            if (_vehicleId <= 0 && _vehicles.Count > 0)
            {
                _vehicleId = _vehicles[0].Id;
            }

            _vehicleName = _vehicles.FirstOrDefault(v => v.Id == _vehicleId)?.DisplayName;
            Raise(nameof(Vehicles));
            Raise(nameof(VehiclesLoading));
            Raise(nameof(VehiclesError));
            Raise(nameof(SelectedVehicleId));
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            // web: useVehicles is an independent query — its failure never blocks the guard reads.
            _vehicles = Array.Empty<VehicleOption>();
            _vehiclesLoading = false;
            _vehiclesError = ex.Message;
            Raise(nameof(Vehicles));
            Raise(nameof(VehiclesLoading));
            Raise(nameof(VehiclesError));
        }
    }

    private async Task LoadGeofencesAsync(CancellationToken cancellationToken)
    {
        try
        {
            var geofences = await _feed.FetchGeofencesAsync(cancellationToken).ConfigureAwait(false);
            cancellationToken.ThrowIfCancellationRequested();
            _geofences = geofences ?? Array.Empty<GuardGeofence>();
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            // web: useGeofences is an independent query — treat a failure as "no geofences".
            _geofences = Array.Empty<GuardGeofence>();
        }
    }

    private async Task LoadVehicleScopedAsync(CancellationToken cancellationToken)
    {
        if (_vehicleId <= 0)
        {
            _config = null;
            _events = Array.Empty<GuardEvent>();
            _vehicleState = null;
            return;
        }

        try
        {
            _config = await _feed.FetchConfigAsync(_vehicleId, cancellationToken).ConfigureAwait(false);
            cancellationToken.ThrowIfCancellationRequested();
            _hasError = false;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            // web: useGuardConfig error → the page keeps rendering; nothing to show drives the error state.
            _config = null;
            _hasError = true;
        }

        try
        {
            var events = await _feed.FetchEventsAsync(_vehicleId, cancellationToken).ConfigureAwait(false);
            cancellationToken.ThrowIfCancellationRequested();
            _events = events ?? Array.Empty<GuardEvent>();
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            _events = Array.Empty<GuardEvent>();
        }

        try
        {
            _vehicleState = await _feed.FetchVehicleStateAsync(_vehicleId, cancellationToken).ConfigureAwait(false);
            cancellationToken.ThrowIfCancellationRequested();
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            _vehicleState = null;
        }
    }

    private async Task RunConfigWriteAsync(GuardConfigWrite write, CancellationToken cancellationToken)
    {
        _savePending = true;
        IsFetching = true;
        Reproject();
        try
        {
            await _feed.SetConfigAsync(_vehicleId, write, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            _savePending = false;
            IsFetching = false;
            Reproject();
            return;
        }
        catch (Exception)
        {
            // web: useSetGuardConfig onError → toast.error('Failed to update guard config').
            _savePending = false;
            PushToast(_localizer.GetString("guard.toast.configFailed", "Failed to update guard config"), isError: true);
            IsFetching = false;
            Reproject();
            return;
        }

        _savePending = false;
        PushToast(_localizer.GetString("guard.toast.configSuccess", "Guard configuration updated"), isError: false);
        await LoadAsync(cancellationToken).ConfigureAwait(false);
    }

    private static long? ParseGeofenceId(string value) =>
        long.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var id) && id > 0 ? id : null;

    private GuardModeModel BuildModel() => new(
        VehicleId: _vehicleId,
        Config: _config,
        Events: _events,
        VehicleState: _vehicleState,
        Geofences: _geofences,
        VehicleName: _vehicleName,
        FormSensitivity: _formSensitivity,
        FormHomeGeofenceId: _formGeofenceId,
        FormAutoPanic: _formAutoPanic,
        Loading: _loading,
        HasError: _hasError,
        IsSavePending: _savePending,
        IsPanicPending: _panicPending,
        AckPendingId: _ackPendingId);

    private void Reproject()
    {
        var display = GuardModeProjection.Project(BuildModel(), _localizer, _clock());
        Display = display;
        State = display.State;
    }

    private void PushToast(string message, bool isError)
    {
        _toastMessage = message ?? string.Empty;
        _toastIsError = isError;
        _toastSequence++;
        Raise(nameof(ToastSequence));
    }

    private static CancellationTokenSource Supersede(ref CancellationTokenSource? slot, CancellationToken cancellationToken)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref slot, cts);
        previous?.Cancel();
        previous?.Dispose();
        return cts;
    }

    private void Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return;
        }

        field = value;
        Raise(name);
    }

    private void Raise(string? name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
