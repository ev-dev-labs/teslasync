using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="InfrastructureSection"/> view — the native port of
/// the web component's data composition
/// (web/src/features/system/components/status/InfrastructureSection.tsx, which reads <c>getTelemetryStatus</c> +
/// <c>getExtendedHealth</c> plus <c>useTranslation</c>). It consumes the cache-then-network
/// <see cref="IInfrastructureSectionSource"/>, projects each snapshot through
/// <see cref="InfrastructureProjection"/>, and exposes the mutually-exclusive <see cref="State"/> plus the
/// freshness flags so the view is a thin renderer. The web always renders the two diagnostic cards (em-dash for
/// any absent field), so the empty state shows the disconnected em-dash cards rather than a blank surface —
/// never a hidden panel. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class InfrastructureSectionViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IInfrastructureSectionSource _source;
    private readonly ILocalizer _localizer;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private InfrastructureState _state = InfrastructureState.Loading;
    private InfrastructureDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private bool _isOffline;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source and localizer.</summary>
    /// <param name="source">The cache-then-network data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public InfrastructureSectionViewModel(IInfrastructureSectionSource source, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _display = InfrastructureProjection.Project(InfrastructureSnapshot.Empty, _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    // ── State ─────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>The current mutually-exclusive surface state.</summary>
    public InfrastructureState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (the two cards plus the optional metric row).</summary>
    public InfrastructureDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasMetrics));
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

    /// <summary>True when the network failed but a cached snapshot is still being shown.</summary>
    public bool IsOffline
    {
        get => _isOffline;
        private set => Set(ref _isOffline, value);
    }

    /// <summary>Localized error message shown in the error/offline surfaces.</summary>
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

    /// <summary>True when a database-pool metric row is available (web <c>extHealth?.database_pool</c>).</summary>
    public bool HasMetrics => _display.Metrics is not null;

    // ── Localized copy (web t(...) keys + native-superset chrome) ───────────────────────────────────────

    /// <summary>The section title shown in the accordion header (web <c>t('Infrastructure')</c>).</summary>
    public string Title => _localizer.GetString("infrastructure.title", "Infrastructure");

    /// <summary>The muted accordion sub-line.</summary>
    public string Description =>
        _localizer.GetString("infrastructure.description", "SSE connections and polling engine diagnostics");

    /// <summary>The "SSE Connection" card title (web <c>t('SSE Connection')</c>).</summary>
    public string SseConnectionTitle => _localizer.GetString("infrastructure.sseConnection", "SSE Connection");

    /// <summary>The "Polling Engine" card title (web <c>t('Polling Engine')</c>).</summary>
    public string PollingEngineTitle => _localizer.GetString("infrastructure.pollingEngine", "Polling Engine");

    /// <summary>Localized loading announcement (native-superset state).</summary>
    public string LoadingLabel =>
        _localizer.GetString("infrastructure.loading", "Loading infrastructure diagnostics");

    /// <summary>Localized retry affordance label.</summary>
    public string RetryLabel => _localizer.GetString("common.retry", "Retry");

    /// <summary>A polite Narrator announcement for the current state (null when nothing to announce).</summary>
    public string? StatusAnnouncement => _state switch
    {
        InfrastructureState.Loading => LoadingLabel,
        InfrastructureState.Stale => _localizer.GetString("infrastructure.stale", "Showing cached infrastructure diagnostics"),
        InfrastructureState.Offline => _errorMessage,
        InfrastructureState.Error => _errorMessage,
        _ => null,
    };

    // ── Commands ──────────────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Run a cache-then-network load: counts the attempt, shows the skeleton only when nothing is already
    /// visible (otherwise keeps content while refreshing), and folds every emission into <see cref="State"/> +
    /// <see cref="Display"/>. A superseding load cancels the prior one.
    /// </summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = Supersede(ref _cts, cancellationToken);
        Attempts++;

        if (!HasContent())
        {
            SetLoading();
        }
        else
        {
            IsFetching = true;
        }

        Raise(nameof(StatusAnnouncement));

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

    /// <summary>Retry after a failure — re-runs the load from the top (web <c>QueryError</c> retry → refetch).</summary>
    public Task RetryAsync(CancellationToken cancellationToken = default) => LoadAsync(cancellationToken);

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        Cancel(ref _cts);
        GC.SuppressFinalize(this);
    }

    // ── Internals ─────────────────────────────────────────────────────────────────────────────────────

    private void Apply(RepositoryResult<InfrastructureSnapshot> result)
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

        Raise(nameof(StatusAnnouncement));
    }

    private void ApplySnapshot(
        InfrastructureSnapshot snapshot,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        // Web parity: the two diagnostic cards always render (em-dash for any absent field), so a loaded body —
        // even one with the connection disabled — is the Ready surface, not an empty one.
        Display = InfrastructureProjection.Project(snapshot, _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsOffline = offline;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline
            ? InfrastructureState.Offline
            : stale ? InfrastructureState.Stale : InfrastructureState.Ready;
    }

    private void SetLoading()
    {
        IsFetching = true;
        IsError = false;
        IsOffline = false;
        IsStale = false;
        ErrorMessage = null;
        State = InfrastructureState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        // Render the disconnected em-dash cards (web parity: the cards show with em-dash / "Disconnected"),
        // never a blank panel.
        Display = InfrastructureProjection.Project(InfrastructureSnapshot.Empty, _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsOffline = false;
        IsError = false;
        ErrorMessage = null;
        State = InfrastructureState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsOffline = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = InfrastructureState.Error;
    }

    private bool HasContent() =>
        _state is InfrastructureState.Ready or InfrastructureState.Stale
            or InfrastructureState.Offline or InfrastructureState.Empty;

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "infrastructure.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "infrastructure.error.offline",
            _ => "infrastructure.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view infrastructure diagnostics",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network =>
                "You're offline \u2014 showing the last cached infrastructure diagnostics",
            _ => "Couldn't load infrastructure diagnostics",
        };

        return _localizer.GetString(key, fallback);
    }

    private static CancellationTokenSource Supersede(ref CancellationTokenSource? slot, CancellationToken cancellationToken)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref slot, cts);
        previous?.Cancel();
        previous?.Dispose();
        return cts;
    }

    private static void Cancel(ref CancellationTokenSource? slot)
    {
        var cts = Interlocked.Exchange(ref slot, null);
        cts?.Cancel();
        cts?.Dispose();
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
