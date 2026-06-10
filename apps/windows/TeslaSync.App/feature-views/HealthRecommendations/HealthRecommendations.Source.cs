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
/// The data port the <see cref="HealthRecommendationsViewModel"/> binds to (P1/S8 state-holder seam). It
/// yields the cache-then-network sequence of parsed drivetrain-health snapshots for the primary (or explicit)
/// vehicle — the native analogue of the web page's <c>useDrivetrainHealth(vehicleId)</c> query whose
/// <c>overallHealth</c> the web <c>HealthRecommendations</c> consumes as a prop. The view never performs HTTP
/// itself; the concrete <see cref="HealthRecommendationsSource"/> (or a test fake) drives this.
/// </summary>
public interface IHealthRecommendationsSource
{
    /// <summary>Stream the cache-then-network drivetrain-health snapshots, newest cache first.</summary>
    /// <param name="cancellationToken">Cancels the in-flight read.</param>
    /// <returns>The cache-then-network emission sequence.</returns>
    IAsyncEnumerable<RepositoryResult<DrivetrainHealthSnapshot>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IHealthRecommendationsSource"/> — the native data adapter for the Health
/// Recommendations surface. It first resolves the primary vehicle from the shared
/// <see cref="IWidgetVehicleSource"/> (the native analogue of the web page's selected-vehicle id), then runs
/// one cache-then-network read of <c>GET /drivetrain/health</c> (generated operation
/// <see cref="HealthRecommendationsRegistration.DrivetrainHealthOperation"/>, scoped by <c>vehicle_id</c>)
/// through the shared <see cref="CacheThenNetworkEngine"/>, caching the raw JSON so the snake_case wire shape
/// round-trips losslessly. Each emission is parsed into a <see cref="DrivetrainHealthSnapshot"/> via
/// <see cref="HealthRecommendationsResultMapper"/>. When no vehicle is available the read short-circuits to
/// <see cref="RepositoryResult{T}.Empty()"/>, mirroring the web hook's disabled query (<c>enabled: !!vehicleId</c>).
/// No HTTP touches the view.
/// </summary>
public sealed class HealthRecommendationsSource : IHealthRecommendationsSource
{
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
    public HealthRecommendationsSource(
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
    public async IAsyncEnumerable<RepositoryResult<DrivetrainHealthSnapshot>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vehicleId = await ResolveVehicleIdAsync(cancellationToken).ConfigureAwait(false);
        if (vehicleId is not { } vid)
        {
            // Web parity: with no vehicle the drivetrain-health query is disabled and the data is undefined.
            yield return RepositoryResult<DrivetrainHealthSnapshot>.Empty();
            yield break;
        }

        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"drivetrain:{vid}:health");
        var request = new ApiRequest(
            HealthRecommendationsRegistration.DrivetrainHealthOperation,
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
            yield return HealthRecommendationsResultMapper.Map(emission);
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

    // The drivetrain-health endpoint returns an object; a null / non-object / empty-object body carries no
    // health level to recommend on (the whole-surface empty treatment, mirroring the web page's EmptyState
    // when `health` is absent). A populated object that simply omits `overall_health` is still parsed and the
    // empty state is then derived from the snapshot's HasData gate.
    private static bool IsEmptyResponse(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Object => !element.EnumerateObject().MoveNext(),
        _ => false,
    };
}
