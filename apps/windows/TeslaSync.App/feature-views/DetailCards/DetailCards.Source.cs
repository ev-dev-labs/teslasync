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
/// The data port the <see cref="DetailCardsViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of parsed drivetrain detail snapshots (with the Power-Summary recent-drive
/// aggregate and the lifetime driving stats already folded in) for the primary (or explicit) vehicle — the
/// native analogue of the web Drivetrain-Health page's <c>useDrivetrainHealth(vehicleId)</c> read (plus the
/// <c>useDrives</c> read the page's power memos aggregate and the <c>useDrivingStats</c> read its regen / CO₂
/// rows consume) whose results it passes into
/// <c>&lt;DetailCards health={…} peakPower={…} avgPowerMax={…} minRegenPower={…} stats={…} /&gt;</c>. The view
/// never performs HTTP itself; the concrete <see cref="DetailCardsSource"/> (or a test fake) drives this.
/// </summary>
public interface IDetailCardsSource
{
    /// <summary>Stream the cache-then-network drivetrain detail snapshots, newest cache first.</summary>
    /// <param name="cancellationToken">Cancels the in-flight read.</param>
    /// <returns>The cache-then-network emission sequence.</returns>
    IAsyncEnumerable<RepositoryResult<DetailCardsSnapshot>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IDetailCardsSource"/> — the native data adapter for the Detail Cards
/// surface. It resolves the primary (or explicit) vehicle from the shared <see cref="IWidgetVehicleSource"/>,
/// then:
/// <list type="number">
///   <item>Resolves the Power-Summary figures: a best-effort cache-then-network read of the drives list
///         (generated operation <c>get_api_v1_drives</c>, scoped by <c>vehicle_id</c>) aggregated by
///         <see cref="DrivetrainPowerSummary.FromDrives"/> — the native analogue of the web page's
///         <c>peakPower</c> / <c>avgPowerMax</c> / <c>minRegenPower</c> memos. A drives failure leaves the
///         figures at <see cref="DrivetrainPowerSummary.Zero"/> (never surfaces an error), mirroring the web
///         rows which simply show the em-dash.</item>
///   <item>Resolves the lifetime stats: a best-effort cache-then-network read of the driving rollup
///         (generated operation <c>get_api_v1_drives_stats</c>, scoped by <c>vehicle_id</c>) parsed into a
///         <see cref="DetailCardsStats"/> — the web <c>useDrivingStats(vehicleId)</c> query. A failure or
///         empty result leaves the stats <see langword="null"/> (web <c>stats === undefined</c> → both rows
///         show the em-dash), never failing the surface.</item>
///   <item>Streams the primary read: a cache-then-network read of the drivetrain-health body
///         (<c>get_api_v1_drivetrain_health</c>, scoped by <c>vehicle_id</c>) through the shared
///         <see cref="CacheThenNetworkEngine"/>, caching the raw JSON so the snake_case wire shape round-trips
///         losslessly, parsed (with the resolved power and stats) into a <see cref="DetailCardsSnapshot"/> via
///         <see cref="DetailCardsResultMapper"/>.</item>
/// </list>
/// When no vehicle is available the read short-circuits to <see cref="RepositoryResult{T}.Empty"/>, mirroring
/// the web hook's disabled query (<c>enabled: !!vehicleId</c>). No HTTP touches the view.
/// </summary>
public sealed class DetailCardsSource : IDetailCardsSource
{
    // The drivetrain-health endpoint is not registered in Operations.cs (it carries no declared query
    // parameter in the generated descriptor); the literal operation id resolves against the generated
    // endpoint table directly.
    private const string DrivetrainHealthOperation = "get_api_v1_drivetrain_health";
    private const string VehicleQueryParam = "vehicle_id";

    private readonly IWidgetVehicleSource _vehicles;
    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly Func<DateTimeOffset> _clock;
    private readonly long? _vehicleId;

