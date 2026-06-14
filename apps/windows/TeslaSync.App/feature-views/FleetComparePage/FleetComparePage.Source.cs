using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews.Analytics;

/// <summary>
/// The data port the <see cref="FleetComparePageViewModel"/> binds to (P1/S8 state-holder seam). It yields
/// the cache-then-network sequence of assembled <see cref="FleetCompareData"/> snapshots — the native analogue
/// of the web page's roster query plus its per-vehicle <c>useVehicleState</c> / <c>useDrivingStats</c> /
/// <c>useCostBreakdown</c> / <c>useMonthlyMileage</c> fan-out
/// (web/src/features/analytics/pages/FleetComparePage.tsx). The view never performs HTTP itself; the concrete
/// <see cref="FleetCompareSource"/> (or a test fake) drives this.
/// </summary>
public interface IFleetCompareSource
{
    /// <summary>Stream the cache-then-network fleet-comparison snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<FleetCompareData>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IFleetCompareSource"/> — the native data adapter for the fleet-comparison
/// page. One logical read fans out, through the shared generated contract client, to the same endpoints the
/// web page reads: <c>GET /vehicles</c> for the roster (web <c>useVehicles</c>), then — concurrently per
/// vehicle — <c>GET /vehicles/{id}/state</c> (web <c>useVehicleState</c>), <c>GET /drives/stats</c>
/// (web <c>useDrivingStats</c>), <c>GET /analytics/tco</c> (web <c>useCostBreakdown</c>) and
/// <c>GET /mileage/monthly</c> (web <c>useMonthlyMileage</c>). A per-vehicle slice whose read fails is left
/// null (web parity: the disabled/errored query yields <c>undefined</c>). The assembled
/// <see cref="FleetCompareData"/> is cached as JSON so the snapshot round-trips losslessly and the whole read
/// replays cache-then-network through the shared <see cref="CacheThenNetworkEngine"/>. No HTTP touches the
/// view.
/// </summary>
public sealed class FleetCompareSource : IFleetCompareSource
{
    private const string CacheKey = "analytics:fleet-compare";
    private const string VehiclePathParam = "vehicleID";
    private const string VehicleQueryParam = "vehicle_id";

    // The generated endpoint id for GET /mileage/monthly (TeslaSync.Windows.Generated.Api.ApiEndpoints). It has
    // no dedicated Operations constant; the sibling MonthlyMileageWidget references it the same way.
    private const string MonthlyMileageOperation = "get_api_v1_mileage_monthly";

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    public FleetCompareSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<FleetCompareData>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<FleetCompareData>(
            CacheKey,
            FetchAsync,
            static data => !data.HasData,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return FleetCompareResultMapper.Map(emission);
        }
    }

    private async Task<FleetCompareData> FetchAsync(CancellationToken cancellationToken)
    {
        // 1. The roster gives every vehicle the comparison can render (web: useVehicles).
        var vehiclesJson = await _api.SendAsync<JsonElement>(new ApiRequest(Operations.Vehicles.List), cancellationToken)
            .ConfigureAwait(false);
        var refs = FleetCompareData.ParseVehicles(vehiclesJson);
        if (refs.Count == 0)
        {
            return FleetCompareData.Empty;
        }

        // 2. One bundle per vehicle, assembled concurrently (web: the per-vehicle queries run in parallel). The
        //    page only renders two at a time, but pre-fetching every roster vehicle keeps selection instant and
        //    matches the BatteryComparison fan-out precedent.
        var tasks = new Task<FleetCompareVehicleBundle>[refs.Count];
        for (int i = 0; i < refs.Count; i++)
        {
            tasks[i] = BundleAsync(refs[i].Id, cancellationToken);
        }

        var bundles = await Task.WhenAll(tasks).ConfigureAwait(false);
        return new FleetCompareData(refs, bundles);
    }

    private async Task<FleetCompareVehicleBundle> BundleAsync(long vehicleId, CancellationToken cancellationToken)
    {
        var stateTask = StateAsync(vehicleId, cancellationToken);
        var statsTask = StatsAsync(vehicleId, cancellationToken);
        var costTask = CostAsync(vehicleId, cancellationToken);
        var monthlyTask = MonthlyAsync(vehicleId, cancellationToken);

        await Task.WhenAll(stateTask, statsTask, costTask, monthlyTask).ConfigureAwait(false);

        return new FleetCompareVehicleBundle(
            vehicleId,
            stateTask.Result,
            statsTask.Result,
            costTask.Result,
            monthlyTask.Result);
    }

    private Task<FleetCompareVehicleState?> StateAsync(long vehicleId, CancellationToken cancellationToken) =>
        ReadAsync(
            ApiRequest.WithPath(Operations.Vehicles.State, VehiclePathParam, vehicleId.ToString(CultureInfo.InvariantCulture)),
            FleetCompareData.ParseState,
            cancellationToken);

    private Task<FleetCompareStats?> StatsAsync(long vehicleId, CancellationToken cancellationToken) =>
        ReadAsync(ScopedRequest(Operations.Drives.Stats, vehicleId), FleetCompareData.ParseStats, cancellationToken);

    private Task<FleetCompareCost?> CostAsync(long vehicleId, CancellationToken cancellationToken) =>
        ReadAsync(ScopedRequest(Operations.Analytics.Tco, vehicleId), FleetCompareData.ParseCost, cancellationToken);

    private async Task<IReadOnlyList<FleetCompareMonthlyBucket>> MonthlyAsync(long vehicleId, CancellationToken cancellationToken)
    {
        var parsed = await ReadAsync(
            ScopedRequest(MonthlyMileageOperation, vehicleId),
            json => (IReadOnlyList<FleetCompareMonthlyBucket>?)FleetCompareData.ParseMonthly(json),
            cancellationToken).ConfigureAwait(false);

        return parsed ?? Array.Empty<FleetCompareMonthlyBucket>();
    }

    // Web parity: a failed per-vehicle slice read leaves that slice out rather than failing the whole surface
    // (the web query's error/disabled state yields undefined). Cancellation is re-thrown so a superseding load
    // can drop the in-flight fetch.
    private async Task<T?> ReadAsync<T>(ApiRequest request, Func<JsonElement, T?> parse, CancellationToken cancellationToken)
        where T : class
    {
        try
        {
            var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
            return parse(json);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return null;
        }
    }

    private static ApiRequest ScopedRequest(string operation, long vehicleId) => new(
        operation,
        Query: new Dictionary<string, object?>(StringComparer.Ordinal) { [VehicleQueryParam] = vehicleId });
}

/// <summary>
/// An <see cref="IFleetCompareSource"/> that immediately yields a single empty result — the default feed the
/// parameterless <see cref="FleetComparePage"/> uses so the registered shell page renders the page-level empty
/// state without a data layer (the established W7 default-feed pattern). DI hosts and the headless tests inject
/// the repository-backed source (or a fake) to exercise the full state matrix.
/// </summary>
public sealed class EmptyFleetCompareSource : IFleetCompareSource
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyFleetCompareSource Instance { get; } = new();

    private EmptyFleetCompareSource()
    {
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<FleetCompareData>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        yield return RepositoryResult<FleetCompareData>.Empty();
        await Task.CompletedTask.ConfigureAwait(false);
    }
}
