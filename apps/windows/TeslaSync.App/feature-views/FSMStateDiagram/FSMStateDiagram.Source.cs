using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="FsmStateDiagramViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of FSM transition windows — the native analogue of the <c>transitions</c> prop
/// the web debugger assembles from <c>useFSMTransitions</c> before handing it to <c>&lt;FSMStateDiagram /&gt;</c>
/// (web/src/features/system/pages/StateMachineDebuggerPage.tsx). The view never performs HTTP itself; the
/// concrete <see cref="FsmStateDiagramSource"/> (or a test fake) drives this.
/// </summary>
public interface IFsmStateDiagramSource
{
    /// <summary>Stream the cache-then-network transition snapshots, cached first.</summary>
    /// <param name="cancellationToken">Cancels the in-flight read when a newer load supersedes it.</param>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<FsmTransition>>> StreamAsync(
        CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IFsmStateDiagramSource"/> — the native data adapter for the State Diagram
/// surface. One logical read pulls the FSM transition log from <c>GET /fsm/transitions</c> (web
/// <c>useFSMTransitions</c>) for one vehicle, time window and FSM type, caching the raw JSON so the snake_case
/// wire shape round-trips losslessly, then maps each emission to a typed transition list via
/// <see cref="FsmTransition.ParseList"/>. No HTTP touches the view.
/// </summary>
public sealed class FsmStateDiagramSource : IFsmStateDiagramSource
{
    // The /fsm/transitions handler post-dates the Operations.cs codegen seam, so this generated operation id is
    // referenced verbatim here (the only file scoped to this surface). It resolves against
    // TeslaSync.Windows.Generated.Api.ApiEndpoints (verified present in ApiEndpoints.cs); the endpoint declares
    // no typed query params, so the client appends vehicle_id/hours/page/per_page/fsm_name without contract rejection.
    private const string TransitionsOperation = "get_api_v1_fsm_transitions";
    private const int DefaultPage = 1;
    private const int DefaultPerPage = 500;

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly long _vehicleId;
    private readonly string _fsmType;
    private readonly int _hours;
    private readonly string _cacheKey;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    /// <param name="api">The generated contract API client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The API client options carrying the JSON serializer settings.</param>
    /// <param name="vehicleId">The vehicle whose transition log is read (web <c>vehicle_id</c>).</param>
    /// <param name="fsmType">The FSM type filter (web <c>fsm_name</c>; <c>all</c> omits the filter).</param>
    /// <param name="hours">The look-back window in hours (web <c>hours</c>); defaults to 24.</param>
    public FsmStateDiagramSource(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        long vehicleId,
        string fsmType,
        int hours = 24)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        ArgumentException.ThrowIfNullOrWhiteSpace(fsmType);
        _api = api;
        _engine = engine;
        _json = options.Json;
        _vehicleId = vehicleId;
        _fsmType = fsmType;
        _hours = hours;
        _cacheKey = string.Create(
            CultureInfo.InvariantCulture,
            $"system:fsm-state-diagram:{vehicleId}:{fsmType}:{hours}");
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<FsmTransition>>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<JsonElement>(
            _cacheKey,
            FetchAsync,
            IsEmptyResponse,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return Map(emission);
        }
    }

    private Task<JsonElement> FetchAsync(CancellationToken cancellationToken)
    {
        bool isAll = string.Equals(_fsmType.Trim(), "all", StringComparison.OrdinalIgnoreCase);
        var query = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["vehicle_id"] = _vehicleId,
            ["hours"] = _hours,
            ["page"] = DefaultPage,
            ["per_page"] = DefaultPerPage,
            ["fsm_name"] = isAll ? null : _fsmType,
        };

        return _api.SendAsync<JsonElement>(new ApiRequest(TransitionsOperation, Query: query), cancellationToken);
    }

    private static RepositoryResult<IReadOnlyList<FsmTransition>> Map(RepositoryResult<JsonElement> result)
    {
        IReadOnlyList<FsmTransition>? value = result.Value is { } element
            ? FsmTransition.ParseList(element)
            : null;

        return new RepositoryResult<IReadOnlyList<FsmTransition>>(
            result.Status, value, result.FetchedAt, result.IsStale, result.Error);
    }

    // The response is the paged { "data": [ … ] } shape; a null/non-array body or an empty array carries no rows.
    private static bool IsEmptyResponse(JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.Object && element.TryGetProperty("data", out var data))
        {
            return data.ValueKind != JsonValueKind.Array || data.GetArrayLength() == 0;
        }

        return element.ValueKind != JsonValueKind.Array || element.GetArrayLength() == 0;
    }
}
