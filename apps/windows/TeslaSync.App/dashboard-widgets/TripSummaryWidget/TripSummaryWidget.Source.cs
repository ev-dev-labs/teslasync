using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The data port the <see cref="TripSummaryViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of parsed trip lists — the native analogue of the web
/// <c>useTrips({ limit: 5 })</c> hook (web/src/features/dashboard/widgets/TripSummaryWidget.tsx). The view
/// never performs HTTP itself; the concrete <see cref="TripSummarySource"/> (or a test fake) drives this.
/// </summary>
public interface ITripSummarySource
{
    /// <summary>Stream the cache-then-network trip-list snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<TripSummaryTrip>>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="ITripSummarySource"/> — the native data adapter for the Trip Summary
/// surface. It runs one cache-then-network read of the trip list (generated operation
/// <c>get_api_v1_trips</c>) through the shared <see cref="CacheThenNetworkEngine"/>, caching the raw JSON so
/// the snake_case wire shape round-trips losslessly, and parses each emission into <see cref="TripSummaryTrip"/>
/// rows via <see cref="TripSummaryResultMapper"/>. Unlike the vehicle-scoped drive surfaces, the web hook
/// passes only <c>limit=5</c> (never a <c>vehicle_id</c>), so the read is fleet-wide and the
/// <see cref="TripSummaryProjection.FetchLimit"/> is sent as a query parameter exactly as the web
/// <c>useTrips({ limit: 5 })</c> does. No HTTP touches the view.
/// </summary>
public sealed class TripSummarySource : ITripSummarySource
{
    private const string LimitQueryParam = "limit";
    private const string CacheKey = "trips:summary";

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    public TripSummarySource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<TripSummaryTrip>>> StreamAsync(
        [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var request = new ApiRequest(
            Operations.Trips.List,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                [LimitQueryParam] = TripSummaryProjection.FetchLimit,
            });

        var raw = _engine.StreamAsync<JsonElement>(
            CacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmptyResponse,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return TripSummaryResultMapper.Map(emission);
        }
    }

    private static bool IsEmptyResponse(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Array => element.GetArrayLength() == 0,
        _ => false,
    };
}
