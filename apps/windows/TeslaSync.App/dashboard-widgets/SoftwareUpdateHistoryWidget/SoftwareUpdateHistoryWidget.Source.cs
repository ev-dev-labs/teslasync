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
/// The data port the <see cref="SoftwareUpdateHistoryViewModel"/> binds to (P1/S8 state-holder seam). It
/// yields the cache-then-network sequence of parsed update lists — the native analogue of the web
/// <c>useVehicles</c> + <c>useSoftwareUpdates</c> hook composition
/// (web/src/features/dashboard/widgets/SoftwareUpdateHistoryWidget.tsx). The view never performs HTTP itself;
/// the concrete <see cref="SoftwareUpdateHistorySource"/> (or a test fake) drives this.
/// </summary>
public interface ISoftwareUpdateHistorySource
{
    /// <summary>Stream the cache-then-network update snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<SoftwareUpdateSample>>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="ISoftwareUpdateHistorySource"/> — the native data adapter for the Update
/// History surface. It first resolves the primary (or explicit) vehicle from the shared
/// <see cref="IWidgetVehicleSource"/> to gate the read (the native analogue of the web hook's
/// <c>enabled: !!vehicleId</c>, with the <c>vehicleId ?? vehicles?.[0]?.id</c> precedence), then runs one
/// cache-then-network read of <c>GET /software-updates</c> (generated operation
/// <c>get_api_v1_software_updates</c>) through the shared <see cref="CacheThenNetworkEngine"/>, caching the
/// raw JSON so the snake_case wire shape round-trips losslessly, and parses each emission into
/// <see cref="SoftwareUpdateSample"/> rows via <see cref="SoftwareUpdateHistoryResultMapper"/>. The web hook
/// requests <c>/software-updates</c> with no <c>vehicle_id</c> query (the fleet-wide list), so this adapter
/// does the same; when no vehicle is cached the read short-circuits to <see cref="RepositoryResult{T}.Empty"/>
/// (the web's disabled query). No HTTP touches the view.
/// </summary>
public sealed class SoftwareUpdateHistorySource : ISoftwareUpdateHistorySource
{
    private const string SoftwareUpdatesOperation = "get_api_v1_software_updates";

    private readonly IWidgetVehicleSource _vehicles;
    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly long? _vehicleId;

    /// <summary>Creates the source over the vehicle source, contract client, engine and JSON settings.</summary>
    /// <param name="vehicles">Resolves the primary (or explicit) vehicle that gates the read.</param>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    /// <param name="vehicleId">An explicit vehicle id; when null the primary cached vehicle is used.</param>
    public SoftwareUpdateHistorySource(
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
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<SoftwareUpdateSample>>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vehicleId = await ResolveVehicleIdAsync(cancellationToken).ConfigureAwait(false);
        if (vehicleId is not { } vid)
        {
            // Web parity: with no vehicle the useSoftwareUpdates query is disabled and `data` is undefined.
            yield return RepositoryResult<IReadOnlyList<SoftwareUpdateSample>>.Empty();
            yield break;
        }

        // Web parity: the queryKey is per-vehicle, so cache entries are scoped per resolved vehicle even
        // though the request itself is fleet-wide (no vehicle_id query parameter).
        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"software-updates:{vid}:list");
        var request = new ApiRequest(SoftwareUpdatesOperation);

        var raw = _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmptyResponse,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return SoftwareUpdateHistoryResultMapper.Map(emission);
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

    private static bool IsEmptyResponse(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Array => element.GetArrayLength() == 0,
        _ => false,
    };
}
