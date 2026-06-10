using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Text.Json.Nodes;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="NotificationChannelsView"/> — the native port of the
/// web component's hook composition
/// (web/src/features/notifications/components/NotificationChannelsView.tsx). It owns the cache-then-network read
/// of the channel list (driving the loading / loaded / empty / stale / offline / error surface state) and a
/// secondary read of the delivery stats (filling the four metric cards, or a skeleton until they arrive),
/// projects both through <see cref="NotificationChannelsProjection"/>, and exposes the save / delete / toggle /
/// test actions the cards and modal invoke — each surfacing a localized toast through
/// <see cref="ToastRequested"/>. Drive it from one confinement; cross-loop state application is serialized
/// internally so the concurrent reads cannot tear the projection.
/// </summary>
public sealed class NotificationChannelsViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly INotificationChannelsSource _source;
    private readonly ILocalizer _localizer;
    private readonly object _gate = new();

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private NotificationChannelsState _state = NotificationChannelsState.Loading;
    private NotificationChannelList _channels = NotificationChannelList.Empty;
    private NotificationChannelStats? _stats;
    private NotificationChannelsDisplay _display;
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over the channels source and the i18n facade.</summary>
    /// <param name="source">The cache-then-network channels/stats source plus the four mutations.</param>
    /// <param name="localizer">The i18n facade resolving every owned string.</param>
    public NotificationChannelsViewModel(INotificationChannelsSource source, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);
        _source = source;
        _localizer = localizer;
        _display = Project();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised with a localized transient message for the toast surface (web <c>useToast</c>).</summary>
    public event EventHandler<NotificationChannelsToast>? ToastRequested;

    /// <summary>The current mutually-exclusive surface freshness state.</summary>
    public NotificationChannelsState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display (stat cards + channel cards + copy).</summary>
    public NotificationChannelsDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
        }
    }

    /// <summary>The current parsed channel list.</summary>
    public NotificationChannelList Channels => _channels;

    /// <summary>The current delivery stats (null until the secondary read first resolves).</summary>
    public NotificationChannelStats? Stats => _stats;

    /// <summary>True once the stats read has resolved a value (the cards replace the skeleton).</summary>
    public bool HasStats => _stats is not null;

    /// <summary>True when at least one channel is configured.</summary>
    public bool HasChannels => _channels.HasData;

    /// <summary>Last successful channels-read timestamp surfaced in the freshness chip.</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>True while a background channels refresh is in flight (the chip pulses).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the shown channel snapshot is older than the freshness window (stale or offline).</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>True when the channels read failed with no cache (drives the error surface).</summary>
    public bool IsError => _state == NotificationChannelsState.Error;

    /// <summary>Localized error / offline message shown in the error surface or offline chip.</summary>
    public string? ErrorMessage
    {
        get => _errorMessage;
        private set => Set(ref _errorMessage, value);
    }

    /// <summary>Number of channels-read attempts started (including retries).</summary>
    public int Attempts
    {
        get => _attempts;
        private set => Set(ref _attempts, value);
    }

    /// <summary>The diagnostics surface slug (<c>NotificationChannelsView</c>).</summary>
    public static string Slug => NotificationChannelsRegistration.Slug;

    /// <summary>
    /// Run the channels + stats cache-then-network reads concurrently: counts the attempt, shows the skeleton
    /// only when nothing is already visible (otherwise keeps content while refreshing), and folds every emission
    /// into <see cref="State"/> / <see cref="Stats"/> / <see cref="Display"/>. A superseding load cancels the
    /// prior one.
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
            await Task.WhenAll(
                ConsumeChannelsAsync(cts.Token),
                ConsumeStatsAsync(cts.Token)).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this run silently.
        }
    }

    /// <summary>Retry after a failure — re-runs both reads from the top.</summary>
    public Task RetryAsync() => LoadAsync();

    /// <summary>
    /// Persist a channel (web <c>useSaveChannel</c>): <c>POST</c> when <paramref name="id"/> is null, otherwise
    /// <c>PUT</c>. Surfaces the created/updated/error toast, refreshes both reads on success and returns whether
    /// the save succeeded so the modal can close.
    /// </summary>
    public async Task<bool> SaveChannelAsync(JsonObject body, long? id, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(body);
        try
        {
            await _source.SaveAsync(body, id, cancellationToken).ConfigureAwait(false);
            RaiseToast(id is null
                ? _localizer.GetString("toast.channels.save.created", "Channel created")
                : _localizer.GetString("toast.channels.save.updated", "Channel updated"));
            await LoadAsync(cancellationToken).ConfigureAwait(false);
            return true;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            RaiseToast(_localizer.GetString("toast.channels.save.error", "Failed to save channel"), isError: true);
            return false;
        }
    }

    /// <summary>Delete a channel (web <c>useDeleteChannel</c>); toasts the outcome and refreshes on success.</summary>
    public async Task DeleteChannelAsync(long id, CancellationToken cancellationToken = default)
    {
        try
        {
            await _source.DeleteAsync(id, cancellationToken).ConfigureAwait(false);
            RaiseToast(_localizer.GetString("notifications.channels.deleted", "Channel deleted"));
            await LoadAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            RaiseToast(_localizer.GetString("notifications.channels.deleteFailed", "Failed to delete channel"), isError: true);
        }
    }

    /// <summary>Flip a channel's enabled flag (web <c>useToggleChannel</c>); toasts the new state and refreshes.</summary>
    public async Task ToggleChannelAsync(NotificationChannel channel, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(channel);
        try
        {
            await _source.ToggleAsync(channel.Id, cancellationToken).ConfigureAwait(false);
            RaiseToast(channel.Enabled
                ? _localizer.GetString("notifications.channels.toggledOff", "Channel disabled")
                : _localizer.GetString("notifications.channels.toggledOn", "Channel enabled"));
            await LoadAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            RaiseToast(_localizer.GetString("notifications.channels.toggleFailed", "Failed to toggle channel"), isError: true);
        }
    }

    /// <summary>
    /// Send a test delivery (web <c>useTestChannel</c>): toasts the short success/failure cue and returns the
    /// localized outcome the modal renders inline.
    /// </summary>
    public async Task<ChannelTestOutcome> TestChannelAsync(long id, CancellationToken cancellationToken = default)
    {
        string failed = _localizer.GetString("notifications.channels.testFailed", "Test failed");
        try
        {
            var response = await _source.TestAsync(id, cancellationToken).ConfigureAwait(false);
            if (response.Success)
            {
                RaiseToast(_localizer.GetString("notifications.channels.testSuccessShort", "Test sent!"));
                return new ChannelTestOutcome(
                    true,
                    _localizer.GetString("notifications.channels.testSuccess", "Test notification sent successfully!"));
            }

            string message = string.IsNullOrEmpty(response.Error) ? failed : response.Error;
            RaiseToast(failed, isError: true);
            return new ChannelTestOutcome(false, message);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            RaiseToast(failed, isError: true);
            return new ChannelTestOutcome(false, failed);
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

    private async Task ConsumeChannelsAsync(CancellationToken cancellationToken)
    {
        await foreach (var result in _source.StreamChannelsAsync(cancellationToken).ConfigureAwait(false))
        {
            ApplyChannels(result);
        }
    }

    private async Task ConsumeStatsAsync(CancellationToken cancellationToken)
    {
        await foreach (var result in _source.StreamStatsAsync(cancellationToken).ConfigureAwait(false))
        {
            ApplyStats(result);
        }
    }

    private void ApplyChannels(RepositoryResult<NotificationChannelList> result)
    {
        lock (_gate)
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
                    ApplyChannelSnapshot(result.Value!, result.FetchedAt, result.IsStale, fetching: false, offline: false, error: null);
                    break;

                case LoadStatus.Refreshing:
                    ApplyChannelSnapshot(result.Value!, result.FetchedAt, result.IsStale, fetching: true, offline: false, error: null);
                    break;

                case LoadStatus.Loaded:
                    ApplyChannelSnapshot(result.Value!, result.FetchedAt, stale: false, fetching: false, offline: false, error: null);
                    break;

                case LoadStatus.Empty:
                    SetEmpty(result.FetchedAt);
                    break;

                case LoadStatus.Offline:
                    ApplyChannelSnapshot(result.Value ?? NotificationChannelList.Empty, result.FetchedAt, stale: true, fetching: false, offline: true, error: result.Error);
                    break;

                default:
                    SetError(result.Error);
                    break;
            }
        }
    }

    private void ApplyStats(RepositoryResult<NotificationChannelStats> result)
    {
        lock (_gate)
        {
            // web parity: the metric cards show a skeleton until the stats query first resolves a value; an
            // empty/failed stats read leaves the previous value (or the skeleton) in place.
            if (result.HasValue && result.Value is { } stats)
            {
                _stats = stats;
                Raise(nameof(Stats));
                Raise(nameof(HasStats));
                Reproject();
            }
        }
    }

    private void ApplyChannelSnapshot(
        NotificationChannelList channels,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        bool offline,
        RepositoryError? error)
    {
        _channels = channels;
        Raise(nameof(Channels));
        Raise(nameof(HasChannels));

        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        ErrorMessage = offline ? ErrorTextFor(error) : null;

        State = offline
            ? NotificationChannelsState.Offline
            : stale
                ? NotificationChannelsState.Stale
                : NotificationChannelsState.Loaded;
        RaiseError();
        Reproject();
    }

    private void SetLoading()
    {
        ErrorMessage = null;
        State = NotificationChannelsState.Loading;
        RaiseError();
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        _channels = NotificationChannelList.Empty;
        Raise(nameof(Channels));
        Raise(nameof(HasChannels));
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        ErrorMessage = null;
        State = NotificationChannelsState.Empty;
        RaiseError();
        Reproject();
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        ErrorMessage = ErrorTextFor(error);
        State = NotificationChannelsState.Error;
        RaiseError();
        Reproject();
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "notifications.channels.error.auth",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "notifications.channels.error.offline",
            _ => "notifications.channels.error.load",
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to manage notification channels",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last saved channels",
            _ => "Couldn't load notification channels",
        };

        return _localizer.GetString(key, fallback);
    }

    private bool HasContent() =>
        _state is NotificationChannelsState.Loaded
            or NotificationChannelsState.Stale
            or NotificationChannelsState.Offline
            or NotificationChannelsState.Empty;

    private NotificationChannelsDisplay Project() =>
        NotificationChannelsProjection.Project(_channels, _stats, _state, _localizer);

    private void Reproject() => Display = Project();

    private void RaiseError() => Raise(nameof(IsError));

    private void RaiseToast(string message, bool isError = false) =>
        ToastRequested?.Invoke(this, new NotificationChannelsToast(message, isError));

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
