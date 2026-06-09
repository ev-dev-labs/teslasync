using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="TeslaChargingSessionsMapViewModel"/> binds to (P1/S8 state-holder seam). It yields
/// the cache-then-network sequence of fleet charging-sessions snapshots that feed the map — the native analogue of
/// the web <c>useTeslaChargingSessions()</c> query (<c>useCharging</c>) whose <c>sessions</c> the page passes into
/// <c>TeslaChargingSessionsMap</c>. The view never performs HTTP itself; the concrete
/// <see cref="TeslaChargingSessionsMapSource"/> (or a test fake) drives this.
/// </summary>
public interface ITeslaChargingSessionsMapSource
{
    /// <summary>Stream the cache-then-network fleet charging-sessions snapshots, cached first.</summary>
    IAsyncEnumerable<RepositoryResult<TeslaChargingSessionsMapData>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="ITeslaChargingSessionsMapSource"/> — the native data adapter for the
/// charging-sessions map surface. It runs a single cache-then-network read through the shared
/// <see cref="CacheThenNetworkEngine"/>, caching the raw JSON so the snake_case wire shape round-trips losslessly,
/// then maps each emission to a typed <see cref="TeslaChargingSessionsMapData"/> via
/// <see cref="TeslaChargingSessionsMapResultMapper"/>: <c>GET /tesla/charging/sessions/</c> (generated operation
/// <c>get_api_v1_tesla_charging_sessions</c>, the same business-fleet endpoint the web page reads). No HTTP touches
/// the view.
/// </summary>
public sealed class TeslaChargingSessionsMapSource : ITeslaChargingSessionsMapSource
{
    private const string SessionsOperation = "get_api_v1_tesla_charging_sessions";
    private const string CacheKey = "tesla:charging:sessions:map";

    private static readonly ApiRequest SessionsRequest = new(SessionsOperation);

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    public TeslaChargingSessionsMapSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<TeslaChargingSessionsMapData>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<JsonElement>(
            CacheKey,
            ct => _api.SendAsync<JsonElement>(SessionsRequest, ct),
            IsEmptyResponse,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return TeslaChargingSessionsMapResultMapper.Map(emission);
        }
    }

    // Web parity: the map renders nothing useful with no sessions. A null / non-object body, a bare empty array, or
    // an envelope whose `sessions` array is missing / empty is the "No location data" empty surface.
    private static bool IsEmptyResponse(JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.Array)
        {
            return element.GetArrayLength() == 0;
        }

        if (element.ValueKind != JsonValueKind.Object)
        {
            return true;
        }

        return !element.TryGetProperty("sessions", out var sessions)
            || sessions.ValueKind != JsonValueKind.Array
            || sessions.GetArrayLength() == 0;
    }
}
