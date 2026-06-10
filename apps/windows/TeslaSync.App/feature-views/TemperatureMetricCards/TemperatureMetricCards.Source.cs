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
/// The data port the <see cref="TemperatureMetricCardsViewModel"/> binds to (P1/S8 state-holder seam). It
/// yields the cache-then-network sequence of parsed drivetrain-health snapshots (with the Peak Power tile's
/// recent-drive aggregate already folded in) for the primary (or explicit) vehicle — the native analogue of
/// the web Drivetrain-Health page's <c>useDrivetrainHealth(vehicleId)</c> read (plus the <c>useDrives</c> read
/// the page's <c>peakPower</c> memo aggregates) whose results it passes into <c>&lt;TemperatureMetricCards
/// sensors={…} overallHealth={…} healthScore={…} peakPower={…} /&gt;</c>. The view never performs HTTP itself;
/// the concrete <see cref="TemperatureMetricCardsSource"/> (or a test fake) drives this.
/// </summary>
public interface ITemperatureMetricCardsSource
{
    /// <summary>Stream the cache-then-network drivetrain-health snapshots, newest cache first.</summary>
    /// <param name="cancellationToken">Cancels the in-flight read.</param>
    /// <returns>The cache-then-network emission sequence.</returns>
    IAsyncEnumerable<RepositoryResult<TemperatureMetricCardsSnapshot>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="ITemperatureMetricCardsSource"/> — the native data adapter for the
/// Temperature Metric Cards surface. It resolves the primary (or explicit) vehicle from the shared
/// <see cref="IWidgetVehicleSource"/>, then:
/// <list type="number">
///   <item>Resolves the Peak Power tile: a best-effort cache-then-network read of the drives list (generated
///         operation <c>get_api_v1_drives</c>, scoped by <c>vehicle_id</c>) aggregated by
///         <see cref="DrivetrainPeakPower.FromDrives"/> — the native analogue of the web page's
///         <c>peakPower</c> memo. A drives failure leaves the tile at 0 (never surfaces an error), mirroring
///         the web tile which simply shows "—".</item>
///   <item>Streams the primary read: a cache-then-network read of the drivetrain-health body
///         (<c>get_api_v1_drivetrain_health</c>, scoped by <c>vehicle_id</c>) through the shared
///         <see cref="CacheThenNetworkEngine"/>, caching the raw JSON so the snake_case wire shape round-trips
///         losslessly, parsed (with the resolved peak power) into a <see cref="TemperatureMetricCardsSnapshot"/>
///         via <see cref="TemperatureMetricCardsResultMapper"/>.</item>
/// </list>
/// When no vehicle is available the read short-circuits to <see cref="RepositoryResult{T}.Empty"/>, mirroring
/// the web hook's disabled query (<c>enabled: !!vehicleId</c>). No HTTP touches the view.
/// </summary>
public sealed class TemperatureMetricCardsSource : ITemperatureMetricCardsSource
{
    // The drivetrain-health endpoint is not registered in Operations.cs (it carries no declared query
    // parameter in the generated descriptor); the literal operation id resolves against the generated
    // endpoint table directly. OperationsResolveTests-style resolution still applies via the engine's client.
    private const string DrivetrainHealthOperation = "get_api_v1_drivetrain_health";
    private const string VehicleQueryParam = "vehicle_id";

    private readonly IWidgetVehicleSource _vehicles;
    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly Func<DateTimeOffset> _clock;
    private readonly long? _vehicleId;

    /// <summary>Creates the source over the vehicle source, contract client, engine and JSON settings.</summary>
    /// <param name="vehicles">Resolves the primary (or explicit) vehicle to scope the read to.</param>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    /// <param name="vehicleId">An explicit vehicle id; when null the primary cached vehicle is used.</param>
    /// <param name="clock">The clock the Peak Power window is derived from; defaults to <see cref="DateTimeOffset.Now"/>.</param>
    public TemperatureMetricCardsSource(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        long? vehicleId = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(vehicles);
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _vehicles = vehicles;
        _api = api;
        _engine = engine;
        _json = options.Json;
        _clock = clock ?? (() => DateTimeOffset.Now);
        _vehicleId = vehicleId;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<TemperatureMetricCardsSnapshot>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vehicleId = await ResolveVehicleIdAsync(cancellationToken).ConfigureAwait(false);
        if (vehicleId is not { } vid)
        {
            // Web parity: with no vehicle the drivetrain-health query is disabled and `health` is undefined.
            yield return RepositoryResult<TemperatureMetricCardsSnapshot>.Empty();
            yield break;
        }

        double peakPowerKw = await ResolvePeakPowerAsync(vid, cancellationToken).ConfigureAwait(false);

        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"drivetrain:{vid}:health-metric-cards");
        var request = new ApiRequest(
            DrivetrainHealthOperation,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                [VehicleQueryParam] = vid,
            });

        // A null body carries no drivetrain-health snapshot; the engine flags it Empty and the view-model
        // renders the web "{health ? … : <EmptyState/>}" empty state.
        var raw = _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmptyHealth,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return TemperatureMetricCardsResultMapper.Map(emission, peakPowerKw);
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

    /// <summary>
    /// Drain a best-effort cache-then-network read of the drives list and aggregate the Peak Power tile value
    /// via <see cref="DrivetrainPeakPower.FromDrives"/> (web <c>peakPower</c>). The freshest value-bearing
    /// emission wins; a transport failure (or an empty body) collapses to 0 so the surface shows "—" rather
    /// than an error, mirroring the web tile. Cancellation still propagates.
    /// </summary>
    private async Task<double> ResolvePeakPowerAsync(long vehicleId, CancellationToken cancellationToken)
    {
        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"drives:list:{vehicleId}:temperature-metric-cards");
        var request = new ApiRequest(
            Operations.Drives.List,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                [VehicleQueryParam] = vehicleId,
            });

        double peakPowerKw = 0;
        try
        {
            var raw = _engine.StreamAsync<JsonElement>(
                cacheKey,
                ct => _api.SendAsync<JsonElement>(request, ct),
                IsEmptyArray,
                _json,
                CacheFreshness.LiveStaleSeconds,
                cancellationToken);

            await foreach (var emission in raw.ConfigureAwait(false))
            {
                peakPowerKw = emission.HasValue
                    ? DrivetrainPeakPower.FromDrives(emission.Value, _clock())
                    : 0;
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Best-effort: a drives-list failure leaves the Peak Power tile at "—" (web peakPower === 0).
        }

        return peakPowerKw;
    }

    private static bool IsEmptyHealth(JsonElement element) =>
        element.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined;

    private static bool IsEmptyArray(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Array => element.GetArrayLength() == 0,
        _ => false,
    };
}
