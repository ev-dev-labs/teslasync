using System.Globalization;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="LiveSignalsTableViewModel"/> binds to (P1/S8 state-holder seam). It exposes
/// the single cache-then-network read the web Live Signal Inspector composes — the Redis-cached live signal
/// snapshot for one vehicle (web <c>useVehicleLiveSignals</c> → <c>GET /signals/{vehicleID}/live</c>). The
/// view never performs HTTP itself; the concrete <see cref="LiveSignalsTableSource"/> (or a test fake)
/// drives this.
/// </summary>
public interface ILiveSignalsTableSource
{
    /// <summary>Stream the cache-then-network live-signal snapshots for <paramref name="vehicleId"/>, cached first.</summary>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<LiveSignalRow>>> StreamLiveSignalsAsync(
        long vehicleId,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="ILiveSignalsTableSource"/> — the native data adapter for the Live
/// Signals surface. It runs one cache-then-network read through the shared <see cref="CacheThenNetworkEngine"/>,
/// caching the raw JSON so the snake_case wire shape round-trips losslessly, then maps each emission to a
/// typed row list via <see cref="LiveSignalsTableResultMapper"/>:
/// <c>GET /signals/{vehicleID}/live</c> (generated operation <c>get_api_v1_signals_vehicleID_live</c>). No
/// HTTP touches the view.
/// </summary>
public sealed class LiveSignalsTableSource : ILiveSignalsTableSource
{
    private const string LiveSignalsOperation = "get_api_v1_signals_vehicleID_live";
    private const string CacheKeyPrefix = "signals:live";

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    public LiveSignalsTableSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<LiveSignalRow>>> StreamLiveSignalsAsync(
        long vehicleId,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        string id = vehicleId.ToString(CultureInfo.InvariantCulture);
        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"{CacheKeyPrefix}:{id}");

        // The live endpoint fills the {vehicleID} path slot; it declares no typed query params (the web hook
        // appends none either — the refresh cadence is the page's, not a query argument).
        var request = ApiRequest.WithPath(LiveSignalsOperation, "vehicleID", id);

        var raw = _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmptyResponse,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return LiveSignalsTableResultMapper.Map(emission);
        }
    }

    // The snapshot is a JSON object; a null / non-object body, a missing signals map, or an empty signals
    // map carries no rows (web parity: Object.keys(signals ?? {}).length === 0 -> the empty state).
    private static bool IsEmptyResponse(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty("signals", out var signals))
        {
            return true;
        }

        return signals.ValueKind != JsonValueKind.Object || !signals.EnumerateObject().Any();
    }
}
