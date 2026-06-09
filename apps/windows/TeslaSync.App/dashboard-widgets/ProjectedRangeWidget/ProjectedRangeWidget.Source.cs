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
/// The repository-backed <see cref="IProjectedRangeSource"/> — the native data adapter for the Projected Range
/// surface. It first resolves the primary vehicle from the shared <see cref="IWidgetVehicleSource"/> (the native
/// analogue of the web component's <c>vehicleId ?? vehicles?.[0]?.id</c>), then runs one cache-then-network read
/// of <c>GET /vehicles/{vehicleID}/battery/projected-range</c> (generated operation
/// <c>get_api_v1_vehicles_vehicleID_battery_projected_range</c>) through the shared
/// <see cref="CacheThenNetworkEngine"/>, caching the raw JSON so the snake_case wire shape round-trips
/// losslessly, and parses each emission into a <see cref="ProjectedRangeReading"/> via
/// <see cref="ProjectedRangeResultMapper"/>. When no vehicle is available the read short-circuits to
/// <see cref="RepositoryResult{T}.Empty"/>, mirroring the web hook's disabled query
/// (<c>enabled: vehicleId !== null</c>). No HTTP touches the view.
/// </summary>
public sealed class ProjectedRangeSource : IProjectedRangeSource
{
    // Generated operation id (asserted by the source tests); the request() client auto-adds the /api/v1 prefix.
    private const string Operation = "get_api_v1_vehicles_vehicleID_battery_projected_range";
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
    public ProjectedRangeSource(
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
    public async IAsyncEnumerable<RepositoryResult<ProjectedRangeReading>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vehicleId = await ResolveVehicleIdAsync(cancellationToken).ConfigureAwait(false);
        if (vehicleId is not { } vid)
        {
            // Web parity: with no vehicle the useProjectedRange query is disabled and `data` is undefined.
            yield return RepositoryResult<ProjectedRangeReading>.Empty();
            yield break;
        }

        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"vehicles:{vid}:battery:projected-range");
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
            yield return ProjectedRangeResultMapper.Map(emission);
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

    // Web parity: a non-object body (data falsy) collapses to the "No projected range data" empty surface.
    private static bool IsEmptyResponse(JsonElement element) => ProjectedRangeReading.FromResponse(element) is null;
}
