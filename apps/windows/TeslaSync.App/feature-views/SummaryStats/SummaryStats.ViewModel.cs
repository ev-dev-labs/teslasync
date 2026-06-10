using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="SummaryStats"/> view — the native port of the web
/// Driving-Dynamics summary grid
/// (web/src/features/driving/components/driving-dynamics/SummaryStats.tsx, which receives
/// <c>motorStats: MotorStats | null</c> as a prop and reads <c>useTranslation</c>; the page derives
/// <c>motorStats</c> via <c>computeMotorStats(useMotorHistory(vehicleId, 200))</c> and the temperature tile
/// formats with <c>useUnits</c>). The native surface binds its own cache-then-network
/// <see cref="IMotorSummarySource"/>, reduces each emission with <see cref="MotorStats.Compute"/>, projects the
/// result through <see cref="MotorSummaryProjection"/> with the active units, and exposes the mutually-exclusive
/// <see cref="State"/> plus the freshness flags so the view is a thin renderer. When the aggregate is absent (no
/// vehicle / no samples) the empty state renders (web <c>motorStats === null</c>). Drive it from one confinement
/// (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class SummaryStatsViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IMotorSummarySource _source;
    private readonly ILocalizer _localizer;

    private UnitPref _units;
    private CancellationTokenSource? _cts;
    private MotorStats? _lastStats;
    private bool _disposed;

    private MotorSummaryState _state = MotorSummaryState.Loading;
    private MotorSummaryDisplay _display = MotorSummaryDisplay.Empty;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer and (optional) unit preference.</summary>
    /// <param name="source">The cache-then-network motor-history source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="units">The user's unit preference (web <c>useUnits</c>); defaults to metric when null.</param>
    public SummaryStatsViewModel(IMotorSummarySource source, ILocalizer localizer, UnitPref? units = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _units = units ?? UnitPref.Metric;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public MotorSummaryState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (the six summary tiles).</summary>
    public MotorSummaryDisplay Display
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

    /// <summary>True while a background refresh is in flight (header chip pulses).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the last load failed with no cache (drives the error surface + header chip).</summary>
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

    /// <summary>True when a motor-stats aggregate is present (web <c>motorStats</c> truthy).</summary>
    public bool HasData => _display.HasData;

    /// <summary>The user's unit preference; reassigning re-projects the current aggregate in the new units.</summary>
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
            if (_lastStats is not null)
            {
                Display = MotorSummaryProjection.Project(_lastStats, _units, _localizer);
            }
        }
    }

    /// <summary>Localized surface title (web grid is headerless; used as the accessible name).</summary>
    public string Title => MotorSummaryRegistration.Name(_localizer);

    /// <summary>Localized empty-state message (web <c>motorStats === null</c> case).</summary>
    public string EmptyMessage =>
        _localizer.GetString("dynamics.summaryStats.empty", "No motor telemetry recorded yet");

    /// <summary>Localized loading announcement for the skeleton live region.</summary>
    public string LoadingLabel => _localizer.GetString("common.loading", "Loading");

    /// <summary>Localized retry-button label.</summary>
    public string RetryLabel => _localizer.GetString("common.retry", "Retry");

    /// <summary>Localized error-surface title.</summary>
    public string ErrorTitle =>
        _localizer.GetString("dynamics.summaryStats.errorTitle", "Couldn't load motor summary");

    /// <summary>Localized refresh-button Narrator label.</summary>
    public string RefreshLabel =>
        _localizer.GetString("dynamics.summaryStats.refresh", "Refresh motor summary");

    /// <summary>Localized stale freshness-chip label.</summary>
    public string StaleChip => _localizer.GetString("common.stale", "Stale");

    /// <summary>Localized offline freshness-chip label.</summary>
    public string OfflineChip => _localizer.GetString("common.offline", "Offline");

    /// <summary>
    /// Run a cache-then-network load: counts the attempt, shows the skeleton only when nothing is already
    /// visible (otherwise keeps content while refreshing), and folds every emission into <see cref="State"/>
    /// + <see cref="Display"/>. A superseding load cancels the prior one.
    /// </summary>
    /// <param name="cancellationToken">Cancels this load.</param>
    /// <returns>A task that completes when the emission stream is exhausted (or superseded).</returns>
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

    /// <summary>Retry after a failure — re-runs the load from the top (web query refetch).</summary>
    /// <returns>A task that completes when the reload finishes.</returns>
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
        _state is MotorSummaryState.Loaded or MotorSummaryState.Stale or MotorSummaryState.Offline;

    private void Apply(RepositoryResult<IReadOnlyList<MotorStatsSample>> result)
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
                ApplySamples(result.Value!, result.FetchedAt, result.IsStale, fetching: false, error: null);
                break;

            case LoadStatus.Refreshing:
                ApplySamples(result.Value!, result.FetchedAt, result.IsStale, fetching: true, error: null);
                break;

            case LoadStatus.Loaded:
                ApplySamples(result.Value!, result.FetchedAt, stale: false, fetching: false, error: null);
                break;

            case LoadStatus.Empty:
                SetEmpty(result.FetchedAt);
                break;

            case LoadStatus.Offline:
                ApplySamples(result.Value!, result.FetchedAt, stale: true, fetching: false, error: result.Error, offline: true);
                break;

            default:
                SetError(result.Error);
                break;
        }
    }

    private void ApplySamples(
        IReadOnlyList<MotorStatsSample> samples,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        var stats = MotorStats.Compute(samples);

        // Web parity: computeMotorStats returns null for an empty series → the empty state, not zeroed cards.
        if (stats is null)
        {
            SetEmpty(fetchedAt);
            return;
        }

        _lastStats = stats;
        Display = MotorSummaryProjection.Project(stats, _units, _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline
            ? MotorSummaryState.Offline
            : stale ? MotorSummaryState.Stale : MotorSummaryState.Loaded;
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = MotorSummaryState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        _lastStats = null;
        Display = MotorSummaryDisplay.Empty;
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = MotorSummaryState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = MotorSummaryState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "dynamics.summaryStats.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "dynamics.summaryStats.error.offline",
            _ => "dynamics.summaryStats.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view the motor summary",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached motor summary",
            _ => "Couldn't load the motor summary",
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
