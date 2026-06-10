using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="QueueStatusViewModel"/> binds to (P1/S8 state-holder seam). It exposes the
/// single cache-then-network read the web component composes — the background-worker queue snapshot (web
/// <c>useQueueStatus</c> → <c>GET /system/queues</c>). The view never performs HTTP itself; the concrete
/// <see cref="QueueStatusSource"/> (or a test fake) drives this.
/// </summary>
public interface IQueueStatusSource
{
    /// <summary>Stream the cache-then-network queue snapshots, cached first.</summary>
    IAsyncEnumerable<RepositoryResult<QueueStatusSnapshot>> StreamStatusAsync(
        CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IQueueStatusSource"/> — the native data adapter for the queue-status
/// surface. It runs one cache-then-network read through the shared <see cref="CacheThenNetworkEngine"/>,
/// caching the raw JSON so the snake_case wire shape round-trips losslessly, then maps each emission to a typed
/// <see cref="QueueStatusSnapshot"/> via <see cref="QueueStatusResultMapper"/>: <c>GET /system/queues</c>
/// (generated operation <c>get_api_v1_system_queues</c>). No HTTP touches the view.
/// </summary>
public sealed class QueueStatusSource : IQueueStatusSource
{
    /// <summary>The generated OpenAPI operation id for the queue-status feed.</summary>
    public const string StatusOperation = "get_api_v1_system_queues";

    private const string CacheKey = "system:queues";

    private static readonly ApiRequest StatusRequest = new(StatusOperation);

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    public QueueStatusSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<QueueStatusSnapshot>> StreamStatusAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<JsonElement>(
            CacheKey,
            ct => _api.SendAsync<JsonElement>(StatusRequest, ct),
            IsEmptyResponse,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return QueueStatusResultMapper.Map(emission);
        }
    }

    // A null / non-object body carries no usable envelope (web parity: the query has no data → empty state
    // with no header timestamp). A valid object with an empty workers array is NOT treated as empty here: the
    // engine keeps the payload so the header's "Updated {when}" survives, and the body's empty state is
    // derived from the zero row count downstream (web: workers.length === 0 → empty body).
    private static bool IsEmptyResponse(JsonElement element) => element.ValueKind != JsonValueKind.Object;
}
