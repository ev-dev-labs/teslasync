using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Analytics;

/// <summary>
/// The data port the <see cref="HeroGaugesViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of parsed fleet-analytics snapshots for <c>GET /analytics/fleet</c> — the
/// native analogue of the analytics page hook that feeds the web <c>HeroGauges</c> its <c>data</c> prop.
/// The view never performs HTTP itself; the concrete <see cref="HeroGaugesSource"/> (or a test fake)
/// drives this.
/// </summary>
public interface IHeroGaugesSource
{
    /// <summary>Stream the cache-then-network analytics snapshots, newest cache first.</summary>
    /// <param name="cancellationToken">Cancels the in-flight read when a newer load supersedes it.</param>
    /// <returns>The ordered cache-then-network emissions for one logical read.</returns>
    IAsyncEnumerable<RepositoryResult<HeroFleetAnalytics>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Canonical metadata for the Hero Gauges surface. The diagnostics <see cref="Slug"/> is the stable
/// surface identifier emitted with the <c>view.opened</c> event, and <see cref="DefaultDays"/> mirrors
/// the trailing window the web analytics page requests for <c>GET /analytics/fleet</c>.
/// </summary>
public static class HeroGaugesRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "HeroGauges";

    /// <summary>The trailing window the surface requests, mirroring the web analytics default.</summary>
    public const int DefaultDays = 30;
}

/// <summary>
/// PII-safe diagnostics for the Hero Gauges surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a fleet metric, VIN or location —
/// so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class HeroGaugesDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink each diagnostics line is written to, or <see langword="null"/>.</param>
    public HeroGaugesDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=HeroGauges</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={HeroGaugesRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="HeroGauges"/> view — the native port of the
/// data composition that feeds the web <c>HeroGauges</c>
/// (web/src/features/analytics/components/analytics/HeroGauges.tsx). It consumes the cache-then-network
/// <see cref="IHeroGaugesSource"/>, projects each snapshot through <see cref="HeroGaugesProjection"/>
/// with the active units + currency, and exposes the mutually-exclusive <see cref="State"/> plus the
/// header freshness flags so the view is a thin renderer. Drive it from one confinement (the UI thread);
/// it is not internally synchronised.
/// </summary>
public sealed class HeroGaugesViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IHeroGaugesSource _source;
    private readonly ILocalizer _localizer;

    private UnitPref _units;
    private string _currencySymbol;
    private CancellationTokenSource? _cts;
    private RepositoryResult<HeroFleetAnalytics>? _last;
    private bool _disposed;

    private HeroGaugesState _state = HeroGaugesState.Loading;
    private HeroGaugesDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, units and currency.</summary>
    /// <param name="source">The cache-then-network data port.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="units">The user's unit preference, or <see langword="null"/> for metric.</param>
    /// <param name="currencySymbol">The currency symbol for the gas-savings tile, or <see langword="null"/> for "$".</param>
    public HeroGaugesViewModel(
        IHeroGaugesSource source,
        ILocalizer localizer,
        UnitPref? units = null,
        string? currencySymbol = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _units = units ?? UnitPref.Metric;
        _currencySymbol = string.IsNullOrWhiteSpace(currencySymbol) ? "$" : currencySymbol;
        _display = HeroGaugesProjection.Project(HeroFleetAnalytics.Empty, _units, _currencySymbol, _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public HeroGaugesState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (the six gauges).</summary>
    public HeroGaugesDisplay Display
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

    /// <summary>True when the last load failed (drives the error surface + header chip).</summary>
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

    /// <summary>True when the snapshot has data to render (web <c>data</c> present with content).</summary>
    public bool HasData => _display.HasData;

    /// <summary>Localized accessible name for the whole surface (Narrator).</summary>
    public string SurfaceName => _localizer.GetString("analytics.hero.surfaceName", "Fleet analytics overview");

    /// <summary>Localized empty-state message.</summary>
    public string EmptyMessage => _localizer.GetString("analytics.hero.empty", "No analytics yet");

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

    /// <summary>The currency symbol used for the gas-savings tile; reassigning re-projects.</summary>
    public string CurrencySymbol
    {
        get => _currencySymbol;
        set
        {
            string resolved = string.IsNullOrWhiteSpace(value) ? "$" : value;
            if (_currencySymbol == resolved)
            {
                return;
            }

            _currencySymbol = resolved;
            Raise(nameof(CurrencySymbol));
            Reproject();
        }
    }

    /// <summary>
    /// Run a cache-then-network load: counts the attempt, shows the skeleton only when nothing is already
    /// visible (otherwise keeps content while refreshing), and folds every emission into
    /// <see cref="State"/> + <see cref="Display"/>. A superseding load cancels the prior one.
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
        _state is HeroGaugesState.Loaded or HeroGaugesState.Stale or HeroGaugesState.Offline;

    private void Apply(RepositoryResult<HeroFleetAnalytics> result)
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
        HeroFleetAnalytics snapshot,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        Display = HeroGaugesProjection.Project(snapshot, _units, _currencySymbol, _localizer);

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
        State = offline ? HeroGaugesState.Offline : stale ? HeroGaugesState.Stale : HeroGaugesState.Loaded;
    }

    private void Reproject()
    {
        if (_last is { HasValue: true } last)
        {
            Apply(last);
        }
        else
        {
            Display = HeroGaugesProjection.Project(HeroFleetAnalytics.Empty, _units, _currencySymbol, _localizer);
        }
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = HeroGaugesState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt, bool keepDisplay = false)
    {
        if (!keepDisplay)
        {
            Display = HeroGaugesProjection.Project(HeroFleetAnalytics.Empty, _units, _currencySymbol, _localizer);
        }

        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = HeroGaugesState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = HeroGaugesState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "analytics.hero.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "analytics.hero.error.offline",
            _ => "analytics.hero.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view analytics",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached analytics",
            _ => "Couldn't load analytics",
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
