using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.FeatureViews.Charging;

/// <summary>
/// The data port the <see cref="CostAnalysisPageViewModel"/> binds to (P1/S8 state-holder seam) — the native
/// analogue of the web Cost Analysis page's <c>useChargingSessionsPaginated(vehicleId, …)</c> read. It yields
/// the cache-then-network sequence of parsed charging-session lists for the scoped (or primary) vehicle; the
/// session count gates the page's loading / empty / success states and the rows feed the page's monthly /
/// cost-per-kWh / charger-type aggregation. The view never performs HTTP itself; the repository-backed
/// <see cref="CostAnalysisSessionsSource"/> (or a test fake) drives this.
/// </summary>
public interface ICostAnalysisSessionsSource
{
    /// <summary>Stream the cache-then-network charging-session snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<CostAnalysisSession>>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="ICostAnalysisSessionsSource"/> — the native data adapter for the Cost
/// Analysis page and the C# port of the web <c>useChargingSessionsPaginated</c> hook composition
/// (web/src/api/hooks/useCharging.ts + web/src/hooks/useSelectedVehicle.ts). It resolves the scoped (or
/// primary) vehicle from the shared <see cref="IWidgetVehicleSource"/> — the native analogue of the page's
/// <c>useSelectedVehicle()</c> scope — then runs one cache-then-network read of the charging-sessions list
/// (generated operation <c>get_api_v1_charging_sessions</c>, scoped by <c>vehicle_id</c>) through the shared
/// <see cref="CacheThenNetworkEngine"/>, caching the raw JSON so the snake_case wire shape round-trips
/// losslessly, and parses each emission into <see cref="CostAnalysisSession"/> rows via
/// <see cref="CostAnalysisResultMapper"/>. When no vehicle is available the read short-circuits to
/// <see cref="RepositoryResult{T}.Empty()"/>, mirroring the web hook's disabled query
/// (<c>enabled: vehicleId !== null</c>). No HTTP touches the view.
/// </summary>
public sealed class CostAnalysisSessionsSource : ICostAnalysisSessionsSource
{
    private const string VehicleQueryParam = "vehicle_id";

    private readonly IWidgetVehicleSource _vehicles;
    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly long? _vehicleId;

    /// <summary>Creates the source over the vehicle source, contract client, engine and JSON settings.</summary>
    /// <param name="vehicles">Resolves the scoped (or primary) vehicle to scope the read to.</param>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    /// <param name="vehicleId">An explicit vehicle id; when null the primary cached vehicle is used.</param>
    public CostAnalysisSessionsSource(
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
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<CostAnalysisSession>>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vehicleId = await ResolveVehicleIdAsync(cancellationToken).ConfigureAwait(false);
        if (vehicleId is not { } vid)
        {
            // Web parity: with no vehicle the charging-sessions query is disabled and `sessions` is undefined.
            yield return RepositoryResult<IReadOnlyList<CostAnalysisSession>>.Empty();
            yield break;
        }

        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"charging:{vid}:cost-analysis");
        var request = new ApiRequest(
            Operations.Charging.Sessions,
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
            yield return CostAnalysisResultMapper.Map(emission);
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

/// <summary>
/// An <see cref="ICostAnalysisSessionsSource"/> that immediately yields a single empty result — the default
/// feed the parameterless <see cref="CostAnalysisPage"/> uses so the registered shell page renders the
/// page-level empty state without a data layer (the established W7 default-feed pattern). DI hosts and the
/// headless tests inject the repository-backed source (or a fake) to exercise the full state matrix.
/// </summary>
public sealed class EmptyCostAnalysisSessionsSource : ICostAnalysisSessionsSource
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyCostAnalysisSessionsSource Instance { get; } = new();

    private EmptyCostAnalysisSessionsSource()
    {
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<CostAnalysisSession>>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        yield return RepositoryResult<IReadOnlyList<CostAnalysisSession>>.Empty();
        await Task.CompletedTask.ConfigureAwait(false);
    }
}
