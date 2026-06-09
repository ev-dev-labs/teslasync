using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The data port the <see cref="VampireDrainViewModel"/> binds to (P1/S8 state-holder seam). It exposes the
/// two cache-then-network sequences the web <c>VampireDrainWidget</c> composes — the phantom-drain summary
/// (<c>useVampireDrainStats</c>) and the recent-events list (<c>useVampireDrainEvents</c>), both scoped to
/// the primary (or explicit) vehicle (web/src/features/dashboard/widgets/VampireDrainWidget.tsx). The view
/// never performs HTTP itself; the concrete <see cref="VampireDrainSource"/> (or a test fake) drives this.
/// </summary>
public interface IVampireDrainSource
{
    /// <summary>Stream the cache-then-network phantom-drain summary (web <c>useVampireDrainStats</c>).</summary>
    IAsyncEnumerable<RepositoryResult<VampireDrainStats>> StreamStatsAsync(CancellationToken cancellationToken = default);

    /// <summary>Stream the cache-then-network recent drain events (web <c>useVampireDrainEvents</c>).</summary>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<VampireDrainEvent>>> StreamEventsAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IVampireDrainSource"/> — the native data adapter for the Vampire Drain
/// surface. It first resolves the primary (or explicit) vehicle from the shared
/// <see cref="IWidgetVehicleSource"/> (the native analogue of the web component's
/// <c>vehicleId ?? vehicles?.[0]?.id</c> with its <c>enabled: vehicleId !== null</c> gate), then runs two
/// independent cache-then-network reads through the shared <see cref="CacheThenNetworkEngine"/>:
/// <c>GET /vampire-drain/stats?vehicle_id={id}</c> (operation <c>get_api_v1_vampire_drain_stats</c>) and
/// <c>GET /vampire-drain/?vehicle_id={id}&amp;limit=30</c> (operation <c>get_api_v1_vampire_drain</c>),
/// caching the raw JSON so the snake_case wire shape round-trips losslessly, and parses each emission via
/// the result mappers. When no vehicle is available both reads short-circuit to
/// <see cref="RepositoryResult{T}.Empty()"/>, mirroring the web hooks' disabled queries. These backend
/// routes are deprecated and reliably 404 in production; the surface degrades gracefully to its empty
/// state, exactly as the web component does. No HTTP touches the view.
/// </summary>
public sealed class VampireDrainSource : IVampireDrainSource
{
    /// <summary>Generated operation id for <c>GET /vampire-drain/stats</c>.</summary>
    public const string StatsOperationId = "get_api_v1_vampire_drain_stats";

    /// <summary>Generated operation id for <c>GET /vampire-drain/</c>.</summary>
    public const string EventsOperationId = "get_api_v1_vampire_drain";

    /// <summary>Recent-events page size (web <c>useVampireDrainEvents(idStr, 30)</c>).</summary>
    public const int EventLimit = 30;

    private const string VehicleQueryParam = "vehicle_id";
    private const string LimitQueryParam = "limit";

    private readonly IWidgetVehicleSource _vehicles;
    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly long? _vehicleId;

    /// <summary>Creates the source over the vehicle source, contract client, engine and JSON settings.</summary>
    /// <param name="vehicles">Resolves the primary (or explicit) vehicle to scope the reads to.</param>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    /// <param name="vehicleId">An explicit vehicle id; when null the primary cached vehicle is used.</param>
    public VampireDrainSource(
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
    public async IAsyncEnumerable<RepositoryResult<VampireDrainStats>> StreamStatsAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vehicleId = await ResolveVehicleIdAsync(cancellationToken).ConfigureAwait(false);
        if (vehicleId is not { } vid)
        {
            // Web parity: with no vehicle the useVampireDrainStats query is disabled and `stats` is undefined.
            yield return RepositoryResult<VampireDrainStats>.Empty();
            yield break;
        }

        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"vampire-drain:stats:{vid}");
        var request = new ApiRequest(
            StatsOperationId,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                [VehicleQueryParam] = vid,
            });

        var raw = _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmptyStats,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return VampireDrainStatsResultMapper.Map(emission);
        }
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<VampireDrainEvent>>> StreamEventsAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vehicleId = await ResolveVehicleIdAsync(cancellationToken).ConfigureAwait(false);
        if (vehicleId is not { } vid)
        {
            // Web parity: with no vehicle the useVampireDrainEvents query is disabled and the list is empty.
            yield return RepositoryResult<IReadOnlyList<VampireDrainEvent>>.Empty();
            yield break;
        }

        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"vampire-drain:events:{vid}:{EventLimit}");
        var request = new ApiRequest(
            EventsOperationId,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                [VehicleQueryParam] = vid,
                [LimitQueryParam] = EventLimit,
            });

        var raw = _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmptyEvents,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return VampireDrainEventsResultMapper.Map(emission);
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

    // Web parity: an absent/non-object stats body collapses to the empty surface (web `stats` undefined).
    private static bool IsEmptyStats(JsonElement element) => element.ValueKind != JsonValueKind.Object;

    private static bool IsEmptyEvents(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Array => element.GetArrayLength() == 0,
        _ => false,
    };
}
