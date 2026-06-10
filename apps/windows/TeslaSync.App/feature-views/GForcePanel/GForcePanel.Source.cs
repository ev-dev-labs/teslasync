using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="GForcePanelViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of parsed drive-dynamics snapshots for the primary (or explicit) vehicle — the
/// native analogue of the web panel's <c>useDriveDynamicsLatest(vehicleId, INTERVALS.REALTIME)</c> hook
/// (web/src/features/driving/components/driving-dynamics/GForcePanel.tsx). The view never performs HTTP itself;
/// the concrete <see cref="GForcePanelSource"/> (or a test fake) drives this.
/// </summary>
public interface IGForcePanelSource
{
    /// <summary>Stream the cache-then-network drive-dynamics snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<GForcePanelSnapshot>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IGForcePanelSource"/> — the native data adapter for the
/// Acceleration-G-Force surface. It first resolves the primary vehicle from the shared
/// <see cref="IWidgetVehicleSource"/> (the native analogue of the page's selected-vehicle scope), then runs one
/// cache-then-network read of the live drive-dynamics projection (generated operation
/// <see cref="DriveDynamicsLatestOperation"/>, scoped by <c>vehicle_id</c>) through the shared
/// <see cref="CacheThenNetworkEngine"/>, caching the raw JSON so the snake_case wire shape round-trips
/// losslessly, and parses each emission into a <see cref="GForcePanelSnapshot"/> via
/// <see cref="GForcePanelResultMapper"/>. When no vehicle is available the read short-circuits to
/// <see cref="RepositoryResult{T}.Empty()"/>, mirroring the web hook's <c>enabled: vehicleId &gt; 0</c> gate.
/// No HTTP touches the view.
/// </summary>
public sealed class GForcePanelSource : IGForcePanelSource
{
    /// <summary>
    /// The generated OpenAPI operation id for <c>GET /api/v1/drive-dynamics/latest</c>. Kept as a local
    /// constant (rather than a shared <c>Operations</c> entry) because this surface is the only consumer; the
    /// <c>OperationResolves</c> test pins it against the generated endpoint table so a regenerated client that
    /// renamed or dropped the operation fails at test time instead of at runtime.
    /// </summary>
    public const string DriveDynamicsLatestOperation = "get_api_v1_drive_dynamics_latest";

    private const string VehicleQueryParam = "vehicle_id";

    private readonly IWidgetVehicleSource _vehicles;
    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly long? _vehicleId;

    /// <summary>Creates the source over the vehicle source, contract client, engine and JSON settings.</summary>
    /// <param name="vehicles">Resolves the primary (or explicit) vehicle to scope the read to.</param>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    /// <param name="vehicleId">An explicit vehicle id; when null the primary cached vehicle is used.</param>
    public GForcePanelSource(
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
    public async IAsyncEnumerable<RepositoryResult<GForcePanelSnapshot>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vehicleId = await ResolveVehicleIdAsync(cancellationToken).ConfigureAwait(false);
        if (vehicleId is not { } vid)
        {
            // Web parity: with no vehicle the drive-dynamics query is disabled and `data` is undefined.
            yield return RepositoryResult<GForcePanelSnapshot>.Empty();
            yield break;
        }

        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"drive-dynamics:{vid}:g-force-panel");
        var request = new ApiRequest(
            DriveDynamicsLatestOperation,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                [VehicleQueryParam] = vid,
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
            yield return GForcePanelResultMapper.Map(emission);
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

    // Web parity: the snapshot endpoint returns `null` when no live state exists for the vehicle. A non-null
    // object that simply omits both acceleration axes is NOT empty here — it parses to a snapshot whose
    // `HasAny` is false, which the view-model classifies as the friendly empty state.
    private static bool IsEmptyResponse(JsonElement element) => element.ValueKind is
        JsonValueKind.Null or JsonValueKind.Undefined;
}
