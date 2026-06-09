using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="XRayHeaderViewModel"/> binds to (P1/S8 state-holder seam). It exposes the
/// single cache-then-network read the web page composes for the header strip — the per-vehicle ingest X-Ray
/// (web <c>useIngestXRay({ vehicleId, window, bucket, limit })</c>). The view never performs HTTP itself; the
/// concrete <see cref="XRayHeaderSource"/> (or a test fake) drives this.
/// </summary>
public interface IXRayHeaderSource
{
    /// <summary>
    /// Stream the cache-then-network ingest-xray snapshots for <paramref name="vehicleId"/> within
    /// <paramref name="window"/> at <paramref name="bucket"/> granularity, cached first.
    /// </summary>
    IAsyncEnumerable<RepositoryResult<IngestXRaySummary>> StreamAsync(
        int vehicleId,
        IngestXRayWindow window,
        IngestXRayBucket bucket,
        int limit,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IXRayHeaderSource"/> — the native data adapter for the X-Ray header
/// surface. It runs a cache-then-network read through the shared <see cref="CacheThenNetworkEngine"/>,
/// caching the raw JSON so the snake_case wire shape round-trips losslessly, then maps each emission to a
/// typed <see cref="IngestXRaySummary"/> via <see cref="XRayHeaderResultMapper"/>:
/// <c>GET /system/ingest-xray/{vehicleID}?window=&amp;bucket=&amp;limit=</c> (generated operation
/// <c>get_api_v1_system_ingest_xray_vehicleID</c>). No HTTP touches the view.
/// </summary>
public sealed class XRayHeaderSource : IXRayHeaderSource
{
    private const string IngestXRayOperation = "get_api_v1_system_ingest_xray_vehicleID";
    private const string CacheKeyPrefix = "system:ingest-xray";

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    public XRayHeaderSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<IngestXRaySummary>> StreamAsync(
        int vehicleId,
        IngestXRayWindow window,
        IngestXRayBucket bucket,
        int limit,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        string windowWire = IngestXRayWindows.Wire(window);
        string bucketWire = IngestXRayBuckets.Wire(bucket);
        string cacheKey = string.Create(
            CultureInfo.InvariantCulture,
            $"{CacheKeyPrefix}:{vehicleId}:{windowWire}:{bucketWire}:{limit}");

        // web: useIngestXRay appends ?window=&bucket=&limit= (snake_case single-word params) to the
        // per-vehicle path. The endpoint declares no typed query params, so the client appends them verbatim.
        var request = new ApiRequest(
            IngestXRayOperation,
            PathParams: new Dictionary<string, string>
            {
                ["vehicleID"] = vehicleId.ToString(CultureInfo.InvariantCulture),
            },
            Query: new Dictionary<string, object?>
            {
                ["window"] = windowWire,
                ["bucket"] = bucketWire,
                ["limit"] = limit,
            });

        var raw = _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmptyResponse,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return XRayHeaderResultMapper.Map(emission);
        }
    }

    // The ingest-xray endpoint returns a populated object even for a zero-sample window; only a null /
    // non-object body carries no data at all (the zero-sample "empty" treatment is the view-model's job).
    private static bool IsEmptyResponse(JsonElement element) =>
        element.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined;
}
