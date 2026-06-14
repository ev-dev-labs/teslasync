using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews.Analytics;

/// <summary>
/// The repository-backed <see cref="IStatisticsSource"/> — the native data adapter for the Statistics page.
/// One logical read assembles the web page's five hooks into a single snapshot:
/// <list type="number">
///   <item>the vehicle roster from <c>GET /vehicles</c> (web <c>useSelectedVehicle</c>), selecting <c>vehicles[0]</c>;</item>
///   <item>that vehicle's lifetime period stats from <c>GET /analytics/period-stats?vehicle_id=…</c> (web
///         <c>statsQuery</c>) — the primary read whose presence is the page-level success/empty discriminator;</item>
///   <item>battery health from <c>GET /analytics/battery-health?vehicle_id=…</c> (web <c>useBatteryHealthAnalytics</c>);</item>
///   <item>mileage from <c>GET /mileage/stats?vehicle_id=…</c> (web <c>useMileageStats</c>);</item>
///   <item>the state distribution from <c>GET /vehicle-states/summary?vehicle_id=…</c> (web <c>useStateSummary</c>);</item>
///   <item>the fleet comparison from <c>GET /analytics/fleet?start=…</c> (web <c>useFleetAnalytics(30, startDate)</c>).</item>
/// </list>
/// The four secondary reads are fault-tolerant — an <see cref="ApiException"/> on any one yields its empty
/// affordance rather than failing the page (web: each is an independent query). Only the primary period-stats
/// read propagates its failure to the page error state. The assembled <see cref="StatisticsSnapshot"/> is cached
/// as JSON so the whole read replays cache-then-network through the shared <see cref="CacheThenNetworkEngine"/>.
/// No HTTP touches the view.
/// </summary>
public sealed class StatisticsSource : IStatisticsSource
{
    private const string VehicleIdParam = "vehicle_id";

    private static readonly ApiRequest VehiclesRequest = new(Operations.Vehicles.List);

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly Func<DateTimeOffset> _clock;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    /// <param name="api">The generated contract API client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The API client options carrying the JSON serializer settings.</param>
    /// <param name="clock">The clock used to compute the fleet <c>start</c> window (null = <see cref="DateTimeOffset.UtcNow"/>).</param>
    public StatisticsSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options, Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<StatisticsSnapshot>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<StatisticsSnapshot>(
            StatisticsRegistration.CacheKey,
            FetchAsync,
            static snapshot => !snapshot.HasData,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return emission;
        }
    }

    private async Task<StatisticsSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        // 1. Vehicle roster → the page's primary vehicle (web useSelectedVehicle, vehicles?.[0]). With no
        //    vehicle the per-vehicle queries are disabled (web enabled: !!activeId) → page-level empty state.
        var vehiclesJson = await _api.SendAsync<JsonElement>(VehiclesRequest, cancellationToken).ConfigureAwait(false);
        var vehicle = StatisticsVehicle.FromVehiclesArray(vehiclesJson);
        if (vehicle is null)
        {
            return StatisticsSnapshot.Empty;
        }

        long vehicleId = vehicle.Id;

        // 2. Primary period stats (web statsQuery). A failure here propagates to the page error state.
        var periodJson = await _api.SendAsync<JsonElement>(PerVehicle(StatisticsRegistration.PeriodStatsOperation, vehicleId), cancellationToken)
            .ConfigureAwait(false);
        var periodStats = StatisticsPeriodStats.FromJson(periodJson);

        // 3. Secondary reads (web useBatteryHealthAnalytics / useMileageStats / useStateSummary / useFleetAnalytics).
        //    Each is independent and fault-tolerant: an ApiException surfaces that section's empty affordance.
        var batteryJson = await TryReadAsync(PerVehicle(Operations.Analytics.BatteryHealth, vehicleId), cancellationToken).ConfigureAwait(false);
        var battery = batteryJson is { } bj ? StatisticsBatteryHealth.FromJson(bj) : null;

        var mileageJson = await TryReadAsync(PerVehicle(StatisticsRegistration.MileageStatsOperation, vehicleId), cancellationToken).ConfigureAwait(false);
        var mileage = mileageJson is { } mj ? StatisticsMileage.FromJson(mj) : null;

        var statesJson = await TryReadAsync(PerVehicle(StatisticsRegistration.StateSummaryOperation, vehicleId), cancellationToken).ConfigureAwait(false);
        var states = statesJson is { } sj ? StatisticsStateSlice.FromArray(sj) : [];

        var fleetJson = await TryReadAsync(FleetRequest(), cancellationToken).ConfigureAwait(false);
        var comparisons = fleetJson is { } fj ? StatisticsComparison.FromFleet(fj) : [];

        return new StatisticsSnapshot(periodStats, battery, mileage, states, comparisons);
    }

    private async Task<JsonElement?> TryReadAsync(ApiRequest request, CancellationToken cancellationToken)
    {
        try
        {
            return await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        }
        catch (ApiException)
        {
            // Web parity: a failed secondary query surfaces its own empty state, never the page error state.
            return null;
        }
    }

    private static ApiRequest PerVehicle(string operationId, long vehicleId) => new(
        operationId,
        Query: new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            [VehicleIdParam] = vehicleId.ToString(CultureInfo.InvariantCulture),
        });

    private ApiRequest FleetRequest() => new(
        Operations.Analytics.Fleet,
        Query: new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["start"] = StatisticsRegistration.FleetStartDate(_clock()),
        });
}
