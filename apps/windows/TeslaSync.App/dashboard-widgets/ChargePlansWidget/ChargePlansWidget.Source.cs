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
/// The repository-backed <see cref="IChargePlansSource"/> — the native data adapter for the Charge
/// Plans surface. It is the native analogue of the web component's two independent hooks: it resolves
/// the primary vehicle from the shared <see cref="IWidgetVehicleSource"/> (web
/// <c>vehicleId ?? vehicles?.[0]?.id</c>) and runs <em>two</em> cache-then-network reads concurrently —
/// the charge-plan history (generated operation <c>get_api_v1_charge_planner_history</c>, scoped by
/// <c>vehicle_id</c>, web <c>useChargePlans</c>) and the available time-of-use rate plans (generated
/// operation <c>get_api_v1_charge_planner_rate_plans</c>, web <c>useRatePlans</c>). Each side's
/// emissions are merged in arrival order through an unbounded channel and folded into one
/// <see cref="ChargePlansSnapshot"/> result by <see cref="ChargePlansResultMapper.Combine"/>, so the
/// surface shows whichever data resolves first (web <c>isLoading</c>/<c>isError</c>/<c>hasData</c> flag
/// combination). When no vehicle is available the plans read short-circuits to an empty result while
/// the rate-plans read still runs — the web rate-plans query has no vehicle dependency. No HTTP touches
/// the view.
/// </summary>
public sealed class ChargePlansSource : IChargePlansSource
{
    // Generated operation ids (see apps/windows/Generated/Api/ApiEndpoints.cs).
    private const string HistoryOperation = "get_api_v1_charge_planner_history";
    private const string RatePlansOperation = "get_api_v1_charge_planner_rate_plans";
    private const string VehicleQueryParam = "vehicle_id";
    private const string RatesCacheKey = "charge-planner:rate-plans";

    // Rate plans are effectively static (web staleTime: STATIC) — give the cached payload a longer
    // freshness window than the 2-minute live default so it does not flag stale on every read.
    private const int RatesStaleSeconds = 300;

    private readonly IWidgetVehicleSource _vehicles;
    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly long? _vehicleId;

    /// <summary>Creates the source over the vehicle source, contract client, engine and JSON settings.</summary>
    /// <param name="vehicles">Resolves the primary (or explicit) vehicle to scope the plans read to.</param>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    /// <param name="vehicleId">An explicit vehicle id; when null the primary cached vehicle is used.</param>
    public ChargePlansSource(
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

    private enum SourceSide
    {
        Plans,
        Rates,
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<ChargePlansSnapshot>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vehicleId = await ResolveVehicleIdAsync(cancellationToken).ConfigureAwait(false);

        // Web parity: with no vehicle the plans query is disabled (resolves to []), but the rate-plans
        // query has no vehicle dependency and still runs.
        var plansStream = vehicleId is { } vid
            ? PlansStream(vid, cancellationToken)
            : EmptySideAsync(cancellationToken);
        var ratesStream = RatesStream(cancellationToken);

        var channel = Channel.CreateUnbounded<SideEmission>(
            new UnboundedChannelOptions { SingleReader = true, SingleWriter = false });

        var pumps = Task.WhenAll(
            PumpAsync(SourceSide.Plans, plansStream, channel.Writer, cancellationToken),
            PumpAsync(SourceSide.Rates, ratesStream, channel.Writer, cancellationToken));

        // Complete the channel once both sub-reads finish (or fault/cancel) so the reader loop ends.
        _ = pumps.ContinueWith(
            static (task, state) => ((Channel<SideEmission>)state!).Writer.TryComplete(task.Exception),
            channel,
            CancellationToken.None,
            TaskContinuationOptions.ExecuteSynchronously,
            TaskScheduler.Default);

        RepositoryResult<JsonElement>? plans = null;
        RepositoryResult<JsonElement>? rates = null;

        await foreach (var emission in channel.Reader.ReadAllAsync(cancellationToken).ConfigureAwait(false))
        {
            if (emission.Side == SourceSide.Plans)
            {
                plans = emission.Result;
            }
            else
            {
                rates = emission.Result;
            }

            yield return ChargePlansResultMapper.Combine(plans, rates);
        }
    }

    private static async Task PumpAsync(
        SourceSide side,
        IAsyncEnumerable<RepositoryResult<JsonElement>> stream,
        ChannelWriter<SideEmission> writer,
        CancellationToken cancellationToken)
    {
        await foreach (var result in stream.WithCancellation(cancellationToken).ConfigureAwait(false))
        {
            await writer.WriteAsync(new SideEmission(side, result), cancellationToken).ConfigureAwait(false);
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

    private IAsyncEnumerable<RepositoryResult<JsonElement>> PlansStream(long vehicleId, CancellationToken cancellationToken)
    {
        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"charge-planner:history:{vehicleId}");
        var request = new ApiRequest(
            HistoryOperation,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                [VehicleQueryParam] = vehicleId,
            });

        return _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmptyResponse,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);
    }

    private IAsyncEnumerable<RepositoryResult<JsonElement>> RatesStream(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(RatePlansOperation);
        return _engine.StreamAsync<JsonElement>(
            RatesCacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmptyResponse,
            _json,
            RatesStaleSeconds,
            cancellationToken);
    }

    private static async IAsyncEnumerable<RepositoryResult<JsonElement>> EmptySideAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        yield return RepositoryResult<JsonElement>.Empty();
        await Task.CompletedTask.ConfigureAwait(false);
    }

    private static bool IsEmptyResponse(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Array => element.GetArrayLength() == 0,
        _ => false,
    };

    private readonly record struct SideEmission(SourceSide Side, RepositoryResult<JsonElement> Result);
}
