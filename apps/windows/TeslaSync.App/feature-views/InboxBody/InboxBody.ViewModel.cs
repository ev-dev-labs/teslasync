using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// One read request for the inbox — the active <see cref="Filter"/> plus the <see cref="View"/> that
/// selects the flat vs grouped read. The native analogue of the web inbox's URL-backed filter + view state
/// that drives <c>useNotificationLogs</c> / <c>useNotificationGroups</c>.
/// </summary>
/// <param name="Filter">The active filter (severity / vehicle / rule / search / read / from-to / archived).</param>
/// <param name="View">The active view mode (grouped vs flat).</param>
public sealed record InboxQuery(InboxFilter Filter, InboxView View);

/// <summary>
/// The read port the <see cref="InboxBodyViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of inbox readings — the native analogue of the web's
/// <c>useNotificationLogs</c> / <c>useNotificationGroups</c> hook composition. The view never performs HTTP
/// itself; the concrete <see cref="InboxSource"/> (or a test fake) drives this.
/// </summary>
public interface IInboxSource
{
    /// <summary>Stream the cache-then-network inbox readings for <paramref name="query"/>, newest cache first.</summary>
    /// <param name="query">The active filter + view request.</param>
    /// <param name="cancellationToken">Cancellation for a superseded read.</param>
    IAsyncEnumerable<RepositoryResult<InboxReading>> StreamAsync(
        InboxQuery query,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// The mutation port the <see cref="InboxBodyViewModel"/> binds to (P1/S8 state-holder seam) — the native
/// analogue of the web inbox's mutation hooks (<c>useMarkNotificationsRead</c>,
/// <c>useMarkNotificationsUnread</c>, <c>useBulkMarkRead</c>, <c>useArchiveNotifications</c>,
/// <c>useUnarchiveNotifications</c>, <c>useDeleteNotifications</c>). The view never performs HTTP itself; the
/// concrete <see cref="InboxCommands"/> (or a test fake) drives this.
/// </summary>
public interface IInboxCommands
{
    /// <summary>Mark the given notifications read (web <c>useMarkNotificationsRead</c>).</summary>
    Task MarkReadAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken = default);

    /// <summary>Mark every notification read (web <c>useBulkMarkRead({ all: true })</c>).</summary>
    Task MarkAllReadAsync(CancellationToken cancellationToken = default);

    /// <summary>Mark the given notifications unread (web <c>useMarkNotificationsUnread</c>).</summary>
    Task MarkUnreadAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken = default);

