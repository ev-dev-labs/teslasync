using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The data port the <see cref="AutomationStatusViewModel"/> binds to (P1/S8 state-holder seam). It
/// yields the cache-then-network sequence of parsed automation snapshots for <c>GET /automations</c> —
/// the native analogue of the web <c>useAutomations</c> hook. The view never performs HTTP itself; the
/// concrete <see cref="AutomationStatusSource"/> (or a test fake) drives this.
/// </summary>
public interface IAutomationStatusSource
{
    /// <summary>Stream the cache-then-network automation snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<AutomationStatusSnapshot>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The mutation port for enabling/disabling one automation (P1/S8 state-holder seam) — the native
/// analogue of the web <c>useToggleAutomation</c> mutation (<c>PATCH /automations/{id}/toggle</c>). It
/// returns <see langword="true"/> on success and <see langword="false"/> on any non-cancellation failure
/// so the view-model can revert its optimistic flip without classifying transport errors itself. The
/// concrete <see cref="AutomationToggleCommand"/> (or a test fake) drives this.
/// </summary>
public interface IAutomationToggle
{
    /// <summary>Request that automation <paramref name="id"/> be set to <paramref name="enabled"/>.</summary>
    Task<bool> ToggleAsync(long id, bool enabled, CancellationToken cancellationToken = default);
}

/// <summary>
/// Canonical registry metadata for the Automation Status surface — the native mirror of the web registry
/// entry in web/src/features/dashboard/widgets/registry/automations.ts. The dashboard grid system binds
/// this surface with the same <see cref="Id"/> and honours the same size constraints.
/// </summary>
public static class AutomationStatusRegistration
{
    /// <summary>Stable registry id (matches the web registry).</summary>
    public const string Id = "automation-status";

    /// <summary>Widget category (matches the web registry).</summary>
    public const string Category = "automations";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "AutomationStatusWidget";

    /// <summary>Default footprint: 2 columns × 4 rows.</summary>
    public static AutomationStatusSize DefaultSize => new(2, 4);

    /// <summary>Minimum footprint: 1 column × 2 rows.</summary>
    public static AutomationStatusSize MinSize => new(1, 2);

    /// <summary>Maximum footprint: 4 columns × 40 rows.</summary>
    public static AutomationStatusSize MaxSize => new(4, 40);

    /// <summary>Localized display name (web registry "Automation Status").</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("widget.automationStatus", "Automation Status");
    }

    /// <summary>Localized description (web registry copy).</summary>
    public static string Description(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "widget.automationStatus.description",
            "Active automations: last run, success/fail badge, next scheduled");
    }

    /// <summary>True when <paramref name="size"/> falls within the min/max footprint constraints.</summary>
    public static bool IsWithinBounds(AutomationStatusSize size) =>
        size.Cols >= MinSize.Cols && size.Cols <= MaxSize.Cols &&
        size.Rows >= MinSize.Rows && size.Rows <= MaxSize.Rows;

    /// <summary>Clamp <paramref name="size"/> into the supported min/max footprint.</summary>
    public static AutomationStatusSize Clamp(AutomationStatusSize size) => new(
        Math.Clamp(size.Cols, MinSize.Cols, MaxSize.Cols),
        Math.Clamp(size.Rows, MinSize.Rows, MaxSize.Rows));
}

/// <summary>
/// PII-safe diagnostics for the Automation Status surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never an automation name, id or status —
/// so a diagnostics line can never leak what an automation does. Thread-safe.
/// </summary>
public sealed class AutomationStatusDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public AutomationStatusDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=AutomationStatusWidget</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={AutomationStatusRegistration.Slug}");
    }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="AutomationStatusWidget"/> view — the native
