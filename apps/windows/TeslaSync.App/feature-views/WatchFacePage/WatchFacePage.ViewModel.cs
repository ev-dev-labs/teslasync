using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Watch;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>WatchFacePage</c> view — the native port of the web page's
/// hook composition (web/src/features/watch/pages/WatchFacePage.tsx). It consumes the cache-then-network
/// <see cref="IWatchFaceSummarySource"/> to read the watch summary (web <c>useWatchSummary</c>), and fires each
/// tap-icon command through the <see cref="IWatchFaceCommandSender"/> mutation (web <c>useWatchCommand</c>) while
/// tracking the single <see cref="ActiveCommand"/> so the view can dim the icon row (web
/// <c>commandMutation.isPending</c>); on success it re-reads the summary so the lock / climate icons and the gauge
/// reflect the change. It projects everything through <see cref="WatchFaceProjection"/> into a render-ready
/// <see cref="Display"/> and derives the mutually-exclusive <see cref="State"/> from the summary read. Observable so
/// the view re-renders on <see cref="PropertyChanged"/>; drive it from one confinement (the UI thread) — it is not
/// internally synchronised.
/// </summary>
public sealed class WatchFacePageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IWatchFaceSummarySource _summarySource;
    private readonly IWatchFaceCommandSender _commandSender;
    private readonly ILocalizer _localizer;
    private readonly WatchFaceDiagnostics _diagnostics;
    private readonly UnitPref _units;
    private readonly long? _vehicleId;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private RepositoryResult<WatchFaceSummary> _summaryResult = RepositoryResult<WatchFaceSummary>.Loading();
    private string? _activeCommand;
    private bool _commandPending;

    private WatchFaceState _state = WatchFaceState.Loading;
    private WatchFaceDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its summary read port, command port, localizer, unit preference and diagnostics.</summary>
    /// <param name="summarySource">The cache-then-network watch-summary port (native <c>useWatchSummary</c>).</param>
    /// <param name="commandSender">The one-shot command mutation port (native <c>useWatchCommand</c>).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="units">The user's unit preference; defaults to metric when null.</param>
    /// <param name="vehicleId">The optional <c>?vehicle_id=</c> deep-link target forwarded to the command (web <c>vehicleId ?? 0</c>).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public WatchFacePageViewModel(
        IWatchFaceSummarySource summarySource,
        IWatchFaceCommandSender commandSender,
        ILocalizer localizer,
        UnitPref? units = null,
        long? vehicleId = null,
        WatchFaceDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(summarySource);
        ArgumentNullException.ThrowIfNull(commandSender);
        ArgumentNullException.ThrowIfNull(localizer);

        _summarySource = summarySource;
        _commandSender = commandSender;
        _localizer = localizer;
        _units = units ?? UnitPref.Metric;
        _vehicleId = vehicleId;
        _diagnostics = diagnostics ?? new WatchFaceDiagnostics();
        _display = WatchFaceProjection.Project(BuildModel(), _localizer);
        _state = _display.State;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state (loading / empty / error / success).</summary>
    public WatchFaceState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content the view binds to.</summary>
    public WatchFaceDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>Last successful summary-read timestamp surfaced through the freshness caption (web <c>last_updated</c>).</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>True while a background refresh is in flight (the web auto-refetch every 30s).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the summary read failed with no value (drives the error surface).</summary>
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

    /// <summary>True while a tap-icon command is in flight (web <c>commandMutation.isPending</c>).</summary>
    public bool IsCommandPending => _commandPending;

    /// <summary>The wire string of the in-flight command, or null (web <c>commandMutation.variables?.command</c>).</summary>
    public string? ActiveCommand => _activeCommand;

    /// <summary>The localized page title (web route title "Watch Face").</summary>
    public string Title => _localizer.GetString("watch.title", "Watch Face");

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();

    /// <summary>
    /// Run a cache-then-network load of the watch summary (web <c>useWatchSummary</c>). Shows the skeleton only
    /// when nothing is already visible; a superseding load cancels the prior one.
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
            _summaryResult = RepositoryResult<WatchFaceSummary>.Loading();
            Reproject();
        }
        else
        {
            IsFetching = true;
        }

        try
        {
            await foreach (var result in _summarySource.StreamAsync(cts.Token).ConfigureAwait(false))
            {
                cts.Token.ThrowIfCancellationRequested();
                _summaryResult = result;
                Reproject();
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

    /// <summary>Refresh the summary read (web auto-refetch / manual refresh).</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <summary>Retry after a failure — re-runs the load from the top.</summary>
    public Task RetryAsync() => LoadAsync();

    /// <summary>
    /// Fire a tap-icon command (web <c>commandMutation.mutate({ vehicleId, command })</c>): marks the command in
    /// flight (dimming the icon row), runs the mutation, then on success re-reads the watch summary so the lock /
    /// climate icons and the gauge reflect the change. An already-pending call is a no-op. Returns the classified
    /// outcome.
    /// </summary>
    public async Task<WatchFaceCommandOutcome> SendCommandAsync(string command, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrEmpty(command);

        if (_commandPending)
        {
            return WatchFaceCommandOutcome.Failure(new RepositoryError(RepositoryErrorKind.Unknown, "A command is already in flight"));
        }

        _activeCommand = command;
        _commandPending = true;
        Reproject();

        WatchFaceCommandOutcome outcome;
        try
        {
            outcome = await _commandSender.SendAsync(_vehicleId ?? 0, command, cancellationToken).ConfigureAwait(false);
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
                await ReloadSummaryAsync(cancellationToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                // The page was navigated away mid-refresh — drop silently.
            }
        }

        return outcome;
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

    private async Task ReloadSummaryAsync(CancellationToken cancellationToken)
    {
        await foreach (var result in _summarySource.StreamAsync(cancellationToken).ConfigureAwait(false))
        {
            cancellationToken.ThrowIfCancellationRequested();
            _summaryResult = result;
            Reproject();
        }
    }

    private bool HasContent() => _state == WatchFaceState.Success;

    private WatchFaceModel BuildModel()
    {
        var hasValue = _summaryResult.HasValue;
        var loading = !hasValue && _summaryResult.Status == LoadStatus.Loading;
        var loadFailed = !hasValue && _summaryResult.Status == LoadStatus.Error;

        return new WatchFaceModel(
            Summary: hasValue ? _summaryResult.Value : null,
            Loading: loading,
            LoadFailed: loadFailed,
            Units: _units,
            ActiveCommand: _activeCommand,
            CommandPending: _commandPending);
    }

    private void Reproject()
    {
        var display = WatchFaceProjection.Project(BuildModel(), _localizer);
        Display = display;
        State = display.State;
        IsError = display.State == WatchFaceState.Error;
        ErrorMessage = display.State == WatchFaceState.Error ? ErrorTextFor(_summaryResult.Error) : null;

        if (_summaryResult.FetchedAt is { } stamp)
        {
            UpdatedAt = stamp;
        }
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "watch.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "watch.error.offline",
            _ => "watch.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view your vehicle",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached watch face",
            _ => "Couldn't load watch data",
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
/// The default watch-summary feed — yields a single resolved empty result (no data). It keeps the headless /
/// unpackaged page on the "No vehicle found" empty surface without any network access, so the page is fully
/// renderable in design-time hosts; a DI host wires the generated-client-backed <see cref="IWatchFaceSummarySource"/>.
/// </summary>
public sealed class EmptyWatchFaceSummarySource : IWatchFaceSummarySource
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyWatchFaceSummarySource Instance { get; } = new();

    private EmptyWatchFaceSummarySource()
    {
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<WatchFaceSummary>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        yield return RepositoryResult<WatchFaceSummary>.Empty();
        await Task.CompletedTask.ConfigureAwait(false);
    }
}

/// <summary>The default command sender — resolves every command to a benign success without any network access.</summary>
public sealed class NoopWatchFaceCommandSender : IWatchFaceCommandSender
{
    /// <summary>The shared singleton instance.</summary>
    public static NoopWatchFaceCommandSender Instance { get; } = new();

    private NoopWatchFaceCommandSender()
    {
    }

    /// <inheritdoc />
    public Task<WatchFaceCommandOutcome> SendAsync(long vehicleId, string command, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(WatchFaceCommandOutcome.Ok);
    }
}
