using System.Collections.Generic;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Nodes;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The browser/OS push-capability seam the <see cref="BrowserPushChannelViewModel"/> binds to (P1/S8) — the
/// native analogue of the web <c>useWebPush</c> hook. It folds the hook's capability flags
/// (<c>isSupported</c> / <c>isPushSupported</c>, the latter already incorporating the server VAPID key), the
/// <c>permission</c> status, the per-device <c>isSubscribed</c> / <c>currentEndpoint</c> pair, and the
/// <c>subscribe</c> / <c>unsubscribe</c> lifecycle. The view never touches the OS or the PushManager directly:
/// the Windows host wires a real Windows-push-backed implementation while the headless core and unit tests use
/// <see cref="InMemoryBrowserPushGateway"/>.
/// </summary>
public interface IBrowserPushGateway
{
    /// <summary>Whether browser push is usable here (web <c>isSupported</c> + <c>isPushSupported</c>).</summary>
    BrowserPushCapability Capability { get; }

    /// <summary>The current OS notification-permission status (web <c>permission</c>).</summary>
    BrowserPushPermissionStatus Permission { get; }

    /// <summary>True when this device is registered for push (web <c>isSubscribed</c>).</summary>
    bool IsSubscribed { get; }

    /// <summary>This device's push endpoint, or null when not subscribed (web <c>currentEndpoint</c>).</summary>
    string? CurrentEndpoint { get; }

    /// <summary>Raised whenever any of the above changes.</summary>
    event EventHandler? Changed;

    /// <summary>Register this device for push (web <c>subscribe</c>); returns true on success.</summary>
    Task<bool> SubscribeAsync(CancellationToken cancellationToken = default);

    /// <summary>Unregister this device from push (web <c>unsubscribe</c>); returns true on success.</summary>
    Task<bool> UnsubscribeAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// A device-free <see cref="IBrowserPushGateway"/> for the headless core and unit tests, and the default the
/// view's <c>Create</c> factory wires when the Windows host has not supplied a real Windows-push-backed gateway.
/// It models the web lifecycle: <see cref="SubscribeAsync"/> grants permission (when not denied), marks the
/// device subscribed and stamps an endpoint; <see cref="UnsubscribeAsync"/> clears both. A gateway whose
/// <see cref="Capability"/> is not <see cref="BrowserPushCapability.Supported"/> refuses to subscribe, exactly as
/// the web <c>subscribe()</c> early-returns when push is unsupported.
/// </summary>
public sealed class InMemoryBrowserPushGateway : IBrowserPushGateway
{
    private BrowserPushCapability _capability;
    private BrowserPushPermissionStatus _permission;
    private bool _isSubscribed;
    private string? _currentEndpoint;

    /// <summary>Creates the gateway seeded with an initial capability / permission / subscription snapshot.</summary>
    /// <param name="capability">The initial capability (defaults to fully supported).</param>
    /// <param name="permission">The initial permission (defaults to not-yet-requested).</param>
    /// <param name="isSubscribed">Whether the device starts subscribed (defaults to false).</param>
    /// <param name="currentEndpoint">The device's endpoint when it starts subscribed.</param>
    public InMemoryBrowserPushGateway(
        BrowserPushCapability capability = BrowserPushCapability.Supported,
        BrowserPushPermissionStatus permission = BrowserPushPermissionStatus.Default,
        bool isSubscribed = false,
        string? currentEndpoint = null)
    {
        _capability = capability;
        _permission = permission;
        _isSubscribed = isSubscribed;
        _currentEndpoint = isSubscribed ? currentEndpoint ?? SyntheticEndpoint : currentEndpoint;
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public BrowserPushCapability Capability => _capability;

    /// <inheritdoc />
    public BrowserPushPermissionStatus Permission => _permission;

    /// <inheritdoc />
    public bool IsSubscribed => _isSubscribed;

    /// <inheritdoc />
    public string? CurrentEndpoint => _currentEndpoint;

    private static string SyntheticEndpoint =>
        "https://push.example/endpoint/" + Guid.NewGuid().ToString("N");

    /// <inheritdoc />
    public Task<bool> SubscribeAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (_capability != BrowserPushCapability.Supported || _permission == BrowserPushPermissionStatus.Denied)
        {
            return Task.FromResult(false);
        }

        bool changed = _permission != BrowserPushPermissionStatus.Granted || !_isSubscribed;
        _permission = BrowserPushPermissionStatus.Granted;
        _isSubscribed = true;
        _currentEndpoint ??= SyntheticEndpoint;
        if (changed)
        {
            Raise();
        }

        return Task.FromResult(true);
    }

