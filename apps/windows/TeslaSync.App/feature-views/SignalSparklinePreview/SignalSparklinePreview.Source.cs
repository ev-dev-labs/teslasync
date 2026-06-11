using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="SignalSparklinePreviewViewModel"/> binds to (P1/S8 state-holder seam). It
/// exposes the single cache-then-network read the web component composes — the typed last-hour history for
/// one signal (web <c>useSignalHistory(vehicleId, signal, { hours: 1, limit: 30 })</c> →
/// <c>GET /signals/{vehicleID}/{signalName}/history</c>). The view never performs HTTP itself; the concrete
/// <see cref="SignalSparklinePreviewSource"/> (or a test fake) drives this.
/// </summary>
public interface ISignalSparklinePreviewSource
{
    /// <summary>
    /// Stream the cache-then-network numeric-series snapshots for <paramref name="signal"/> on
    /// <paramref name="vehicleId"/> over the fixed last-hour window, cached first.
    /// </summary>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<double>>> StreamHistoryAsync(
        long vehicleId,
        string signal,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="ISignalSparklinePreviewSource"/> — the native data adapter for the
/// signal-sparkline preview. It runs one cache-then-network read through the shared
/// <see cref="CacheThenNetworkEngine"/>, caching the raw JSON so the snake_case wire shape round-trips
/// losslessly, then maps each emission to the numeric series via
/// <see cref="SignalSparklinePreviewResultMapper"/>:
/// <c>GET /signals/{vehicleID}/{signalName}/history?hours=1&amp;limit=30</c> (generated operation
/// <c>get_api_v1_signals_vehicleID_signalName_history</c>). No HTTP touches the view.
/// </summary>
public sealed class SignalSparklinePreviewSource : ISignalSparklinePreviewSource
{
    private const string HistoryOperation = "get_api_v1_signals_vehicleID_signalName_history";
    private const string CacheKeyPrefix = "signals:history";

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    public SignalSparklinePreviewSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<double>>> StreamHistoryAsync(
        long vehicleId,
        string signal,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrEmpty(signal);

        string id = vehicleId.ToString(CultureInfo.InvariantCulture);
        string cacheKey = string.Create(
            CultureInfo.InvariantCulture,
            $"{CacheKeyPrefix}:{id}:{signal}:{SignalSparklinePreviewQuery.Hours}:{SignalSparklinePreviewQuery.Limit}");

        // The history endpoint fills the {vehicleID} + {signalName} path slots; hours/limit are appended as
        // snake_case query params (the generated descriptor declares none, so the client passes them through,
        // exactly as the web hook appends ?hours=1&limit=30).
        var request = new ApiRequest(
            HistoryOperation,
            new Dictionary<string, string>(StringComparer.Ordinal)
            {
                ["vehicleID"] = id,
                ["signalName"] = signal,
            },
            new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["hours"] = SignalSparklinePreviewQuery.Hours,
                ["limit"] = SignalSparklinePreviewQuery.Limit,
            });

        var raw = _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmptyResponse,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return SignalSparklinePreviewResultMapper.Map(emission);
        }
    }

    // The window is empty when it carries fewer than the two samples a trend line needs — web parity with the
    // component's numericSeries.length < 2 em-dash branch (so the engine emits Empty directly on a fresh
    // single-point or sample-less response rather than a degenerate one-point line).
    private static bool IsEmptyResponse(JsonElement element) =>
        SignalSparklineSeries.FromHistory(element).Count < SignalSparklinePreviewQuery.MinSamples;
}
