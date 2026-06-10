using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="TemperatureMetricCards"/> view — the native port
/// of the web component's data composition
/// (web/src/features/driving/components/drivetrain-health/TemperatureMetricCards.tsx, which receives
/// <c>sensors</c> / <c>overallHealth</c> / <c>healthScore</c> / <c>peakPower</c> as props and reads
/// <c>useTranslation</c> + <c>useUnits</c>). It consumes the cache-then-network
/// <see cref="ITemperatureMetricCardsSource"/>, projects each snapshot through
/// <see cref="TemperatureMetricCardsProjection"/> with the active units, and exposes the mutually-exclusive
/// <see cref="State"/> plus the freshness flags so the view is a thin renderer. A snapshot is always present
/// or absent — when absent (no vehicle / empty body) the empty state renders (web
/// <c>{health ? … : &lt;EmptyState/&gt;}</c>). Drive it from one confinement (the UI thread); it is not
/// internally synchronised.
/// </summary>
public sealed class TemperatureMetricCardsViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ITemperatureMetricCardsSource _source;
    private readonly ILocalizer _localizer;

    private UnitPref _units;
    private CancellationTokenSource? _cts;
    private TemperatureMetricCardsSnapshot? _lastSnapshot;
    private bool _disposed;

    private TemperatureMetricCardsState _state = TemperatureMetricCardsState.Loading;
    private TemperatureMetricCardsDisplay _display = TemperatureMetricCardsDisplay.Empty;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer and (optional) unit preference.</summary>
    /// <param name="source">The cache-then-network drivetrain-health source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="units">The user's unit preference (web <c>useUnits</c>); defaults to metric when null.</param>
    public TemperatureMetricCardsViewModel(
        ITemperatureMetricCardsSource source,
        ILocalizer localizer,
        UnitPref? units = null)
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
    public TemperatureMetricCardsState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (the six metric tiles).</summary>
    public TemperatureMetricCardsDisplay Display
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

    /// <summary>True when a drivetrain-health snapshot is present (web <c>health</c> truthy).</summary>
    public bool HasData => _display.HasData;

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
            if (_lastSnapshot is not null)
            {
                Display = TemperatureMetricCardsProjection.Project(_lastSnapshot, _units, _localizer);
            }
        }
    }

    /// <summary>Localized surface title (used as the accessible name; the web grid itself is headerless).</summary>
    public string Title => _localizer.GetString("drivetrain.metricCards.title", "Temperature & Power");

    /// <summary>Localized empty-state message (web Drivetrain-Health page's empty gate).</summary>
    public string EmptyMessage =>
        _localizer.GetString("drivetrain.metricCards.noData", "No drivetrain health data available yet");

    /// <summary>Localized loading announcement for the skeleton live region.</summary>
    public string LoadingLabel =>
        _localizer.GetString("drivetrain.metricCards.loading", "Loading drivetrain metrics");

    /// <summary>Localized retry-button label.</summary>
    public string RetryLabel => _localizer.GetString("common.retry", "Retry");

    /// <summary>Localized error-surface title.</summary>
    public string ErrorTitle =>
        _localizer.GetString("drivetrain.metricCards.errorTitle", "Couldn't load drivetrain metrics");

    /// <summary>Localized refresh-button Narrator label.</summary>
    public string RefreshLabel =>
        _localizer.GetString("drivetrain.metricCards.refresh", "Refresh drivetrain metrics");

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
        _state is TemperatureMetricCardsState.Loaded or TemperatureMetricCardsState.Stale or TemperatureMetricCardsState.Offline;

    private void Apply(RepositoryResult<TemperatureMetricCardsSnapshot> result)
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
        TemperatureMetricCardsSnapshot snapshot,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        _lastSnapshot = snapshot;
        Display = TemperatureMetricCardsProjection.Project(snapshot, _units, _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline
            ? TemperatureMetricCardsState.Offline
            : stale ? TemperatureMetricCardsState.Stale : TemperatureMetricCardsState.Loaded;
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = TemperatureMetricCardsState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        _lastSnapshot = null;
        Display = TemperatureMetricCardsDisplay.Empty;
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = TemperatureMetricCardsState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = TemperatureMetricCardsState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "drivetrain.metricCards.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "drivetrain.metricCards.error.offline",
            _ => "drivetrain.metricCards.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view drivetrain metrics",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached drivetrain metrics",
            _ => "Couldn't load drivetrain metrics",
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