    /// <summary>Archive the given notifications (web <c>useArchiveNotifications</c>).</summary>
    Task ArchiveAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken = default);

    /// <summary>Restore the given archived notifications (web <c>useUnarchiveNotifications</c>).</summary>
    Task UnarchiveAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken = default);

    /// <summary>Permanently delete the given notifications (web <c>useDeleteNotifications</c>).</summary>
    Task DeleteAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken = default);
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="InboxBody"/> view — the native port of the web
/// <c>InboxBody</c>'s hook composition + local state
/// (web/src/features/notifications/components/InboxBody.tsx). It owns the URL-equivalent filter + view state,
/// the bulk-selection set, and the auto-mark-read-on-open behaviour; consumes the cache-then-network
/// <see cref="IInboxSource"/>; projects each reading through <see cref="InboxBodyProjection"/>; and drives the
/// inbox mutations through <see cref="IInboxCommands"/>. Faithful to the web component, the load-bearing read
/// drives the state matrix (a hard failure shows the retry surface) while content stays visible during a
/// background refresh. Drive it from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class InboxBodyViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IInboxSource _source;
    private readonly IInboxCommands _commands;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;
    private readonly bool _archived;
    private readonly HashSet<long> _selected = new();

    private InboxView _view;
    private InboxFilter _filter;
    private InboxReading _lastReading;
    private CancellationTokenSource? _cts;
    private bool _autoMarked;
    private bool _disposed;

    private InboxBodyState _state = InboxBodyState.Loading;
    private InboxBodyDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over its source, command port, localizer, tab and (optional) clock.</summary>
    /// <param name="source">The cache-then-network inbox read source.</param>
    /// <param name="commands">The inbox mutation command port.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="archived">Whether this is the archive tab (web <c>archived</c> prop).</param>
    /// <param name="clock">Injectable clock so the relative-time / day tiers are deterministic in tests.</param>
    public InboxBodyViewModel(
        IInboxSource source,
        IInboxCommands commands,
        ILocalizer localizer,
        bool archived,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(commands);
        ArgumentNullException.ThrowIfNull(localizer);

        _source = source;
        _commands = commands;
        _localizer = localizer;
        _archived = archived;
        _clock = clock ?? (() => DateTimeOffset.Now);

        // Web parity: the grouped view is the default on the inbox tab; the archive tab is always flat.
        _view = archived ? InboxView.Flat : InboxView.Grouped;
        _filter = InboxFilter.Default(archived);
        _lastReading = InboxReading.EmptyFor(_view);
        _display = Project(_lastReading);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Whether auto-mark-read-on-open is enabled (web <c>PREF_MARK_ON_OPEN</c>; default on).</summary>
    public bool AutoMarkOnOpen { get; set; } = true;

    /// <summary>Whether this is the archive tab.</summary>
    public bool Archived => _archived;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public InboxBodyState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display (always non-null so the header chrome always renders).</summary>
    public InboxBodyDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
        }
    }

    /// <summary>The active view mode (web URL <c>view</c>).</summary>
    public InboxView View => _view;

    /// <summary>The active filter (web URL-backed <c>NotificationFilters</c>).</summary>
    public InboxFilter Filter => _filter;

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

    /// <summary>True when the load-bearing read failed (drives the error surface / offline chip).</summary>
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

    /// <summary>The number of currently bulk-selected rows.</summary>
    public int SelectedCount => _selected.Count;

    /// <summary>True when <paramref name="id"/> is currently bulk-selected.</summary>
    /// <param name="id">The notification id.</param>
    public bool IsSelected(long id) => _selected.Contains(id);

    /// <summary>
    /// Run a cache-then-network load: counts the attempt, shows the skeleton only when nothing is already
    /// visible (otherwise keeps content while refreshing), and folds every emission into the state matrix. A
    /// superseding load cancels the prior one.
    /// </summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        CancellationTokenSource? previous = Interlocked.Exchange(ref _cts, cts);
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

        var query = new InboxQuery(_filter, _view);
        try
        {
            await foreach (RepositoryResult<InboxReading> result in _source.StreamAsync(query, cts.Token).ConfigureAwait(false))
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

    /// <summary>Switch the inbox view mode (web view toggle); clears selection and reloads.</summary>
    /// <param name="view">The view to switch to.</param>
    public Task SetViewAsync(InboxView view)
    {
        if (_view == view)
        {
            return Task.CompletedTask;
        }

        _view = view;
        Raise(nameof(View));
        ClearSelectionInternal();
        Reproject();
        return LoadAsync();
    }

    /// <summary>Replace the active filter (web <c>handleFiltersChange</c>); clears selection and reloads.</summary>
    /// <param name="filter">The new filter.</param>
    public Task SetFilterAsync(InboxFilter filter)
    {
        ArgumentNullException.ThrowIfNull(filter);
        _filter = filter with { Archived = _archived };
        Raise(nameof(Filter));
        ClearSelectionInternal();
        _autoMarked = false;
        return LoadAsync();
    }

    /// <summary>Update only the free-text search term (web <c>q</c>) and reload.</summary>
    /// <param name="query">The search term, or <see langword="null"/> / blank to clear it.</param>
    public Task SetSearchAsync(string? query) =>
        SetFilterAsync(_filter with { Query = string.IsNullOrWhiteSpace(query) ? null : query.Trim() });

    /// <summary>Update only the read-state filter (web <c>read</c>) and reload.</summary>
    /// <param name="read">The read-state filter.</param>
    public Task SetReadFilterAsync(InboxReadFilter read) =>
        SetFilterAsync(_filter with { Read = read });

    /// <summary>Toggle a severity in the filter (web severity multi-select) and reload.</summary>
    /// <param name="severity">The severity to toggle.</param>
    /// <param name="on">Whether the severity should be included.</param>
    public Task ToggleSeverityAsync(InboxSeverity severity, bool on)
    {
        var set = new List<InboxSeverity>(_filter.Severities);
        bool present = set.Contains(severity);
        if (on && !present)
        {
            set.Add(severity);
        }
        else if (!on && present)
        {
            set.Remove(severity);
        }
        else
        {
            return Task.CompletedTask;
        }

        return SetFilterAsync(_filter with { Severities = set });
    }

    /// <summary>Whether any narrowing filter (severity / search / read / vehicle / rule / dates) is active.</summary>
    public bool HasActiveFilter =>
        _filter.Severities.Count > 0 ||
        _filter.VehicleIds.Count > 0 ||
        _filter.RuleIds.Count > 0 ||
        !string.IsNullOrWhiteSpace(_filter.Query) ||
        !string.IsNullOrWhiteSpace(_filter.From) ||
        !string.IsNullOrWhiteSpace(_filter.To) ||
        _filter.Read != InboxReadFilter.All;

    /// <summary>Clear every narrowing filter back to the tab default and reload.</summary>
    public Task ClearFiltersAsync() => SetFilterAsync(InboxFilter.Default(_archived));

    /// <summary>Toggle one row's bulk selection (web <c>useBulkSelection.setSelected</c>).</summary>
    /// <param name="id">The notification id.</param>
    /// <param name="on">Whether the row should be selected.</param>
    public void ToggleSelection(long id, bool on)
    {
        bool changed = on ? _selected.Add(id) : _selected.Remove(id);
        if (changed)
        {
            AfterSelectionChanged();
        }
    }

    /// <summary>Select every currently-visible flat row (web <c>selectAllVisible</c>).</summary>
    public void SelectAllVisible()
    {
        bool changed = false;
        foreach (long id in _display.VisibleIds)
        {
            changed |= _selected.Add(id);
        }

        if (changed)
        {
            AfterSelectionChanged();
        }
    }

    /// <summary>Clear the bulk selection (web <c>clearSelection</c>).</summary>
    public void ClearSelection()
    {
        if (_selected.Count == 0)
        {
            return;
        }

        ClearSelectionInternal();
        AfterSelectionChanged();
    }

    /// <summary>Mark every notification read (web <c>handleMarkAllRead</c>); clears selection and reloads.</summary>
    public Task MarkAllReadAsync() => RunAsync(ct => _commands.MarkAllReadAsync(ct));

    /// <summary>Run a per-row context-menu command (web <c>buildRowContextMenu</c>).</summary>
    /// <param name="action">The row action.</param>
    /// <param name="id">The target notification id.</param>
    public Task InvokeRowActionAsync(InboxRowAction action, long id)
    {
        var ids = new[] { id };
        return action switch
        {
            InboxRowAction.MarkRead => RunAsync(ct => _commands.MarkReadAsync(ids, ct)),
            InboxRowAction.MarkUnread => RunAsync(ct => _commands.MarkUnreadAsync(ids, ct)),
            InboxRowAction.Archive => RunAsync(ct => _commands.ArchiveAsync(ids, ct)),
            InboxRowAction.Restore => RunAsync(ct => _commands.UnarchiveAsync(ids, ct)),
            InboxRowAction.Delete => RunAsync(ct => _commands.DeleteAsync(ids, ct)),
            _ => Task.CompletedTask,
        };
    }

    /// <summary>Run a bulk-selection toolbar command over the current selection (web <c>bulkActions</c>).</summary>
    /// <param name="action">The bulk action.</param>
    public Task InvokeBulkActionAsync(InboxBulkAction action)
    {
        long[] ids = _selected.ToArray();
        if (ids.Length == 0)
        {
            return Task.CompletedTask;
        }

        return action switch
        {
            InboxBulkAction.MarkRead => RunAsync(ct => _commands.MarkReadAsync(ids, ct)),
            InboxBulkAction.Archive => RunAsync(ct => _commands.ArchiveAsync(ids, ct)),
            InboxBulkAction.Restore => RunAsync(ct => _commands.UnarchiveAsync(ids, ct)),
            InboxBulkAction.Delete => RunAsync(ct => _commands.DeleteAsync(ids, ct)),
            _ => Task.CompletedTask,
        };
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        CancellationTokenSource? cts = Interlocked.Exchange(ref _cts, null);
        cts?.Cancel();
        cts?.Dispose();
        GC.SuppressFinalize(this);
    }

    private bool HasContent() =>
        _state is InboxBodyState.Loaded or InboxBodyState.Empty or InboxBodyState.Stale or InboxBodyState.Offline;

    private void Apply(RepositoryResult<InboxReading> result)
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
                ApplyReading(result.Value!, result.FetchedAt, result.IsStale, fetching: false, offline: false, error: null);
                break;

            case LoadStatus.Refreshing:
                ApplyReading(result.Value!, result.FetchedAt, result.IsStale, fetching: true, offline: false, error: null);
                break;

            case LoadStatus.Loaded:
                ApplyReading(result.Value!, result.FetchedAt, stale: false, fetching: false, offline: false, error: null);
                break;

            case LoadStatus.Empty:
                SetEmpty(result.FetchedAt);
                break;

            case LoadStatus.Offline:
                ApplyReading(result.Value!, result.FetchedAt, stale: true, fetching: false, offline: true, error: result.Error);
                break;

            default:
                SetError(result.Error);
                break;
        }
    }

    private void ApplyReading(
        InboxReading reading,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        bool offline,
        RepositoryError? error)
    {
        _lastReading = reading;
        Display = Project(reading);
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = offline;
        ErrorMessage = offline ? ErrorTextFor(error) : null;

        if (!_display.HasContent)
        {
            State = InboxBodyState.Empty;
            return;
        }

        State = offline
            ? InboxBodyState.Offline
            : stale ? InboxBodyState.Stale : InboxBodyState.Loaded;

        MaybeAutoMarkRead();
    }

    private void Reproject() => Display = Project(_lastReading);

    private InboxBodyDisplay Project(InboxReading reading)
    {
        var model = new InboxBodyModel(reading, _archived, _view, _selected);
        return InboxBodyProjection.Project(model, _localizer, _clock());
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = InboxBodyState.Loading;
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        _lastReading = InboxReading.EmptyFor(_view);
        Display = Project(_lastReading);
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = InboxBodyState.Empty;
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = InboxBodyState.Error;
    }

    // Web parity: on the inbox flat view, auto-mark the visible unread rows read on open (once), unless the
    // user opted out. Grouped view never auto-marks (it would dismiss every thread head).
    private void MaybeAutoMarkRead()
    {
        if (_archived || _display.IsGrouped || _autoMarked || !AutoMarkOnOpen)
        {
            return;
        }

        long[] unread = CollectVisibleUnread();
        if (unread.Length == 0)
        {
            return;
        }

        _autoMarked = true;
        _ = AutoMarkReadAsync(unread);
    }

    private long[] CollectVisibleUnread()
    {
        var unread = new List<long>();
        foreach (InboxDayGroup day in _display.Days)
        {
            foreach (InboxRowDisplay row in day.Rows)
            {
                if (!row.IsRead)
                {
                    unread.Add(row.Id);
                }
            }
        }

        return unread.ToArray();
    }

    private async Task AutoMarkReadAsync(IReadOnlyList<long> ids)
    {
        try
        {
            await _commands.MarkReadAsync(ids).ConfigureAwait(false);
            await LoadAsync().ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            // Superseded — ignore.
        }
    }

    private async Task RunAsync(Func<CancellationToken, Task> command)
    {
        try
        {
            await command(CancellationToken.None).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        ClearSelectionInternal();
        AfterSelectionChanged();
        await LoadAsync().ConfigureAwait(false);
    }

    private void ClearSelectionInternal() => _selected.Clear();

    private void AfterSelectionChanged()
    {
        Reproject();
        Raise(nameof(SelectedCount));
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "notifications.inbox.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "notifications.inbox.error.offline",
            _ => "notifications.inbox.error.title",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to view notifications",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last cached notifications",
            _ => "Could not load notifications",
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