    /// <inheritdoc />
    public Task<bool> UnsubscribeAsync(CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        bool changed = _isSubscribed || _currentEndpoint is not null;
        _isSubscribed = false;
        _currentEndpoint = null;
        if (changed)
        {
            Raise();
        }

        return Task.FromResult(true);
    }

    /// <summary>Set the capability, raising <see cref="Changed"/> when it changes (host/test hook).</summary>
    public void SetCapability(BrowserPushCapability capability)
    {
        if (_capability == capability)
        {
            return;
        }

        _capability = capability;
        Raise();
    }

    /// <summary>Set the permission, raising <see cref="Changed"/> when it changes (host/test hook).</summary>
    public void SetPermission(BrowserPushPermissionStatus permission)
    {
        if (_permission == permission)
        {
            return;
        }

        _permission = permission;
        Raise();
    }

    /// <summary>Set the subscription state and endpoint, raising <see cref="Changed"/> on a change (host/test hook).</summary>
    public void SetSubscription(bool isSubscribed, string? endpoint = null)
    {
        string? nextEndpoint = isSubscribed ? endpoint ?? _currentEndpoint ?? SyntheticEndpoint : null;
        if (_isSubscribed == isSubscribed && _currentEndpoint == nextEndpoint)
        {
            return;
        }

        _isSubscribed = isSubscribed;
        _currentEndpoint = nextEndpoint;
        Raise();
    }

    private void Raise() => Changed?.Invoke(this, EventArgs.Empty);
}

/// <summary>
/// The registered-devices seam (P1/S8) — the native analogue of the web <c>usePushSubscriptions</c> query plus
/// the <c>useUnsubscribePush</c> mutation. It yields the cache-then-network sequence of parsed device lists for
/// <c>GET /push/subscribe</c> and removes a single subscription via <c>DELETE /push/subscribe</c>. The view never
/// performs HTTP; the concrete <see cref="BrowserPushDeviceSource"/> (or a test fake) drives this.
/// </summary>
public interface IBrowserPushDeviceSource
{
    /// <summary>Stream the cache-then-network device-list snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<BrowserPushDevice>>> StreamAsync(
        CancellationToken cancellationToken = default);

    /// <summary>Remove the subscription identified by <paramref name="endpoint"/> (web <c>useUnsubscribePush</c>).</summary>
    Task RemoveAsync(string endpoint, CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IBrowserPushDeviceSource"/> — the native data adapter for the
/// registered-devices section. It runs one cache-then-network read of <c>GET /push/subscribe</c> (the web
/// <c>usePushSubscriptions</c> query), parsing each emission's JSON array into a
/// <see cref="BrowserPushDevice"/> list, and removes a single device via <c>DELETE /push/subscribe</c> with the
/// <c>{ endpoint }</c> body the Go handler expects (web <c>useUnsubscribePush</c>). No HTTP touches the view.
/// </summary>
public sealed class BrowserPushDeviceSource : IBrowserPushDeviceSource
{
    private const string CacheKey = "push:subscriptions";

    private static readonly ApiRequest ListRequest = new(BrowserPushChannelRegistration.DevicesGetOperation);

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    public BrowserPushDeviceSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<BrowserPushDevice>>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<JsonElement>(
            CacheKey,
            ct => _api.SendAsync<JsonElement>(ListRequest, ct),
            IsEmptyResponse,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return Map(emission);
        }
    }

    /// <inheritdoc />
    public async Task RemoveAsync(string endpoint, CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrEmpty(endpoint);

        var body = new JsonObject { ["endpoint"] = endpoint };
        var request = new ApiRequest(BrowserPushChannelRegistration.DeviceDeleteOperation, Body: body);
        await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
    }

    private static RepositoryResult<IReadOnlyList<BrowserPushDevice>> Map(RepositoryResult<JsonElement> raw)
    {
        IReadOnlyList<BrowserPushDevice> Parse() =>
            raw.HasValue ? BrowserPushDevice.ParseList(raw.Value) : Array.Empty<BrowserPushDevice>();

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<IReadOnlyList<BrowserPushDevice>>.Loading(),
            LoadStatus.Cached => RepositoryResult<IReadOnlyList<BrowserPushDevice>>.Cached(
                Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<IReadOnlyList<BrowserPushDevice>>.Refreshing(
                Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<IReadOnlyList<BrowserPushDevice>>.Loaded(
                Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<IReadOnlyList<BrowserPushDevice>>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<BrowserPushDevice>>.OfflineCached(
                Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<IReadOnlyList<BrowserPushDevice>>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }

    // The list endpoint returns a JSON array; a null / non-array body or an empty array carries no devices, so
    // the surface falls back to its friendly empty state.
    private static bool IsEmptyResponse(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Array => element.GetArrayLength() == 0,
        _ => true,
    };
}
