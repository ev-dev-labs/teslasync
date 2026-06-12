using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.FeatureViews.Charging;

/// <summary>The generated OpenAPI operation ids the Smart Charge sources consume (charge-planner domain).</summary>
internal static class ChargePlannerOperations
{
    public const string RatePlans = "get_api_v1_charge_planner_rate_plans";
    public const string History = "get_api_v1_charge_planner_history";
    public const string Optimize = "post_api_v1_charge_planner_optimize";
    public const string Apply = "post_api_v1_charge_planner_apply";
}

/// <summary>
/// The generated-client-backed <see cref="IRatePlansSource"/> — the native data adapter for the Smart Charge
/// page's rate-plans read and the C# port of the web <c>useRatePlans</c> hook (web/src/api/hooks/useCharging.ts).
/// It runs one cache-then-network read of <c>GET /charge-planner/rate-plans</c> (generated operation
/// <c>get_api_v1_charge_planner_rate_plans</c>) through the shared <see cref="CacheThenNetworkEngine"/>, caching
/// the raw JSON so the snake_case wire shape round-trips losslessly, and parses each emission into a list of
/// <see cref="RatePlanOption"/>. No HTTP touches the view.
/// </summary>
public sealed class RatePlansClientSource : IRatePlansSource
{
    // Rate plans are static reference data (web STALE_TIMES.STATIC) — a longer stale window than live reads.
    private const int StaticStaleSeconds = 300;

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, engine and JSON settings.</summary>
    public RatePlansClientSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<RatePlanOption>>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var request = new ApiRequest(ChargePlannerOperations.RatePlans);
        var raw = _engine.StreamAsync<JsonElement>(
            "charge-planner:rate-plans",
            ct => _api.SendAsync<JsonElement>(request, ct),
            ChargePlannerEmptiness.IsEmptyArray,
            _json,
            StaticStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return ChargePlannerResultMapper.MapRatePlans(emission);
        }
    }
}

/// <summary>
/// The generated-client-backed <see cref="IChargePlansSource"/> — the native data adapter for the Smart Charge
/// page's plan-history read and the C# port of the web <c>useChargePlans</c> hook composition
/// (web/src/api/hooks/useCharging.ts + web/src/hooks/useSelectedVehicle.ts). It resolves the scoped (or primary)
/// vehicle from the shared <see cref="IWidgetVehicleSource"/>, then runs one cache-then-network read of
/// <c>GET /charge-planner/history?vehicle_id=…</c> (generated operation
/// <c>get_api_v1_charge_planner_history</c>) and parses each emission into a list of <see cref="ChargePlanRecord"/>.
/// When no vehicle is available the read short-circuits to <see cref="RepositoryResult{T}.Empty()"/>, mirroring
/// the web hook's disabled query (<c>enabled: !!vehicleId</c>). No HTTP touches the view.
/// </summary>
public sealed class ChargePlansClientSource : IChargePlansSource
{
    private readonly IWidgetVehicleSource _vehicles;
    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly long? _vehicleId;

    /// <summary>Creates the source over the vehicle source, contract client, engine and JSON settings.</summary>
    public ChargePlansClientSource(
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
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<ChargePlanRecord>>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vehicleId = await ChargePlannerVehicleScope.ResolveAsync(_vehicles, _vehicleId, cancellationToken).ConfigureAwait(false);
        if (vehicleId is not { } vid)
        {
            yield return RepositoryResult<IReadOnlyList<ChargePlanRecord>>.Empty();
            yield break;
        }

        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"charge-planner:history:{vid}");
        var request = new ApiRequest(
            ChargePlannerOperations.History,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["vehicle_id"] = vid,
            });

        var raw = _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            ChargePlannerEmptiness.IsEmptyArray,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return ChargePlannerResultMapper.MapPlans(emission);
        }
    }
}

/// <summary>
/// The generated-client-backed <see cref="IOptimizeChargeClient"/> — the native data adapter for the optimize
/// mutation and the C# port of the web <c>useOptimizeCharge</c> hook. It POSTs the snake_case optimizer request
/// body to <c>POST /charge-planner/optimize</c> (generated operation
/// <c>post_api_v1_charge_planner_optimize</c>) and parses the response into an <see cref="OptimizeChargeResult"/>.
/// </summary>
public sealed class OptimizeChargeClient : IOptimizeChargeClient
{
    private readonly IApiClient _api;

