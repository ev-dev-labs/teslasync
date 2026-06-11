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
/// The data port the <see cref="RecentDrivesSectionViewModel"/> binds to (P1/S8 state-holder seam). It yields
/// the cache-then-network sequence of the vehicle's parsed drive list — the native analogue of the web
/// Vehicle-Detail page's <c>useDrives(vehicleId)</c> read whose result it passes into
/// <c>&lt;RecentDrivesSection drives={…} /&gt;</c>
/// (web/src/features/vehicles/components/vehicle-detail/RecentDrivesSection.tsx). The view never performs HTTP
/// itself; the concrete <see cref="RecentDrivesSectionSource"/> (or a test fake) drives this.
/// </summary>
public interface IRecentDrivesSectionSource
{
    /// <summary>Stream the cache-then-network drive-list snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<RecentDriveSample>>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IRecentDrivesSectionSource"/> — the native data adapter for the
/// Recent-Drives surface. It resolves the vehicle to summarise (an explicit <c>vehicleId</c> wins; otherwise
/// the primary cached vehicle from the shared <see cref="IWidgetVehicleSource"/>), then runs one
/// cache-then-network read of that vehicle's drive list (generated operation <c>get_api_v1_drives</c>, scoped
/// by <c>vehicle_id</c>) through the shared <see cref="CacheThenNetworkEngine"/>, caching the raw JSON so the
/// snake_case wire shape round-trips losslessly, parsed into <see cref="RecentDriveSample"/> rows via
/// <see cref="RecentDrivesSectionResultMapper"/>. With no vehicle the read is short-circuited to
/// <see cref="RepositoryResult{T}.Empty()"/> (the web disabled query). No HTTP touches the view.
/// </summary>
public sealed class RecentDrivesSectionSource : IRecentDrivesSectionSource
{
    private const string VehicleQueryParam = "vehicle_id";

    private readonly IWidgetVehicleSource _vehicles;
    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly long? _vehicleId;

    /// <summary>Creates the source over the vehicle source, contract client, engine and JSON settings.</summary>
    /// <param name="vehicles">Resolves the primary vehicle when no explicit vehicle is supplied.</param>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    /// <param name="vehicleId">An explicit vehicle id; when null the primary cached vehicle is used.</param>
    public RecentDrivesSectionSource(
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
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<RecentDriveSample>>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vehicleId = await ResolveVehicleIdAsync(cancellationToken).ConfigureAwait(false);
        if (vehicleId is not { } vid)
        {
            // Web parity: with no vehicle the drives query is disabled and `drives` is undefined.
            yield return RepositoryResult<IReadOnlyList<RecentDriveSample>>.Empty();
            yield break;
        }

        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"drives:list:{vid}:recent-drives");
        var request = new ApiRequest(
            Operations.Drives.List,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                [VehicleQueryParam] = vid,
            });

        // An empty / null drive list carries no rows; the engine flags it Empty and the view-model renders
        // the friendly empty surface (web EmptyState).
        var raw = _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmptyResponse,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return RecentDrivesSectionResultMapper.Map(emission);
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
