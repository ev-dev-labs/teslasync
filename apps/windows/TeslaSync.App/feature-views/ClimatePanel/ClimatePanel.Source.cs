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
/// The data port the <see cref="ClimatePanelViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of one vehicle's latest climate snapshot — the native analogue of the web
/// <c>useLatestClimate(vehicleId)</c> read whose <c>data</c> the live-telemetry page passes into
/// <c>&lt;ClimatePanel climateData={…} /&gt;</c>
/// (web/src/features/vehicles/components/telemetry-panels/LiveTelemetryPanels.tsx). The view never performs
/// HTTP itself; the concrete <see cref="ClimatePanelSource"/> (or a test fake) drives this.
/// </summary>
public interface IClimatePanelSource
{
    /// <summary>Stream the cache-then-network latest-snapshot emissions, newest cache first.</summary>
    /// <param name="cancellationToken">Cancels the in-flight read.</param>
    /// <returns>The cache-then-network emission sequence.</returns>
    IAsyncEnumerable<RepositoryResult<ClimateReading>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IClimatePanelSource"/> — the native data adapter for the Climate panel. It
/// resolves the vehicle to read, then runs one cache-then-network read of that vehicle's latest climate
/// snapshot:
/// <list type="number">
///   <item>The vehicle id: an explicit <c>vehicleId</c> wins; otherwise the primary vehicle is resolved from
///         the shared <see cref="IWidgetVehicleSource"/>. No vehicle → <see cref="RepositoryResult{T}.Empty"/>
///         (the web <c>enabled: vehicleId &gt; 0</c> disabled query).</item>
///   <item>The snapshot: a cache-then-network read of <c>get_api_v1_climate_latest</c> (scoped by
///         <c>vehicle_id</c>) through the shared <see cref="CacheThenNetworkEngine"/>, caching the raw JSON so
///         the snake_case wire shape round-trips losslessly, parsed into a <see cref="ClimateReading"/> via
///         <see cref="ClimatePanelResultMapper"/>. A null / non-object response is flagged empty.</item>
/// </list>
/// No HTTP touches the view.
/// </summary>
public sealed class ClimatePanelSource : IClimatePanelSource
{
    /// <summary>The generated operation id for <c>GET /climate/latest</c> (resolved against the endpoint table).</summary>
    public const string LatestOperation = "get_api_v1_climate_latest";

    private const string VehicleQueryParam = "vehicle_id";

    private readonly IWidgetVehicleSource _vehicles;
    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly long? _vehicleId;

    /// <summary>Creates the source over the vehicle source, contract client, engine and JSON settings.</summary>
    /// <param name="vehicles">Resolves the primary vehicle when no explicit vehicle is supplied.</param>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    /// <param name="vehicleId">An explicit vehicle id; when null the primary cached vehicle is used.</param>
    public ClimatePanelSource(
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
    public async IAsyncEnumerable<RepositoryResult<ClimateReading>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vehicleId = await ResolveVehicleIdAsync(cancellationToken).ConfigureAwait(false);
        if (vehicleId is not { } vid)
        {
            // Web parity: with no vehicle the latest-climate query is disabled and `data` is undefined.
            yield return RepositoryResult<ClimateReading>.Empty();
            yield break;
        }

        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"climate:latest:{vid}");
        var request = new ApiRequest(
            LatestOperation,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                [VehicleQueryParam] = vid,
            });

        // A null / non-object snapshot carries nothing to render; the engine flags it Empty and the view-model
        // renders the web "No climate data available" empty state.
        var raw = _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmptyResponse,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return ClimatePanelResultMapper.Map(emission);
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

    private static bool IsEmptyResponse(JsonElement element) => element.ValueKind != JsonValueKind.Object;
}
