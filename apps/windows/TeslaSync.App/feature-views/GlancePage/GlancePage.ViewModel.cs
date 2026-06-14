using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Dashboard;

/// <summary>
/// The vehicle-resolution data port (P1/S8) — the native analogue of the web <c>useVehicles</c> hook the glance
/// page reads to resolve <c>vehicleId ?? vehicles?.[0]?.id</c>. It yields the cache-then-network sequence of
/// resolved <see cref="GlanceVehicle"/> snapshots for <c>GET /vehicles</c>; a successful-but-empty fleet surfaces
/// as <see cref="RepositoryResult{T}.Empty"/> (web <c>!vehicle</c>). The view never performs HTTP itself.
/// </summary>
public interface IGlanceVehiclesSource
{
    /// <summary>Stream the cache-then-network resolved-vehicle snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<GlanceVehicle>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The vehicle-state data port (P1/S8) — the native analogue of the web <c>useVehicleState</c> hook. It yields the
/// cache-then-network sequence of parsed <see cref="GlanceVehicleState"/> snapshots for
/// <c>GET /vehicles/{vehicleID}/state</c> scoped to the resolved vehicle.
/// </summary>
public interface IGlanceVehicleStateSource
{
    /// <summary>Stream the cache-then-network state snapshots for <paramref name="vehicleId"/>, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<GlanceVehicleState>> StreamAsync(long vehicleId, CancellationToken cancellationToken = default);
}

/// <summary>
/// The latest-location data port (P1/S8) — the native analogue of the web <c>useLocationSnapshotLatest</c> hook. It
/// yields the cache-then-network sequence of parsed <see cref="GlanceLocation"/> snapshots for
/// <c>GET /location-snapshots/latest?vehicle_id={id}</c> scoped to the resolved vehicle.
/// </summary>
public interface IGlanceLocationSource
{
    /// <summary>Stream the cache-then-network location snapshots for <paramref name="vehicleId"/>, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<GlanceLocation>> StreamAsync(long vehicleId, CancellationToken cancellationToken = default);
}

/// <summary>
/// The command-mutation port (P1/S8) — the native analogue of the web <c>useVehicleCommand</c> mutation
/// (<c>POST /vehicles/{id}/command</c>). The view never performs HTTP itself; the concrete sender (or a test fake)
/// drives this and returns a classified <see cref="GlanceCommandOutcome"/>.
/// </summary>
public interface IGlanceCommandSender
{
    /// <summary>Send <paramref name="command"/> to <paramref name="vehicleId"/> and return the classified outcome.</summary>
    Task<GlanceCommandOutcome> SendAsync(long vehicleId, string command, CancellationToken cancellationToken = default);
}

/// <summary>
/// The result of a quick-action command POST — the native mirror of the web <c>useVehicleCommand</c> mutation
/// settling (success or a classified failure). Pure data so the flow is unit-tested without a network.
/// </summary>
/// <param name="Success">Whether the command was accepted.</param>
/// <param name="Error">The classified failure when <see cref="Success"/> is false; otherwise null.</param>
public sealed record GlanceCommandOutcome(bool Success, RepositoryError? Error)
{
    /// <summary>A successful command settlement.</summary>
    public static GlanceCommandOutcome Ok { get; } = new(true, null);

    /// <summary>A failed command settlement carrying the classified error.</summary>
    public static GlanceCommandOutcome Failure(RepositoryError error) => new(false, error);
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>GlancePage</c> view — the native port of the web page's hook
/// composition (web/src/features/dashboard/pages/GlancePage.tsx). It consumes the cache-then-network
/// <see cref="IGlanceVehiclesSource"/> to resolve the vehicle (web <c>useVehicles</c>), then the
/// <see cref="IGlanceVehicleStateSource"/> + <see cref="IGlanceLocationSource"/> scoped to that vehicle (web
/// <c>useVehicleState</c> + <c>useLocationSnapshotLatest</c>), and fires each quick action through the
/// <see cref="IGlanceCommandSender"/> mutation while tracking the single <see cref="ActiveCommand"/> so the view can
/// spin that tile and disable the grid (web <c>sendCommand.isPending</c>). It projects everything through
/// <see cref="GlanceProjection"/> into a render-ready <see cref="Display"/> and derives the mutually-exclusive
/// <see cref="State"/> from the vehicles read. Observable so the view re-renders on <see cref="PropertyChanged"/>;
/// drive it from one confinement (the UI thread) — it is not internally synchronised.
/// </summary>
public sealed class GlancePageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IGlanceVehiclesSource _vehiclesSource;
    private readonly IGlanceVehicleStateSource _stateSource;
    private readonly IGlanceLocationSource _locationSource;
    private readonly IGlanceCommandSender _commandSender;
    private readonly ILocalizer _localizer;
    private readonly GlanceDiagnostics _diagnostics;
    private readonly UnitPref _units;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private RepositoryResult<GlanceVehicle> _vehicleResult = RepositoryResult<GlanceVehicle>.Loading();
    private RepositoryResult<GlanceVehicleState>? _stateResult;
    private RepositoryResult<GlanceLocation>? _locationResult;
    private string? _activeCommand;
    private bool _commandPending;

