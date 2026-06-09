using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Threading.Channels;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.DashboardWidgets.FleetStatsBar;

/// <summary>
/// The repository-backed <see cref="IFleetStatsBarSource"/> — the native data adapter for the Fleet Stats
/// Bar surface. It runs two concurrent cache-then-network reads — the vehicle list
/// (<c>GET /vehicles</c>, generated operation <c>get_api_v1_vehicles</c>) and the fleet analytics rollup
/// (<c>GET /analytics/fleet?days=30</c>, <c>get_api_v1_analytics_fleet</c>) — the native analogue of the
/// web component's <c>useVehicles</c> + <c>useFleetAnalytics(30)</c> queries. Their raw JSON emissions are
/// combine-latest merged through <see cref="FleetStatsBarResultMapper.Combine"/> as each settles, so cached
/// content surfaces fast and the header freshness tracks the analytics read. No HTTP touches the view.
/// </summary>
public sealed class FleetStatsBarSource : IFleetStatsBarSource
{
    private const string VehiclesCacheKey = "vehicles:fleet-stats-bar:list";
    private const string FleetCacheKey = "analytics:fleet-stats-bar:summary";

    private static readonly ApiRequest VehiclesRequest = new(Operations.Vehicles.List);

    private static readonly ApiRequest FleetRequest = new(
        Operations.Analytics.Fleet,
        Query: new Dictionary<string, object?> { ["days"] = FleetStatsBarRegistration.DefaultDays });

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    public FleetStatsBarSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    private enum Part
    {
        Vehicles,
        Fleet,
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<FleetStats>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var channel = Channel.CreateUnbounded<MergeItem>(new UnboundedChannelOptions
        {
            SingleReader = true,
            SingleWriter = false,
        });

        var pumpAll = Task.WhenAll(
            PumpAsync(Part.Vehicles, VehiclesStream(cancellationToken), channel.Writer, cancellationToken),
            PumpAsync(Part.Fleet, FleetStream(cancellationToken), channel.Writer, cancellationToken));

        // Complete the channel once both pumps finish; accessing t.Exception observes any pump fault so the
        // reader surfaces it (and no task goes unobserved). Cancellation flows cleanly via ReadAllAsync.
        _ = pumpAll.ContinueWith(
            static (t, writer) => ((ChannelWriter<MergeItem>)writer!).TryComplete(t.Exception),
            channel.Writer,
            CancellationToken.None,
            TaskContinuationOptions.ExecuteSynchronously,
            TaskScheduler.Default);

        var vehicles = RepositoryResult<JsonElement>.Loading();
        var fleet = RepositoryResult<JsonElement>.Loading();

        await foreach (var item in channel.Reader.ReadAllAsync(cancellationToken).ConfigureAwait(false))
        {
            if (item.Part == Part.Vehicles)
            {
                vehicles = item.Result;
            }
            else
            {
                fleet = item.Result;
            }

            yield return FleetStatsBarResultMapper.Combine(vehicles, fleet);
        }
    }

    private static async Task PumpAsync(
        Part part,
        IAsyncEnumerable<RepositoryResult<JsonElement>> stream,
        ChannelWriter<MergeItem> writer,
        CancellationToken cancellationToken)
    {
        await foreach (var result in stream.ConfigureAwait(false))
        {
            await writer.WriteAsync(new MergeItem(part, result), cancellationToken).ConfigureAwait(false);
        }
    }

    // Web parity: an empty vehicle list ([]) contributes a zero count (vehicles.length === 0), and a
    // non-array body carries no vehicles either — both collapse to the empty terminal.
    private static bool IsEmptyVehicles(JsonElement element) =>
        element.ValueKind != JsonValueKind.Array || element.GetArrayLength() == 0;

    // Web parity: in JS any resolved analytics object is truthy (even {}), so only a null/non-object body
    // is treated as "no analytics".
    private static bool IsEmptyFleet(JsonElement element) => element.ValueKind != JsonValueKind.Object;

    private IAsyncEnumerable<RepositoryResult<JsonElement>> VehiclesStream(CancellationToken cancellationToken) =>
        _engine.StreamAsync<JsonElement>(
            VehiclesCacheKey,
            ct => _api.SendAsync<JsonElement>(VehiclesRequest, ct),
            IsEmptyVehicles,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

    private IAsyncEnumerable<RepositoryResult<JsonElement>> FleetStream(CancellationToken cancellationToken) =>
        _engine.StreamAsync<JsonElement>(
            FleetCacheKey,
            ct => _api.SendAsync<JsonElement>(FleetRequest, ct),
            IsEmptyFleet,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

    private readonly record struct MergeItem(Part Part, RepositoryResult<JsonElement> Result);
}
