using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="OperationsSectionViewModel"/> binds to (P1/S8 state-holder seam). It exposes
/// the three independent cache-then-network reads the web component composes — the notification-delivery
/// rollup (web <c>useQuery(getNotificationStats)</c> → <c>GET /notifications/stats</c>), the recent delivery
/// log (web <c>useQuery(getNotificationLogs(10, 0))</c> → <c>GET /notifications/logs?limit=10&amp;offset=0</c>)
/// and the audit trail (web <c>useQuery(getAuditLogs(20))</c> → <c>GET /system/audit?limit=20</c>). The view
/// never performs HTTP itself; the concrete <see cref="OperationsSectionSource"/> (or a test fake) drives this.
/// </summary>
public interface IOperationsSectionSource
{
    /// <summary>Stream the cache-then-network notification-delivery rollup snapshots, cached first.</summary>
    /// <param name="cancellationToken">Cancels the stream.</param>
    IAsyncEnumerable<RepositoryResult<OperationsNotificationStats>> StreamStatsAsync(
        CancellationToken cancellationToken = default);

    /// <summary>Stream the cache-then-network recent delivery-log snapshots, cached first.</summary>
    /// <param name="cancellationToken">Cancels the stream.</param>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<OperationsNotificationLog>>> StreamLogsAsync(
        CancellationToken cancellationToken = default);

    /// <summary>Stream the cache-then-network audit-trail snapshots, cached first.</summary>
    /// <param name="cancellationToken">Cancels the stream.</param>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<OperationsAuditEntry>>> StreamAuditAsync(
        CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IOperationsSectionSource"/> — the native data adapter for the Operations
/// surface. It runs three independent cache-then-network reads through the shared
/// <see cref="CacheThenNetworkEngine"/>, caching the raw JSON so the snake_case wire shape round-trips
/// losslessly, then maps each emission to a typed snapshot via <see cref="OperationsSectionResultMapper"/>:
/// <c>GET /notifications/stats</c> (generated operation <c>get_api_v1_notifications_stats</c>),
/// <c>GET /notifications/logs?limit=10&amp;offset=0</c> (<c>get_api_v1_notifications_logs</c>) and
/// <c>GET /system/audit?limit=20</c> (<c>get_api_v1_system_audit</c>). None of the endpoints is
/// vehicle-scoped, so no vehicle resolution is required. No HTTP touches the view.
/// </summary>
public sealed class OperationsSectionSource : IOperationsSectionSource
{
    /// <summary>The recent delivery-log page size (web <c>getNotificationLogs(10, 0)</c>).</summary>
    public const int LogsLimit = 10;

    /// <summary>The audit-trail page size (web <c>getAuditLogs(20)</c>).</summary>
    public const int AuditLimit = 20;

    private const string StatsCacheKey = "notifications:stats";
    private const string LogsCacheKey = "operations:notifications:logs:10";
    private const string AuditCacheKey = "operations:system:audit:20";

    private static readonly ApiRequest StatsRequest = new(Operations.Notifications.Stats);

    private static readonly ApiRequest LogsRequest = new(
        Operations.Notifications.Logs,
        Query: new Dictionary<string, object?> { ["limit"] = LogsLimit, ["offset"] = 0 });

    private static readonly ApiRequest AuditRequest = new(
        Operations.SystemAdmin.Audit,
        Query: new Dictionary<string, object?> { ["limit"] = AuditLimit });

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    public OperationsSectionSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<OperationsNotificationStats>> StreamStatsAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = Stream(StatsCacheKey, StatsRequest, IsNullBody, cancellationToken);
        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return OperationsSectionResultMapper.MapStats(emission);
        }
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<OperationsNotificationLog>>> StreamLogsAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = Stream(LogsCacheKey, LogsRequest, IsEmptyArray, cancellationToken);
        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return OperationsSectionResultMapper.MapLogs(emission);
        }
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<OperationsAuditEntry>>> StreamAuditAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = Stream(AuditCacheKey, AuditRequest, IsEmptyArray, cancellationToken);
        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return OperationsSectionResultMapper.MapAudit(emission);
        }
    }

    private IAsyncEnumerable<RepositoryResult<JsonElement>> Stream(
        string cacheKey,
        ApiRequest request,
        Func<JsonElement, bool> isEmpty,
        CancellationToken cancellationToken) =>
        _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            isEmpty,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

    // Stats: the backend always returns a populated object (an idle inbox renders as zeros), so only a
    // null / absent body counts as empty — mirroring the web outer `stats ? … : <EmptyState>` gate.
    private static bool IsNullBody(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        _ => false,
    };

    // Logs / audit are JSON arrays; a null body or an empty array carries no rows.
    private static bool IsEmptyArray(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Array => element.GetArrayLength() == 0,
        _ => false,
    };
}
