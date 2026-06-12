using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.FeatureViews.Analytics;

/// <summary>
/// The repository-backed <see cref="ITrueCostBreakdownSource"/> — the native data adapter for the True Cost
/// of Ownership page and the C# port of the web <c>useCostBreakdown</c> hook composition
/// (web/src/api/hooks/useAnalytics.ts + web/src/hooks/useSelectedVehicle.ts). It resolves the scoped (or
/// primary) vehicle from the shared <see cref="IWidgetVehicleSource"/> — the native analogue of the page's
/// <c>useSelectedVehicle()</c> + <c>vehicles?.[0]?.id</c> fallback — then runs one cache-then-network read
/// of <c>GET /analytics/tco?vehicle_id=…</c> (generated operation <c>get_api_v1_analytics_tco</c>) through
/// the shared <see cref="CacheThenNetworkEngine"/>, caching the raw JSON so the snake_case wire shape
/// round-trips losslessly, and parses each emission into a <see cref="TrueCostBreakdown"/> via
/// <see cref="TrueCostResultMapper"/>. When no vehicle is available the read short-circuits to
/// <see cref="RepositoryResult{T}.Empty()"/>, mirroring the web hook's disabled query
/// (<c>enabled: !!vehicleId</c>). No HTTP touches the view.
/// </summary>
public sealed class TrueCostBreakdownSource : ITrueCostBreakdownSource
{
    private const string VehicleQueryParam = "vehicle_id";

    private readonly IWidgetVehicleSource _vehicles;
    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly long? _vehicleId;

    /// <summary>Creates the source over the vehicle source, contract client, engine and JSON settings.</summary>
    /// <param name="vehicles">Resolves the scoped (or primary) vehicle to scope the read to.</param>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    /// <param name="vehicleId">An explicit vehicle id; when null the primary cached vehicle is used.</param>
    public TrueCostBreakdownSource(
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
    public async IAsyncEnumerable<RepositoryResult<TrueCostBreakdown>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vehicleId = await ResolveVehicleIdAsync(cancellationToken).ConfigureAwait(false);
        if (vehicleId is not { } vid)
        {
            // Web parity: with no vehicle the cost-breakdown query is disabled and `data` is undefined.
            yield return RepositoryResult<TrueCostBreakdown>.Empty();
            yield break;
        }

        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"analytics:tco:{vid}");
        var request = new ApiRequest(
            Operations.Analytics.Tco,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                [VehicleQueryParam] = vid,
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
            yield return TrueCostResultMapper.Map(emission);
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
