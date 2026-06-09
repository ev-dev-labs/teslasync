using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Threading.Channels;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The repository-backed <see cref="IFleetStatsSource"/> — the native data adapter for the Fleet Stats
/// surface. It mirrors the web component's four hooks
/// (web/src/features/dashboard/widgets/FleetStatsWidget.tsx): a cache-then-network read of
/// <c>GET /analytics/fleet?days=30</c> (the spine — generated operation <c>get_api_v1_analytics_fleet</c>,
/// web <c>useFleetAnalytics(30)</c>), the vehicle list (<c>GET /vehicles</c>, web <c>useVehicles</c>) for
/// the fleet-size + online counts, and the primary vehicle's recent drives (<c>GET /drives?vehicle_id=</c>)
/// and recent charges (<c>GET /charging?vehicle_id=</c>) that back the two sparklines. The primary vehicle
/// is resolved once from the shared <see cref="IWidgetVehicleSource"/> (the native analogue of
/// <c>vehicles?.[0]?.id</c>); with no vehicle the drive/charge reads short-circuit to
/// <see cref="RepositoryResult{T}.Empty"/>, mirroring the web hooks' disabled queries
/// (<c>enabled: primaryId &gt; 0</c>). All four emissions are combine-latest merged through
/// <see cref="FleetStatsResultMapper"/> as each settles — only the analytics read gates the surface, so the
/// counts and sparklines fill in as they arrive (web parity: only <c>useFleetAnalytics</c> is wired to
/// <c>WidgetShell</c>). No HTTP touches the view.
/// </summary>
public sealed class FleetStatsSource : IFleetStatsSource
{
    private const string VehiclesListCacheKey = "vehicles:list";
    private const string VehicleQueryParam = "vehicle_id";

    private readonly IWidgetVehicleSource _vehicles;
    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the vehicle source, contract client, cache-then-network engine and JSON settings.</summary>
    /// <param name="vehicles">Resolves the primary vehicle to scope the recent-drive/charge reads to.</param>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    public FleetStatsSource(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(vehicles);
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _vehicles = vehicles;
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    private enum FleetPart
    {
        Analytics,
        Vehicles,
        Drives,
        Charges,
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<FleetStatsReading>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        yield return RepositoryResult<FleetStatsReading>.Loading();

        long? primaryId = await ResolvePrimaryIdAsync(cancellationToken).ConfigureAwait(false);

        var channel = Channel.CreateUnbounded<MergeItem>(new UnboundedChannelOptions
        {
            SingleReader = true,
            SingleWriter = false,
        });

        var pumpAll = Task.WhenAll(
            PumpAsync(FleetPart.Analytics, AnalyticsStream(cancellationToken), channel.Writer, cancellationToken),
            PumpAsync(FleetPart.Vehicles, VehiclesStream(cancellationToken), channel.Writer, cancellationToken),
            PumpAsync(FleetPart.Drives, DrivesStream(primaryId, cancellationToken), channel.Writer, cancellationToken),
            PumpAsync(FleetPart.Charges, ChargesStream(primaryId, cancellationToken), channel.Writer, cancellationToken));

        // Complete the channel once every pump finishes; accessing t.Exception observes any pump fault so the
        // reader surfaces it (and no task goes unobserved). Cancellation is delivered cleanly via ReadAllAsync.
        _ = pumpAll.ContinueWith(
            static (t, writer) => ((ChannelWriter<MergeItem>)writer!).TryComplete(t.Exception),
            channel.Writer,
            CancellationToken.None,
            TaskContinuationOptions.ExecuteSynchronously,
            TaskScheduler.Default);

        var analytics = RepositoryResult<JsonElement>.Loading();
        var vehicles = RepositoryResult<JsonElement>.Loading();
        var drives = RepositoryResult<JsonElement>.Loading();
        var charges = RepositoryResult<JsonElement>.Loading();

        await foreach (var item in channel.Reader.ReadAllAsync(cancellationToken).ConfigureAwait(false))
        {
            switch (item.Part)
            {
                case FleetPart.Analytics:
                    analytics = item.Result;
                    break;
                case FleetPart.Vehicles:
                    vehicles = item.Result;
                    break;
                case FleetPart.Drives:
                    drives = item.Result;
                    break;
                default:
                    charges = item.Result;
                    break;
            }

            // Web parity: the fleet-analytics read is the only WidgetShell query, so it alone gates the surface.
            if (analytics.Status == LoadStatus.Loading)
            {
                continue;
            }

            yield return FleetStatsResultMapper.Combine(analytics, vehicles, drives, charges);
        }
    }

