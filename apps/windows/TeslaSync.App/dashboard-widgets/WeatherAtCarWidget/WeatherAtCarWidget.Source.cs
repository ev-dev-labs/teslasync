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
/// The repository-backed <see cref="IWeatherAtCarSource"/> — the native data adapter for the Weather at Car
/// surface. It first resolves the primary vehicle from the shared <see cref="IWidgetVehicleSource"/> (the native
/// analogue of the web component's <c>vehicleId ?? vehicles?.[0]?.id ?? 0</c>), then runs one cache-then-network
/// read of <c>GET /vehicles/{vehicleID}/state</c> (generated operation
/// <c>get_api_v1_vehicles_vehicleID_state</c>) through the shared <see cref="CacheThenNetworkEngine"/>, caching
/// the raw JSON so the snake_case wire shape round-trips losslessly, and parses each emission into a
/// <see cref="WeatherAtCarReading"/> via <see cref="WeatherAtCarResultMapper"/> — the web <c>useVehicleState</c>
/// query (polled at 30 s) that drives the temperature readout, the condition icon and the freshness / error
/// chrome. When no vehicle is available the read short-circuits to <see cref="RepositoryResult{T}.Empty"/>,
/// mirroring the web hook's disabled query (<c>enabled: vehicleId &gt; 0</c>). No HTTP touches the view.
/// </summary>
public sealed class WeatherAtCarSource : IWeatherAtCarSource
{
    // Generated operation id (TeslaSync.App.Core.Data.Net.Operations.Vehicles.State); asserted by the source tests.
    private const string Operation = "get_api_v1_vehicles_vehicleID_state";
    private const string VehiclePathParam = "vehicleID";

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
    /// <param name="vehicleId">An explicit vehicle id; when null the primary cached vehicle is used.</param>
    public WeatherAtCarSource(
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
    public async IAsyncEnumerable<RepositoryResult<WeatherAtCarReading>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vehicleId = await ResolveVehicleIdAsync(cancellationToken).ConfigureAwait(false);
        if (vehicleId is not { } vid)
        {
            // Web parity: with no vehicle the useVehicleState query is disabled and `state` is undefined.
            yield return RepositoryResult<WeatherAtCarReading>.Empty();
            yield break;
        }

        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"vehicles:{vid}:state");
        var request = new ApiRequest(
            Operation,
            PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [VehiclePathParam] = vid.ToString(CultureInfo.InvariantCulture),
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
            yield return WeatherAtCarResultMapper.Map(emission);
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

    // Web parity: an absent/stateless body collapses to the empty surface (web `state` undefined). The
    // additional outside_temp == null gate is applied at the view-model, not here, so a state snapshot with no
    // temperature still round-trips through the cache with its freshness intact.
    private static bool IsEmptyResponse(JsonElement element) => WeatherAtCarReading.FromResponse(element) is null;
}
