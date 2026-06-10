using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="BrowserPushChannelCard"/> view — the native port of
/// the web BrowserPushChannelCard hook composition
/// (web/src/features/notifications/components/BrowserPushChannelCard.tsx). It binds the two shared seams the web
/// component composes (the browser/OS push capability and the server-registered device list), owns the
/// cache-then-network read of the device list so the surface renders the full freshness state matrix the P2
/// contract mandates, projects every change through <see cref="BrowserPushChannelProjection"/>, and exposes the
/// action methods the view's enable / disable / remove affordances invoke. Drive it from one confinement (the UI
/// thread); it is not internally synchronised.
/// </summary>
public sealed class BrowserPushChannelViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IBrowserPushDeviceSource _deviceSource;
    private readonly IBrowserPushGateway _gateway;
    private readonly ILocalizer _localizer;

    private CancellationTokenSource? _cts;
    private bool _disposed;

    private BrowserPushChannelState _state = BrowserPushChannelState.Loading;
    private BrowserPushChannelDisplay _display;
    private IReadOnlyList<BrowserPushDevice> _devices = Array.Empty<BrowserPushDevice>();
    private DateTimeOffset? _updatedAt;
    private bool _isFetching;
    private bool _isStale;
    private string? _errorMessage;
    private int _attempts;

    /// <summary>Creates the holder over the two shared seams and the i18n facade.</summary>
    /// <param name="deviceSource">The registered-devices cache-then-network source (web <c>usePushSubscriptions</c>).</param>
    /// <param name="gateway">The browser/OS push-capability gateway (web <c>useWebPush</c>).</param>
    /// <param name="localizer">The i18n facade resolving every owned string.</param>
    public BrowserPushChannelViewModel(
        IBrowserPushDeviceSource deviceSource,
        IBrowserPushGateway gateway,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(deviceSource);
        ArgumentNullException.ThrowIfNull(gateway);
        ArgumentNullException.ThrowIfNull(localizer);

        _deviceSource = deviceSource;
        _gateway = gateway;
        _localizer = localizer;

        _display = Project();
        _gateway.Changed += OnGatewayChanged;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive device-read freshness state.</summary>
    public BrowserPushChannelState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready display (chrome + registered devices).</summary>
    public BrowserPushChannelDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
        }
    }

    /// <summary>Last successful device-read timestamp surfaced in the freshness chip.</summary>
    public DateTimeOffset? UpdatedAt
    {
        get => _updatedAt;
        private set => Set(ref _updatedAt, value);
    }

    /// <summary>True while a background device refresh is in flight (the chip pulses).</summary>
    public bool IsFetching
    {
        get => _isFetching;
        private set => Set(ref _isFetching, value);
    }

    /// <summary>True when the shown device list is older than the freshness window (stale or offline).</summary>
    public bool IsStale
    {
        get => _isStale;
        private set => Set(ref _isStale, value);
    }

    /// <summary>True when the device read failed with no cache (drives the error surface).</summary>
    public bool IsError => _state == BrowserPushChannelState.Error;

    /// <summary>Localized error / offline message shown in the error surface or offline chip.</summary>
    public string? ErrorMessage
    {
        get => _errorMessage;
        private set => Set(ref _errorMessage, value);
    }

    /// <summary>Number of device-read attempts started (including retries).</summary>
    public int Attempts
    {
        get => _attempts;
        private set => Set(ref _attempts, value);
    }

    /// <summary>Whether browser push is usable here (web <c>useWebPush</c> support flags).</summary>
    public BrowserPushCapability Capability => _gateway.Capability;

    /// <summary>The current OS notification-permission status.</summary>
    public BrowserPushPermissionStatus Permission => _gateway.Permission;

    /// <summary>True when this device is registered for push.</summary>
    public bool IsSubscribed => _gateway.IsSubscribed;

    /// <summary>This device's push endpoint, or null when not subscribed.</summary>
    public string? CurrentEndpoint => _gateway.CurrentEndpoint;

    /// <summary>The current server-registered device list.</summary>
    public IReadOnlyList<BrowserPushDevice> Devices => _devices;

    /// <summary>
    /// Run a cache-then-network read of the registered-device list: counts the attempt, shows the skeleton only
    /// when nothing is already visible (otherwise keeps content while refreshing), and folds every emission into
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
            await foreach (var result in _deviceSource.StreamAsync(cts.Token).ConfigureAwait(false))
            {
                Apply(result);
            }
        }
        catch (OperationCanceledException)
        {
            // Superseded by a newer load (or disposed) — drop this emission silently.
        }
    }

    /// <summary>Retry after a failure — re-runs the device read from the top.</summary>
    public Task RetryAsync() => LoadAsync();

    /// <summary>
    /// Enable browser push on this device (web <c>handleEnable</c> → <c>subscribe()</c>): registers through the
    /// gateway and re-reads the device list so the new registration appears, exactly as the web mutation
    /// invalidates the subscriptions query.
    /// </summary>
    public async Task EnableAsync(CancellationToken cancellationToken = default)
    {
        await RunGatewayActionAsync(() => _gateway.SubscribeAsync(cancellationToken), cancellationToken)
            .ConfigureAwait(false);
    }

    /// <summary>
    /// Disable browser push on this device (web <c>handleDisable</c> → <c>unsubscribe()</c>): unregisters through
    /// the gateway and re-reads the device list so the removed registration disappears.
    /// </summary>
    public async Task DisableAsync(CancellationToken cancellationToken = default)
    {
        await RunGatewayActionAsync(() => _gateway.UnsubscribeAsync(cancellationToken), cancellationToken)
            .ConfigureAwait(false);
    }

    /// <summary>
    /// Remove a single registered device by endpoint (web <c>handleRemoveDevice</c> → <c>useUnsubscribePush</c>):
    /// deletes it server-side and re-reads the list so the row disappears.
    /// </summary>
    public async Task RemoveDeviceAsync(string endpoint, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrEmpty(endpoint);
        try
        {
            await _deviceSource.RemoveAsync(endpoint, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // The remove surfaces its own feedback; the true server state is re-read below regardless.
        }

        await LoadAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _gateway.Changed -= OnGatewayChanged;

        var cts = Interlocked.Exchange(ref _cts, null);
        cts?.Cancel();
        cts?.Dispose();
        GC.SuppressFinalize(this);
    }

    private async Task RunGatewayActionAsync(Func<Task<bool>> action, CancellationToken cancellationToken)
    {
        try
        {
            await action().ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // The gateway surfaces its own feedback; reproject from its current state and re-read the list.
        }

        RaiseGatewayState();
        Reproject();
        await LoadAsync(cancellationToken).ConfigureAwait(false);
    }

    private void OnGatewayChanged(object? sender, EventArgs e)
    {
        RaiseGatewayState();
        Reproject();
    }

    private void RaiseGatewayState()
    {
        Raise(nameof(Capability));
        Raise(nameof(Permission));
        Raise(nameof(IsSubscribed));
        Raise(nameof(CurrentEndpoint));
    }

    private bool HasContent() =>
        _state is BrowserPushChannelState.Loaded
            or BrowserPushChannelState.Stale
            or BrowserPushChannelState.Offline
            or BrowserPushChannelState.Empty;

    private void Apply(RepositoryResult<IReadOnlyList<BrowserPushDevice>> result)
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
                ApplySnapshot(result.Value!, result.FetchedAt, result.IsStale, fetching: false, offline: false, error: null);
                break;

            case LoadStatus.Refreshing:
                ApplySnapshot(result.Value!, result.FetchedAt, result.IsStale, fetching: true, offline: false, error: null);
                break;

            case LoadStatus.Loaded:
                ApplySnapshot(result.Value!, result.FetchedAt, stale: false, fetching: false, offline: false, error: null);
                break;

            case LoadStatus.Empty:
                SetEmpty(result.FetchedAt);
                break;

            case LoadStatus.Offline:
                ApplySnapshot(result.Value!, result.FetchedAt, stale: true, fetching: false, offline: true, error: result.Error);
                break;

            default:
                SetError(result.Error);
                break;
        }
    }

    private void ApplySnapshot(
        IReadOnlyList<BrowserPushDevice> devices,
        DateTimeOffset? fetchedAt,
        bool stale,
        bool fetching,
        bool offline,
        RepositoryError? error)
    {
        _devices = devices;
        Raise(nameof(Devices));

        UpdatedAt = fetchedAt;
        IsFetching = fetching;
        IsStale = stale;
        ErrorMessage = offline ? ErrorTextFor(error) : null;

        State = offline
            ? BrowserPushChannelState.Offline
            : stale
                ? BrowserPushChannelState.Stale
                : BrowserPushChannelState.Loaded;
        RaiseError();
        Reproject();
    }

    private void SetLoading()
    {
        ErrorMessage = null;
        State = BrowserPushChannelState.Loading;
        RaiseError();
    }

    private void SetEmpty(DateTimeOffset? fetchedAt)
    {
        _devices = Array.Empty<BrowserPushDevice>();
        Raise(nameof(Devices));
        UpdatedAt = fetchedAt;
        IsFetching = false;
        IsStale = false;
        ErrorMessage = null;
        State = BrowserPushChannelState.Empty;
        RaiseError();
        Reproject();
    }

    private void SetError(RepositoryError? error)
    {
        IsFetching = false;
        IsStale = false;
        ErrorMessage = ErrorTextFor(error);
        State = BrowserPushChannelState.Error;
        RaiseError();
    }

    private string ErrorTextFor(RepositoryError? error)
    {
        string key = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => BrowserPushChannelStrings.ErrorAuth,
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => BrowserPushChannelStrings.ErrorOffline,
            _ => BrowserPushChannelStrings.ErrorLoad,
        };

        string fallback = error?.Kind switch
        {
            RepositoryErrorKind.Unauthorized => "Sign in to manage browser push devices",
            RepositoryErrorKind.Offline or RepositoryErrorKind.Network => "You're offline — showing the last saved devices",
            _ => "Couldn't load registered devices",
        };

        return _localizer.GetString(key, fallback);
    }

    private BrowserPushChannelDisplay Project() =>
        BrowserPushChannelProjection.Project(
            _gateway.Capability,
            _gateway.Permission,
            _gateway.IsSubscribed,
            _gateway.CurrentEndpoint,
            _devices,
            _localizer,
            DateTimeOffset.Now);

    private void Reproject() => Display = Project();

    private void RaiseError() => Raise(nameof(IsError));

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
