using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="FleetStatsBar"/> view — the native port of the
/// web Fleet-stats bar (web/src/features/dashboard/components/FleetStatsBar.tsx). The web component is a pure
/// child of the dashboard widget; the native surface binds its own cache-then-network
/// <see cref="IFleetStatsBarSource"/>, projects each snapshot through <see cref="FleetStatsBarProjection"/>
/// with the active unit preference, and exposes the mutually-exclusive <see cref="State"/> plus the freshness
/// flags so the view is a thin renderer. The five stat panels always render (the web grid is never hidden):
/// the <see cref="FleetStatsBarState.Loaded"/>, <see cref="FleetStatsBarState.Stale"/>,
/// <see cref="FleetStatsBarState.Offline"/> and <see cref="FleetStatsBarState.Empty"/> states all carry a
/// populated <see cref="Display"/> (the panels fall back to zeroed values, the web <c>?? 0</c>). Drive it from
/// one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class FleetStatsBarViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IFleetStatsBarSource _source;
    private readonly ILocalizer _localizer;

    private UnitPref _units;
    private CancellationTokenSource? _cts;
    private RepositoryResult<FleetStatsBarData>? _last;
    private bool _disposed;

    private FleetStatsBarState _state = FleetStatsBarState.Loading;
    private FleetStatsBarDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer and (optional) unit preference.</summary>
    /// <param name="source">The cache-then-network fleet-stats source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="units">The user's display-unit preference (web <c>useUnits().unitPrefs</c>); null = metric.</param>
    public FleetStatsBarViewModel(IFleetStatsBarSource source, ILocalizer localizer, UnitPref? units = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _units = units ?? UnitPref.Metric;
        _display = FleetStatsBarDisplay.Empty(_units, _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public FleetStatsBarState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (the five stat panels + surface label).</summary>
    public FleetStatsBarDisplay Display
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

    /// <summary>True when real fleet data backed the figures (web — a vehicle / non-zero rollup exists).</summary>
    public bool HasData => _display.HasData;

    /// <summary>Localized surface title.</summary>
    public string Title => FleetStatsBarRegistration.Name(_localizer);

    /// <summary>The display-unit preference; reassigning re-projects the current snapshot at the new units.</summary>
    public UnitPref Units
    {
        get => _units;
        set
        {
            UnitPref resolved = value ?? UnitPref.Metric;
            if (_units == resolved)
            {
                return;
            }

            _units = resolved;
            Raise(nameof(Units));
            Reproject();
        }
    }

    /// <summary>
    /// Run a cache-then-network load: counts the attempt, shows the panel skeletons only when nothing is
    /// already visible (otherwise keeps content while refreshing), and folds every emission into
    /// <see cref="State"/> + <see cref="Display"/>. A superseding load cancels the prior one.
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
        _state is FleetStatsBarState.Loaded
            or FleetStatsBarState.Stale
            or FleetStatsBarState.Offline
            or FleetStatsBarState.Empty;

    private void Apply(RepositoryResult<FleetStatsBarData> result)
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
        FleetStatsBarData data,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        Display = FleetStatsBarProjection.Project(data, _units, _localizer);

        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;

        // The five panels always render; freshness wins over emptiness so the stale/offline chip survives an
        // empty snapshot, while a fresh empty snapshot is classified Empty (the panels render zeroed, web parity).
        State = offline
            ? FleetStatsBarState.Offline
            : stale
                ? FleetStatsBarState.Stale
                : data.HasData
                    ? FleetStatsBarState.Loaded
                    : FleetStatsBarState.Empty;
    }

    private void Reproject()
    {
        if (_last is { } last && last.HasValue)
        {
            Apply(last);
        }
        else
        {
            Display = FleetStatsBarDisplay.Empty(_units, _localizer);
        }
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = FleetStatsBarState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = FleetStatsBarDisplay.Empty(_units, _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = FleetStatsBarState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = FleetStatsBarState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "dashboard.fleet.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "dashboard.fleet.error.offline",
            _ => "dashboard.fleet.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view fleet stats",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached fleet stats",
            _ => "Couldn't load fleet stats",
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
