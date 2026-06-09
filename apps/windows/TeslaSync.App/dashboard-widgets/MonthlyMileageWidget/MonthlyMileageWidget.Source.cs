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
/// The data port the <see cref="MonthlyMileageViewModel"/> binds to (P1/S8 state-holder seam). It yields
/// the cache-then-network sequence of parsed monthly-mileage lists for the primary (or explicit) vehicle —
/// the native analogue of the web <c>useVehicles</c> + <c>useMonthlyMileage(vehicleId)</c> hook composition
/// (web/src/features/dashboard/widgets/MonthlyMileageWidget.tsx). The view never performs HTTP itself; the
/// concrete <see cref="MonthlyMileageSource"/> (or a test fake) drives this.
/// </summary>
public interface IMonthlyMileageSource
{
    /// <summary>Stream the cache-then-network monthly-mileage snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<MonthlyMileageBucket>>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IMonthlyMileageSource"/> — the native data adapter for the Monthly
/// Mileage surface. It first resolves the primary vehicle from the shared <see cref="IWidgetVehicleSource"/>
/// (the native analogue of the web component's <c>vehicleId ?? vehicles?.[0]?.id</c>), then runs one
/// cache-then-network read of the monthly-mileage rollup (generated operation
/// <c>get_api_v1_mileage_monthly</c>, scoped by <c>vehicle_id</c>) through the shared
/// <see cref="CacheThenNetworkEngine"/>, caching the raw JSON so the snake_case <c>{vehicle_id, months}</c>
/// envelope round-trips losslessly, and parses each emission's <c>months</c> array into
/// <see cref="MonthlyMileageBucket"/> rows via <see cref="MonthlyMileageResultMapper"/> (the native
/// analogue of the web hook's <c>select: (resp) =&gt; safeArray(resp?.months)</c>). When no vehicle is
/// available the read short-circuits to <see cref="RepositoryResult{T}.Empty()"/>, mirroring the web hook's
/// disabled query (<c>enabled: !!vehicleId</c>). No HTTP touches the view.
/// </summary>
public sealed class MonthlyMileageSource : IMonthlyMileageSource
{
    // The generated endpoint id for GET /mileage/monthly (TeslaSync.Windows.Generated.Api.ApiEndpoints).
    // The shared Operations table carries no analytics-mileage group yet, so the surface names its own
    // endpoint id here; MonthlyMileageWidgetTests asserts it resolves against the generated table so a
    // regenerated client that renamed it fails at test time rather than at runtime.
    private const string MonthlyMileageOperation = "get_api_v1_mileage_monthly";
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
    public MonthlyMileageSource(
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
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<MonthlyMileageBucket>>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vehicleId = await ResolveVehicleIdAsync(cancellationToken).ConfigureAwait(false);
        if (vehicleId is not { } vid)
        {
            // Web parity: with no vehicle the monthly-mileage query is disabled and `data` is undefined.
            yield return RepositoryResult<IReadOnlyList<MonthlyMileageBucket>>.Empty();
            yield break;
        }

        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"analytics:{vid}:monthly-mileage");
        var request = new ApiRequest(
            MonthlyMileageOperation,
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
            yield return MonthlyMileageResultMapper.Map(emission);
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

    // Web parity: the hook selects `resp?.months` through `safeArray`, so an envelope with no `months`
    // (or a non-object body) carries no data and collapses to the empty terminal.
    private static bool IsEmptyResponse(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return true;
        }

        return !element.TryGetProperty("months", out var months) ||
            months.ValueKind != JsonValueKind.Array ||
            months.GetArrayLength() == 0;
    }
}
