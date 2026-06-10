using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="PedalUsageViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of projected <see cref="PedalReading"/> snapshots for
/// <c>GET /drive-dynamics/latest</c> — the native analogue of the snapshot the web component reads with
/// <c>useDriveDynamicsLatest(vehicleId)</c>. The view never performs HTTP itself; the concrete
/// <see cref="PedalUsageSource"/> (or a test fake) drives this.
/// </summary>
public interface IPedalUsageSource
{
    /// <summary>Stream the cache-then-network pedal snapshots, newest cache first.</summary>
    /// <param name="cancellationToken">Cancels the in-flight read when a newer load supersedes it.</param>
    /// <returns>The ordered cache-then-network emissions for one logical read.</returns>
    IAsyncEnumerable<RepositoryResult<PedalReading>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Canonical metadata for the <c>PedalUsage</c> feature surface — the native mirror of the web component at
/// web/src/features/driving/components/driving-dynamics/PedalUsage.tsx. The diagnostics <see cref="Slug"/> is the
/// stable surface identifier emitted with the <c>view.opened</c> event.
/// </summary>
public static class PedalUsageRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "PedalUsage";

    /// <summary>Surface category.</summary>
    public const string Category = "driving";

    /// <summary>Localized accessible surface name (the web panel title).</summary>
    /// <param name="localizer">The i18n facade the name resolves through.</param>
    /// <returns>The localized accessible surface name.</returns>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("dynamics.pedalUsage", "Pedal Usage");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>PedalUsage</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a throttle / brake reading or VIN — so a
/// diagnostics line can never leak pedal telemetry. Thread-safe.
/// </summary>
public sealed class PedalUsageDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink each diagnostics line is written to, or <see langword="null"/>.</param>
    public PedalUsageDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=PedalUsage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={PedalUsageRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="PedalUsage"/> view — the native port of the data
/// composition the web component drives with <c>useDriveDynamicsLatest</c>
/// (web/src/features/driving/components/driving-dynamics/PedalUsage.tsx). It consumes the cache-then-network
/// <see cref="IPedalUsageSource"/>, projects each snapshot through <see cref="PedalUsageProjection"/>, and exposes
/// the mutually-exclusive <see cref="State"/> plus the header freshness flags so the view is a thin renderer. The
/// web component shows its empty state whenever no pedal signal is present, so a snapshot with no pedal data is
/// classified <see cref="PedalUsageState.Empty"/> rather than rendering blank gauges. Drive it from one
/// confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class PedalUsageViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IPedalUsageSource _source;
    private readonly ILocalizer _localizer;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private PedalUsageState _state = PedalUsageState.Loading;
    private PedalUsageContent _content;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source and localizer.</summary>
    /// <param name="source">The cache-then-network data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public PedalUsageViewModel(IPedalUsageSource source, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _content = PedalUsageProjection.Project(PedalReading.Empty, _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public PedalUsageState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready content (the gauges, brake status and accessible name).</summary>
    public PedalUsageContent Content
    {
        get => _content;
        private set
        {
            _content = value;
            Raise(nameof(Content));
            Raise(nameof(HasData));
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

    /// <summary>True when the last load failed with no cache (drives the error surface).</summary>
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

    /// <summary>True when the shown snapshot carries at least one pedal signal (web <c>hasAny</c>).</summary>
    public bool HasData => _content.HasData;

    /// <summary>Localized accessible name for the whole surface (Narrator) — the web panel title.</summary>
    public string SurfaceName => PedalUsageRegistration.Name(_localizer);

    /// <summary>Localized empty-state message shown when no pedal telemetry resolved.</summary>
    public string EmptyMessage => _content.EmptyMessage;

    /// <summary>
    /// Run a cache-then-network load: counts the attempt, shows the skeleton only when nothing is already
    /// visible (otherwise keeps content while refreshing), and folds every emission into <see cref="State"/>
    /// + <see cref="Content"/>. A superseding load cancels the prior one.
    /// </summary>
    /// <param name="cancellationToken">Cancels this load.</param>
    /// <returns>A task that completes when the cache-then-network sequence is exhausted.</returns>
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
    /// <returns>A task that completes when the retried load's sequence is exhausted.</returns>
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

    private bool HasContent() =>
        _state is PedalUsageState.Ready or PedalUsageState.Stale or PedalUsageState.Offline;

    private void Apply(RepositoryResult<PedalReading> result)
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
                ApplySnapshot(result.Value!, result.FetchedAt, result.IsStale, fetching: false, error: null);
                break;

            case LoadStatus.Refreshing:
                ApplySnapshot(result.Value!, result.FetchedAt, result.IsStale, fetching: true, error: null);
                break;

            case LoadStatus.Loaded:
                ApplySnapshot(result.Value!, result.FetchedAt, stale: false, fetching: false, error: null);
                break;

            case LoadStatus.Empty:
                SetEmpty(result.FetchedAt);
                break;

            case LoadStatus.Offline:
                ApplySnapshot(result.Value!, result.FetchedAt, stale: true, fetching: false, error: result.Error, offline: true);
                break;

            default:
                SetError(result.Error);
                break;
        }
    }

    private void ApplySnapshot(
        PedalReading snapshot,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        Content = PedalUsageProjection.Project(snapshot, _localizer);

        // web parity: the component shows its empty state whenever no pedal signal is present (`!hasAny`), so a
        // snapshot with no pedal data is classified Empty (a friendly empty surface) rather than blank gauges.
        if (!snapshot.HasData)
        {
            SetEmpty(fetchedAt, keepContent: true);
            return;
        }

        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline ? PedalUsageState.Offline : stale ? PedalUsageState.Stale : PedalUsageState.Ready;
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = PedalUsageState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt, bool keepContent = false)
    {
        if (!keepContent)
        {
            Content = PedalUsageProjection.Project(PedalReading.Empty, _localizer);
        }

        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = PedalUsageState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = PedalUsageState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "dynamics.pedalError.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "dynamics.pedalError.offline",
            _ => "dynamics.pedalError",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view pedal telemetry",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached reading",
            _ => "Couldn't load pedal telemetry",
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
