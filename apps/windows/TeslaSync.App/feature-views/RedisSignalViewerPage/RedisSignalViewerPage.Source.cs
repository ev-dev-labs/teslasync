using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The read/write seam the <see cref="RedisSignalViewerPageViewModel"/> binds to (P1/S8 state-holder layer) — the
/// native port of the web page's data sources (web/src/features/admin/pages/RedisSignalViewerPage.tsx): the
/// <c>useVehicles → GET /vehicles</c> fleet list that fills the vehicle picker, the per-vehicle
/// <c>getRedisSignals → GET /dev-tools/redis-signals?vehicle_id=…</c> query that fills the stat tiles and the
/// signal table, and the two destructive purge paths (<c>purgeRedisSignals → DELETE /dev-tools/redis-signals</c>
/// and <c>purgeAllRedisSignals → DELETE /dev-tools/redis-signals/keys</c>). The view never performs HTTP; the
/// contract-client-backed <see cref="RedisSignalViewerClientFeed"/> (or a test fake) drives this.
/// </summary>
public interface IRedisSignalViewerFeed
{
    /// <summary>Fetch the fleet list for the vehicle picker (web <c>useVehicles → GET /vehicles</c>).</summary>
    Task<IReadOnlyList<RedisSignalViewerVehicle>> FetchVehiclesAsync(CancellationToken cancellationToken);

    /// <summary>Fetch the cached Redis signals for <paramref name="vehicleId"/> (web <c>getRedisSignals</c>).</summary>
    Task<RedisSignalsSnapshot> FetchSignalsAsync(long vehicleId, CancellationToken cancellationToken);

    /// <summary>Purge the per-vehicle Redis HSET (web <c>purgeRedisSignals</c>).</summary>
    Task<RedisPurgeResult> PurgeAsync(long vehicleId, CancellationToken cancellationToken);

    /// <summary>Purge every vehicle's Redis HSET (web <c>purgeAllRedisSignals</c>).</summary>
    Task<RedisPurgeAllResult> PurgeAllAsync(CancellationToken cancellationToken);
}

/// <summary>The default feed — resolves to an empty fleet / empty snapshot and no-op purges (the empty data state, no HTTP).</summary>
public sealed class EmptyRedisSignalViewerFeed : IRedisSignalViewerFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyRedisSignalViewerFeed Instance { get; } = new();

    private EmptyRedisSignalViewerFeed()
    {
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<RedisSignalViewerVehicle>> FetchVehiclesAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<IReadOnlyList<RedisSignalViewerVehicle>>(Array.Empty<RedisSignalViewerVehicle>());
    }

    /// <inheritdoc />
    public Task<RedisSignalsSnapshot> FetchSignalsAsync(long vehicleId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(RedisSignalsSnapshot.Empty);
    }

    /// <inheritdoc />
    public Task<RedisPurgeResult> PurgeAsync(long vehicleId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(new RedisPurgeResult(false));
    }

    /// <inheritdoc />
    public Task<RedisPurgeAllResult> PurgeAllAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(new RedisPurgeAllResult(0, 0, 0, false));
    }
}

/// <summary>
/// The generated-client-backed <see cref="IRedisSignalViewerFeed"/> — the native data adapter for the Redis Signal
/// Viewer page. It binds the page's web data sources to the generated OpenAPI contract client (ADR-004):
/// <c>GET /vehicles</c> (web <c>useVehicles</c>), <c>GET /dev-tools/redis-signals?vehicle_id=…</c>
/// (web <c>getRedisSignals</c>), and the two purge DELETEs. The per-vehicle reads pass the snake_case
/// <c>vehicle_id</c> query the Go API expects (never camelCase, never a double <c>/api/v1</c> prefix — the client
/// versions the path exactly once). Each response JSON round-trips through the tolerant model parsers so the
/// snake_case wire shape is preserved losslessly, and a non-success response surfaces as the client's
/// <see cref="ApiException"/> for the view-model's error branch. No HTTP touches the view.
/// </summary>
public sealed class RedisSignalViewerClientFeed : IRedisSignalViewerFeed
{
    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public RedisSignalViewerClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<RedisSignalViewerVehicle>> FetchVehiclesAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(RedisSignalViewerRegistration.VehiclesOperation);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return RedisSignalViewerVehicle.ParseList(json);
    }

    /// <inheritdoc />
    public async Task<RedisSignalsSnapshot> FetchSignalsAsync(long vehicleId, CancellationToken cancellationToken)
    {
        var request = new ApiRequest(
            RedisSignalViewerRegistration.SignalsOperation,
            Query: VehicleQuery(vehicleId));

        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return RedisSignalsSnapshot.FromJson(json);
    }

    /// <inheritdoc />
    public async Task<RedisPurgeResult> PurgeAsync(long vehicleId, CancellationToken cancellationToken)
    {
        var request = new ApiRequest(
            RedisSignalViewerRegistration.PurgeOperation,
            Query: VehicleQuery(vehicleId));

        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return RedisPurgeResult.FromJson(json);
    }

    /// <inheritdoc />
    public async Task<RedisPurgeAllResult> PurgeAllAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(RedisSignalViewerRegistration.PurgeAllOperation);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return RedisPurgeAllResult.FromJson(json);
    }

    private static Dictionary<string, object?> VehicleQuery(long vehicleId) =>
        new(StringComparer.Ordinal)
        {
            [RedisSignalViewerRegistration.VehicleIdQueryParam] = vehicleId.ToString(CultureInfo.InvariantCulture),
        };
}
