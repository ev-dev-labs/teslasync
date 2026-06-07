using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The data port the <see cref="AutomationHistoryViewModel"/> binds to (P1/S8 state-holder seam). It
/// yields the cache-then-network sequence of parsed run-history snapshots for
/// <c>GET /automations/history</c> — the native analogue of the web <c>useAutomationHistory</c> hook. The
/// view never performs HTTP itself; the concrete <see cref="AutomationHistorySource"/> (or a test fake)
/// drives this.
/// </summary>
public interface IAutomationHistorySource
{
    /// <summary>Stream the cache-then-network run-history snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<AutomationHistorySnapshot>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// Canonical registry metadata for the Automation History surface — the native mirror of the web registry
/// entry in web/src/features/dashboard/widgets/registry/automations.ts. The dashboard grid system binds
/// this surface with the same <see cref="Id"/> and honours the same size constraints.
/// </summary>
public static class AutomationHistoryRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "automation-history";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "automations";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "AutomationHistoryWidget";

    /// <summary>The page-size the web hook requests (<c>useAutomationHistory(20)</c>).</summary>
    public const int DefaultLimit = 20;

    /// <summary>Default footprint: 2 columns × 4 rows.</summary>
    public static AutomationHistorySize DefaultSize => new(2, 4);

    /// <summary>Minimum footprint: 1 column × 2 rows.</summary>
    public static AutomationHistorySize MinSize => new(1, 2);

    /// <summary>Maximum footprint: 4 columns × 40 rows.</summary>
    public static AutomationHistorySize MaxSize => new(4, 40);

    /// <summary>Localized display name (web registry "Automation History").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.automationHistory", "Automation History");
    }

    /// <summary>Localized description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "widget.automationHistory.description",
            "Recent automation runs: success/failure status, execution times");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(AutomationHistorySize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static AutomationHistorySize Clamp(AutomationHistorySize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Automation History surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never an automation name, status or run
/// payload — so a diagnostics line can never leak what an automation did. Thread-safe.
/// </summary>
public sealed class AutomationHistoryDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public AutomationHistoryDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=AutomationHistoryWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={AutomationHistoryRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="AutomationHistoryWidget"/> view — the native
/// port of the web <c>AutomationHistoryWidget</c>'s hook composition
/// (web/src/features/dashboard/widgets/AutomationHistoryWidget.tsx). It consumes the cache-then-network
/// <see cref="IAutomationHistorySource"/>, projects each snapshot through
/// <see cref="AutomationHistoryProjection"/>, and exposes the mutually-exclusive <see cref="State"/> plus
/// the header freshness flags so the view is a thin renderer. Drive it from one confinement (the UI
/// thread); it is not internally synchronised.
/// </summary>
public sealed class AutomationHistoryViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IAutomationHistorySource _source;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;

    private AutomationHistorySize _size;
    private CancellationTokenSource? _cts;
    private RepositoryResult<AutomationHistorySnapshot>? _last;
    private bool _disposed;

    private AutomationHistoryState _state = AutomationHistoryState.Loading;
    private AutomationHistoryDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, footprint and (optional) clock.</summary>
    public AutomationHistoryViewModel(
        IAutomationHistorySource source,
        ILocalizer localizer,
        AutomationHistorySize size,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _size = size;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _display = AutomationHistoryProjection.Project(AutomationHistorySnapshot.Empty, _size, _localizer, _clock());
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public AutomationHistoryState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (feed rows + success-rate hero / header).</summary>
    public AutomationHistoryDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasItems));
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

    /// <summary>True when there is at least one run row to render.</summary>
    public bool HasItems => _display.HasItems;

    /// <summary>Localized widget title (web <c>widget.automationHistory</c>).</summary>
    public string Title => AutomationHistoryRegistration.Name(_localizer);

    /// <summary>Localized empty-state message (web <c>widget.noAutomationRuns</c>).</summary>
    public string EmptyMessage => _localizer.GetString("widget.noAutomationRuns", "No automation runs yet");

    /// <summary>The widget footprint; reassigning re-projects the current snapshot for the new layout.</summary>
    public AutomationHistorySize Size
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

    /// <summary>
    /// Run a cache-then-network load: counts the attempt, shows the skeleton only when nothing is already
    /// visible (otherwise keeps content while refreshing), and folds every emission into
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
        _state is AutomationHistoryState.Loaded or AutomationHistoryState.Stale or AutomationHistoryState.Offline;

    private void Apply(RepositoryResult<AutomationHistorySnapshot> result)
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
        AutomationHistorySnapshot snapshot,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        // Web parity: the success-rate header (wide) and hero (compact) always render; the empty branch is
        // a within-content condition (items.length === 0), not a hidden surface — so a no-rows snapshot is
        // still projected and shown, with State distinguishing it for the compact empty state.
        Display = AutomationHistoryProjection.Project(snapshot, _size, _localizer, _clock());

        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline
            ? AutomationHistoryState.Offline
            : stale
                ? AutomationHistoryState.Stale
                : Display.HasItems
                    ? AutomationHistoryState.Loaded
                    : AutomationHistoryState.Empty;
    }

    private void Reproject()
    {
        if (_last is { HasValue: true } last)
        {
            Apply(last);
        }
        else
        {
            Display = AutomationHistoryProjection.Project(AutomationHistorySnapshot.Empty, _size, _localizer, _clock());
        }
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = AutomationHistoryState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = AutomationHistoryProjection.Project(AutomationHistorySnapshot.Empty, _size, _localizer, _clock());
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = AutomationHistoryState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = AutomationHistoryState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "widget.automationHistory.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "widget.automationHistory.error.offline",
            _ => "widget.automationHistory.error",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view automation history",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached automation history",
            _ => "Couldn't load automation history",
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
