using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="LiveVehicleState"/> view — the native port of the web
/// <c>LiveVehicleState</c> child plus its parent's query lifecycle
/// (web/src/features/admin/components/security-access/LiveVehicleState.tsx +
/// web/src/features/admin/pages/SecurityAccessPage.tsx). It consumes the cache-then-network
/// <see cref="ILiveVehicleStateSource"/>, projects each security reading through
/// <see cref="LiveVehicleStateProjection"/> into ten render-ready tiles, and exposes the mutually-exclusive
/// <see cref="State"/> plus the freshness flags so the view is a thin renderer. A reading always renders the ten
/// tiles (web <c>liveSignals.length &gt; 0</c>); the source collapses a security-less response to
/// <see cref="LiveVehicleStateState.Empty"/>. Drive it from one confinement (the UI thread); it is not internally
/// synchronised.
/// </summary>
public sealed class LiveVehicleStateViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ILiveVehicleStateSource _source;
    private readonly ILocalizer _localizer;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private LiveVehicleStateState _state = LiveVehicleStateState.Loading;
    private LiveVehicleStateDisplay? _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source and localizer.</summary>
    /// <param name="source">The cache-then-network security source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    public LiveVehicleStateViewModel(ILiveVehicleStateSource source, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public LiveVehicleStateState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready model (null until a reading resolves, or on the empty surface).</summary>
    public LiveVehicleStateDisplay? Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasData));
        }
    }

    /// <summary>Last successful update timestamp surfaced in the header freshness chip.</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>True while a background refresh is in flight (freshness chip pulses).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the last load failed (drives the error / offline surface + freshness chip).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown snapshot is older than the freshness window (stale or offline).</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>Localized error / offline message shown in the error surface or offline chip.</summary>
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

    /// <summary>True when a security reading has resolved and the tiles are renderable (web <c>liveSignals.length &gt; 0</c>).</summary>
    public bool HasData => _display is not null;

    /// <summary>Localized surface title (web <c>admin.security.liveState</c> "Live Vehicle State").</summary>
    public string Title => LiveVehicleStateRegistration.Name(_localizer);

    /// <summary>Localized empty-state message (web <c>admin.security.live.noData</c> "No live state data available").</summary>
    public string EmptyMessage => LiveVehicleStateRegistration.EmptyMessage(_localizer);

    /// <summary>Localized "Live" indicator label (web <c>admin.security.live.indicator</c> "Live").</summary>
    public string LiveIndicator => LiveVehicleStateRegistration.LiveIndicator(_localizer);

    /// <summary>
    /// Run a cache-then-network load: counts the attempt, shows the skeleton only when nothing is already
    /// visible (otherwise keeps the tiles while refreshing), and folds every emission into <see cref="State"/>
    /// + <see cref="Display"/>. A superseding load cancels the prior one.
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
            SetLoading();
        }
        else
        {
            IsFetching = true;
        }

        try
        {
            await foreach (var result in _source.StreamAsync(cts.Token).ConfigureAwait(false))
            {
                Apply(result);
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this emission silently.
        }
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
        GC.SuppressFinalize(this);
    }

    private bool HasContent() =>
        _state is LiveVehicleStateState.Loaded or LiveVehicleStateState.Stale or LiveVehicleStateState.Offline;

    private void Apply(RepositoryResult<VehicleSecurityReading> result)
    {
        switch (result.Status)
        {
            case LoadStatus.Loading:
                if (!HasContent())
                {
                    SetLoading();
                }

                IsFetching = true;
                break;

            case LoadStatus.Cached:
                ApplyReading(result.Value!, result.FetchedAt, result.IsStale, fetching: false, error: null);
                break;

            case LoadStatus.Refreshing:
                ApplyReading(result.Value!, result.FetchedAt, result.IsStale, fetching: true, error: null);
                break;

            case LoadStatus.Loaded:
                ApplyReading(result.Value!, result.FetchedAt, stale: false, fetching: false, error: null);
                break;

            case LoadStatus.Empty:
                SetEmpty(result.FetchedAt);
                break;

            case LoadStatus.Offline:
                ApplyReading(result.Value!, result.FetchedAt, stale: true, fetching: false, error: result.Error, offline: true);
                break;

            default:
                SetError(result.Error);
                break;
        }
    }

    private void ApplyReading(
        VehicleSecurityReading reading,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        Display = LiveVehicleStateProjection.Project(reading, _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = offline;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline
            ? LiveVehicleStateState.Offline
            : stale ? LiveVehicleStateState.Stale : LiveVehicleStateState.Loaded;
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = LiveVehicleStateState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = null;
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = LiveVehicleStateState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        Display = null;
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = LiveVehicleStateState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "admin.security.live.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "admin.security.live.error.offline",
            _ => "admin.security.live.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view live vehicle state",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached vehicle state",
            _ => "Couldn't load live vehicle state",
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
        Raise(name);
    }

    private void Raise(string? name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
