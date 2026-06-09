using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The repository-backed <see cref="IOdometerCounterSource"/> — the native data adapter for the Odometer
/// Counter surface. It first resolves the primary vehicle from the shared <see cref="IWidgetVehicleSource"/>
/// (the native analogue of the web component's <c>vehicleId ?? vehicles?.[0]?.id</c>), then composes the
/// web's two queries:
/// <list type="number">
///   <item>One best-effort cache-then-network read of the lifetime driving rollup (generated operation
///         <c>get_api_v1_drives_stats</c>, scoped by <c>vehicle_id</c>) — the web
///         <c>useDrivingStats(idStr)</c> query. This supplements the reading with the "Total Driven" figure
///         shown only in the wide footprint; any failure or empty result simply yields a
///         <see langword="null"/> distance (the web <c>stats?.totalDistanceKm ?? null</c> → "—"), never
///         failing the surface.</item>
///   <item>The primary cache-then-network read of <c>GET /vehicles/{vehicleID}/state</c> (generated operation
///         <c>get_api_v1_vehicles_vehicleID_state</c>) — the web <c>useVehicleState(id)</c> query that
///         supplies the odometer and the freshness/error chrome.</item>
/// </list>
/// Each state emission is combined with the resolved lifetime distance via
/// <see cref="OdometerCounterResultMapper"/>. When no vehicle is available the read short-circuits to
/// <see cref="RepositoryResult{T}.Empty"/>, mirroring the web hooks' disabled queries
/// (<c>enabled: id &gt; 0</c>). No HTTP touches the view.
/// </summary>
public sealed class OdometerCounterSource : IOdometerCounterSource
{
    // Generated operation ids (TeslaSync.App.Core.Data.Net); both exist in the endpoint registry.
    private const string StateOperation = "get_api_v1_vehicles_vehicleID_state";
    private const string StatsOperation = "get_api_v1_drives_stats";
    private const string VehiclePathParam = "vehicleID";
    private const string VehicleQueryParam = "vehicle_id";

    private readonly IWidgetVehicleSource _vehicles;
    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly long? _vehicleId;

    /// <summary>Creates the source over the vehicle source, contract client, engine and JSON settings.</summary>
    /// <param name="vehicles">Resolves the primary (or explicit) vehicle to scope the reads to.</param>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    /// <param name="vehicleId">An explicit vehicle id; when null the primary cached vehicle is used.</param>
    public OdometerCounterSource(
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
    public async IAsyncEnumerable<RepositoryResult<OdometerSnapshot>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vehicleId = await ResolveVehicleIdAsync(cancellationToken).ConfigureAwait(false);
        if (vehicleId is not { } vid)
        {
            // Web parity: with no vehicle the useVehicleState query is disabled and `state` is undefined.
            yield return RepositoryResult<OdometerSnapshot>.Empty();
            yield break;
        }

        // Resolve the lifetime distance first (best-effort; supplementary, never fails the surface).
        double? totalDistanceKm = await ResolveTotalDistanceKmAsync(vid, cancellationToken).ConfigureAwait(false);

        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"vehicles:{vid}:odometer-counter");
        var request = new ApiRequest(
            StateOperation,
            PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [VehiclePathParam] = vid.ToString(CultureInfo.InvariantCulture),
            });

        var raw = _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsOdometerlessState,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return OdometerCounterResultMapper.Map(emission, totalDistanceKm);
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

    /// <summary>
    /// Drain a best-effort cache-then-network read of the lifetime driving stats, returning the freshest
    /// available <c>total_distance_km</c> or <see langword="null"/>. The figure is supplementary (web
    /// <c>stats?.totalDistanceKm</c>), so any network/parse failure or empty result collapses to
    /// <see langword="null"/> rather than propagating — cancellation still propagates so a superseded load is
    /// dropped.
    /// </summary>
    private async Task<double?> ResolveTotalDistanceKmAsync(long vid, CancellationToken cancellationToken)
    {
        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"drives:{vid}:odometer-counter");
        var request = new ApiRequest(
            StatsOperation,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                [VehicleQueryParam] = vid,
            });

        double? latest = null;
        try
        {
            var raw = _engine.StreamAsync<JsonElement>(
                cacheKey,
                ct => _api.SendAsync<JsonElement>(request, ct),
                IsEmptyStats,
                _json,
                CacheFreshness.LiveStaleSeconds,
                cancellationToken);

            await foreach (var emission in raw.ConfigureAwait(false))
            {
                if (emission.HasValue && ReadTotalDistanceKm(emission.Value) is { } parsed)
                {
                    latest = parsed;
                }
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Best-effort: the lifetime distance is supplementary, so a failure leaves the odometer intact
            // (web `stats` undefined → "Total Driven" shows "—").
        }

        return latest;
    }

    // Web parity: a response with no usable odometer collapses to the empty surface (web `odometer` null).
    private static bool IsOdometerlessState(JsonElement element) => OdometerReading.FromResponse(element) is null;

    private static bool IsEmptyStats(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Object => !element.EnumerateObject().MoveNext(),
        _ => false,
    };

    private static double? ReadTotalDistanceKm(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty("total_distance_km", out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var n) => n,
            JsonValueKind.String when double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }
}