    private GlanceState _state = GlanceState.Loading;
    private GlanceDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its four data ports, localizer, unit preference and diagnostics.</summary>
    /// <param name="vehiclesSource">The cache-then-network vehicle-resolution port (native <c>useVehicles</c>).</param>
    /// <param name="stateSource">The cache-then-network vehicle-state port (native <c>useVehicleState</c>).</param>
    /// <param name="locationSource">The cache-then-network latest-location port (native <c>useLocationSnapshotLatest</c>).</param>
    /// <param name="commandSender">The one-shot command mutation port (native <c>useVehicleCommand</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="units">The user's unit preference; defaults to metric when null.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public GlancePageViewModel(
        IGlanceVehiclesSource vehiclesSource,
        IGlanceVehicleStateSource stateSource,
        IGlanceLocationSource locationSource,
        IGlanceCommandSender commandSender,
        ILocalizer localizer,
        UnitPref? units = null,
        GlanceDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(vehiclesSource);
        ArgumentNullException.ThrowIfNull(stateSource);
        ArgumentNullException.ThrowIfNull(locationSource);
        ArgumentNullException.ThrowIfNull(commandSender);
        ArgumentNullException.ThrowIfNull(localizer);

        _vehiclesSource = vehiclesSource;
        _stateSource = stateSource;
        _locationSource = locationSource;
        _commandSender = commandSender;
        _localizer = localizer;
        _units = units ?? UnitPref.Metric;
        _diagnostics = diagnostics ?? new GlanceDiagnostics();
        _display = GlanceProjection.Project(BuildModel(), _localizer);
        _state = _display.State;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state (loading / error / empty / success).</summary>
    public GlanceState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public GlanceDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>Last successful state-read timestamp surfaced in the freshness chip (web <c>dataUpdatedAt</c>).</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>True while a background refresh is in flight (the freshness chip pulses).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the vehicles read failed with no value (drives the top-level error surface).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>Localized error message shown in the error surface.</summary>
    public string? ErrorMessage
    {
        get => _errorMessage;
        private set => Set(ref _errorMessage, value);
    }

    /// <summary>Number of load attempts started (including retries).</summary>
    public int Attempts
    {
        get => _attempts;
        private set => Set(ref _attempts, value);
    }

    /// <summary>True while a quick-action command is in flight (web <c>sendCommand.isPending</c>).</summary>
    public bool IsCommandPending => _commandPending;

    /// <summary>The wire string of the in-flight command, or null (web <c>sendCommand.variables?.command</c>).</summary>
    public string? ActiveCommand => _activeCommand;

    /// <summary>The localized page title (web <c>glance.title</c>).</summary>
    public string Title => _localizer.GetString("glance.title", "Quick Glance");

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>
    /// Run a cache-then-network load: resolve the vehicle (web <c>useVehicles</c>), then — when one resolves — load
    /// its state and latest location (web <c>useVehicleState</c> + <c>useLocationSnapshotLatest</c>). Shows the
    /// skeleton only when nothing is already visible; a superseding load cancels the prior one.
    /// </summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref _cts, cts);
        previous?.Cancel();
        previous?.Dispose();

        Attempts++;
        if (!HasContent())
        {
            _vehicleResult = RepositoryResult<GlanceVehicle>.Loading();
            Reproject();
        }
        else
        {
            IsFetching = true;
        }

        try
        {
            await foreach (var result in _vehiclesSource.StreamAsync(cts.Token).ConfigureAwait(false))
            {
                cts.Token.ThrowIfCancellationRequested();
                _vehicleResult = result;
                Reproject();
            }

            if (_vehicleResult.HasValue && _vehicleResult.Value is { Id: > 0 } vehicle)
            {
                await LoadStateAndLocationAsync(vehicle.Id, cts.Token).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this emission silently.
            return;
        }

        IsFetching = false;
        Reproject();
    }

