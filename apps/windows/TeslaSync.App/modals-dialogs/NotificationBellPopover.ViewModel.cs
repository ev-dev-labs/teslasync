using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// What invoking the bell trigger resolves to — the native union of the web bell's click branch
/// (<c>isMobile ? navigate('/notifications/inbox') : setOpen(v =&gt; !v)</c>).
/// </summary>
public enum NotificationBellTriggerAction
{
    /// <summary>Open the popover (desktop): the host shows the flyout and the view-model loads the preview.</summary>
    OpenPopover,

    /// <summary>Navigate to the full inbox (compact viewport): the popover would clip, so the bell deep-links.</summary>
    NavigateInbox,
}

/// <summary>The route a <see cref="NotificationBellPopoverViewModel.NavigateRequested"/> event carries.</summary>
public sealed class NotificationBellNavigationEventArgs : EventArgs
{
    /// <summary>Creates the args for <paramref name="route"/>.</summary>
    /// <param name="route">The canonical destination route.</param>
    public NotificationBellNavigationEventArgs(string route) => Route = route;

    /// <summary>The canonical destination route (web <c>navigate(to)</c>).</summary>
    public string Route { get; }
}

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="NotificationBellPopover"/> view — the native port
/// of the web <c>NotificationBellPopover</c>'s hook composition + local state
/// (web/src/components/layout/NotificationBellPopover.tsx). It owns the always-on unread-count badge stream
/// (<c>useUnreadCount</c>), the open-gated preview load (<c>useUnreadNotifications</c> joined with
/// <c>useAlertRules</c> / <c>useVehicles</c>), the compact-viewport deep-link branch (<c>useIsMobile</c>), and
/// the mark-all-read action (<c>useBulkMarkRead({ all: true })</c>). Faithful to the web component, the
/// load-bearing preview read drives the state matrix (a hard failure shows the retry surface) while content
/// stays visible during a background refresh. Drive it from one confinement (the UI thread); it is not
/// internally synchronised.
/// </summary>
public sealed class NotificationBellPopoverViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly INotificationBellSource _source;
    private readonly INotificationBellCommands _commands;
    private readonly ILocalizer _localizer;
    private readonly Func<DateTimeOffset> _clock;
    private readonly NotificationBellLabels _labels;

    private int _unreadCount;
    private NotificationBellState _state = NotificationBellState.Loading;
    private NotificationBellDisplay _display;
    private NotificationBellPreview? _lastPreview;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isError;
    private bool _isStale;
    private bool _markPending;
    private bool _isOpen;
    private bool _isMobile;
    private string? _errorMessage;
    private int _attempts;

    private CancellationTokenSource? _previewCts;
    private CancellationTokenSource? _countCts;
    private bool _countStarted;
    private bool _disposed;

    /// <summary>Creates the holder over its read source, command port, localizer and (optional) clock.</summary>
    /// <param name="source">The cache-then-network bell read source.</param>
    /// <param name="commands">The bell mutation command port.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="clock">Injectable clock so relative timestamps are deterministic in tests.</param>
    public NotificationBellPopoverViewModel(
        INotificationBellSource source,
        INotificationBellCommands commands,
        ILocalizer localizer,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(commands);
        ArgumentNullException.ThrowIfNull(localizer);

        _source = source;
        _commands = commands;
        _localizer = localizer;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _labels = NotificationBellLabels.Resolve(localizer);
        _display = NotificationBellProjection.Project(
            NotificationBellState.Loading, null, 0, false, _labels, _localizer, _clock());
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised when the bell wants the host to navigate (compact trigger, row click, "View all").</summary>
    public event EventHandler<NotificationBellNavigationEventArgs>? NavigateRequested;

    /// <summary>Raised when the bell wants the host to dismiss the popover (after a navigation).</summary>
    public event EventHandler? CloseRequested;

    /// <summary>The resolved chrome labels the view renders.</summary>
    public NotificationBellLabels Labels => _labels;

    /// <summary>The current preview lifecycle branch.</summary>
    public NotificationBellState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The render-ready display projection (subtitle, rows, mark-all-read enablement).</summary>
    public NotificationBellDisplay Display
    {
        get => _display;
        private set => Set(ref _display, value);
    }

    /// <summary>The unread badge count (web <c>useUnreadCount</c>).</summary>
    public int UnreadCount
    {
        get => _unreadCount;
        private set
        {
            if (Set(ref _unreadCount, value))
            {
                Raise(nameof(BadgeText));
                Raise(nameof(HasUnread));
                Raise(nameof(TriggerLabel));
            }
        }
    }

    /// <summary>The badge text, capped at "99+" (web <c>count &gt; 99 ? '99+' : count</c>).</summary>
    public string BadgeText => NotificationBellProjection.BadgeText(_unreadCount);

    /// <summary>True when there is at least one unread notification (the badge is shown).</summary>
    public bool HasUnread => _unreadCount > 0;

    /// <summary>The trigger button's accessible label (count-aware, web <c>aria-label</c>).</summary>
    public string TriggerLabel => NotificationBellProjection.TriggerLabel(_unreadCount, _localizer);

    /// <summary>Last successful update timestamp surfaced in the freshness chip.</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>True while a background preview refresh is in flight (freshness chip pulses).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the load-bearing preview read failed (drives the error surface / offline chip).</summary>
    public bool IsError
    {
        get => _isError;
        private set => Set(ref _isError, value);
    }

    /// <summary>True when the shown preview snapshot is older than the freshness window.</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>True while the mark-all-read mutation is in flight (the action is disabled).</summary>
    public bool MarkAllReadPending
    {
        get => _markPending;
        private set => Set(ref _markPending, value);
    }

    /// <summary>Localized error message shown in the error / offline surface.</summary>
    public string? ErrorMessage
    {
        get => _errorMessage;
        private set => Set(ref _errorMessage, value);
    }

    /// <summary>Number of preview load attempts started (including retries).</summary>
    public int Attempts
    {
        get => _attempts;
        private set => Set(ref _attempts, value);
    }

    /// <summary>Whether the popover is currently open (the preview is mounted only while open, web parity).</summary>
    public bool IsOpen
    {
        get => _isOpen;
        private set => Set(ref _isOpen, value);
    }

    /// <summary>
    /// Whether the viewport is compact (web <c>useIsMobile</c>, ≤ 640 px). The host sets this from the window
    /// size; when true, invoking the trigger deep-links to the full inbox instead of opening the popover.
    /// </summary>
    public bool IsMobile
    {
        get => _isMobile;
        set => Set(ref _isMobile, value);
    }

    /// <summary>
    /// Resolve a trigger invocation (web bell click). On a compact viewport it raises a navigation to the full
    /// inbox and returns <see cref="NotificationBellTriggerAction.NavigateInbox"/>; otherwise it returns
    /// <see cref="NotificationBellTriggerAction.OpenPopover"/> so the host shows the flyout.
    /// </summary>
    public NotificationBellTriggerAction OnTriggerInvoked()
    {
        if (_isMobile)
        {
            RaiseNavigate(NotificationBellRegistration.InboxRoute);
            return NotificationBellTriggerAction.NavigateInbox;
        }

        return NotificationBellTriggerAction.OpenPopover;
    }

    /// <summary>Begin the always-on unread-count badge stream (web <c>useUnreadCount</c>). Idempotent.</summary>
    /// <param name="cancellationToken">Cancellation linked to the surface lifetime.</param>
    public Task StartCountAsync(CancellationToken cancellationToken = default)
    {
        if (_countStarted)
        {
            return Task.CompletedTask;
        }

        _countStarted = true;
        return RefreshCountAsync(cancellationToken);
    }

    /// <summary>Run one cache-then-network unread-count read (also used to refresh after mark-all-read).</summary>
    /// <param name="cancellationToken">Cancellation for a superseded read.</param>
    public async Task RefreshCountAsync(CancellationToken cancellationToken = default)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        CancellationTokenSource? previous = Interlocked.Exchange(ref _countCts, cts);
        previous?.Cancel();
        previous?.Dispose();

        try
        {
            await foreach (RepositoryResult<int> result in _source.StreamUnreadCountAsync(cts.Token).ConfigureAwait(false))
            {
                ApplyCount(result);
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer read (or disposed) — drop silently.
        }
    }

    /// <summary>Open the popover and load the preview (web: the panel mounts its hooks on open).</summary>
    /// <param name="cancellationToken">Cancellation linked to the surface lifetime.</param>
    public Task OpenAsync(CancellationToken cancellationToken = default)
    {
        IsOpen = true;
        return LoadPreviewAsync(cancellationToken);
    }

    /// <summary>Close the popover (web: the panel unmounts). Cancels any in-flight preview load.</summary>
    public void Close()
    {
        IsOpen = false;
        CancellationTokenSource? cts = Interlocked.Exchange(ref _previewCts, null);
        cts?.Cancel();
        cts?.Dispose();
    }

    /// <summary>
    /// Run a cache-then-network preview load: counts the attempt, shows the loading affordance only when nothing
    /// is already visible (otherwise keeps content while refreshing), and folds every emission into the state
    /// matrix. A superseding load cancels the prior one.
    /// </summary>
    /// <param name="cancellationToken">Cancellation linked to the surface lifetime.</param>
    public async Task LoadPreviewAsync(CancellationToken cancellationToken = default)
    {
        var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        CancellationTokenSource? previous = Interlocked.Exchange(ref _previewCts, cts);
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
            await foreach (RepositoryResult<NotificationBellPreview> result in
                _source.StreamPreviewAsync(NotificationBellRegistration.PreviewLimit, cts.Token).ConfigureAwait(false))
            {
                Apply(result);
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop silently.
        }
    }

    /// <summary>Retry after a failure — re-runs the preview load from the top.</summary>
    /// <param name="cancellationToken">Cancellation linked to the surface lifetime.</param>
    public Task RetryAsync(CancellationToken cancellationToken = default) => LoadPreviewAsync(cancellationToken);

    /// <summary>
    /// Mark every notification read (web <c>handleMarkAllRead</c>). A no-op when there is nothing to mark or a
    /// mutation is already in flight; on success it reloads the preview (now empty) and refreshes the badge,
    /// mirroring the web invalidation cascade that zeroes both.
    /// </summary>
    /// <param name="cancellationToken">Cancellation linked to the surface lifetime.</param>
    public async Task MarkAllReadAsync(CancellationToken cancellationToken = default)
    {
        if (!_display.HasRows || _markPending)
        {
            return;
        }

        MarkAllReadPending = true;
        Reproject();
        try
        {
            await _commands.MarkAllReadAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // The mutation failed; leave the preview intact and re-enable the action.
            MarkAllReadPending = false;
            Reproject();
            return;
        }

        MarkAllReadPending = false;
        await LoadPreviewAsync(cancellationToken).ConfigureAwait(false);
        await RefreshCountAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Request the host navigate to the full inbox and dismiss the popover (row click / "View all").</summary>
    public void NavigateToInbox()
    {
        RaiseNavigate(NotificationBellRegistration.InboxRoute);
        CloseRequested?.Invoke(this, EventArgs.Empty);
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        CancellationTokenSource? preview = Interlocked.Exchange(ref _previewCts, null);
        preview?.Cancel();
        preview?.Dispose();
        CancellationTokenSource? count = Interlocked.Exchange(ref _countCts, null);
        count?.Cancel();
        count?.Dispose();
    }

    private bool HasContent() => _state is NotificationBellState.Loaded
        or NotificationBellState.Empty
        or NotificationBellState.Stale
        or NotificationBellState.Offline;

    private void ApplyCount(RepositoryResult<int> result)
    {
        switch (result.Status)
        {
            case LoadStatus.Loading:
            case LoadStatus.Error:
                // Keep the last known badge value rather than flashing to zero.
                break;

            default:
                UnreadCount = result.Value;
                Reproject();
                break;
        }
    }

    private void Apply(RepositoryResult<NotificationBellPreview> result)
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
        NotificationBellPreview preview,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        bool offline,
        RepositoryError? error)
    {
        _lastPreview = preview;
        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        IsError = offline;
        ErrorMessage = offline ? ErrorTextFor(error) : null;

        bool hasRows = preview.Notifications.Count > 0;
        if (!hasRows)
        {
            State = NotificationBellState.Empty;
        }
        else
        {
            State = offline
                ? NotificationBellState.Offline
                : stale ? NotificationBellState.Stale : NotificationBellState.Loaded;
        }

        Reproject();
    }

    private void SetLoading()
    {
        IsError = false;
        ErrorMessage = null;
        State = NotificationBellState.Loading;
        Reproject();
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        _lastPreview = NotificationBellPreview.Empty;
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        IsError = false;
        ErrorMessage = null;
        State = NotificationBellState.Empty;
        Reproject();
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        IsError = true;
        ErrorMessage = ErrorTextFor(error);
        State = NotificationBellState.Error;
        Reproject();
    }

    private void Reproject() => Display = NotificationBellProjection.Project(
        _state, _lastPreview, _unreadCount, _markPending, _labels, _localizer, _clock());

    private string ErrorTextFor(RepositoryError? error) =>
        string.IsNullOrEmpty(error?.Message) ? _labels.ErrorText : error!.Message;

    private void RaiseNavigate(string route) =>
        NavigateRequested?.Invoke(this, new NotificationBellNavigationEventArgs(route));

    private bool Set<T>(ref T field, T value, [CallerMemberName] string? propertyName = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return false;
        }

        field = value;
        Raise(propertyName);
        return true;
    }

    private void Raise(string? propertyName) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
}
