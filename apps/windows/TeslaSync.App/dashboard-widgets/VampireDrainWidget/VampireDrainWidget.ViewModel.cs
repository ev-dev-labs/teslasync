using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// Canonical registry metadata for the Vampire Drain surface — the native mirror of the web registry entry
/// in web/src/features/dashboard/widgets/registry/energy.ts. The dashboard grid system binds this surface
/// with the same <see cref="Id"/> and honours the same size constraints.
/// </summary>
public static class VampireDrainRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "vampire-drain";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "energy";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "VampireDrainWidget";

    /// <summary>Default footprint: 2 columns × 4 rows.</summary>
    public static VampireDrainSize DefaultSize => new(2, 4);

    /// <summary>Minimum footprint: 1 column × 2 rows.</summary>
    public static VampireDrainSize MinSize => new(1, 2);

    /// <summary>Maximum footprint: 4 columns × 40 rows.</summary>
    public static VampireDrainSize MaxSize => new(4, 40);

    /// <summary>Localized registry display name (web registry "Vampire Drain").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.vampireDrain.title", "Vampire Drain");
    }

    /// <summary>Localized description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "widget.vampireDrain.description",
            "Phantom drain rate: avg %/day, recent drain events");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(VampireDrainSize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static VampireDrainSize Clamp(VampireDrainSize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Vampire Drain surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a drain rate, battery delta, VIN or
/// vehicle id — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class VampireDrainDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public VampireDrainDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=VampireDrainWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={VampireDrainRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="VampireDrainWidget"/> view — the native port of
/// the web <c>VampireDrainWidget</c>'s hook composition
/// (web/src/features/dashboard/widgets/VampireDrainWidget.tsx). It consumes the two cache-then-network
/// sequences of the <see cref="IVampireDrainSource"/> (the phantom-drain summary and the recent-events
/// list), projects them through <see cref="VampireDrainProjection"/>, and exposes the combined
/// <see cref="State"/> plus the header freshness flags so the view is a thin renderer. The two streams are
/// consumed sequentially within one confinement (the UI thread) so the holder needs no internal
/// synchronisation; the combined freshness mirrors the web's <c>statsX || eventsX</c> booleans and the
/// <c>hasData = stats != null || events.length &gt; 0</c> gate.
/// </summary>
public sealed class VampireDrainViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IVampireDrainSource _source;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;

    private VampireDrainSize _size;
    private CancellationTokenSource? _cts;
    private bool _disposed;

    private RepositoryResult<VampireDrainStats>? _statsResult;
    private RepositoryResult<IReadOnlyList<VampireDrainEvent>>? _eventsResult;
    private VampireDrainStats? _stats;
    private IReadOnlyList<VampireDrainEvent> _events = Array.Empty<VampireDrainEvent>();
    private bool _statsResolved;
    private bool _eventsResolved;
    private bool _statsActive;
    private bool _eventsActive;

    private VampireDrainState _state = VampireDrainState.Loading;
    private VampireDrainDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, footprint and (optional) clock.</summary>
    public VampireDrainViewModel(
        IVampireDrainSource source,
        ILocalizer localizer,
        VampireDrainSize size,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _size = size;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _display = Project();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current combined surface state.</summary>
    public VampireDrainState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (compact stat / avg-drain card / sparkline / feed).</summary>
    public VampireDrainDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasData));
        }
    }

    /// <summary>Last successful update timestamp surfaced in the header freshness chip (max of both sources).</summary>
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

    /// <summary>True when either source's last load failed (drives the header error chip).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when either source's shown data is older than the freshness window.</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>Number of load attempts started (including retries).</summary>
    public int Attempts
    {
        get => _attempts;
        private set => Set(ref _attempts, value);
    }

    /// <summary>True when there is a stats summary and/or at least one drain event to render (web <c>hasData</c>).</summary>
    public bool HasData => _display.HasData;

    /// <summary>Localized widget title (web <c>widget.vampireDrain.title</c>).</summary>
    public string Title => VampireDrainRegistration.Name(_localizer);

    /// <summary>Localized empty-state message (web <c>widget.vampireDrain.noData</c>).</summary>
    public string EmptyMessage => _localizer.GetString("widget.vampireDrain.noData", "No vampire drain data");

    /// <summary>The widget footprint; reassigning re-projects the current data for the new layout.</summary>
    public VampireDrainSize Size
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
            Recompute();
        }
    }

    /// <summary>
    /// Run a cache-then-network load of both sources sequentially: counts the attempt, then folds each
    /// emission into <see cref="State"/> + <see cref="Display"/>. The skeleton shows only until BOTH
    /// sources have resolved at least once (web <c>statsLoading || eventsLoading</c>); thereafter content
    /// stays visible while refreshing. A superseding load cancels the prior one.
    /// </summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var previous = Interlocked.Exchange(ref _cts, cts);
        previous?.Cancel();
        previous?.Dispose();

        Attempts++;
        _statsActive = true;
        _eventsActive = true;
        Recompute();

        try
        {
            await foreach (var result in _source.StreamStatsAsync(cts.Token).ConfigureAwait(false))
            {
                _statsResult = result;
                _stats = NextStats(result, _stats);
                if (result.Status != LoadStatus.Loading)
                {
                    _statsResolved = true;
                }

                Recompute();
            }

            _statsActive = false;
            Recompute();

            await foreach (var result in _source.StreamEventsAsync(cts.Token).ConfigureAwait(false))
            {
                _eventsResult = result;
                _events = NextEvents(result, _events);
                if (result.Status != LoadStatus.Loading)
                {
                    _eventsResolved = true;
                }

                Recompute();
            }

            _eventsActive = false;
            Recompute();
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop the remaining emissions silently.
        }
    }

    /// <summary>Retry both sources — re-runs the load from the top while keeping content visible.</summary>
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

    private void Recompute()
    {
        Display = Project();

        UpdatedAt = MaxTime(_statsResult?.FetchedAt, _eventsResult?.FetchedAt);
        bool stale = (_statsResult?.IsStale ?? false) || (_eventsResult?.IsStale ?? false);
        bool error = IsErrorish(_statsResult) || IsErrorish(_eventsResult);
        bool offline = _statsResult?.Status == LoadStatus.Offline || _eventsResult?.Status == LoadStatus.Offline;
        bool bothResolved = _statsResolved && _eventsResolved;

        IsStale = stale;
        IsError = error;
        IsFetching = bothResolved && (_statsActive || _eventsActive);

        bool hasData = _display.HasData;
        State = !bothResolved
            ? VampireDrainState.Loading
            : !hasData && error
                ? VampireDrainState.Error
                : !hasData
                    ? VampireDrainState.Empty
                    : offline
                        ? VampireDrainState.Offline
                        : stale
                            ? VampireDrainState.Stale
                            : VampireDrainState.Loaded;
    }

    private VampireDrainDisplay Project() =>
        VampireDrainProjection.Project(_stats, _events, _size, _localizer, _clock());

    private static VampireDrainStats? NextStats(
        RepositoryResult<VampireDrainStats> result,
        VampireDrainStats? previous) => result.Status switch
        {
            LoadStatus.Loading => previous,                       // transient — keep prior content visible
            LoadStatus.Empty or LoadStatus.Error => null,         // resolved with nothing for this source
            _ => result.Value ?? previous,                        // cached / loaded / offline carry a value
        };

    private static IReadOnlyList<VampireDrainEvent> NextEvents(
        RepositoryResult<IReadOnlyList<VampireDrainEvent>> result,
        IReadOnlyList<VampireDrainEvent> previous) => result.Status switch
        {
            LoadStatus.Loading => previous,                       // transient — keep prior content visible
            LoadStatus.Empty or LoadStatus.Error => Array.Empty<VampireDrainEvent>(), // nothing for this source
            _ => result.Value ?? previous,                        // cached / loaded / offline carry a value
        };

    private static bool IsErrorish<T>(RepositoryResult<T>? result) =>
        result is { Status: LoadStatus.Error or LoadStatus.Offline };

    private static DateTimeOffset? MaxTime(DateTimeOffset? a, DateTimeOffset? b)
    {
        if (a is null)
        {
            return b;
        }

        if (b is null)
        {
            return a;
        }

        return a.Value >= b.Value ? a : b;
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
