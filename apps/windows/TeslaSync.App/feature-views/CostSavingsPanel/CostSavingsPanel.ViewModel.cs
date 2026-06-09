using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="CostSavingsPanel"/> view — the native port of the
/// web component's data composition
/// (web/src/features/driving/components/drive-detail/CostSavingsPanel.tsx, which receives a resolved
/// <c>drive</c> + computed <c>stats</c> as props and reads <c>useTranslation</c> / <c>useSettings</c> /
/// <c>useFormatting</c> / <c>useUnits</c>). It consumes the cache-then-network
/// <see cref="ICostSavingsPanelSource"/>, projects each snapshot through <see cref="CostSavingsProjection"/>
/// with the active settings + units, and exposes the mutually-exclusive <see cref="State"/> plus the freshness
/// flags so the view is a thin renderer. Reassigning <see cref="Settings"/> or <see cref="Units"/> re-projects
/// the current snapshot (the native analogue of the web hooks re-running on a settings change). Drive it from
/// one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class CostSavingsPanelViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ICostSavingsPanelSource _source;
    private readonly ILocalizer _localizer;

    private CostSavingsSettings _settings;
    private UnitPref _units;
    private CancellationTokenSource? _cts;
    private RepositoryResult<DriveCostSnapshot>? _last;
    private bool _disposed;

    private CostSavingsState _state = CostSavingsState.Loading;
    private CostSavingsDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, monetary/fuel settings and unit preference.</summary>
    /// <param name="source">The cache-then-network drive-cost source.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="settings">The monetary/fuel preferences; defaults to <see cref="CostSavingsSettings.Default"/>.</param>
    /// <param name="units">The user's display preference; defaults to <see cref="UnitPref.Metric"/>.</param>
    public CostSavingsPanelViewModel(
        ICostSavingsPanelSource source,
        ILocalizer localizer,
        CostSavingsSettings? settings = null,
        UnitPref? units = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _settings = settings ?? CostSavingsSettings.Default;
        _units = units ?? UnitPref.Metric;
        _display = CostSavingsProjection.Project(DriveCostSnapshot.Empty, _settings, _units, _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public CostSavingsState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (header title + the cost tiles).</summary>
    public CostSavingsDisplay Display
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

    /// <summary>True when a drive is being priced (loaded / stale / offline content states).</summary>
    public bool HasData =>
        _state is CostSavingsState.Loaded or CostSavingsState.Stale or CostSavingsState.Offline;

    /// <summary>Localized surface title (web header "Cost &amp; Savings").</summary>
    public string Title => _localizer.GetString("driveDetail.costSavings", "Cost & Savings");

    /// <summary>Localized empty-state message (no drive payload yet).</summary>
    public string EmptyMessage => _display.EmptyMessage;

    /// <summary>The monetary/fuel preferences; reassigning re-projects the current snapshot.</summary>
    public CostSavingsSettings Settings
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
        _state is CostSavingsState.Loaded or CostSavingsState.Stale or CostSavingsState.Offline;

    private void Apply(RepositoryResult<DriveCostSnapshot> result)
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
        DriveCostSnapshot snapshot,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        Display = CostSavingsProjection.Project(snapshot, _settings, _units, _localizer);

        if (!snapshot.HasData)
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
            ? CostSavingsState.Offline
            : stale ? CostSavingsState.Stale : CostSavingsState.Loaded;
    }

    private void Reproject()
    {
        if (_last is { } last)
        {
            Apply(last);
        }
        else
        {
            Display = CostSavingsProjection.Project(DriveCostSnapshot.Empty, _settings, _units, _localizer);
        }
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = CostSavingsState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt, bool keepDisplay = false)
    {
        if (!keepDisplay)
        {
            Display = CostSavingsProjection.Project(DriveCostSnapshot.Empty, _settings, _units, _localizer);
        }

        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = CostSavingsState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = CostSavingsState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "driveDetail.costSavings.errorAuth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "driveDetail.costSavings.errorOffline",
            _ => "driveDetail.costSavings.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view cost & savings",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached cost & savings",
            _ => "Couldn't load cost & savings",
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