    /// <summary>Refresh every read (web auto-refetch / manual refresh).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>
    /// Fire a quick-action command (web <c>sendCommand.mutate({ vehicleId, command })</c>): marks the command in
    /// flight (spinning its tile, disabling the grid), runs the mutation, then on success re-reads the vehicle state
    /// + location so the lock / climate cards and the gauge reflect the change. A no-vehicle or already-pending call
    /// is a no-op. Returns the classified outcome.
    /// </summary>
    public async Task<GlanceCommandOutcome> SendCommandAsync(string command, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrEmpty(command);

        if (_commandPending)
        {
            return GlanceCommandOutcome.Failure(new RepositoryError(RepositoryErrorKind.Unknown, "A command is already in flight"));
        }

        if (!(_vehicleResult.HasValue && _vehicleResult.Value is { Id: > 0 } vehicle))
        {
            return GlanceCommandOutcome.Failure(new RepositoryError(RepositoryErrorKind.NotFound, "No vehicle selected"));
        }

        _activeCommand = command;
        _commandPending = true;
        Reproject();

        GlanceCommandOutcome outcome;
        try
        {
            outcome = await _commandSender.SendAsync(vehicle.Id, command, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            _commandPending = false;
            _activeCommand = null;
            Reproject();
            throw;
        }

        _commandPending = false;
        _activeCommand = null;
        Reproject();

        if (outcome.Success)
        {
            try
            {
                await LoadStateAndLocationAsync(vehicle.Id, cancellationToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                // The page was navigated away mid-refresh — drop silently.
            }
        }

        return outcome;
    }

    /// <summary>Retry after a failure — re-runs the load from the top.</summary>
    public Task RetryAsync() => LoadAsync();

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

    private async Task LoadStateAndLocationAsync(long vehicleId, CancellationToken cancellationToken)
    {
        await foreach (var result in _stateSource.StreamAsync(vehicleId, cancellationToken).ConfigureAwait(false))
        {
            cancellationToken.ThrowIfCancellationRequested();
            _stateResult = result;
            Reproject();
        }

        await foreach (var result in _locationSource.StreamAsync(vehicleId, cancellationToken).ConfigureAwait(false))
        {
            cancellationToken.ThrowIfCancellationRequested();
            _locationResult = result;
            Reproject();
        }
    }

    private bool HasContent() => _state == GlanceState.Success;

    private GlanceModel BuildModel()
    {
        var hasVehicle = _vehicleResult.HasValue;
        var loading = !hasVehicle && _vehicleResult.Status == LoadStatus.Loading;
        var loadFailed = !hasVehicle && _vehicleResult.Status == LoadStatus.Error;

        return new GlanceModel(
            Vehicle: hasVehicle ? _vehicleResult.Value : null,
            State: _stateResult is { HasValue: true } s ? s.Value : null,
            Location: _locationResult is { HasValue: true } l ? l.Value : null,
            Loading: loading,
            LoadFailed: loadFailed,
            Units: _units,
            ActiveCommand: _activeCommand,
            CommandPending: _commandPending);
    }

    private void Reproject()
    {
        var display = GlanceProjection.Project(BuildModel(), _localizer);
        Display = display;
        State = display.State;
        IsError = display.State == GlanceState.Error;
        ErrorMessage = display.State == GlanceState.Error ? ErrorTextFor(_vehicleResult.Error) : null;

        var fetchedAt = _stateResult?.FetchedAt ?? _vehicleResult.FetchedAt;
        if (fetchedAt is { } stamp)
        {
            UpdatedAt = stamp;
        }
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "glance.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "glance.error.offline",
            _ => "glance.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view your vehicle",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached glance",
            _ => "Couldn't load your vehicle",
        };

        return _localizer.GetString(key, fallback);
    }

    private void Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return;
        }

        field = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    }
}

/// <summary>
/// The default vehicle-resolution feed — yields a single resolved empty result (no vehicle). It keeps the headless /
/// unpackaged page on the "No vehicle found" empty surface without any network access, so the page is fully
/// renderable in design-time hosts; a DI host wires the generated-client-backed <see cref="IGlanceVehiclesSource"/>.
/// </summary>
public sealed class EmptyGlanceVehiclesSource : IGlanceVehiclesSource
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyGlanceVehiclesSource Instance { get; } = new();

    private EmptyGlanceVehiclesSource()
    {
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<GlanceVehicle>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        yield return RepositoryResult<GlanceVehicle>.Empty();
        await Task.CompletedTask.ConfigureAwait(false);
    }
}

/// <summary>The default vehicle-state feed — yields a single empty result (no state) without any network access.</summary>
public sealed class EmptyGlanceVehicleStateSource : IGlanceVehicleStateSource
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyGlanceVehicleStateSource Instance { get; } = new();

    private EmptyGlanceVehicleStateSource()
    {
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<GlanceVehicleState>> StreamAsync(
        long vehicleId,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        yield return RepositoryResult<GlanceVehicleState>.Empty();
        await Task.CompletedTask.ConfigureAwait(false);
    }
}

/// <summary>The default latest-location feed — yields a single empty result (no location) without any network access.</summary>
public sealed class EmptyGlanceLocationSource : IGlanceLocationSource
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyGlanceLocationSource Instance { get; } = new();

    private EmptyGlanceLocationSource()
    {
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<GlanceLocation>> StreamAsync(
        long vehicleId,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        yield return RepositoryResult<GlanceLocation>.Empty();
        await Task.CompletedTask.ConfigureAwait(false);
    }
}

/// <summary>The default command sender — resolves every command to a benign success without any network access.</summary>
public sealed class NoopGlanceCommandSender : IGlanceCommandSender
{
    /// <summary>The shared singleton instance.</summary>
    public static NoopGlanceCommandSender Instance { get; } = new();

    private NoopGlanceCommandSender()
    {
    }

    /// <inheritdoc />
    public Task<GlanceCommandOutcome> SendAsync(long vehicleId, string command, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(GlanceCommandOutcome.Ok);
    }
}
