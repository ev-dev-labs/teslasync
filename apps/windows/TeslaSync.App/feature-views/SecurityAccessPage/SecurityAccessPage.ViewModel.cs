using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Forms;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>SecurityAccessPage</c> view — the native port of the web page's
/// data flow (web/src/features/admin/pages/SecurityAccessPage.tsx). It owns the fleet scope (web <c>useVehicles</c> /
/// <c>useSelectedVehicle</c>), the polled latest snapshot (web <c>GET /security/latest</c>) and the security history
/// (web <c>useSecurityEvents</c>), reads them through the injected <see cref="ISecurityAccessFeed"/> and projects the
/// result through <see cref="SecurityAccessProjection"/> so the view is a thin renderer. It surfaces the three web
/// data states (loading / error / success) — the load failure mapping to the web <c>anyError</c> banner — plus an
/// in-flight flag and the vehicle scope change (web <c>useSelectedVehicle</c>); observable so the view re-renders on
/// <see cref="PropertyChanged"/>. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class SecurityAccessPageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ISecurityAccessFeed _feed;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;
    private readonly SecurityAccessDiagnostics _diagnostics;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private IReadOnlyList<VehicleOption> _vehicles = Array.Empty<VehicleOption>();
    private bool _vehiclesLoading = true;
    private string? _vehiclesError;

    private long _vehicleId;
    private SecurityEvent? _latest;
    private IReadOnlyList<SecurityEvent> _history = Array.Empty<SecurityEvent>();
    private bool _loadingLatest = true;
    private bool _loadingHistory = true;
    private string? _latestError;
    private string? _historyError;

    private SecurityAccessState _state = SecurityAccessState.Loading;
    private SecurityAccessDisplay _display;
    private bool _isFetching;
    private DateTimeOffset? _updatedAt;

    /// <summary>Creates the holder over its data feed, localizer and (optional) clock / diagnostics.</summary>
    /// <param name="feed">The security-access data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="clock">Injectable clock for deterministic relative-time formatting in tests.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public SecurityAccessPageViewModel(
        ISecurityAccessFeed feed,
        ILocalizer localizer,
        Func<DateTimeOffset>? clock = null,
        SecurityAccessDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(feed);
        ArgumentNullException.ThrowIfNull(localizer);

        _feed = feed;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _diagnostics = diagnostics ?? new SecurityAccessDiagnostics();
        _display = SecurityAccessProjection.Project(BuildModel(), _localizer, _clock());
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current top-level data state (loading / error / success).</summary>
    public SecurityAccessState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public SecurityAccessDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>True while a (re)fetch is in flight (the header freshness chip pulses).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the last load failed (drives the header freshness chip's error state).</summary>
    public bool IsError => _vehiclesError is not null || _latestError is not null || _historyError is not null;

    /// <summary>Last successful update timestamp surfaced in the header freshness chip.</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>The localized page title (web <c>t('admin.security.title')</c>).</summary>
    public string Title => SecurityAccessRegistration.Title(_localizer);

    /// <summary>The fleet options backing the scope picker (web <c>useVehicles</c>).</summary>
    public IReadOnlyList<VehicleOption> Vehicles => _vehicles;

    /// <summary>True while the fleet read is in flight (drives the picker's loading state).</summary>
    public bool VehiclesLoading => _vehiclesLoading;

    /// <summary>The localized fleet-load failure message, or null (drives the picker's error state).</summary>
    public string? VehiclesError => _vehiclesError;

    /// <summary>The currently-scoped vehicle id, or null when none is selected.</summary>
    public long? SelectedVehicleId => _vehicleId > 0 ? _vehicleId : null;

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>Run (or re-run) the full load: the fleet scope, then the vehicle-scoped latest + history reads.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);

        IsFetching = true;
        if (_latest is null && _history.Count == 0)
        {
            _loadingLatest = true;
            _loadingHistory = true;
            Reproject();
        }

        try
        {
            await LoadFleetAsync(cts.Token).ConfigureAwait(false);
            await LoadVehicleScopedAsync(cts.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this result silently.
            return;
        }

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
        _latest = null;
        _history = Array.Empty<SecurityEvent>();
        _latestError = null;
        _historyError = null;
        _loadingLatest = true;
        _loadingHistory = true;
        Raise(nameof(SelectedVehicleId));
        return LoadAsync(cancellationToken);
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
            // web: useVehicles is an independent query — its failure surfaces via the same anyError banner.
            _vehicles = Array.Empty<VehicleOption>();
            _vehiclesLoading = false;
            _vehiclesError = ex.Message;
            Raise(nameof(Vehicles));
            Raise(nameof(VehiclesLoading));
            Raise(nameof(VehiclesError));
        }
    }

    private async Task LoadVehicleScopedAsync(CancellationToken cancellationToken)
    {
        if (_vehicleId <= 0)
        {
            // web: the latest + history queries are disabled without an active vehicle (enabled: !!activeId).
            _latest = null;
            _history = Array.Empty<SecurityEvent>();
            _loadingLatest = false;
            _loadingHistory = false;
            return;
        }

        try
        {
            _latest = await _feed.FetchLatestAsync(_vehicleId, cancellationToken).ConfigureAwait(false);
            cancellationToken.ThrowIfCancellationRequested();
            _latestError = null;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            // web: latestError feeds the anyError banner; the page keeps rendering whatever else resolved.
            _latestError = ex.Message;
        }
        finally
        {
            _loadingLatest = false;
        }

        try
        {
            var history = await _feed.FetchSecurityEventsAsync(_vehicleId, cancellationToken).ConfigureAwait(false);
            cancellationToken.ThrowIfCancellationRequested();
            _history = history ?? Array.Empty<SecurityEvent>();
            _historyError = null;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _historyError = ex.Message;
        }
        finally
        {
            _loadingHistory = false;
        }
    }

    private SecurityAccessModel BuildModel() => new(
        Latest: _latest,
        History: _history,
        LoadingLatest: _loadingLatest,
        LoadingHistory: _loadingHistory,
        HasVehicle: _vehicleId > 0,
        VehiclesError: _vehiclesError,
        LatestError: _latestError,
        HistoryError: _historyError);

    private void Reproject()
    {
        var display = SecurityAccessProjection.Project(BuildModel(), _localizer, _clock());
        Display = display;
        State = display.State;
        Raise(nameof(IsError));
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
