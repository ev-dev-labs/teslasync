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
/// The data port the <see cref="MotorSectionViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of parsed motor readings for <c>GET /motor/latest?vehicle_id={id}</c> — the native
/// analogue of the web Vehicle-Detail page's <c>useMotorLatest(vehicleId)</c> query whose <c>data</c> it passes
/// into <c>&lt;MotorSection motorData={…} /&gt;</c>
/// (web/src/features/vehicles/components/vehicle-detail/MotorSection.tsx). The view never performs HTTP itself;
/// the concrete <see cref="MotorSectionSource"/> (or a test fake) drives this.
/// </summary>
public interface IMotorSectionSource
{
    /// <summary>Stream the cache-then-network motor snapshots, newest cache first.</summary>
    /// <param name="cancellationToken">Cancels the in-flight read.</param>
    /// <returns>The cache-then-network emission sequence.</returns>
    IAsyncEnumerable<RepositoryResult<MotorSectionReading>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IMotorSectionSource"/> — the native data adapter for the powertrain surface.
/// It first resolves the vehicle to scope the read to — an explicit <c>vehicleId</c> (the Vehicle-Detail route's
/// id) wins; otherwise the primary vehicle is resolved from the shared <see cref="IWidgetVehicleSource"/> — then
/// runs one cache-then-network read of <c>GET /motor/latest?vehicle_id={id}</c> (generated operation
/// <c>get_api_v1_motor_latest</c>, the web <c>useMotorLatest</c> query) through the shared
/// <see cref="CacheThenNetworkEngine"/>, caching the raw JSON so the snake_case wire shape round-trips losslessly,
/// and parses each emission into a <see cref="MotorSectionReading"/> via <see cref="MotorSectionResultMapper"/>.
/// When no vehicle is available the read short-circuits to <see cref="RepositoryResult{T}.Empty()"/>, mirroring the
/// web hook's disabled query (<c>enabled: vehicleId &gt; 0</c>). No HTTP touches the view.
/// </summary>
public sealed class MotorSectionSource : IMotorSectionSource
{
    // The web's useMotorLatest reads /motor/latest; the generated endpoint table exposes this id but
    // Operations.cs carries no Motor group yet, so it is referenced verbatim here (scoped to this surface),
    // exactly as the sibling LiveMotorStatusSource / MotorPerformanceSource do. It resolves against
    // TeslaSync.Windows.Generated.Api.ApiEndpoints.
    private const string MotorLatestOperation = "get_api_v1_motor_latest";
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
    /// <param name="vehicleId">An explicit vehicle id (the Vehicle-Detail context); when null the primary cached vehicle is used.</param>
    public MotorSectionSource(
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
    public async IAsyncEnumerable<RepositoryResult<MotorSectionReading>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vehicleId = await ResolveVehicleIdAsync(cancellationToken).ConfigureAwait(false);
        if (vehicleId is not { } vid)
        {
            // Web parity: with no vehicle the useMotorLatest query is disabled and `data` is undefined.
            yield return RepositoryResult<MotorSectionReading>.Empty();
            yield break;
        }

        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"vehicles:{vid}:motor-section");
        var request = new ApiRequest(
            MotorLatestOperation,
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
            yield return MotorSectionResultMapper.Map(emission);
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

    // Web parity: a null / non-object body makes `motorData` falsy → the empty surface.
    private static bool IsEmptyResponse(JsonElement element) => MotorSectionReading.FromResponse(element) is null;
}
