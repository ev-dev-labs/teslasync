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
/// The repository-backed <see cref="IStateTimelineSource"/> — the native data adapter for the State
/// Timeline surface. It resolves the primary (or explicit) vehicle from the shared
/// <see cref="IWidgetVehicleSource"/> (the native analogue of the web component's
/// <c>vehicleId ?? vehicles?.[0]?.id</c>), then runs two concurrent cache-then-network reads — the
/// load-bearing state-distribution summary (<c>GET /vehicle-states/summary</c>, the web
/// <c>useStateSummary</c> query) and the enrichment 24-hour transition timeline
/// (<c>GET /vehicle-states/timeline</c>, the web <c>useTimeline</c> query). Their emissions are
/// combine-latest merged through <see cref="StateTimelineResultMapper"/> as each settles, so cached content
/// surfaces fast and a slow / failed timeline read only enriches (or silently omits) the wide stripe — the
/// summary alone decides loaded / empty / error, mirroring the web's <c>hasData = segments.length &gt; 0</c>
/// gate. Both routes were retired in Phase-42 (the hooks are <c>@deprecated</c> and the endpoints 404), so
/// the surface degrades to the empty state in practice — faithfully reproducing the web. When no vehicle
/// exists the read short-circuits to <see cref="RepositoryResult{T}.Empty"/> (web parity: both queries are
/// <c>enabled: !!vehicleId</c>). No HTTP touches the view.
/// </summary>
public sealed class StateTimelineSource : IStateTimelineSource
{
    // The deprecated state-summary / state-timeline routes post-date the Operations.cs codegen seam, so
    // their generated operation ids are referenced verbatim here — both resolve against
    // TeslaSync.Windows.Generated.Api.ApiEndpoints (present, and already consumed by DashboardStatsSource).
    private const string SummaryOperation = "get_api_v1_vehicle_states_summary";
    private const string TimelineOperation = "get_api_v1_vehicle_states_timeline";
    private const string VehicleQueryParam = "vehicle_id";

    private readonly IWidgetVehicleSource _vehicles;
    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly long? _vehicleId;

    /// <summary>Creates the source over the vehicle source, contract client, engine and JSON settings.</summary>
    /// <param name="vehicles">Resolves the primary (or explicit) vehicle to scope both reads to.</param>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    /// <param name="vehicleId">An explicit vehicle id; when null the primary cached vehicle is used.</param>
    public StateTimelineSource(
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

    private enum TimelinePart
    {
        Summary,
        Timeline,
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<StateTimelineReading>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vid = await ResolveVehicleIdAsync(cancellationToken).ConfigureAwait(false);
        if (vid is not { } vehicleId)
        {
            // Web parity: with no vehicle both queries are disabled and `segments` is empty → empty surface.
            yield return RepositoryResult<StateTimelineReading>.Empty();
            yield break;
        }

        yield return RepositoryResult<StateTimelineReading>.Loading();

        var channel = Channel.CreateUnbounded<MergeItem>(new UnboundedChannelOptions
        {
            SingleReader = true,
            SingleWriter = false,
        });

        var pumps = new List<Task>(2)
        {
            PumpAsync(TimelinePart.Summary, SummaryStream(vehicleId, cancellationToken), channel.Writer, cancellationToken),
            PumpAsync(TimelinePart.Timeline, TimelineStream(vehicleId, cancellationToken), channel.Writer, cancellationToken),
        };

        var pumpAll = Task.WhenAll(pumps);

        // Complete the channel once every pump finishes; accessing t.Exception observes any pump fault so the
        // reader surfaces it (and no task goes unobserved). Cancellation flows cleanly via ReadAllAsync.
        _ = pumpAll.ContinueWith(
            static (t, writer) => ((ChannelWriter<MergeItem>)writer!).TryComplete(t.Exception),
            channel.Writer,
            CancellationToken.None,
            TaskContinuationOptions.ExecuteSynchronously,
            TaskScheduler.Default);

        var summary = RepositoryResult<JsonElement>.Loading();
        var timeline = RepositoryResult<JsonElement>.Loading();

        await foreach (var item in channel.Reader.ReadAllAsync(cancellationToken).ConfigureAwait(false))
        {
            if (item.Part == TimelinePart.Summary)
            {
                summary = item.Result;
            }
            else
            {
                timeline = item.Result;
            }

            // Web parity: the load-bearing summary gates the first content emission; the timeline never gates.
            if (summary.Status == LoadStatus.Loading)
            {
                continue;
            }

            var timelineArg = timeline.Status != LoadStatus.Loading ? (RepositoryResult<JsonElement>?)timeline : null;
            yield return StateTimelineResultMapper.Combine(summary, timelineArg);
        }
    }

    private static async Task PumpAsync(
        TimelinePart part,
        IAsyncEnumerable<RepositoryResult<JsonElement>> stream,
        ChannelWriter<MergeItem> writer,
        CancellationToken cancellationToken)
    {
        await foreach (var result in stream.ConfigureAwait(false))
        {
            await writer.WriteAsync(new MergeItem(part, result), cancellationToken).ConfigureAwait(false);
        }
    }

    // A null / non-array (and non-enveloped) body carries no segments / transitions → treated as empty.
    private static bool IsEmptyResponse(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Array => element.GetArrayLength() == 0,
        JsonValueKind.Object => !element.EnumerateObject().MoveNext(),
        _ => false,
    };

    private async Task<long?> ResolveVehicleIdAsync(CancellationToken cancellationToken)
    {
        if (_vehicleId is { } explicitId)
        {
            var explicitSnapshot = await _vehicles.GetAsync(explicitId, cancellationToken).ConfigureAwait(false);
            if (explicitSnapshot is not null)
            {
                return explicitSnapshot.VehicleId;
            }

            return explicitId;
        }

        var primary = await _vehicles.GetPrimaryAsync(cancellationToken).ConfigureAwait(false);
        return primary?.VehicleId;
    }

    private IAsyncEnumerable<RepositoryResult<JsonElement>> SummaryStream(long vid, CancellationToken cancellationToken)
    {
        var request = new ApiRequest(
            SummaryOperation,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal) { [VehicleQueryParam] = vid });
        return Stream(
            string.Create(CultureInfo.InvariantCulture, $"vehicles:{vid}:state-timeline:summary"),
            request,
            cancellationToken);
    }

    private IAsyncEnumerable<RepositoryResult<JsonElement>> TimelineStream(long vid, CancellationToken cancellationToken)
    {
        var request = new ApiRequest(
            TimelineOperation,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal) { [VehicleQueryParam] = vid });
        return Stream(
            string.Create(CultureInfo.InvariantCulture, $"vehicles:{vid}:state-timeline:timeline"),
            request,
            cancellationToken);
    }

    private IAsyncEnumerable<RepositoryResult<JsonElement>> Stream(
        string cacheKey,
        ApiRequest request,
        CancellationToken cancellationToken) =>
        _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmptyResponse,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

    private readonly record struct MergeItem(TimelinePart Part, RepositoryResult<JsonElement> Result);
}
