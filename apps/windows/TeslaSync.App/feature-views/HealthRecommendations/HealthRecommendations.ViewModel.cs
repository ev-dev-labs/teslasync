using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="HealthRecommendations"/> view — the native port
/// of the web component's data composition
/// (web/src/features/driving/components/drivetrain-health/HealthRecommendations.tsx, which receives
/// <c>overallHealth</c> as a prop and reads <c>useTranslation</c>). It consumes the cache-then-network
/// <see cref="IHealthRecommendationsSource"/>, projects each snapshot through
/// <see cref="HealthRecommendationsProjection"/>, and exposes the mutually-exclusive <see cref="State"/> plus
/// the freshness flags so the view is a thin renderer. Drive it from one confinement (the UI thread); it is
/// not internally synchronised.
/// </summary>
public sealed class HealthRecommendationsViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IHealthRecommendationsSource _source;
    private readonly ILocalizer _localizer;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private HealthRecommendationsState _state = HealthRecommendationsState.Loading;
    private HealthRecommendationsDisplay _display = HealthRecommendationsDisplay.Empty;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source and localizer.</summary>
    /// <param name="source">The cache-then-network drivetrain-health source.</param>
    /// <param name="localizer">The i18n facade used for every label.</param>
    public HealthRecommendationsViewModel(
        IHealthRecommendationsSource source,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public HealthRecommendationsState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (the ordered recommendation rows).</summary>
    public HealthRecommendationsDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasData));
        }
    }

    /// <summary>Last successful update timestamp surfaced in the freshness chip.</summary>
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

    /// <summary>True when the last load failed (drives the error surface + freshness chip).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown snapshot is older than the freshness window.</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>Localized error message shown in the error / offline surface.</summary>
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

    /// <summary>True when the snapshot carries a health level with recommendations to render.</summary>
    public bool HasData => _display.HasData;

    /// <summary>Localized surface header / accessible name (web <c>drivetrain.recommendations</c>).</summary>
    public string Title =>
        _localizer.GetString(HealthRecommendationsProjection.TitleKey, HealthRecommendationsProjection.TitleFallback);

    /// <summary>Localized empty-state message (no drivetrain-health data yet).</summary>
    public string EmptyMessage =>
        _localizer.GetString("drivetrain.noData", "No drivetrain health data available yet");

    /// <summary>Localized loading announcement.</summary>
    public string LoadingLabel =>
        _localizer.GetString("drivetrain.recommendations.loading", "Loading health recommendations");

    /// <summary>Localized retry affordance label.</summary>
    public string RetryLabel => _localizer.GetString("drivetrain.recommendations.retry", "Retry");

    /// <summary>
    /// Run a cache-then-network load: counts the attempt, shows the skeleton only when nothing is already
    /// visible (otherwise keeps content while refreshing), and folds every emission into <see cref="State"/>
    /// + <see cref="Display"/>. A superseding load cancels the prior one.
    /// </summary>
    /// <param name="cancellationToken">Cancels the load.</param>
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
    /// <returns>A task that completes when the retry load finishes.</returns>
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
        _state is HealthRecommendationsState.Loaded or HealthRecommendationsState.Stale or HealthRecommendationsState.Offline;

    private void Apply(RepositoryResult<DrivetrainHealthSnapshot> result)
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
        DrivetrainHealthSnapshot snapshot,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        if (!snapshot.HasData)
        {
            SetEmpty(fetchedAt);
            return;
        }

        Display = HealthRecommendationsProjection.Project(snapshot, _localizer);

        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline
            ? HealthRecommendationsState.Offline
            : stale ? HealthRecommendationsState.Stale : HealthRecommendationsState.Loaded;
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = HealthRecommendationsState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = HealthRecommendationsDisplay.Empty;
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = HealthRecommendationsState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = HealthRecommendationsState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "drivetrain.recommendations.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "drivetrain.recommendations.error.offline",
            _ => "drivetrain.recommendations.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view health recommendations",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached recommendations",
            _ => "Couldn't load health recommendations",
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
