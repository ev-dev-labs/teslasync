using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="CostSummaryCards"/> view — the native port of
/// the web component's data composition
/// (web/src/features/charging/components/cost-analysis/CostSummaryCards.tsx, which receives <c>coreStats</c>
/// as a prop and reads <c>useTranslation</c> + <c>useFormatting</c> + <c>useSettings</c>). It consumes the
/// cache-then-network <see cref="ICostSummaryCardsSource"/>, aggregates each snapshot through
/// <see cref="CostSummaryCoreStats.Compute"/> and projects it through <see cref="CostSummaryCardsProjection"/>
/// with the active units, currency and gas settings, and exposes the mutually-exclusive <see cref="State"/>
/// plus the freshness flags so the view is a thin renderer. A snapshot with no sessions renders the empty
/// state (web cost-analysis page's empty gate). Drive it from one confinement (the UI thread); it is not
/// internally synchronised.
/// </summary>
public sealed class CostSummaryCardsViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ICostSummaryCardsSource _source;
    private readonly ILocalizer _localizer;

    private UnitPref _units;
    private CostSummaryCardsSettings _settings;
    private CancellationTokenSource? _cts;
    private RepositoryResult<IReadOnlyList<CostSummaryCardsSession>>? _last;
    private bool _disposed;

    private CostSummaryCardsState _state = CostSummaryCardsState.Loading;
    private CostSummaryCardsDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, units and currency/gas settings.</summary>
    public CostSummaryCardsViewModel(
        ICostSummaryCardsSource source,
        ILocalizer localizer,
        UnitPref? units = null,
        CostSummaryCardsSettings? settings = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _units = units ?? UnitPref.Metric;
        _settings = settings ?? CostSummaryCardsSettings.Default;
        _display = BuildDisplay(Array.Empty<CostSummaryCardsSession>());
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public CostSummaryCardsState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (the six metric tiles).</summary>
    public CostSummaryCardsDisplay Display
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

    /// <summary>True when the snapshot has at least one session to summarise (web <c>coreStats</c> non-null).</summary>
    public bool HasData => _display.HasData;

    /// <summary>Localized surface title (used as the accessible name; the web grid itself is headerless).</summary>
    public string Title => _localizer.GetString("costAnalysis.summary.title", "Cost Summary");

    /// <summary>Localized empty-state message (no charging data yet).</summary>
    public string EmptyMessage =>
        _localizer.GetString("costAnalysis.summary.noData", "No cost data yet");

    /// <summary>Localized loading announcement.</summary>
    public string LoadingLabel =>
        _localizer.GetString("costAnalysis.summary.loading", "Loading cost summary");

    /// <summary>Localized retry affordance label.</summary>
    public string RetryLabel => _localizer.GetString("costAnalysis.summary.retry", "Retry");

    /// <summary>The user's unit preference; reassigning re-projects the current snapshot in the new units.</summary>
    public UnitPref Units
    {
        get => _units;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            if (_units == value)
            {
                return;
            }

            _units = value;
            Raise(nameof(Units));
            Reproject();
        }
    }

    /// <summary>The currency/gas preferences; reassigning re-projects (symbol, gas price, gas unit).</summary>
    public CostSummaryCardsSettings Settings
    {
        get => _settings;
        set
        {
            ArgumentNullException.ThrowIfNull(value);
            if (_settings == value)
            {
                return;
            }

            _settings = value;
            Raise(nameof(Settings));
            Reproject();
        }
    }

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
        _state is CostSummaryCardsState.Loaded or CostSummaryCardsState.Stale or CostSummaryCardsState.Offline;

    private void Apply(RepositoryResult<IReadOnlyList<CostSummaryCardsSession>> result)
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
        IReadOnlyList<CostSummaryCardsSession> sessions,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        var display = BuildDisplay(sessions);
        Display = display;

        if (!display.HasData)
        {
            SetEmpty(fetchedAt, keepDisplay: true);
            return;
        }

        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline
            ? CostSummaryCardsState.Offline
            : stale ? CostSummaryCardsState.Stale : CostSummaryCardsState.Loaded;
    }

    private void Reproject()
    {
        if (_last is { HasValue: true } last)
        {
            Apply(last);
        }
        else
        {
            Display = BuildDisplay(Array.Empty<CostSummaryCardsSession>());
        }
    }

    private CostSummaryCardsDisplay BuildDisplay(IReadOnlyList<CostSummaryCardsSession> sessions)
    {
        var stats = CostSummaryCoreStats.Compute(sessions, _settings, _units);
        return CostSummaryCardsProjection.Project(stats, _settings, _units, _localizer);
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = CostSummaryCardsState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt, bool keepDisplay = false)
    {
        if (!keepDisplay)
        {
            Display = BuildDisplay(Array.Empty<CostSummaryCardsSession>());
        }

        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = CostSummaryCardsState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = CostSummaryCardsState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "costAnalysis.summary.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "costAnalysis.summary.error.offline",
            _ => "costAnalysis.summary.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view cost summary",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached cost summary",
            _ => "Couldn't load cost summary",
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