    /// <summary>Creates the client over the shared contract client.</summary>
    public OptimizeChargeClient(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<OptimizeChargeResult> OptimizeAsync(OptimizeChargeRequestModel request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var body = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["vehicle_id"] = request.VehicleId,
            ["target_soc"] = request.TargetSoc,
            ["depart_by"] = request.DepartBy,
            ["rate_plan_id"] = request.RatePlanId,
            ["max_amps"] = request.MaxAmps,
            ["battery_capacity_kwh"] = request.BatteryCapacityKwh,
        };

        var apiRequest = new ApiRequest(ChargePlannerOperations.Optimize, Body: body);
        var response = await _api.SendAsync<JsonElement>(apiRequest, cancellationToken).ConfigureAwait(false);
        return OptimizeChargeResult.FromJson(response);
    }
}

/// <summary>
/// The generated-client-backed <see cref="IApplyScheduleClient"/> — the native data adapter for the apply
/// mutation and the C# port of the web <c>useApplySchedule</c> hook. It POSTs <c>{ "plan_id": … }</c> to
/// <c>POST /charge-planner/apply</c> (generated operation <c>post_api_v1_charge_planner_apply</c>) and parses the
/// response into an <see cref="ApplyScheduleResult"/>.
/// </summary>
public sealed class ApplyScheduleClient : IApplyScheduleClient
{
    private readonly IApiClient _api;

    /// <summary>Creates the client over the shared contract client.</summary>
    public ApplyScheduleClient(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<ApplyScheduleResult> ApplyAsync(long planId, CancellationToken cancellationToken = default)
    {
        var body = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["plan_id"] = planId,
        };

        var apiRequest = new ApiRequest(ChargePlannerOperations.Apply, Body: body);
        var response = await _api.SendAsync<JsonElement>(apiRequest, cancellationToken).ConfigureAwait(false);
        return ApplyScheduleResult.FromJson(response);
    }
}

/// <summary>Resolves the vehicle the plan-history read scopes to — an explicit id, else the cached primary vehicle.</summary>
internal static class ChargePlannerVehicleScope
{
    public static async Task<long?> ResolveAsync(IWidgetVehicleSource vehicles, long? explicitId, CancellationToken cancellationToken)
    {
        if (explicitId is { } id)
        {
            return id;
        }

        var primary = await vehicles.GetPrimaryAsync(cancellationToken).ConfigureAwait(false);
        return primary?.VehicleId;
    }
}

/// <summary>Cache-then-network emptiness predicate shared by the Smart Charge array reads.</summary>
internal static class ChargePlannerEmptiness
{
    /// <summary>True for a null response or an empty array (web <c>safeArray</c> with no rows).</summary>
    public static bool IsEmptyArray(JsonElement element)
    {
        if (element.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
        {
            return true;
        }

        var arr = element;
        if (element.ValueKind == JsonValueKind.Object)
        {
            if (element.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Array)
            {
                arr = data;
            }
            else
            {
                return !element.EnumerateObject().MoveNext();
            }
        }

        return arr.ValueKind == JsonValueKind.Array && arr.GetArrayLength() == 0;
    }
}

/// <summary>
/// Parses a raw <see cref="JsonElement"/> charge-planner emission into the typed read-model while preserving
/// every freshness flag (cached / refreshing / stale / offline), so the view-model can render the full state
/// matrix. Pure so the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class ChargePlannerResultMapper
{
    /// <summary>Parse a rate-plans payload (when present) while preserving its status.</summary>
    public static RepositoryResult<IReadOnlyList<RatePlanOption>> MapRatePlans(RepositoryResult<JsonElement> raw) =>
        Map(raw, RatePlanOption.ListFromJson, System.Array.Empty<RatePlanOption>());

    /// <summary>Parse a plan-history payload (when present) while preserving its status.</summary>
    public static RepositoryResult<IReadOnlyList<ChargePlanRecord>> MapPlans(RepositoryResult<JsonElement> raw) =>
        Map(raw, ChargePlanRecord.ListFromJson, System.Array.Empty<ChargePlanRecord>());

    private static RepositoryResult<T> Map<T>(RepositoryResult<JsonElement> raw, Func<JsonElement, T> parse, T empty)
    {
        ArgumentNullException.ThrowIfNull(raw);
        T Parse() => raw.HasValue ? parse(raw.Value) : empty;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<T>.Loading(),
            LoadStatus.Cached => RepositoryResult<T>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<T>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<T>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<T>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<T>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<T>.Failure(raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
