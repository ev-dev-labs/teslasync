using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="HealthProbesSection"/> view — the native port of
/// the web component's data composition
/// (web/src/features/system/components/status/HealthProbesSection.tsx, which reads a single polled
/// <c>useQuery(getExtendedHealth)</c> plus <c>useTranslation</c>). It consumes the cache-then-network
/// <see cref="IHealthProbesSectionSource"/>, projects each snapshot through <see cref="HealthProbesProjection"/>,
/// and exposes the mutually-exclusive <see cref="State"/> plus the freshness flags so the view is a thin
/// renderer. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class HealthProbesSectionViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IHealthProbesSectionSource _source;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;

    private CancellationTokenSource? _cts;
    private RepositoryResult<HealthProbesSnapshot>? _last;
    private bool _disposed;

    private HealthProbesState _state = HealthProbesState.Loading;
    private HealthProbesDisplay _display;
    private bool _hasData;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer and (optional) clock.</summary>
    /// <param name="source">The cache-then-network system-health source.</param>
    /// <param name="localizer">The i18n facade resolving every owned string.</param>
    /// <param name="clock">The wall clock (overridable in tests); defaults to <see cref="DateTimeOffset.Now"/>.</param>
    public HealthProbesSectionViewModel(
        IHealthProbesSectionSource source,
        ILocalizer localizer,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _display = HealthProbesProjection.Project(HealthProbesSnapshot.Empty, _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public HealthProbesState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (the two probe cards plus the header badges).</summary>
    public HealthProbesDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
        }
    }

    /// <summary>True when the current snapshot carries a system-health body (drives the empty branch).</summary>
    public bool HasData
    {
        get => _hasData;
        private set => Set(ref _hasData, value);
    }

    /// <summary>Last successful update timestamp surfaced in the freshness chip.</summary>
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

    /// <summary>True when the last load failed with no cache (drives the error surface + freshness chip).</summary>
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

    /// <summary>Localized section title (web <c>t('Health Probes')</c> — the AccordionSection title).</summary>
    public string Title => _localizer.GetString("Health Probes", "Health Probes");

    /// <summary>Localized section description (web <c>t('Liveness and readiness checks')</c>).</summary>
    public string Description =>
        _localizer.GetString("Liveness and readiness checks", "Liveness and readiness checks");

    /// <summary>Localized empty-state message (native-superset: the web has no empty branch).</summary>
    public string EmptyMessage =>
        _localizer.GetString("healthProbes.empty", "No system health data available");

    /// <summary>Localized loading announcement (native-superset).</summary>
    public string LoadingLabel =>
        _localizer.GetString("healthProbes.loading", "Loading health probes");

    /// <summary>Localized retry affordance label.</summary>
    public string RetryLabel => _localizer.GetString("common.retry", "Retry");

    /// <summary>The diagnostics surface slug (<c>HealthProbesSection</c>).</summary>
    public static string Slug => HealthProbesSectionRegistration.Slug;

    /// <summary>
    /// Run a cache-then-network load: counts the attempt, shows the skeleton only when nothing is already
    /// visible (otherwise keeps content while refreshing), and folds every emission into <see cref="State"/>
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
        _state is HealthProbesState.Loaded or HealthProbesState.Stale or HealthProbesState.Offline;

    private void Apply(RepositoryResult<HealthProbesSnapshot> result)
    {
        _last = result;
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
        HealthProbesSnapshot snapshot,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        Display = HealthProbesProjection.Project(snapshot, _localizer);

        if (!snapshot.HasData)
        {
            SetEmpty(fetchedAt, keepDisplay: true);
            return;
        }

        HasData = true;
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline
            ? HealthProbesState.Offline
            : stale ? HealthProbesState.Stale : HealthProbesState.Loaded;
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = HealthProbesState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt, bool keepDisplay = false)
    {
        if (!keepDisplay)
        {
            Display = HealthProbesProjection.Project(HealthProbesSnapshot.Empty, _localizer);
        }

        HasData = false;
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = HealthProbesState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        HasData = false;
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = HealthProbesState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "healthProbes.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "healthProbes.error.offline",
            _ => "healthProbes.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view system health",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network =>
                "You're offline — showing the last cached system health",
            _ => "Couldn't load health probes",
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
