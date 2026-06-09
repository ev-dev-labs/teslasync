using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="CostForecastSectionViewModel"/> binds to (P1/S8 state-holder seam). It yields
/// the cache-then-network sequence of parsed cost-forecast snapshots for the primary (or explicit) vehicle —
/// the native analogue of the web cost-analysis page's <c>useCostForecast(vehicleId)</c> hook whose result is
/// handed to <c>&lt;CostForecastSection forecastData={…} /&gt;</c>
/// (web/src/features/charging/pages/CostAnalysisPage.tsx). The view never performs HTTP itself; the concrete
/// <see cref="CostForecastSectionSource"/> (or a test fake) drives this.
/// </summary>
public interface ICostForecastSectionSource
{
    /// <summary>Stream the cache-then-network cost-forecast snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<CostForecastSectionData>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="ICostForecastSectionSource"/> — the native data adapter for the
/// Cost-Forecast section. It first resolves the primary vehicle from the shared
/// <see cref="IWidgetVehicleSource"/> (the native analogue of the page's selected-vehicle scope), then runs
/// one cache-then-network read of <c>GET /analytics/cost-forecast?vehicle_id=…&amp;months=…</c> (generated
/// operation <c>get_api_v1_analytics_cost_forecast</c>) through the shared <see cref="CacheThenNetworkEngine"/>,
/// caching the raw JSON so the snake_case wire shape round-trips losslessly, and parses each emission into a
/// <see cref="CostForecastSectionData"/> via <see cref="CostForecastSectionResultMapper"/>. When no vehicle is
/// available the read short-circuits to <see cref="RepositoryResult{T}.Empty()"/>, mirroring the web hook's
/// disabled query (<c>enabled: vehicleId !== null</c>). No HTTP touches the view.
/// </summary>
public sealed class CostForecastSectionSource : ICostForecastSectionSource
{
    /// <summary>
    /// The generated OpenAPI operation id for <c>GET /api/v1/analytics/cost-forecast</c>. Declared locally
    /// (rather than via <c>Operations.Analytics</c>, which this surface does not own) and resolved against the
    /// generated <c>ApiEndpoints.All</c> table at request time.
    /// </summary>
    private const string ForecastOperation = "get_api_v1_analytics_cost_forecast";

    private const string VehicleQueryParam = "vehicle_id";
    private const string MonthsQueryParam = "months";

    // Web parity: useCostForecast sets staleTime: STALE_TIMES.SLOW (5 minutes); the engine flags a cached
    // snapshot older than this window as stale so the header shows the refreshing chip.
    private const int SlowStaleSeconds = 300;

    private readonly IWidgetVehicleSource _vehicles;
    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly long? _vehicleId;
    private readonly int _months;

    /// <summary>Creates the source over the vehicle source, contract client, engine and JSON settings.</summary>
    /// <param name="vehicles">Resolves the primary (or explicit) vehicle to scope the read to.</param>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    /// <param name="vehicleId">An explicit vehicle id; when null the primary cached vehicle is used.</param>
    /// <param name="months">The projection horizon (web <c>useCostForecast(_, months = 6)</c>).</param>
    public CostForecastSectionSource(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        long? vehicleId = null,
        int months = CostForecastSectionRegistration.Months)
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
        _months = months > 0 ? months : CostForecastSectionRegistration.Months;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<CostForecastSectionData>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vehicleId = await ResolveVehicleIdAsync(cancellationToken).ConfigureAwait(false);
        if (vehicleId is not { } vid)
        {
            // Web parity: with no vehicle the cost-forecast query is disabled and `forecastData` is undefined.
            yield return RepositoryResult<CostForecastSectionData>.Empty();
            yield break;
        }

        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"analytics:cost-forecast-section:{vid}:{_months}");
        var request = new ApiRequest(
            ForecastOperation,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                [VehicleQueryParam] = vid,
                [MonthsQueryParam] = _months,
            });

        var raw = _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmptyResponse,
            _json,
            SlowStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return CostForecastSectionResultMapper.Map(emission);
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

    private static bool IsEmptyResponse(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Object => !element.EnumerateObject().MoveNext(),
        _ => false,
    };
}
