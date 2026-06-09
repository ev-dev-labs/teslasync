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
/// The repository-backed <see cref="IDashboardStatsSource"/> — the native data adapter for the Dashboard
/// Stats surface. It resolves the primary (or explicit) vehicle from the shared
/// <see cref="IWidgetVehicleSource"/> (the native analogue of the web component's
/// <c>vehicleId ?? vehicles?.[0]?.id</c>), then runs up to three concurrent cache-then-network reads —
/// dashboard rollup (<c>GET /dashboard/stats</c>, the web <c>useDashboardStats</c> query, load-bearing
/// and vehicle-independent), FSM vehicle state (<c>GET /vehicles/{vehicleID}/state</c>, web
/// <c>useVehicleStateMachine</c>) and the FSM state timeline (<c>GET /vehicle-states/timeline</c>, web
/// <c>useStateTimeline</c>). Their emissions are combine-latest merged through
/// <see cref="DashboardStatsResultMapper"/> as each settles, so cached content surfaces fast and a slow /
/// failed FSM or timeline read only enriches (or silently omits) the badge and rows — the stats decide
/// loaded/empty/error, mirroring the web's <c>hasData = stats.data != null</c> gate. When no vehicle
/// exists only the dashboard read runs (web parity: the FSM queries are <c>enabled: !!vehicleId</c>). No
/// HTTP touches the view.
/// </summary>
public sealed class DashboardStatsSource : IDashboardStatsSource
{
    // The dashboard rollup and the FSM timeline have no Operations group yet (the dashboard handler and
    // the deprecated timeline route post-date the codegen seam captured in Operations.cs), so their ids
    // are referenced verbatim here — the only file scoped to this surface. Both resolve against
    // TeslaSync.Windows.Generated.Api.ApiEndpoints (verified present in api/openapi/teslasync.openapi.json).
    private const string DashboardStatsOperation = "get_api_v1_dashboard_stats";
    private const string StateTimelineOperation = "get_api_v1_vehicle_states_timeline";
    private const string VehiclePathParam = "vehicleID";
    private const string VehicleQueryParam = "vehicle_id";
    private const string DaysQueryParam = "days";
    private const int TimelineDays = 7; // web useStateTimeline default (days = 7)

    private readonly IWidgetVehicleSource _vehicles;
    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly long? _vehicleId;

