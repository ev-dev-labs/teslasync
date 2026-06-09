using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// Canonical registry metadata for the Warranty Status surface — the native mirror of the web registry entry
/// in web/src/features/dashboard/widgets/registry/vehicle.ts (id <c>warranty-status</c>, category
/// <c>vehicle</c>). The dashboard grid system binds this surface with the same <see cref="Id"/> and honours
/// the same size constraints. The generated OpenAPI operation id is centralized here so a single test asserts
/// it resolves against the generated endpoint table (catching contract drift at build/test time rather than at
/// runtime).
/// </summary>
public static class WarrantyStatusRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "warranty-status";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "vehicle";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "WarrantyStatusWidget";

    /// <summary>Generated operation id for the warranty read (web <c>useWarrantyDetails</c>).</summary>
    public const string WarrantyOperationId = "get_api_v1_tesla_warranty";

    /// <summary>Default footprint: 2 columns × 2 rows.</summary>
    public static WarrantyStatusSize DefaultSize => new(2, 2);

    /// <summary>Minimum footprint: 1 column × 2 rows.</summary>
    public static WarrantyStatusSize MinSize => new(1, 2);

    /// <summary>Maximum footprint: 3 columns × 40 rows.</summary>
    public static WarrantyStatusSize MaxSize => new(3, 40);

    /// <summary>Localized display name (web registry "Warranty Status").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.warranty.title", "Warranty Status");
    }

    /// <summary>Localized description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "widget.warranty.description",
            "Warranty countdown: time remaining, mileage remaining, coverage types");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(WarrantyStatusSize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static WarrantyStatusSize Clamp(WarrantyStatusSize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Warranty Status surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never an expiry date, mileage, days-remaining
/// countdown or coverage type — so a diagnostics line can never leak an owner's warranty position. Thread-safe.
/// </summary>
public sealed class WarrantyStatusDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public WarrantyStatusDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=WarrantyStatusWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={WarrantyStatusRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="WarrantyStatusWidget"/> view — the native port of
/// the web component's hook composition (web/src/features/dashboard/widgets/WarrantyStatusWidget.tsx). It
/// consumes the cache-then-network <see cref="IWarrantyStatusSource"/>, projects each snapshot through
/// <see cref="WarrantyStatusProjection"/> with the active units and an injected clock (so the countdown is
/// deterministic in tests), and exposes the mutually-exclusive <see cref="State"/> plus the freshness flags so
/// the view is a thin renderer. A snapshot whose warranty <c>data</c> is null renders the single "No warranty
/// data" empty surface (web's <c>warrantyData ? … : &lt;EmptyState&gt;</c>). Drive it from one confinement
/// (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class WarrantyStatusViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IWarrantyStatusSource _source;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _now;

    private WarrantyStatusSize _size;
    private UnitPref _units;
    private CancellationTokenSource? _cts;
    private RepositoryResult<WarrantyStatusSnapshot>? _last;
    private bool _disposed;

    private WarrantyStatusState _state = WarrantyStatusState.Loading;
    private WarrantyStatusDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, footprint, units and (optional) clock.</summary>
    /// <param name="source">The cache-then-network warranty source.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="size">The widget footprint (registry metadata; drives the compact summary branch).</param>
    /// <param name="units">The user's unit preference (drives mileage conversion); defaults to metric.</param>
    /// <param name="now">Clock for the countdown projection; defaults to <see cref="DateTimeOffset.UtcNow"/>.</param>
    public WarrantyStatusViewModel(
        IWarrantyStatusSource source,
        ILocalizer localizer,
        WarrantyStatusSize size,
        UnitPref? units = null,
        Func<DateTimeOffset>? now = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _size = size;
        _units = units ?? UnitPref.Metric;
        _now = now ?? (() => DateTimeOffset.UtcNow);
        _display = WarrantyStatusProjection.Project(WarrantyStatusSnapshot.None, _size, _now(), _localizer, _units);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public WarrantyStatusState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (compact summary + bars + detail rows).</summary>
    public WarrantyStatusDisplay Display
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

    /// <summary>True when a warranty <c>data</c> object resolved (web truthy <c>warrantyData</c>).</summary>
    public bool HasData => _display.HasData;

    /// <summary>Localized widget title (web registry "Warranty Status").</summary>
    public string Title => _localizer.GetString("widget.warranty.title", "Warranty Status");

    /// <summary>Localized empty-state message (web <c>widget.warranty.noData</c>).</summary>
    public string EmptyMessage => _localizer.GetString("widget.warranty.noData", "No warranty data");

    /// <summary>The widget footprint; reassigning re-projects the current snapshot for the new layout.</summary>
    public WarrantyStatusSize Size
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
    /// visible (otherwise keeps content while refreshing), and folds every emission into <see cref="State"/> +
    /// <see cref="Display"/>. A superseding load cancels the prior one.
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

    /// <summary>Retry after a failure (or refresh on demand) — re-runs the load from the top.</summary>
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
        _state is WarrantyStatusState.Loaded
            or WarrantyStatusState.Empty
            or WarrantyStatusState.Stale
            or WarrantyStatusState.Offline;

    private void Apply(RepositoryResult<WarrantyStatusSnapshot> result)
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
        WarrantyStatusSnapshot snapshot,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        Display = WarrantyStatusProjection.Project(snapshot, _size, _now(), _localizer, _units);

        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;

        // Web parity: the single empty surface ("No warranty data") shows whenever the warranty data is null.
        // Offline / stale freshness take precedence for the header chip; the body still renders the right
        // empty/content via Display.
        State = offline
            ? WarrantyStatusState.Offline
            : stale
                ? WarrantyStatusState.Stale
                : Display.HasData
                    ? WarrantyStatusState.Loaded
                    : WarrantyStatusState.Empty;
    }

    private void Reproject()
    {
        if (_last is { } last && last.Status is not LoadStatus.Loading and not LoadStatus.Error)
        {
            Apply(last);
        }
        else
        {
            Display = WarrantyStatusProjection.Project(WarrantyStatusSnapshot.None, _size, _now(), _localizer, _units);
        }
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = WarrantyStatusState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = WarrantyStatusProjection.Project(WarrantyStatusSnapshot.None, _size, _now(), _localizer, _units);
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = WarrantyStatusState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = WarrantyStatusState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "widget.warranty.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "widget.warranty.error.offline",
            _ => "widget.warranty.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view warranty details",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached warranty",
            _ => "Couldn't load warranty details",
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
