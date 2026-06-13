using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.FeatureViews.Trips;

/// <summary>
/// The repository-backed <see cref="ITripListSource"/> — the native data adapter for the Trips page's trip
/// list and the C# port of the web <c>useTrips(...)</c> hook composition
/// (web/src/api/hooks/useTrips.ts + web/src/hooks/useSelectedVehicle.ts). It first resolves the in-scope
/// vehicle from the shared <see cref="IWidgetVehicleSource"/> (the native analogue of the web page's
/// <c>useSelectedVehicle</c>), then runs one cache-then-network read of the trip list (generated operation
/// <c>get_api_v1_trips</c>) through the shared <see cref="CacheThenNetworkEngine"/>, caching the raw JSON so the
/// snake_case wire shape round-trips losslessly, and parses each emission into <see cref="TripListItem"/> rows
/// via <see cref="TripListResultMapper"/>. Faithful to the web hook, the query is <b>not</b> disabled when no
/// vehicle is selected — it omits the <c>vehicle_id</c> parameter and reads the fleet-wide list, while a
/// resolved vehicle scopes the read to that vehicle. The <c>limit</c> is always sent. No HTTP touches the view.
/// </summary>
public sealed class TripListSource : ITripListSource
{
    private const string VehicleQueryParam = "vehicle_id";
    private const string LimitQueryParam = "limit";

    private readonly IWidgetVehicleSource _vehicles;
    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly long? _vehicleId;

    /// <summary>Creates the source over the vehicle source, contract client, engine and JSON settings.</summary>
    /// <param name="vehicles">Resolves the primary (or explicit) vehicle to scope the read to.</param>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    /// <param name="vehicleId">An explicit vehicle id; when null the primary cached vehicle (if any) is used.</param>
    public TripListSource(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        long? vehicleId = null)
    {
        ArgumentNullException.ThrowIfNull(vehicles);
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _vehicles = vehicles;
        _api = api;
        _engine = engine;
        _json = options.Json;
        _vehicleId = vehicleId;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<TripListItem>>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vehicleId = await ResolveVehicleIdAsync(cancellationToken).ConfigureAwait(false);

        var query = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            [LimitQueryParam] = TripListProjection.FetchLimit,
        };
        if (vehicleId is { } vid)
        {
            query[VehicleQueryParam] = vid;
        }

        string scope = vehicleId is { } id
            ? id.ToString(CultureInfo.InvariantCulture)
            : "all";
        string cacheKey = string.Create(
            CultureInfo.InvariantCulture,
            $"{TripListRegistration.CacheKeyPrefix}:{scope}");

        var request = new ApiRequest(Operations.Trips.List, Query: query);

        var raw = _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmptyResponse,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return TripListResultMapper.Map(emission);
        }
    }

    private async Task<long?> ResolveVehicleIdAsync(CancellationToken cancellationToken)
    {
        if (_vehicleId is { } explicitId)
        {
            return explicitId;
        }

        var primary = await _vehicles.GetPrimaryAsync(cancellationToken).ConfigureAwait(false);
        return primary?.VehicleId;
    }

    // The trips endpoint returns an array; a null / non-array / empty body carries no trips (the page-level
    // empty state), mirroring the web hook's safeArray default + empty-list gate.
    private static bool IsEmptyResponse(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Array => element.GetArrayLength() == 0,
        _ => false,
    };
}