    /// <summary>Creates the source over the vehicle source, contract client, engine and JSON settings.</summary>
    /// <param name="vehicles">Resolves the primary (or explicit) vehicle to scope the reads to.</param>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    /// <param name="vehicleId">An explicit vehicle id; when null the primary cached vehicle is used.</param>
    /// <param name="clock">The clock the Power-Summary window is derived from; defaults to <see cref="DateTimeOffset.Now"/>.</param>
    public DetailCardsSource(
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
    public async IAsyncEnumerable<RepositoryResult<DetailCardsSnapshot>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vehicleId = await ResolveVehicleIdAsync(cancellationToken).ConfigureAwait(false);
        if (vehicleId is not { } vid)
        {
            // Web parity: with no vehicle the drivetrain-health query is disabled and `health` is undefined.
            yield return RepositoryResult<DetailCardsSnapshot>.Empty();
            yield break;
        }

        DrivetrainPowerSummary power = await ResolvePowerAsync(vid, cancellationToken).ConfigureAwait(false);
        DetailCardsStats? stats = await ResolveStatsAsync(vid, cancellationToken).ConfigureAwait(false);

        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"drivetrain:{vid}:health-detail-cards");
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
            yield return DetailCardsResultMapper.Map(emission, power, stats);
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
    /// Drain a best-effort cache-then-network read of the drives list and aggregate the Power-Summary figures
    /// via <see cref="DrivetrainPowerSummary.FromDrives"/> (web <c>peakPower</c> / <c>avgPowerMax</c> /
    /// <c>minRegenPower</c>). The freshest value-bearing emission wins; a transport failure (or an empty body)
    /// collapses to <see cref="DrivetrainPowerSummary.Zero"/> so the rows show the em-dash rather than an
    /// error, mirroring the web rows. Cancellation still propagates.
    /// </summary>
    private async Task<DrivetrainPowerSummary> ResolvePowerAsync(long vehicleId, CancellationToken cancellationToken)
    {
        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"drives:list:{vehicleId}:detail-cards");
        var request = new ApiRequest(
            Operations.Drives.List,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                [VehicleQueryParam] = vehicleId,
            });

        DrivetrainPowerSummary power = DrivetrainPowerSummary.Zero;
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
                power = emission.HasValue
                    ? DrivetrainPowerSummary.FromDrives(emission.Value, _clock())
                    : DrivetrainPowerSummary.Zero;
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Best-effort: a drives-list failure leaves the Power-Summary rows at the em-dash.
        }

        return power;
    }

    /// <summary>
    /// Drain a best-effort cache-then-network read of the lifetime driving stats, returning the freshest
    /// value-bearing <see cref="DetailCardsStats"/> or <see langword="null"/>. The figures are supplementary
    /// (web <c>stats</c>), so any network / parse failure or empty result collapses to <see langword="null"/>
    /// (both rows show the em-dash) rather than propagating — cancellation still propagates so a superseded
    /// load is dropped.
    /// </summary>
    private async Task<DetailCardsStats?> ResolveStatsAsync(long vehicleId, CancellationToken cancellationToken)
    {
        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"drives:stats:{vehicleId}:detail-cards");
        var request = new ApiRequest(
            Operations.Drives.Stats,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                [VehicleQueryParam] = vehicleId,
            });

        DetailCardsStats? stats = null;
        try
        {
            var raw = _engine.StreamAsync<JsonElement>(
                cacheKey,
                ct => _api.SendAsync<JsonElement>(request, ct),
                IsEmptyStats,
                _json,
                CacheFreshness.LiveStaleSeconds,
                cancellationToken);

            await foreach (var emission in raw.ConfigureAwait(false))
            {
                if (emission.HasValue && DetailCardsStats.FromJson(emission.Value) is { } parsed)
                {
                    stats = parsed;
                }
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Best-effort: a stats failure leaves the regen / CO₂ rows at the em-dash (web `stats` undefined).
        }

        return stats;
    }

    private static bool IsEmptyHealth(JsonElement element) =>
        element.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined;

    private static bool IsEmptyArray(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Array => element.GetArrayLength() == 0,
        _ => false,
    };

    private static bool IsEmptyStats(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Object => !element.EnumerateObject().MoveNext(),
        _ => false,
    };
}
