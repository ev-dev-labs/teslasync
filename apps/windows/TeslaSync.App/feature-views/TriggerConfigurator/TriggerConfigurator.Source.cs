using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews.Automations;

/// <summary>
/// The data port the <see cref="TriggerConfiguratorViewModel"/> binds to (P1/S8 state-holder seam). It yields
/// the cache-then-network sequence of configured geofences — the native analogue of the web
/// <c>useGeofences</c> query (web/src/features/automations/pages/TriggerConfigurator.tsx). The view never
/// performs HTTP itself; the concrete <see cref="TriggerGeofenceSource"/> (or a test fake) drives this.
/// </summary>
public interface ITriggerGeofenceSource
{
    /// <summary>Stream the cache-then-network geofence list, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<TriggerGeofence>>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="ITriggerGeofenceSource"/> — the native data adapter for the geofence
/// dropdown. It runs a single cache-then-network read of the configured geofences
/// (<c>GET /geofences</c>, the web <c>useGeofences</c> query) through the shared
/// <see cref="CacheThenNetworkEngine"/> and projects each emission's JSON body into a tolerant
/// <see cref="TriggerGeofence"/> list while preserving the lifecycle status / freshness / error so the
/// view-model can render every state. An empty or non-array body collapses to
/// <see cref="LoadStatus.Empty"/> (the "No geofences configured" surface). No HTTP touches the view.
/// </summary>
public sealed class TriggerGeofenceSource : ITriggerGeofenceSource
{
    private const string CacheKey = "geofences";

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, engine and JSON settings.</summary>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    public TriggerGeofenceSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<TriggerGeofence>>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var request = new ApiRequest(Operations.Locations.Geofences);
        var stream = _engine.StreamAsync<JsonElement>(
            CacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmpty,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var result in stream.ConfigureAwait(false))
        {
            yield return Project(result);
        }
    }

    /// <summary>
    /// Project one raw geofence emission into a parsed list, preserving the lifecycle status / freshness /
    /// error. The cached → projection adapter the view-model binds to. The value is parsed only for the
    /// content-bearing statuses; <see cref="RepositoryResult{T}"/> carries a non-null <see cref="JsonElement"/>
    /// struct (<c>default</c>, kind <c>Undefined</c>) for loading / empty / error, so the lifecycle status —
    /// not a null check — decides whether there is a body to parse.
    /// </summary>
    public static RepositoryResult<IReadOnlyList<TriggerGeofence>> Project(RepositoryResult<JsonElement> result)
    {
        ArgumentNullException.ThrowIfNull(result);
        IReadOnlyList<TriggerGeofence>? fences = result.Status switch
        {
            LoadStatus.Cached or LoadStatus.Refreshing or LoadStatus.Loaded or LoadStatus.Offline
                => TriggerGeofence.ParseList(result.Value),
            _ => null,
        };

        return new RepositoryResult<IReadOnlyList<TriggerGeofence>>(
            result.Status,
            fences,
            result.FetchedAt,
            result.IsStale,
            result.Error);
    }

    // Web parity: a missing / empty geofences array is the "No geofences configured" empty surface.
    private static bool IsEmpty(JsonElement element) =>
        element.ValueKind != JsonValueKind.Array || element.GetArrayLength() == 0;
}
