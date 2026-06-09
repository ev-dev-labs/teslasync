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
/// The repository-backed <see cref="ITirePressureVisualSource"/> — the native data adapter for the Tire Pressure
/// Visual surface. It first resolves the primary vehicle from the shared <see cref="IWidgetVehicleSource"/> (the
/// native analogue of the web component's <c>vehicleId ?? vehicles?.[0]?.id ?? 0</c>), then performs the web's
/// single cache-then-network read of <c>GET /tire-pressure/latest?vehicle_id={id}</c> (generated operation
/// <c>get_api_v1_tire_pressure_latest</c>) — the web <c>useLatestTirePressure</c> query that drives the four
/// corner values, the colour-coded diagram, the status badge and the freshness / error chrome. When no vehicle is
/// available the read short-circuits to <see cref="RepositoryResult{T}.Empty"/>, mirroring the web hook's disabled
/// query (<c>enabled: vehicleId &gt; 0</c>). No HTTP touches the view.
/// </summary>
public sealed class TirePressureVisualSource : ITirePressureVisualSource
{
    // Generated endpoint table entry get_api_v1_tire_pressure_latest -> GET /tire-pressure/latest
    // (apps/windows/Generated/Api/ApiEndpoints.cs). Held as a local constant so the surface stays
    // self-contained; the request() client resolves the path from this id at send time.
    private const string TirePressureLatestOperation = "get_api_v1_tire_pressure_latest";
    private const string VehicleQueryParam = "vehicle_id";

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
    public TirePressureVisualSource(
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
    public async IAsyncEnumerable<RepositoryResult<TirePressureReading>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vehicleId = await ResolveVehicleIdAsync(cancellationToken).ConfigureAwait(false);
        if (vehicleId is not { } vid)
        {
            // Web parity: with no vehicle the useLatestTirePressure query is disabled (enabled: vehicleId > 0)
            // and `tireData` is undefined.
            yield return RepositoryResult<TirePressureReading>.Empty();
            yield break;
        }

        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"vehicles:{vid}:tire-pressure-latest");
        var request = new ApiRequest(
            TirePressureLatestOperation,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                [VehicleQueryParam] = vid,
            });

        var raw = _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmpty,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return TirePressureVisualResultMapper.Map(emission);
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

    // Web parity: a null/non-object body collapses to the empty surface (web `tireData == null`).
    private static bool IsEmpty(JsonElement element) => TirePressureReading.FromResponse(element) is null;
}
