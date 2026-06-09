using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews.OverviewVehicleComparison;

/// <summary>
/// The repository-backed <see cref="IOverviewVehicleComparisonSource"/> — the native data adapter for the
/// vehicle-comparison surface. It runs one cache-then-network read of the fleet analytics rollup
/// (<c>GET /analytics/fleet?days=30</c>, generated operation <c>get_api_v1_analytics_fleet</c>) — the
/// native analogue of the analytics page's <c>useFleetAnalytics</c> query that feeds the web
/// <c>OverviewVehicleComparison</c> — caching the raw JSON so the snake_case <c>vehicle_comparison</c>
/// shape round-trips losslessly, then mapping each emission to a typed snapshot through
/// <see cref="OverviewVehicleComparisonResultMapper"/>. No HTTP touches the view.
/// </summary>
public sealed class OverviewVehicleComparisonSource : IOverviewVehicleComparisonSource
{
    private const string CacheKey = "analytics:overview-vehicle-comparison:fleet";

    private static readonly ApiRequest FleetRequest = new(
        Operations.Analytics.Fleet,
        Query: new Dictionary<string, object?> { ["days"] = OverviewVehicleComparisonRegistration.DefaultDays });

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    public OverviewVehicleComparisonSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<OverviewVehicleComparisonData>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<JsonElement>(
            CacheKey,
            ct => _api.SendAsync<JsonElement>(FleetRequest, ct),
            IsEmpty,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return OverviewVehicleComparisonResultMapper.Map(emission);
        }
    }

    // Web parity: in JS any resolved analytics object is truthy (even {}), so only a null/non-object body
    // is treated as "no analytics" (the engine's empty terminal). An object with an empty
    // vehicle_comparison still resolves to content — the four panels each render their own empty state.
    private static bool IsEmpty(JsonElement element) => element.ValueKind != JsonValueKind.Object;
}
