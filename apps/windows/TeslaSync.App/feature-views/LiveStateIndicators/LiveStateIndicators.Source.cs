using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="LiveStateIndicatorsViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of parsed vehicle-state snapshots for <c>GET /vehicles/{vehicleID}/state</c> — the
/// native analogue of the web parent page's <c>useVehicleState(vehicleId)</c> query that feeds the
/// <c>LiveStateIndicators</c> child (web/src/features/vehicles/pages/VehicleDetailPage.tsx). The view never
/// performs HTTP itself; the concrete <see cref="LiveStateIndicatorsSource"/> (or a test fake) drives this.
/// </summary>
public interface ILiveStateIndicatorsSource
{
    /// <summary>Stream the cache-then-network vehicle-state snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<LiveStateIndicatorsReading>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="ILiveStateIndicatorsSource"/> — the native data adapter for the Live State
/// Indicators surface. It first resolves the primary vehicle from the shared <see cref="IWidgetVehicleSource"/>
/// (the native analogue of the web page's selected-vehicle id), then runs one cache-then-network read of
/// <c>GET /vehicles/{vehicleID}/state</c> (generated operation <c>get_api_v1_vehicles_vehicleID_state</c>, the
/// web <c>useVehicleState</c> query) through the shared <see cref="CacheThenNetworkEngine"/>, caching the raw
/// JSON so the snake_case wire shape round-trips losslessly, and parses each emission into a
/// <see cref="LiveStateIndicatorsReading"/> via <see cref="LiveStateIndicatorsResultMapper"/>. When no vehicle
/// is available the read short-circuits to <see cref="RepositoryResult{T}.Empty()"/>, mirroring the web hook's
/// disabled query (<c>enabled: vehicleId &gt; 0</c>). No HTTP touches the view.
/// </summary>
public sealed class LiveStateIndicatorsSource : ILiveStateIndicatorsSource
{
    private const string StateOperation = "get_api_v1_vehicles_vehicleID_state";
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
    public LiveStateIndicatorsSource(
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
    public async IAsyncEnumerable<RepositoryResult<LiveStateIndicatorsReading>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vehicleId = await ResolveVehicleIdAsync(cancellationToken).ConfigureAwait(false);
        if (vehicleId is not { } vid)
        {
            // Web parity: with no vehicle the useVehicleState query is disabled and `state` is undefined.
            yield return RepositoryResult<LiveStateIndicatorsReading>.Empty();
            yield break;
        }

        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"vehicles:{vid}:live-state-indicators");
        var request = new ApiRequest(
            StateOperation,
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
            yield return LiveStateIndicatorsResultMapper.Map(emission);
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

    // Web parity: a body without a usable vehicle-state object makes `state` falsy → the empty surface.
    private static bool IsEmptyResponse(JsonElement element) => LiveStateIndicatorsReading.FromResponse(element) is null;
}
