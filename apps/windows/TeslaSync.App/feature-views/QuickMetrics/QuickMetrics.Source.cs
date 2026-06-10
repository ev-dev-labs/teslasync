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
/// The data port the <see cref="QuickMetricsViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of computed <see cref="QuickMetricsStats"/> for the primary (or explicit)
/// vehicle — the native analogue of the web parent's <c>useChargingSessionsPaginated(vehicleId)</c> query
/// feeding <c>computeStats(sessions)</c> (web/src/features/charging/pages/ChargingListPage.tsx). The view never
/// performs HTTP itself; the concrete <see cref="QuickMetricsSource"/> (or a test fake) drives this.
/// </summary>
public interface IQuickMetricsSource
{
    /// <summary>Stream the cache-then-network charging-stats snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<QuickMetricsStats>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IQuickMetricsSource"/> — the native data adapter for the QuickMetrics
/// surface. It first resolves the primary vehicle from the shared <see cref="IWidgetVehicleSource"/> (the native
/// analogue of the web page's selected-vehicle id), then runs one cache-then-network read of the
/// charging-sessions list (generated operation <c>get_api_v1_charging_sessions</c>, scoped by
/// <c>vehicle_id</c>) through the shared <see cref="CacheThenNetworkEngine"/>, caching the raw JSON so the
/// snake_case wire shape round-trips losslessly. Each emission is parsed and reduced to a
/// <see cref="QuickMetricsStats"/> via <see cref="QuickMetricsResultMapper"/>. When no vehicle is available the
/// read short-circuits to <see cref="RepositoryResult{T}.Empty()"/>, mirroring the web hook's disabled query
/// (<c>enabled: id &gt; 0</c>). No HTTP touches the view.
/// </summary>
public sealed class QuickMetricsSource : IQuickMetricsSource
{
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
    public QuickMetricsSource(
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
    public async IAsyncEnumerable<RepositoryResult<QuickMetricsStats>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vehicleId = await ResolveVehicleIdAsync(cancellationToken).ConfigureAwait(false);
        if (vehicleId is not { } vid)
        {
            // Web parity: with no vehicle the charging query is disabled and the stats are undefined.
            yield return RepositoryResult<QuickMetricsStats>.Empty();
            yield break;
        }

        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"charging:{vid}:quick-metrics");
        var request = new ApiRequest(
            Operations.Charging.Sessions,
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
            yield return QuickMetricsResultMapper.Map(emission);
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

    // The charging-sessions endpoint returns an array; a null / non-array / empty body carries no sessions to
    // aggregate (the whole-surface empty treatment), mirroring the web `computeStats` returning null.
    private static bool IsEmptyResponse(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Array => element.GetArrayLength() == 0,
        _ => false,
    };
}