    private static async Task PumpAsync(
        FleetPart part,
        IAsyncEnumerable<RepositoryResult<JsonElement>> stream,
        ChannelWriter<MergeItem> writer,
        CancellationToken cancellationToken)
    {
        await foreach (var result in stream.ConfigureAwait(false))
        {
            await writer.WriteAsync(new MergeItem(part, result), cancellationToken).ConfigureAwait(false);
        }
    }

    private async Task<long?> ResolvePrimaryIdAsync(CancellationToken cancellationToken)
    {
        var primary = await _vehicles.GetPrimaryAsync(cancellationToken).ConfigureAwait(false);
        return primary?.VehicleId;
    }

    private IAsyncEnumerable<RepositoryResult<JsonElement>> AnalyticsStream(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(
            Operations.Analytics.Fleet,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["days"] = FleetStatsRegistration.DefaultDays,
            });
        return Stream("analytics:fleet:fleet-stats", request, IsEmptyObject, cancellationToken);
    }

    private IAsyncEnumerable<RepositoryResult<JsonElement>> VehiclesStream(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(Operations.Vehicles.List);
        return Stream(VehiclesListCacheKey, request, IsEmptyArray, cancellationToken);
    }

    private async IAsyncEnumerable<RepositoryResult<JsonElement>> DrivesStream(
        long? vehicleId,
        [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        if (vehicleId is not { } vid)
        {
            // Web parity: with no vehicle the recent-drives query is disabled and `recentDrives` is undefined.
            yield return RepositoryResult<JsonElement>.Empty();
            yield break;
        }

        var request = new ApiRequest(
            Operations.Drives.List,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                [VehicleQueryParam] = vid,
            });

        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"drives:{vid}:fleet-stats");
        await foreach (var emission in Stream(cacheKey, request, IsEmptyArray, cancellationToken).ConfigureAwait(false))
        {
            yield return emission;
        }
    }

    private async IAsyncEnumerable<RepositoryResult<JsonElement>> ChargesStream(
        long? vehicleId,
        [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        if (vehicleId is not { } vid)
        {
            // Web parity: with no vehicle the recent-charges query is disabled and `recentCharges` is undefined.
            yield return RepositoryResult<JsonElement>.Empty();
            yield break;
        }

        var request = new ApiRequest(
            Operations.Charging.Sessions,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                [VehicleQueryParam] = vid,
            });

        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"charging:{vid}:fleet-stats");
        await foreach (var emission in Stream(cacheKey, request, IsEmptyArray, cancellationToken).ConfigureAwait(false))
        {
            yield return emission;
        }
    }

    private IAsyncEnumerable<RepositoryResult<JsonElement>> Stream(
        string cacheKey,
        ApiRequest request,
        Func<JsonElement, bool> isEmpty,
        CancellationToken cancellationToken) =>
        _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            isEmpty,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

    private static bool IsEmptyObject(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Object => !element.EnumerateObject().MoveNext(),
        _ => false,
    };

    private static bool IsEmptyArray(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Array => element.GetArrayLength() == 0,
        _ => false,
    };

    private readonly record struct MergeItem(FleetPart Part, RepositoryResult<JsonElement> Result);
}