/// port of the web <c>AutomationStatusWidget</c>'s hook composition
/// (web/src/features/dashboard/widgets/AutomationStatusWidget.tsx). It consumes the cache-then-network
/// <see cref="IAutomationStatusSource"/>, projects each snapshot through
/// <see cref="AutomationStatusProjection"/>, exposes the mutually-exclusive <see cref="State"/> plus the
/// header freshness flags, and drives the optimistic enable/disable toggle through
/// <see cref="IAutomationToggle"/> (flip → reconcile on success, revert on failure). Drive it from one
/// confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class AutomationStatusViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IAutomationStatusSource _source;
    private readonly IAutomationToggle? _toggle;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;

    private AutomationStatusSize _size;
    private CancellationTokenSource? _cts;
    private RepositoryResult<AutomationStatusSnapshot>? _last;
    private bool _disposed;

    private AutomationStatusState _state = AutomationStatusState.Loading;
    private AutomationStatusDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private string? _toggleErrorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its data source, localizer, footprint, (optional) toggle and clock.</summary>
    public AutomationStatusViewModel(
        IAutomationStatusSource source,
        ILocalizer localizer,
        AutomationStatusSize size,
        IAutomationToggle? toggle = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _toggle = toggle;
        _localizer = localizer;
        _size = size;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _display = AutomationStatusProjection.Project(AutomationStatusSnapshot.Empty, _size, _localizer, _clock());
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public AutomationStatusState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display model (counts + rows + summary chips).</summary>
    public AutomationStatusDisplay Display
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

    /// <summary>Localized inline message shown when an optimistic toggle was reverted after a failed write.</summary>
    public string? ToggleErrorMessage
    {
        get => _toggleErrorMessage;
        private set => Set(ref _toggleErrorMessage, value);
    }

    /// <summary>Number of load attempts started (including retries).</summary>
    public int Attempts
    {
        get => _attempts;
        private set => Set(ref _attempts, value);
    }

    /// <summary>True when there is at least one automation row to render.</summary>
    public bool HasItems => _display.HasItems;

    /// <summary>Localized widget title (web <c>widget.automationStatus</c>).</summary>
    public string Title => AutomationStatusRegistration.Name(_localizer);

    /// <summary>Localized empty-state message (web <c>widget.noAutomations</c>).</summary>
    public string EmptyMessage => _localizer.GetString("widget.noAutomations", "No automations configured");

    /// <summary>The widget footprint; reassigning re-projects the current snapshot for the new layout.</summary>
    public AutomationStatusSize Size
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
        ToggleErrorMessage = null;
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

    /// <summary>
    /// Optimistically flip automation <paramref name="id"/> to <paramref name="enabled"/> (re-projecting
    /// the counts, badge and summary at once), then commit the write through the toggle port — the native
    /// port of the web optimistic <c>useToggleAutomation</c> mutation. On a failed write the flip is
    /// reverted and <see cref="ToggleErrorMessage"/> is surfaced; cancellation leaves the flip in place
    /// (a subsequent reload reconciles). A no-op when no toggle port or no loaded snapshot is present.
    /// </summary>
    public async Task ToggleAsync(long id, bool enabled, CancellationToken cancellationToken = default)
    {
        if (_toggle is null || _last is not { HasValue: true } before || before.Value is null)
        {
            return;
        }

        ToggleErrorMessage = null;
        var optimistic = before with { Value = before.Value.WithEnabled(id, enabled) };
        _last = optimistic;
        Apply(optimistic);

        bool committed;
        try
        {
            committed = await _toggle.ToggleAsync(id, enabled, cancellationToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        if (!committed)
        {
            _last = before;
            Apply(before);
            ToggleErrorMessage = _localizer.GetString("toast.automation.toggle.error", "Failed to toggle automation");
        }
    }

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
        _state is AutomationStatusState.Loaded or AutomationStatusState.Stale or AutomationStatusState.Offline;

    private void Apply(RepositoryResult<AutomationStatusSnapshot> result)
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
        AutomationStatusSnapshot snapshot,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        RepositoryError? error,
        bool offline = false)
    {
        Display = AutomationStatusProjection.Project(snapshot, _size, _localizer, _clock());

        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = false;
        ErrorMessage = offline ? ErrorTextFor(error) : null;
        State = offline
            ? AutomationStatusState.Offline
            : stale
                ? AutomationStatusState.Stale
                : Display.HasItems
                    ? AutomationStatusState.Loaded
                    : AutomationStatusState.Empty;
    }

    private void Reproject()
    {
        if (_last is { HasValue: true } last)
        {
            Apply(last);
        }
        else
        {
            Display = AutomationStatusProjection.Project(AutomationStatusSnapshot.Empty, _size, _localizer, _clock());
        }
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = AutomationStatusState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        Display = AutomationStatusProjection.Project(AutomationStatusSnapshot.Empty, _size, _localizer, _clock());
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = AutomationStatusState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = AutomationStatusState.Error;
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        var key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "widget.automationStatus.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "widget.automationStatus.error.offline",
            _ => "widget.automationStatus.error",
        };

        var fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view automations",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached automations",
            _ => "Couldn't load automations",
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
