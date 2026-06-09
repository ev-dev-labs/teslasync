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
/// The data port the <see cref="WatchSummaryViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of combined watch readings — the native analogue of the web
/// <c>useWatchSummary</c> + <c>useWatchComplication</c> hook composition
/// (web/src/features/dashboard/widgets/WatchSummaryWidget.tsx). The view never performs HTTP itself; the
/// concrete <see cref="WatchSummarySource"/> (or a test fake) drives this.
/// </summary>
public interface IWatchSummarySource
{
    /// <summary>Stream the cache-then-network watch readings, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<WatchSummaryReading>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IWatchSummarySource"/> — the native data adapter for the Watch Summary
/// surface. It resolves the primary (or explicit) vehicle from the shared <see cref="IWidgetVehicleSource"/>
/// (the native analogue of the web component's <c>vehicleId</c> prop), then runs two concurrent
/// cache-then-network reads — the load-bearing watch summary (<c>GET /watch/summary</c>, generated operation
/// <c>get_api_v1_watch_summary</c>, the web <c>useWatchSummary</c> query) and the enrichment complication
/// (<c>GET /watch/complication</c>, generated operation <c>get_api_v1_watch_complication</c>, the web
/// <c>useWatchComplication</c> query). Their emissions are combine-latest merged through
/// <see cref="WatchSummaryResultMapper"/> once both settle, so cached content surfaces fast and a slow / failed
/// complication only omits the charging affordance — the summary alone decides loaded / empty / error,
/// mirroring the web <c>hasData = summary != null</c> gate. Unlike the vehicle-gated drive surfaces, the web
/// watch queries are never disabled, so the read always runs; the resolved vehicle id is forwarded as the
/// optional <c>vehicle_id</c> query (web <c>?vehicle_id=…</c>) only when one is available. No HTTP touches the
/// view.
/// </summary>
public sealed class WatchSummarySource : IWatchSummarySource
{
    // Generated operation ids (TeslaSync.Windows.Generated.Api.ApiEndpoints); asserted by the source tests.
    private const string SummaryOperation = "get_api_v1_watch_summary";
    private const string ComplicationOperation = "get_api_v1_watch_complication";
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
    public WatchSummarySource(
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

    private enum WatchPart
    {
        Summary,
        Complication,
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<WatchSummaryReading>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        // Web parity: the watch queries are never disabled — they run with or without a resolved vehicle, the
        // id being forwarded as the optional vehicle_id query only when one is available.
        long? vid = await ResolveVehicleIdAsync(cancellationToken).ConfigureAwait(false);

        yield return RepositoryResult<WatchSummaryReading>.Loading();

        var channel = Channel.CreateUnbounded<MergeItem>(new UnboundedChannelOptions
        {
            SingleReader = true,
            SingleWriter = false,
        });

        var pumps = new List<Task>(2)
        {
            PumpAsync(WatchPart.Summary, SummaryStream(vid, cancellationToken), channel.Writer, cancellationToken),
            PumpAsync(WatchPart.Complication, ComplicationStream(vid, cancellationToken), channel.Writer, cancellationToken),
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
        var complication = RepositoryResult<JsonElement>.Loading();

        await foreach (var item in channel.Reader.ReadAllAsync(cancellationToken).ConfigureAwait(false))
        {
            if (item.Part == WatchPart.Summary)
            {
                summary = item.Result;
            }
            else
            {
                complication = item.Result;
            }

            // Web parity: isLoading = summaryLoading || compLoading — the shell stays in its skeleton until both
            // reads have produced their first non-loading emission, then the summary gates the content.
            if (summary.Status == LoadStatus.Loading || complication.Status == LoadStatus.Loading)
            {
                continue;
            }

            yield return WatchSummaryResultMapper.Combine(summary, complication);
        }
    }

    private static async Task PumpAsync(
        WatchPart part,
        IAsyncEnumerable<RepositoryResult<JsonElement>> stream,
        ChannelWriter<MergeItem> writer,
        CancellationToken cancellationToken)
    {
        await foreach (var result in stream.ConfigureAwait(false))
        {
            await writer.WriteAsync(new MergeItem(part, result), cancellationToken).ConfigureAwait(false);
        }
    }

    // An absent / non-object body carries no usable watch summary → treated as the empty surface.
    private static bool IsEmptySummary(JsonElement element) => WatchSummaryData.FromResponse(element) is null;

    // The complication is enrichment only; an absent / non-object body simply yields charging = false.
    private static bool IsEmptyComplication(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Object => !element.EnumerateObject().MoveNext(),
        _ => false,
    };

    private async Task<long?> ResolveVehicleIdAsync(CancellationToken cancellationToken)
    {
        if (_vehicleId is { } explicitId)
        {
            var explicitSnapshot = await _vehicles.GetAsync(explicitId, cancellationToken).ConfigureAwait(false);
            return explicitSnapshot?.VehicleId ?? explicitId;
        }

        var primary = await _vehicles.GetPrimaryAsync(cancellationToken).ConfigureAwait(false);
        return primary?.VehicleId;
    }

    private IAsyncEnumerable<RepositoryResult<JsonElement>> SummaryStream(long? vid, CancellationToken cancellationToken)
    {
        var request = new ApiRequest(SummaryOperation, Query: VehicleQuery(vid));
        return Stream(CacheKey("summary", vid), request, IsEmptySummary, cancellationToken);
    }

    private IAsyncEnumerable<RepositoryResult<JsonElement>> ComplicationStream(long? vid, CancellationToken cancellationToken)
    {
        var request = new ApiRequest(ComplicationOperation, Query: VehicleQuery(vid));
        return Stream(CacheKey("complication", vid), request, IsEmptyComplication, cancellationToken);
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

    private static Dictionary<string, object?>? VehicleQuery(long? vid)
    {
        if (vid is not { } id)
        {
            return null;
        }

        return new Dictionary<string, object?>(StringComparer.Ordinal) { [VehicleQueryParam] = id };
    }

    private static string CacheKey(string part, long? vid) =>
        vid is { } id
            ? string.Create(CultureInfo.InvariantCulture, $"watch:{id}:{part}")
            : string.Create(CultureInfo.InvariantCulture, $"watch:primary:{part}");

    private readonly record struct MergeItem(WatchPart Part, RepositoryResult<JsonElement> Result);
}
