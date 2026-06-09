using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.DashboardWidgets.UptimeMonitor;

/// <summary>
/// The data port the <see cref="UptimeMonitorViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of parsed <see cref="SystemHealthSnapshot"/> values — the native analogue of
/// the web component's single <c>useSystemHealth</c> hook. The view never performs HTTP itself; the concrete
/// <see cref="UptimeMonitorSource"/> (or a test fake) drives this.
/// </summary>
public interface IUptimeMonitorSource
{
    /// <summary>Stream the cache-then-network system-health snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<SystemHealthSnapshot>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IUptimeMonitorSource"/> — the native data adapter for the Uptime Monitor
/// surface. It is the native analogue of the web component's single <c>useSystemHealth</c> hook: one
/// cache-then-network read of <c>GET /system/health</c> (generated operation
/// <see cref="UptimeMonitorRegistration.HealthOperationId"/>) through the shared
/// <see cref="CacheThenNetworkEngine"/>, parsing each emission into a <see cref="SystemHealthSnapshot"/>. The
/// snapshot is cached so the whole surface restores instantly, and no HTTP ever touches the view. A non-object
/// body is a meaningful value (rendered as the "no system health data" empty surface, not the engine's generic
/// empty), so the read never treats anything as empty — the view-model derives the Empty / Loaded distinction
/// from the snapshot's <see cref="SystemHealthSnapshot.HasData"/> flag.
/// </summary>
public sealed class UptimeMonitorSource : IUptimeMonitorSource
{
    private const string CacheKey = "admin:system-health";

    private static readonly ApiRequest HealthRequest = new(UptimeMonitorRegistration.HealthOperationId);

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    public UptimeMonitorSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<SystemHealthSnapshot>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var stream = _engine.StreamAsync(
            CacheKey,
            FetchAsync,
            static _ => false,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in stream.ConfigureAwait(false))
        {
            yield return emission;
        }
    }

    private async Task<SystemHealthSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        var body = await _api.SendAsync<JsonElement>(HealthRequest, cancellationToken).ConfigureAwait(false);
        return SystemHealthSnapshot.FromJson(body);
    }
}
