using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// Canonical registry metadata for the Energy Stats surface — the native mirror of the web registry entry in
/// web/src/features/dashboard/widgets/registry/energy.ts. The dashboard grid system binds this surface with
/// the same <see cref="Id"/> and honours the same size constraints.
/// </summary>
public static class EnergyStatsRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "energy-stats";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "energy";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "EnergyStatsWidget";

    /// <summary>Default footprint: 2 columns × 4 rows.</summary>
    public static EnergyStatsSize DefaultSize => new(2, 4);

    /// <summary>Minimum footprint: 1 column × 2 rows.</summary>
    public static EnergyStatsSize MinSize => new(1, 2);

    /// <summary>Maximum footprint: 4 columns × 40 rows.</summary>
    public static EnergyStatsSize MaxSize => new(4, 40);

    /// <summary>Localized registry display name (web registry "Energy Stats").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.energyStats.title", "Energy Stats");
    }

    /// <summary>Localized description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "widget.energyStats.description",
            "Energy overview: daily usage chart, total used/charged, efficiency, CO\u2082 saved");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(EnergyStatsSize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static EnergyStatsSize Clamp(EnergyStatsSize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Energy Stats surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never an energy value, cost, VIN or vehicle
/// id — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class EnergyStatsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public EnergyStatsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=EnergyStatsWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={EnergyStatsRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="EnergyStatsWidget"/> view — the native port of
/// the web <c>EnergyStatsWidget</c>'s hook composition
/// (web/src/features/dashboard/widgets/EnergyStatsWidget.tsx). It consumes the cache-then-network
/// <see cref="IEnergyStatsSource"/>, projects each emission through <see cref="EnergyStatsProjection"/> in the
/// user's units, applies the web <c>hasData = !!data</c> gate (an absent summary renders the friendly empty
/// state), and exposes the mutually-exclusive <see cref="State"/> plus the header freshness flags so the view
/// is a thin renderer. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class EnergyStatsViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IEnergyStatsSource _source;
    private readonly ILocalizer _localizer;

    private EnergyStatsSize _size;
    private UnitPref _units;
    private CancellationTokenSource? _cts;
    private RepositoryResult<EnergyStatsData>? _last;
    private bool _disposed;

    private EnergyStatsState _state = EnergyStatsState.Loading;
    private EnergyStatsDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, footprint and units.</summary>
    public EnergyStatsViewModel(
        IEnergyStatsSource source,
        ILocalizer localizer,
        EnergyStatsSize size,
        UnitPref? units = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _size = size;
        _units = units ?? UnitPref.Metric;
        _display = EnergyStatsProjection.Project(null, _size, _units, _localizer);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public EnergyStatsState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (compact number + stats + daily points).</summary>
    public EnergyStatsDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
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

    /// <summary>Localized widget title shown in the header (web <c>widget.energyStats.title</c>).</summary>
    public string Title => _localizer.GetString("widget.energyStats.title", "Energy Stats");

    /// <summary>Localized empty-state message (web <c>widget.energyStats.noData</c>).</summary>
    public string EmptyMessage => _localizer.GetString("widget.energyStats.noData", "No energy data available");

    /// <summary>The widget footprint; reassigning re-projects the current summary for the new layout.</summary>
    public EnergyStatsSize Size
    {
        get => _size;
        set
        {
            if (_size == value)
            {
                return;
            }

            _size = value;
            Raise(nameof(Size));
            Reproject();
        }
    }

    /// <summary>The user's unit preference; reassigning re-projects the current summary in the new units.</summary>
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
        _state is EnergyStatsState.Loaded or EnergyStatsState.Stale or EnergyStatsState.Offline;

    private void Apply(RepositoryResult<EnergyStatsData> result)
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

            case LoadStatus.Cached when result.Value is { } cached:
                ApplyData(cached, result.FetchedAt, result.IsStale, fetching: false, error: null);
                break;

            case LoadStatus.Refreshing when result.Value is { } refreshing:
                ApplyData(refreshing, result.FetchedAt, result.IsStale, fetching: true, error: null);
                break;

            case LoadStatus.Loaded when result.Value is { } loaded:
                ApplyData(loaded, result.FetchedAt, stale: false, fetching: false, error: null);
                break;

            case LoadStatus.Offline when result.Value is { } offline:
                ApplyData(offline, result.FetchedAt, stale: true, fetching: false, error: result.Error, offline: true);
                break;

            case LoadStatus.Empty:
                SetEmpty(result.FetchedAt);
                break;

            case LoadStatus.Error:
                SetError(result.Error);
                break;

            default:
                // A content status with no value should never occur (the mapper guarantees one); fall back to
                // the empty surface rather than render a half-built panel.
                SetEmpty(result.FetchedAt);
                break;
        }
    }

    private void ApplyData(
        EnergyStatsData data,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        // Web parity: hasData = !!data — a present summary always renders content (the stat grid shows zeros
        // and the chart is hidden when there is no daily breakdown); only an absent summary is "empty".
        Display = EnergyStatsProjection.Project(data, _size, _units, _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline
            ? EnergyStatsState.Offline
            : stale ? EnergyStatsState.Stale : EnergyStatsState.Loaded;
    }

    private void Reproject()
    {
        if (_last is { } last)
        {
            Apply(last);
        }
        else
        {
            Display = EnergyStatsProjection.Project(null, _size, _units, _localizer);
        }
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = EnergyStatsState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = EnergyStatsProjection.Project(null, _size, _units, _localizer);
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = EnergyStatsState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = EnergyStatsState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "widget.energyStats.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "widget.energyStats.error.offline",
            _ => "widget.energyStats.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view energy stats",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached energy stats",
            _ => "Couldn't load energy stats",
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
