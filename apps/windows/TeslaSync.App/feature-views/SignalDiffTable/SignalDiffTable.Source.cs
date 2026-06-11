using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="SignalDiffTableViewModel"/> binds to (P1/S8 state-holder seam). It exposes
/// the single cache-then-network read the web Signal Diff surface composes — the server-side diff between
/// two point-in-time snapshots for one vehicle (web <c>useSignalDiffServer</c> → <c>GET
/// /signals/{vehicleID}/diff</c>, which returns only the signals that changed). The view never performs HTTP
/// itself; the concrete <see cref="SignalDiffTableSource"/> (or a test fake) drives this.
/// </summary>
public interface ISignalDiffTableSource
{
    /// <summary>Stream the cache-then-network signal-diff rows for <paramref name="vehicleId"/>, cached first.</summary>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<SignalDiffRow>>> StreamDiffAsync(
        long vehicleId,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="ISignalDiffTableSource"/> — the native data adapter for the Signal Diff
/// surface. It runs one cache-then-network read through the shared <see cref="CacheThenNetworkEngine"/>,
/// caching the raw JSON so the snake_case wire shape round-trips losslessly, then maps each emission to a
/// typed diff-row list via <see cref="SignalDiffTableResultMapper"/>:
/// <c>GET /signals/{vehicleID}/diff</c> (generated operation <c>get_api_v1_signals_vehicleID_diff</c>). The
/// window-bounding query params (<c>at_a</c> / <c>at_b</c>) are owned by the parent compare surface; left
/// unset, the backend defaults to the trailing hour (now-1h → now), matching the web page's default window.
/// No HTTP touches the view.
/// </summary>
public sealed class SignalDiffTableSource : ISignalDiffTableSource
{
    private const string DiffOperation = "get_api_v1_signals_vehicleID_diff";
    private const string CacheKeyPrefix = "signals:diff";

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    public SignalDiffTableSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<SignalDiffRow>>> StreamDiffAsync(
        long vehicleId,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        string id = vehicleId.ToString(CultureInfo.InvariantCulture);
        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"{CacheKeyPrefix}:{id}");

        // The diff endpoint fills the {vehicleID} path slot; the at_a / at_b window params are the parent
        // compare surface's responsibility (out of scope here), so this read uses the backend's default
        // trailing-hour window — the same default the web page seeds its picker with.
        var request = ApiRequest.WithPath(DiffOperation, "vehicleID", id);

        var raw = _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmptyResponse,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return SignalDiffTableResultMapper.Map(emission);
        }
    }

    // The diff is a JSON object; a null / non-object body, a missing data array, or an empty data array
    // carries no rows (web parity: the backend omits unchanged signals, so an empty data array means the two
    // snapshots are identical → the "No differences" empty state).
    private static bool IsEmptyResponse(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty("data", out var data))
        {
            return true;
        }

        return data.ValueKind != JsonValueKind.Array || data.GetArrayLength() == 0;
    }
}
