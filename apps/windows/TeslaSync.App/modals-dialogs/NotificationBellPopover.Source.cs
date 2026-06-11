using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Serialization;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// The read port the <see cref="NotificationBellPopoverViewModel"/> binds to (P1/S8 state-holder seam). It
/// yields the two cache-then-network sequences the web bell composes: the unread-count badge read
/// (<c>useUnreadCount</c>) and the unread-preview read joined against the alert-rule + vehicle lookups
/// (<c>useUnreadNotifications</c> + <c>useAlertRules</c> + <c>useVehicles</c>). The view never performs HTTP
/// itself; the concrete <see cref="NotificationBellSource"/> (or a test fake) drives this.
/// </summary>
public interface INotificationBellSource
{
    /// <summary>Stream the cache-then-network unread-count badge value (web <c>useUnreadCount</c>).</summary>
    /// <param name="cancellationToken">Cancellation for a superseded read.</param>
    IAsyncEnumerable<RepositoryResult<int>> StreamUnreadCountAsync(CancellationToken cancellationToken = default);

    /// <summary>Stream the cache-then-network unread preview, newest cache first (web panel composition).</summary>
    /// <param name="limit">The maximum number of preview rows to request (web <c>PREVIEW_LIMIT</c>).</param>
    /// <param name="cancellationToken">Cancellation for a superseded read.</param>
    IAsyncEnumerable<RepositoryResult<NotificationBellPreview>> StreamPreviewAsync(
        int limit,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// The mutation port the <see cref="NotificationBellPopoverViewModel"/> binds to (P1/S8 state-holder seam) —
/// the native analogue of the web bell's <c>useBulkMarkRead({ all: true })</c> action. The view never performs
/// HTTP itself; the concrete <see cref="NotificationBellCommands"/> (or a test fake) drives this.
/// </summary>
public interface INotificationBellCommands
{
    /// <summary>Mark every notification read (web <c>useBulkMarkRead({ all: true })</c>).</summary>
    /// <param name="cancellationToken">Cancellation for the mutation.</param>
    Task MarkAllReadAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="INotificationBellSource"/> — the native data adapter for the bell popover.
/// The unread-count read maps <c>GET /notifications/unread-count</c>'s <c>{ "count": n }</c> body to the badge
/// integer (web <c>select: data?.count ?? 0</c>). The preview read first resolves the alert-rule and vehicle
/// lookups (the web's <c>useAlertRules</c> / <c>useVehicles</c> queries) — taking the freshest cache-then-network
/// value of each — then streams <c>GET /notifications/logs?read=false&amp;archived=false&amp;limit=n</c> (web
/// <c>useUnreadNotifications</c>), folding each emission into a <see cref="NotificationBellPreview"/> with those
/// lookups attached. Every body is cached so the snake_case wire shape round-trips losslessly. No HTTP touches
/// the view.
/// </summary>
public sealed class NotificationBellSource : INotificationBellSource
{
    private const string UnreadCountCacheKey = "notifications:unread-count";
    private const string AlertRulesCacheKey = "notifications:bell:alert-rules";
    private const string VehiclesCacheKey = "notifications:bell:vehicles";

    private static readonly IReadOnlyDictionary<long, BellAlertRule> NoRules = new Dictionary<long, BellAlertRule>();
    private static readonly IReadOnlyDictionary<long, BellVehicle> NoVehicles = new Dictionary<long, BellVehicle>();

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    public NotificationBellSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<int>> StreamUnreadCountAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var request = new ApiRequest(NotificationBellRegistration.UnreadCountOperation);
        IAsyncEnumerable<RepositoryResult<JsonElement>> stream = _engine.StreamAsync<JsonElement>(
            UnreadCountCacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsNullBody,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (RepositoryResult<JsonElement> result in stream.ConfigureAwait(false))
        {
            int count = result.Value is { } body ? ReadCount(body) : 0;
            yield return new RepositoryResult<int>(
                result.Status, count, result.FetchedAt, result.IsStale, result.Error);
        }
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<NotificationBellPreview>> StreamPreviewAsync(
        int limit,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        int safeLimit = Math.Max(1, limit);

        // Web parity: the panel joins each log against the alert-rule + vehicle registries. Resolve the
        // freshest available value of each lookup before streaming the load-bearing logs read, so every row is
        // fully enriched (severity tone + vehicle name) rather than flashing un-joined content first.
        IReadOnlyDictionary<long, BellAlertRule> rules =
            await ResolveRulesAsync(cancellationToken).ConfigureAwait(false);
        IReadOnlyDictionary<long, BellVehicle> vehicles =
            await ResolveVehiclesAsync(cancellationToken).ConfigureAwait(false);

        var query = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["read"] = "false",
            ["archived"] = "false",
            ["limit"] = safeLimit.ToString(CultureInfo.InvariantCulture),
        };
        var request = new ApiRequest(NotificationBellRegistration.LogsOperation, null, query);
        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"notifications:bell:unread:{safeLimit}");

        IAsyncEnumerable<RepositoryResult<JsonElement>> stream = _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmptyArray,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (RepositoryResult<JsonElement> result in stream.ConfigureAwait(false))
        {
            NotificationBellPreview? preview = result.Value is { } body
                ? new NotificationBellPreview(BellNotification.FromJsonArray(body), rules, vehicles)
                : null;
            yield return new RepositoryResult<NotificationBellPreview>(
                result.Status, preview, result.FetchedAt, result.IsStale, result.Error);
        }
    }

    private async Task<IReadOnlyDictionary<long, BellAlertRule>> ResolveRulesAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(NotificationBellRegistration.AlertRulesOperation);
        IReadOnlyDictionary<long, BellAlertRule> map = NoRules;
        IAsyncEnumerable<RepositoryResult<JsonElement>> stream = _engine.StreamAsync<JsonElement>(
            AlertRulesCacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmptyArray,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (RepositoryResult<JsonElement> result in stream.ConfigureAwait(false))
        {
            if (result.Value is { } body)
            {
                map = BellAlertRule.MapFromJson(body);
            }
        }

        return map;
    }

    private async Task<IReadOnlyDictionary<long, BellVehicle>> ResolveVehiclesAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(NotificationBellRegistration.VehiclesOperation);
        IReadOnlyDictionary<long, BellVehicle> map = NoVehicles;
        IAsyncEnumerable<RepositoryResult<JsonElement>> stream = _engine.StreamAsync<JsonElement>(
            VehiclesCacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmptyArray,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (RepositoryResult<JsonElement> result in stream.ConfigureAwait(false))
        {
            if (result.Value is { } body)
            {
                map = BellVehicle.MapFromJson(body);
            }
        }

        return map;
    }

    private static int ReadCount(JsonElement body)
    {
        long? count = BellJson.Long(body, "count", "count");
        if (count is { } value)
        {
            return value < 0 ? 0 : (int)Math.Min(value, int.MaxValue);
        }

        return 0;
    }

    // The count payload is an object; only a null / undefined body is treated as "no value".
    private static bool IsNullBody(JsonElement element) =>
        element.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined;

    // The logs / rules / vehicles payloads are JSON arrays; a null body or empty array is the empty result.
    private static bool IsEmptyArray(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Array => element.GetArrayLength() == 0,
        _ => false,
    };
}

/// <summary>
/// The repository-backed <see cref="INotificationBellCommands"/> — the native command adapter for the bell's
/// mark-all-read action. Issues <c>POST /notifications/mark-read</c> with the <c>{ "all": true }</c> body the
/// Go API expects, mirroring the web <c>useBulkMarkRead({ all: true })</c> mutation. No HTTP touches the view.
/// </summary>
public sealed class NotificationBellCommands : INotificationBellCommands
{
    private readonly IApiClient _api;

    /// <summary>Creates the command adapter over the generated contract client.</summary>
    /// <param name="api">The generated contract client.</param>
    public NotificationBellCommands(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task MarkAllReadAsync(CancellationToken cancellationToken = default)
    {
        var request = new ApiRequest(NotificationBellRegistration.MarkReadOperation, Body: new MarkAllBody(true));
        await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
    }

    private sealed record MarkAllBody([property: JsonPropertyName("all")] bool All);
}
