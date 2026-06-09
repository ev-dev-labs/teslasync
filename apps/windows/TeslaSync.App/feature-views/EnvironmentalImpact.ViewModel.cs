using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="EnvironmentalImpact"/> view — the native port of
/// the web Environmental-Impact card
/// (web/src/features/charging/components/cost-analysis/EnvironmentalImpact.tsx). The web component is a pure
/// child of the Cost-Analysis page (it takes a pre-computed <c>coreStats</c>); the native surface binds its own
/// cache-then-network <see cref="IEnvironmentalImpactSource"/>, projects each snapshot through
/// <see cref="EnvironmentalImpactProjection"/> (which computes the environmental statistics), and exposes the
/// mutually-exclusive <see cref="State"/> plus the freshness flags so the view is a thin renderer. The card
/// content (green tiles, sentence, sub-stats) always renders for the <see cref="EnvironmentalImpactState.Loaded"/>,
/// <see cref="EnvironmentalImpactState.Stale"/> and <see cref="EnvironmentalImpactState.Offline"/> states; a
/// friendly empty surface covers <see cref="EnvironmentalImpactState.Empty"/> (web parity — no sessions, so
/// <c>coreStats</c> is null). Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class EnvironmentalImpactViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IEnvironmentalImpactSource _source;
    private readonly ILocalizer _localizer;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private EnvironmentalImpactState _state = EnvironmentalImpactState.Loading;
    private EnvironmentalImpactDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source and localizer.</summary>
    public EnvironmentalImpactViewModel(IEnvironmentalImpactSource source, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _display = EnvironmentalImpactDisplay.Empty(_localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public EnvironmentalImpactState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (the tiles, sentence and sub-stats).</summary>
    public EnvironmentalImpactDisplay Display
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

    /// <summary>True when the projection produced environmental statistics (web <c>coreStats</c> non-null).</summary>
    public bool HasData => _display.HasData;

    /// <summary>Localized surface title.</summary>
    public string Title => EnvironmentalImpactRegistration.Name(_localizer);

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
        _state is EnvironmentalImpactState.Loaded
            or EnvironmentalImpactState.Stale
            or EnvironmentalImpactState.Offline
            or EnvironmentalImpactState.Empty;

    private void Apply(RepositoryResult<IReadOnlyList<EnvironmentalImpactSession>> result)
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
        IReadOnlyList<EnvironmentalImpactSession> data,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        var display = EnvironmentalImpactProjection.Project(data, _localizer);
        Display = display;

        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;

        // Freshness wins over emptiness so the stale/offline chip survives an empty snapshot, while a fresh
        // snapshot with no sessions is classified Empty (web parity — the friendly "No data" surface).
        State = offline
            ? EnvironmentalImpactState.Offline
            : stale
                ? EnvironmentalImpactState.Stale
                : display.HasData
                    ? EnvironmentalImpactState.Loaded
                    : EnvironmentalImpactState.Empty;
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = EnvironmentalImpactState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = EnvironmentalImpactDisplay.Empty(_localizer);
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = EnvironmentalImpactState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = EnvironmentalImpactState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        return error?.Kind switch
        {
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => _localizer.GetString(
                "costAnalysis.environment.offline",
                "You're offline — showing the last cached environmental impact"),
            _ => _localizer.GetString(
                "costAnalysis.environment.error", "Couldn't load environmental impact"),
        };
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
