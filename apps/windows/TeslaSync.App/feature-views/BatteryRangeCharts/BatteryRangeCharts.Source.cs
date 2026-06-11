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
/// The data port the <see cref="BatteryRangeChartsViewModel"/> binds to (P1/S8 state-holder seam). It yields
/// the cache-then-network sequence of assembled <see cref="BatteryRangeChartsData"/> snapshots — the native
/// analogue of the <c>state</c> + <c>drives</c> props the web Vehicle-Detail page hands
/// <c>&lt;BatteryRangeCharts /&gt;</c>
/// (web/src/features/vehicles/components/vehicle-detail/BatteryRangeCharts.tsx). The view never performs HTTP
/// itself; the concrete <see cref="BatteryRangeChartsSource"/> (or a test fake) drives this.
/// </summary>
public interface IBatteryRangeChartsSource
{
    /// <summary>Stream the cache-then-network battery-range snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<BatteryRangeChartsData>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IBatteryRangeChartsSource"/> — the native data adapter for the
/// Battery-Range surface. One logical read resolves the vehicle to plot, then fans out, through the shared
/// generated contract client, to the two endpoints the web page assembles its props from:
/// <list type="number">
///   <item>The vehicle: an explicit <c>vehicleId</c> wins; otherwise the primary vehicle is resolved from the
///         shared <see cref="IWidgetVehicleSource"/> (the native analogue of the page's selected vehicle).
///         No vehicle → <see cref="BatteryRangeChartsData.Empty"/> without touching the API (the web disabled
///         query).</item>
///   <item>The live state (<c>GET /vehicles/{vehicleID}/state</c>,
///         <see cref="Operations.Vehicles.State"/>, the web <c>useVehicleState</c>) and that vehicle's recent
///         drives (<c>GET /drives?vehicle_id=…</c>, <see cref="Operations.Drives.List"/>, the web
///         <c>useDrives</c>) run concurrently and fold into one <see cref="BatteryRangeChartsData"/>.</item>
/// </list>
/// The assembled snapshot is cached as JSON so it round-trips losslessly and the whole read replays
/// cache-then-network through the shared <see cref="CacheThenNetworkEngine"/>. No HTTP touches the view.
/// </summary>
public sealed class BatteryRangeChartsSource : IBatteryRangeChartsSource
{
    private const string VehiclePathParam = "vehicleID";
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
    public BatteryRangeChartsSource(
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
    public async IAsyncEnumerable<RepositoryResult<BatteryRangeChartsData>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        string cacheKey = CacheKey();
        var raw = _engine.StreamAsync<BatteryRangeChartsData>(
            cacheKey,
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

    private async Task<BatteryRangeChartsData> FetchAsync(CancellationToken cancellationToken)
    {
        long? vehicleId = await ResolveVehicleIdAsync(cancellationToken).ConfigureAwait(false);
        if (vehicleId is not { } vid)
        {
            // Web parity: with no vehicle the state/drives queries are disabled and the surface is empty.
            return BatteryRangeChartsData.Empty;
        }

        // The two reads are independent of one another — run them concurrently (web's two hooks fire in
        // parallel). The drive list is best-effort: a drive-list failure leaves the trend chart empty rather
        // than failing the whole surface, mirroring the web's independent query.
        var stateTask = _api.SendAsync<JsonElement>(StateRequest(vid), cancellationToken);
        var drivesTask = DrivesAsync(vid, cancellationToken);

        await Task.WhenAll(stateTask, drivesTask).ConfigureAwait(false);
        return BatteryRangeChartsData.FromParts(stateTask.Result, drivesTask.Result);
    }

    private async Task<JsonElement> DrivesAsync(long vehicleId, CancellationToken cancellationToken)
    {
        try
        {
            return await _api.SendAsync<JsonElement>(DrivesRequest(vehicleId), cancellationToken)
                .ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Best-effort: the trend chart falls back to its inner empty state (web disabled/failed query).
            return default;
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

    private static ApiRequest StateRequest(long vehicleId) => new(
        Operations.Vehicles.State,
        PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
        {
            [VehiclePathParam] = vehicleId.ToString(CultureInfo.InvariantCulture),
        });

    private static ApiRequest DrivesRequest(long vehicleId) => new(
        Operations.Drives.List,
        Query: new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            [VehicleQueryParam] = vehicleId,
        });

    private string CacheKey() => _vehicleId is { } id
        ? string.Create(CultureInfo.InvariantCulture, $"vehicles:{id}:battery-range-charts")
        : "vehicles:primary:battery-range-charts";
}
