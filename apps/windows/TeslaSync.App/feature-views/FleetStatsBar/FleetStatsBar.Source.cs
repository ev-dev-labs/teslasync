using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="FleetStatsBarViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of aggregated <see cref="FleetStatsBarData"/> snapshots — the native analogue
/// of the props the dashboard <c>FleetStatsWidget</c> assembles from <c>useVehicles</c>,
/// <c>useFleetAnalytics(30)</c>, two recent-drive/charge queries and the unread-alert count before handing
/// them to <c>&lt;FleetStatsBar /&gt;</c> (web/src/features/dashboard/widgets/FleetStatsWidget.tsx). The view
/// never performs HTTP itself; the concrete <see cref="FleetStatsBarSource"/> (or a test fake) drives this.
/// </summary>
public interface IFleetStatsBarSource
{
    /// <summary>Stream the cache-then-network fleet-stats snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<FleetStatsBarData>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IFleetStatsBarSource"/> — the native data adapter for the Fleet-stats bar.
/// One logical read fans out, through the shared generated contract client, to the same endpoints the web
/// dashboard reads: <c>GET /vehicles</c> (roster + primary vehicle), <c>GET /analytics/fleet?days=30</c> (the
/// 30-day rollup), <c>GET /drives?vehicle_id=…</c> and <c>GET /charging-sessions?vehicle_id=…</c> (the recent
/// rows behind the two sparklines, scoped to the primary vehicle exactly as the web scopes them to
/// <c>vehicles[0].id</c>) and <c>GET /notifications/unread-count</c> (the Alerts panel). The vehicles read
/// resolves the primary vehicle first; the remaining four run concurrently. The assembled
/// <see cref="FleetStatsBarData"/> is cached as JSON so the snapshot round-trips losslessly and the whole
/// read replays cache-then-network through the shared <see cref="CacheThenNetworkEngine"/>. No HTTP touches
/// the view.
/// </summary>
public sealed class FleetStatsBarSource : IFleetStatsBarSource
{
    private const string CacheKey = "dashboard:fleet-stats-bar";
    private const string DaysQueryParam = "days";
    private const string VehicleQueryParam = "vehicle_id";

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly int _analyticsDays;
    private readonly int _recentLimit;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    public FleetStatsBarSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
        _analyticsDays = FleetStatsBarRegistration.AnalyticsDays;
        _recentLimit = FleetStatsBarRegistration.RecentLimit;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<FleetStatsBarData>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<FleetStatsBarData>(
            CacheKey,
            FetchAsync,
            static data => !data.HasData,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return emission;
        }
    }

    private async Task<FleetStatsBarData> FetchAsync(CancellationToken cancellationToken)
    {
        // 1. The vehicle roster gives the fleet/online counts and the primary vehicle the recent-drive/charge
        //    queries scope to (web: vehicles[0].id, the queries enabled only when primaryId > 0).
        var vehicles = await _api.SendAsync<JsonElement>(new ApiRequest(Operations.Vehicles.List), cancellationToken)
            .ConfigureAwait(false);
        long? primaryId = FirstVehicleId(vehicles);

        // 2. The remaining reads are independent of one another — run them concurrently. Drives/charges are
        //    skipped (empty) when there is no primary vehicle, mirroring the web's disabled queries.
        var analyticsTask = _api.SendAsync<JsonElement>(
            new ApiRequest(
                Operations.Analytics.Fleet,
                Query: new Dictionary<string, object?>(StringComparer.Ordinal) { [DaysQueryParam] = _analyticsDays }),
            cancellationToken);
        var unreadTask = _api.SendAsync<JsonElement>(
            new ApiRequest(Operations.Notifications.UnreadCount), cancellationToken);
        var drivesTask = RecentByVehicleAsync(Operations.Drives.List, primaryId, cancellationToken);
        var chargesTask = RecentByVehicleAsync(Operations.Charging.Sessions, primaryId, cancellationToken);

        await Task.WhenAll(analyticsTask, unreadTask, drivesTask, chargesTask).ConfigureAwait(false);

        return FleetStatsBarData.FromParts(
            analyticsTask.Result,
            vehicles,
            drivesTask.Result,
            chargesTask.Result,
            unreadTask.Result,
            _recentLimit);
    }

    private Task<JsonElement> RecentByVehicleAsync(string operationId, long? vehicleId, CancellationToken cancellationToken)
    {
        // web parity: the recent-drive/charge queries are enabled only when a primary vehicle exists; with
        // none, the sparkline falls back to a single flat point. A default JsonElement (Undefined) is treated
        // as an empty array by the parse, so no JsonDocument is allocated for the skipped case.
        if (vehicleId is not { } id)
        {
            return Task.FromResult(default(JsonElement));
        }

        var request = new ApiRequest(
            operationId,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal) { [VehicleQueryParam] = id });
        return _api.SendAsync<JsonElement>(request, cancellationToken);
    }

    // web: vehicles?.[0]?.id — the primary vehicle's database id, used as the recent-query vehicle filter.
    private static long? FirstVehicleId(JsonElement vehicles)
    {
        if (vehicles.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        foreach (var v in vehicles.EnumerateArray())
        {
            if (v.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            if (TryReadId(v, "id", out long id) || TryReadId(v, "vehicle_id", out id))
            {
                return id;
            }

            // Only the first roster entry is the primary; a malformed first row yields no primary.
            return null;
        }

        return null;
    }

    private static bool TryReadId(JsonElement obj, string name, out long id)
    {
        id = 0;
        if (!obj.TryGetProperty(name, out var v))
        {
            return false;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out id) => true,
            JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out id) => true,
            _ => false,
        };
    }
}
