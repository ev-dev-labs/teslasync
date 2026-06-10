using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The repository-backed <see cref="IPedalUsageSource"/> — the native data adapter for the <c>PedalUsage</c>
/// surface. It runs one cache-then-network read of <c>GET /drive-dynamics/latest?vehicle_id={id}</c> (generated
/// operation <c>get_api_v1_drive_dynamics_latest</c>) for a single vehicle — the native analogue of the web
/// component's <c>useDriveDynamicsLatest(vehicleId)</c> query — caching the raw JSON so the snake_case wire shape
/// round-trips losslessly, and projects each emission's snapshot body into a <see cref="PedalReading"/> via
/// <see cref="PedalUsageResultMapper"/>. No HTTP touches the view.
/// </summary>
public sealed class PedalUsageSource : IPedalUsageSource
{
    // Generated operation id (see apps/windows/Generated/Api/ApiEndpoints.cs).
    private const string LatestOperation = "get_api_v1_drive_dynamics_latest";
    private const string VehicleQueryParam = "vehicle_id";
    private const string CacheKeyPrefix = "drive-dynamics:latest:pedal";

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly ApiRequest _request;
    private readonly string _cacheKey;

    /// <summary>Creates the source over the contract client, cache-then-network engine, JSON settings and vehicle.</summary>
    /// <param name="api">The generated contract API client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The API client options carrying the JSON serializer settings.</param>
    /// <param name="vehicleId">The vehicle whose pedal telemetry to read (web <c>vehicleId</c> prop).</param>
    public PedalUsageSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options, long vehicleId)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;

        _request = ApiRequest.WithQuery(LatestOperation, VehicleQueryParam, vehicleId);
        _cacheKey = string.Format(CultureInfo.InvariantCulture, "{0}:{1}", CacheKeyPrefix, vehicleId);
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<PedalReading>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<JsonElement>(
            _cacheKey,
            ct => _api.SendAsync<JsonElement>(_request, ct),
            IsEmptyResponse,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return PedalUsageResultMapper.Map(emission);
        }
    }

    // The drive-dynamics latest endpoint returns a single JSON object (or a null body when the vehicle has no
    // snapshot yet). A null / non-object body, or a property-less object, carries no pedal telemetry, so it is
    // treated as empty and the view-model surfaces the empty state rather than blank gauges.
    private static bool IsEmptyResponse(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Object => !element.EnumerateObject().MoveNext(),
        _ => true,
    };
}
