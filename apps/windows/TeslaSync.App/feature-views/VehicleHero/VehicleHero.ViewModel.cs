using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="VehicleHero"/> view — the native port of the data
/// composition that feeds the web <c>VehicleHero</c>
/// (web/src/features/dashboard/components/VehicleHero.tsx). The web component is a pure child of the dashboard
/// widget; the native surface binds its own cache-then-network <see cref="IVehicleHeroSource"/>, projects each
/// snapshot through <see cref="VehicleHeroProjection"/> with the active unit preference, and exposes the
/// mutually-exclusive <see cref="State"/> plus the freshness flags so the view is a thin renderer. Drive it
/// from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class VehicleHeroViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IVehicleHeroSource _source;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _now;

    private UnitPref _units;
    private CancellationTokenSource? _cts;
    private RepositoryResult<VehicleHeroData>? _last;
    private bool _disposed;

    private VehicleHeroState _state = VehicleHeroState.Loading;
    private VehicleHeroDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, unit preference and clock.</summary>
    /// <param name="source">The cache-then-network hero source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="units">The user's display-unit preference (web <c>useUnits().unitPrefs</c>); null = metric.</param>
    /// <param name="now">The clock used for the charging "done at" projection; null uses the system clock.</param>
    public VehicleHeroViewModel(
        IVehicleHeroSource source,
        ILocalizer localizer,
        UnitPref? units = null,
        Func<DateTimeOffset>? now = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _units = units ?? UnitPref.Metric;
        _now = now ?? (static () => DateTimeOffset.Now);
        _display = VehicleHeroDisplay.Empty(_localizer, _now());
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public VehicleHeroState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (the header, gauges, stats and actions).</summary>
    public VehicleHeroDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(IsAwake));
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

    /// <summary>True when the resolved vehicle reported live state (render the hero vs the asleep panel).</summary>
    public bool IsAwake => _display.IsAwake;

    /// <summary>Localized surface title.</summary>
    public string Title => VehicleHeroRegistration.Name(_localizer);

    /// <summary>Localized "no vehicle" empty-state message.</summary>
    public string EmptyMessage => _localizer.GetString("hero.noVehicle", "No vehicle data");

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
    /// Run a cache-then-network load: counts the attempt, shows the skeleton only when nothing is already
    /// visible (otherwise keeps content while refreshing), and folds every emission into <see cref="State"/> +
    /// <see cref="Display"/>. A superseding load cancels the prior one.
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
        _state is VehicleHeroState.Loaded
            or VehicleHeroState.Stale
            or VehicleHeroState.Offline
            or VehicleHeroState.Empty;

    private void Apply(RepositoryResult<VehicleHeroData> result)
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
        VehicleHeroData data,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        // A resolved vehicle always renders (the hero or the asleep panel); only a vehicle-less snapshot is
        // classified Empty (via the engine's isEmpty predicate, surfaced as LoadStatus.Empty).
        if (!data.HasVehicle)
        {
            SetEmpty(fetchedAt);
            return;
        }

        Display = VehicleHeroProjection.Project(data, _units, _now(), _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline
            ? VehicleHeroState.Offline
            : stale
                ? VehicleHeroState.Stale
                : VehicleHeroState.Loaded;
    }

    private void Reproject()
    {
        if (_last is { } last && last.HasValue && last.Value!.HasVehicle)
        {
            Apply(last);
        }
        else
        {
            Display = VehicleHeroDisplay.Empty(_localizer, _now());
        }
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = VehicleHeroState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = VehicleHeroDisplay.Empty(_localizer, _now());
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = VehicleHeroState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = VehicleHeroState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "hero.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "hero.error.offline",
            _ => "hero.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view this vehicle",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached vehicle",
            _ => "Couldn't load this vehicle",
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
