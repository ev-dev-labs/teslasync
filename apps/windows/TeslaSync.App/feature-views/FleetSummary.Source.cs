using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="FleetSummaryViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of aggregated fleet rollups — the native analogue of the web
/// <c>FleetSummary</c>'s two data sources (<c>useVehicles</c> for the list + the <c>useQuery</c> fan-out of
/// <c>fetchVehicleState</c> per vehicle). The view never performs HTTP itself; the concrete
/// <see cref="FleetSummarySource"/> (or a test fake) drives this.
/// </summary>
public interface IFleetSummarySource
{
    /// <summary>Stream the cache-then-network fleet rollups, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<FleetSummaryReading>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IFleetSummarySource"/> — the native data adapter for the Fleet Summary
/// surface. It mirrors the web component's two data sources
/// (web/src/features/vehicles/components/FleetSummary.tsx): a cache-then-network read of the vehicle list
/// (<c>GET /vehicles</c>, generated operation <see cref="Operations.Vehicles.List"/>, the web
/// <c>useVehicles</c>) which is the load-bearing spine that decides the surface state and supplies the
/// Vehicles count, then a best-effort fan-out of one state read per vehicle
/// (<c>GET /vehicles/{vehicleID}/state</c>, <see cref="Operations.Vehicles.State"/>, the web
/// <c>useQuery</c> + <c>fetchVehicleState</c>) whose resolved results are reduced into the avg-battery /
/// total-range / charging / online rollup via <see cref="FleetSummaryReading.Aggregate"/>. Each per-vehicle
/// read is wrapped so a single failure contributes nothing (web parity: each <c>fetchVehicleState</c> has a
/// <c>try/catch</c> returning <c>null</c>, and the fleet drops the nulls). An empty list short-circuits to
/// <see cref="RepositoryResult{T}.Empty"/>, mirroring the web's disabled query
/// (<c>enabled: vehicles.length &gt; 0</c>). No HTTP touches the view.
/// </summary>
public sealed class FleetSummarySource : IFleetSummarySource
{
    private const string VehiclesListCacheKey = "vehicles:list";

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    public FleetSummarySource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<FleetSummaryReading>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var listStream = _engine.StreamAsync<JsonElement>(
            VehiclesListCacheKey,
            ct => _api.SendAsync<JsonElement>(new ApiRequest(Operations.Vehicles.List), ct),
            IsEmptyArray,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var listResult in listStream.ConfigureAwait(false))
        {
            yield return await MapAsync(listResult, cancellationToken).ConfigureAwait(false);
        }
    }

    private async Task<RepositoryResult<FleetSummaryReading>> MapAsync(
        RepositoryResult<JsonElement> listResult,
        CancellationToken cancellationToken)
    {
        switch (listResult.Status)
        {
            case LoadStatus.Loading:
                return RepositoryResult<FleetSummaryReading>.Loading();

            case LoadStatus.Empty:
                // Web parity: with no vehicles the per-vehicle query is disabled — the friendly empty surface.
                return RepositoryResult<FleetSummaryReading>.Empty(listResult.FetchedAt);

            case LoadStatus.Error:
                return RepositoryResult<FleetSummaryReading>.Failure(
                    listResult.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error"));

            case LoadStatus.Cached:
            case LoadStatus.Refreshing:
            case LoadStatus.Loaded:
            case LoadStatus.Offline:
                return await MapContentAsync(listResult, cancellationToken).ConfigureAwait(false);

            default:
                return RepositoryResult<FleetSummaryReading>.Failure(
                    listResult.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error"));
        }
    }

    private async Task<RepositoryResult<FleetSummaryReading>> MapContentAsync(
        RepositoryResult<JsonElement> listResult,
        CancellationToken cancellationToken)
    {
        var ids = FleetSummaryVehicles.ParseIds(listResult.Value);
        var fetchedAt = listResult.FetchedAt ?? DateTimeOffset.UtcNow;

        // Web parity: an empty vehicle list classifies as Empty even on a cached / offline read (no fleet to
        // summarise), except on the network-failure path where the offline chip must survive over the (zero) tiles.
        if (ids.Count == 0 && listResult.Status != LoadStatus.Offline)
        {
            return RepositoryResult<FleetSummaryReading>.Empty(fetchedAt);
        }

        var states = await FanOutStatesAsync(ids, cancellationToken).ConfigureAwait(false);
        var reading = FleetSummaryReading.Aggregate(ids.Count, states);

        return listResult.Status switch
        {
            LoadStatus.Cached => RepositoryResult<FleetSummaryReading>.Cached(reading, fetchedAt, listResult.IsStale),
            LoadStatus.Refreshing => RepositoryResult<FleetSummaryReading>.Refreshing(reading, fetchedAt, listResult.IsStale),
            LoadStatus.Offline => RepositoryResult<FleetSummaryReading>.OfflineCached(
                reading, fetchedAt, listResult.Error ?? new RepositoryError(RepositoryErrorKind.Network, "offline")),
            _ => RepositoryResult<FleetSummaryReading>.Loaded(reading, fetchedAt),
        };
    }

    private async Task<IReadOnlyList<FleetVehicleStateLite>> FanOutStatesAsync(
        IReadOnlyList<long> ids,
        CancellationToken cancellationToken)
    {
        if (ids.Count == 0)
        {
            return Array.Empty<FleetVehicleStateLite>();
        }

        var reads = new List<Task<FleetVehicleStateLite?>>(ids.Count);
        foreach (var id in ids)
        {
            reads.Add(FetchStateAsync(id, cancellationToken));
        }

        var resolved = await Task.WhenAll(reads).ConfigureAwait(false);

        var states = new List<FleetVehicleStateLite>(resolved.Length);
        foreach (var state in resolved)
        {
            if (state is not null)
            {
                states.Add(state);
            }
        }

        return states;
    }

    private async Task<FleetVehicleStateLite?> FetchStateAsync(long vehicleId, CancellationToken cancellationToken)
    {
        var request = new ApiRequest(
            Operations.Vehicles.State,
            PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [FleetSummaryRegistration.VehicleIdPathParam] = vehicleId.ToString(CultureInfo.InvariantCulture),
            });

        try
        {
            var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
            return FleetVehicleStateLite.FromStateResponse(json);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Web parity: each fetchVehicleState is wrapped in try/catch returning null; the fleet drops nulls.
            return null;
        }
    }

    private static bool IsEmptyArray(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Array => element.GetArrayLength() == 0,
        _ => false,
    };
}