    /// <summary>Creates the source over the vehicle source, contract client, engine and JSON settings.</summary>
    /// <param name="vehicles">Resolves the primary (or explicit) vehicle to scope the FSM reads to.</param>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    /// <param name="vehicleId">An explicit vehicle id; when null the primary cached vehicle is used.</param>
    public DashboardStatsSource(
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

    private enum DashboardPart
    {
        Stats,
        Fsm,
        Timeline,
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<DashboardStatsReading>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vid = await ResolveVehicleIdAsync(cancellationToken).ConfigureAwait(false);
        bool fsmActive = vid is not null;

        yield return RepositoryResult<DashboardStatsReading>.Loading();

        var channel = Channel.CreateUnbounded<MergeItem>(new UnboundedChannelOptions
        {
            SingleReader = true,
            SingleWriter = false,
        });

        var pumps = new List<Task>(3)
        {
            PumpAsync(DashboardPart.Stats, StatsStream(cancellationToken), channel.Writer, cancellationToken),
        };

        if (vid is { } vehicleId)
        {
            pumps.Add(PumpAsync(DashboardPart.Fsm, FsmStream(vehicleId, cancellationToken), channel.Writer, cancellationToken));
            pumps.Add(PumpAsync(DashboardPart.Timeline, TimelineStream(vehicleId, cancellationToken), channel.Writer, cancellationToken));
        }

        var pumpAll = Task.WhenAll(pumps);

        // Complete the channel once every pump finishes; accessing t.Exception observes any pump fault so
        // the reader surfaces it (and no task goes unobserved). Cancellation flows cleanly via ReadAllAsync.
        _ = pumpAll.ContinueWith(
            static (t, writer) => ((ChannelWriter<MergeItem>)writer!).TryComplete(t.Exception),
            channel.Writer,
            CancellationToken.None,
            TaskContinuationOptions.ExecuteSynchronously,
            TaskScheduler.Default);

        var stats = RepositoryResult<JsonElement>.Loading();
        var fsm = RepositoryResult<JsonElement>.Loading();
        var timeline = RepositoryResult<JsonElement>.Loading();

        await foreach (var item in channel.Reader.ReadAllAsync(cancellationToken).ConfigureAwait(false))
        {
            switch (item.Part)
            {
                case DashboardPart.Stats:
                    stats = item.Result;
                    break;
                case DashboardPart.Fsm:
                    fsm = item.Result;
                    break;
                default:
                    timeline = item.Result;
                    break;
            }

            // Web parity: the loading gate is `stats.isLoading || fsm.isLoading` — the timeline never gates.
            if (stats.Status == LoadStatus.Loading || (fsmActive && fsm.Status == LoadStatus.Loading))
            {
                continue;
            }

            var fsmArg = fsmActive && fsm.Status != LoadStatus.Loading ? (RepositoryResult<JsonElement>?)fsm : null;
            var timelineArg = fsmActive && timeline.Status != LoadStatus.Loading ? (RepositoryResult<JsonElement>?)timeline : null;
            yield return DashboardStatsResultMapper.Combine(stats, fsmArg, timelineArg);
        }
    }

    private static async Task PumpAsync(
        DashboardPart part,
        IAsyncEnumerable<RepositoryResult<JsonElement>> stream,
        ChannelWriter<MergeItem> writer,
        CancellationToken cancellationToken)
    {
        await foreach (var result in stream.ConfigureAwait(false))
        {
            await writer.WriteAsync(new MergeItem(part, result), cancellationToken).ConfigureAwait(false);
        }
    }

    // Web parity: only an absent / null body counts as empty for the load-bearing stats read (the backend
    // always returns a populated object — an idle fleet renders as zeros, not as the empty surface).
    private static bool IsStatsEmpty(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        _ => false,
    };

    // A null / non-object body for the FSM or timeline read contributes nothing (state → —, rows → none).
    private static bool IsEnrichmentEmpty(JsonElement element) => element.ValueKind != JsonValueKind.Object;

    private async Task<long?> ResolveVehicleIdAsync(CancellationToken cancellationToken)
    {
        if (_vehicleId is { } explicitId)
        {
            var explicitSnapshot = await _vehicles.GetAsync(explicitId, cancellationToken).ConfigureAwait(false);
            if (explicitSnapshot is not null)
            {
                return explicitSnapshot.VehicleId;
            }
        }

        var primary = await _vehicles.GetPrimaryAsync(cancellationToken).ConfigureAwait(false);
        return primary?.VehicleId;
    }

    private IAsyncEnumerable<RepositoryResult<JsonElement>> StatsStream(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(DashboardStatsOperation);
        return Stream("dashboard:stats", request, IsStatsEmpty, cancellationToken);
    }

    private IAsyncEnumerable<RepositoryResult<JsonElement>> FsmStream(long vid, CancellationToken cancellationToken)
    {
        var request = new ApiRequest(
            Operations.Vehicles.State,
            PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [VehiclePathParam] = vid.ToString(CultureInfo.InvariantCulture),
            });
        return Stream(
            string.Create(CultureInfo.InvariantCulture, $"vehicles:{vid}:dashboard-stats:state"),
            request,
            IsEnrichmentEmpty,
            cancellationToken);
    }

    private IAsyncEnumerable<RepositoryResult<JsonElement>> TimelineStream(long vid, CancellationToken cancellationToken)
    {
        var request = new ApiRequest(
            StateTimelineOperation,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                [VehicleQueryParam] = vid,
                [DaysQueryParam] = TimelineDays,
            });
        return Stream(
            string.Create(CultureInfo.InvariantCulture, $"vehicles:{vid}:dashboard-stats:timeline"),
            request,
            IsEnrichmentEmpty,
            cancellationToken);
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

    private readonly record struct MergeItem(DashboardPart Part, RepositoryResult<JsonElement> Result);
}
