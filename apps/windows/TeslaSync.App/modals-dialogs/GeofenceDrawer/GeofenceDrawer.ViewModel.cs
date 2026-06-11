using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Maps;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// The data port the <see cref="GeofenceDrawerViewModel"/> binds to (P1/S8 state-holder seam). It
/// yields the cache-then-network sequence of parsed geofence snapshots for <c>GET /geofences</c> — the
/// native analogue of the fences the web <c>GeofenceDrawer</c> receives from its parent page. The view
/// never performs HTTP itself; the concrete <see cref="GeofenceDrawerSource"/> (or a test fake) drives this.
/// </summary>
public interface IGeofenceDrawerSource
{
    /// <summary>Stream the cache-then-network geofence snapshots, cached first.</summary>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<DrawableGeofence>>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Canonical metadata for the Geofence drawer surface — the stable id, the diagnostics slug emitted
/// with <c>view.opened</c>, and the localized chrome strings. Mirrors the web feature copy
/// (web/src/features/maps/pages/GeofencesPage.tsx + components/maps/GeofenceDrawer.tsx).
/// </summary>
public static class GeofenceDrawerRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "geofence-drawer";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "GeofenceDrawer";

    /// <summary>Localized dialog title.</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("geofences.drawer.title", "Geofences");
    }

    /// <summary>Localized dialog subtitle / description.</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "geofences.drawer.description",
            "Draw, edit and remove geofences on the map.");
    }

    /// <summary>Localized empty-state message shown when no geofences exist yet.</summary>
    public static string EmptyMessage(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("geofences.drawer.empty", "No geofences yet. Draw one on the map to begin.");
    }
}

/// <summary>
/// PII-safe diagnostics for the Geofence drawer (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a geofence name, coordinate or
/// radius — so a diagnostics line can never leak where a vehicle's geofences are. Thread-safe.
/// </summary>
public sealed class GeofenceDrawerDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public GeofenceDrawerDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=GeofenceDrawer</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={GeofenceDrawerRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="GeofenceDrawer"/> view — the native port of
/// the web <c>GeofenceDrawer</c> + its <c>GeofencesPage</c> data composition
/// (web/src/components/maps/GeofenceDrawer.tsx). It consumes the cache-then-network
/// <see cref="IGeofenceDrawerSource"/>, projects each snapshot through <see cref="GeofenceDrawerProjection"/>,
/// and exposes the mutually-exclusive <see cref="State"/>, the fences for the map overlay, the accessible
/// list rows, the header freshness flags, and the active <see cref="Mode"/>. Drive it from one
/// confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class GeofenceDrawerViewModel : INotifyPropertyChanged, IDisposable
{
    private static readonly IReadOnlyList<DrawableGeofence> NoFences = Array.Empty<DrawableGeofence>();
    private static readonly IReadOnlyList<GeofenceRow> NoRows = Array.Empty<GeofenceRow>();

    private readonly IGeofenceDrawerSource _source;
    private readonly ILocalizer _localizer;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private GeofenceDrawerState _state = GeofenceDrawerState.Loading;
    private IReadOnlyList<DrawableGeofence> _fences = NoFences;
    private IReadOnlyList<GeofenceRow> _rows = NoRows;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source and localizer.</summary>
    public GeofenceDrawerViewModel(IGeofenceDrawerSource source, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public GeofenceDrawerState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The fences rendered as overlays on the map.</summary>
    public IReadOnlyList<DrawableGeofence> Fences
    {
        get => _fences;
        private set => Set(ref _fences, value);
    }

    /// <summary>The projected, name-sorted accessible list rows.</summary>
    public IReadOnlyList<GeofenceRow> Rows
    {
        get => _rows;
        private set
        {
            _rows = value;
            Raise(nameof(Rows));
            Raise(nameof(HasFences));
        }
    }

    /// <summary>Last successful update timestamp surfaced in the header freshness chip.</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>True while a background refresh is in flight (header chip pulses).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the last load failed (drives the error surface + header chip).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown fences are older than the freshness window.</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>Localized error message shown in the error / offline surfaces.</summary>
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

    /// <summary>True when there is at least one fence to render.</summary>
    public bool HasFences => _rows.Count > 0;

    /// <summary>Localized dialog title (web <c>Geofences</c>).</summary>
    public string Title => GeofenceDrawerRegistration.Title(_localizer);

    /// <summary>Localized dialog description.</summary>
    public string Description => GeofenceDrawerRegistration.Description(_localizer);

    /// <summary>Localized empty-state message.</summary>
    public string EmptyMessage => GeofenceDrawerRegistration.EmptyMessage(_localizer);

    /// <summary>
    /// Run a cache-then-network load: counts the attempt, shows the skeleton only when no fences are
    /// already visible (otherwise keeps content while refreshing), and folds every emission into
    /// <see cref="State"/> + <see cref="Fences"/> + <see cref="Rows"/>. A superseding load cancels the prior one.
    /// </summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref _cts, cts);
        previous?.Cancel();
        previous?.Dispose();

        Attempts++;
        if (!HasFences)
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

    private void Apply(RepositoryResult<IReadOnlyList<DrawableGeofence>> result)
    {
        switch (result.Status)
        {
            case LoadStatus.Loading:
                if (!HasFences)
                {
                    SetLoading();
                }

                IsFetching = true;
                break;

            case LoadStatus.Cached:
                ApplyFences(result.Value!, result.FetchedAt, result.IsStale, fetching: false, error: null);
                break;

            case LoadStatus.Refreshing:
                ApplyFences(result.Value!, result.FetchedAt, result.IsStale, fetching: true, error: null);
                break;

            case LoadStatus.Loaded:
                ApplyFences(result.Value!, result.FetchedAt, stale: false, fetching: false, error: null);
                break;

            case LoadStatus.Empty:
                SetEmpty(result.FetchedAt);
                break;

            case LoadStatus.Offline:
                ApplyFences(result.Value!, result.FetchedAt, stale: true, fetching: false, error: result.Error, offline: true);
                break;

            default:
                SetError(result.Error);
                break;
        }
    }

    private void ApplyFences(
        IReadOnlyList<DrawableGeofence> fences,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        var rows = GeofenceDrawerProjection.Project(fences, _localizer);
        if (rows.Count == 0)
        {
            SetEmpty(fetchedAt);
            return;
        }

        Fences = fences;
        Rows = rows;
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline ? GeofenceDrawerState.Offline : stale ? GeofenceDrawerState.Stale : GeofenceDrawerState.Loaded;
    }

    private void SetLoading()
    {
        Fences = NoFences;
        Rows = NoRows;
        IsError = false;
        ErrorMessage = null;
        State = GeofenceDrawerState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Fences = NoFences;
        Rows = NoRows;
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = GeofenceDrawerState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        Fences = NoFences;
        Rows = NoRows;
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = GeofenceDrawerState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "geofences.drawer.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "geofences.drawer.error.offline",
            _ => "geofences.drawer.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to manage geofences",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached geofences",
            _ => "Couldn't load geofences",
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
