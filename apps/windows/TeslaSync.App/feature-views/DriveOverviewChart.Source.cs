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
/// The data port the <see cref="DriveOverviewChartViewModel"/> binds to (P1/S8 state-holder seam). It yields
/// the cache-then-network sequence of one drive's parsed telemetry samples — the native analogue of the web
/// Drive-Detail page's <c>useDriveDetailData(id)</c> → <c>useDrive(id)</c> read whose <c>chartData</c> it
/// passes into <c>&lt;DriveOverviewChart chartData={…} /&gt;</c>
/// (web/src/features/driving/pages/DriveDetailPage.tsx). The view never performs HTTP itself; the concrete
/// <see cref="DriveOverviewChartSource"/> (or a test fake) drives this.
/// </summary>
public interface IDriveOverviewChartSource
{
    /// <summary>Stream the cache-then-network drive-telemetry snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<DriveOverviewSample>>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IDriveOverviewChartSource"/> — the native data adapter for the Drive
/// Overview surface. It resolves the drive to plot, then runs one cache-then-network read of that drive's
/// telemetry:
/// <list type="number">
///   <item>The drive id: an explicit <c>driveId</c> (the Drive-Detail route's <c>id</c>) wins; otherwise the
///         primary (or explicit) vehicle is resolved from the shared <see cref="IWidgetVehicleSource"/> and
///         its newest drive (by <c>start_ts</c>) is read from the drive list (generated operation
///         <c>get_api_v1_drives</c>, scoped by <c>vehicle_id</c>) — the native analogue of the page's
///         selected drive. No drive → <see cref="RepositoryResult{T}.Empty"/> (the web disabled query).</item>
///   <item>The telemetry: a cache-then-network read of <c>get_api_v1_drives_driveID_telemetry</c> through the
///         shared <see cref="CacheThenNetworkEngine"/>, caching the raw JSON so the snake_case wire shape
///         round-trips losslessly, parsed into <see cref="DriveOverviewSample"/> rows via
///         <see cref="DriveOverviewChartResultMapper"/>.</item>
/// </list>
/// No HTTP touches the view.
/// </summary>
public sealed class DriveOverviewChartSource : IDriveOverviewChartSource
{
    private const string DrivePathParam = "driveID";
    private const string VehicleQueryParam = "vehicle_id";

    private readonly IWidgetVehicleSource _vehicles;
    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly long? _vehicleId;
    private readonly long? _driveId;

    /// <summary>Creates the source over the vehicle source, contract client, engine and JSON settings.</summary>
    /// <param name="vehicles">Resolves the primary (or explicit) vehicle when no explicit drive is supplied.</param>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    /// <param name="vehicleId">An explicit vehicle id; when null the primary cached vehicle is used.</param>
    /// <param name="driveId">An explicit drive id (the Drive-Detail context); when null the newest drive is resolved.</param>
    public DriveOverviewChartSource(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        long? vehicleId = null,
        long? driveId = null)
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
        _driveId = driveId;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<DriveOverviewSample>>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? driveId = await ResolveDriveIdAsync(cancellationToken).ConfigureAwait(false);
        if (driveId is not { } did)
        {
            // Web parity: with no vehicle / no drive the drive query is disabled and `drive` is undefined.
            yield return RepositoryResult<IReadOnlyList<DriveOverviewSample>>.Empty();
            yield break;
        }

        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"drives:{did}:overview-telemetry");
        var request = new ApiRequest(
            Operations.Drives.Telemetry,
            PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [DrivePathParam] = did.ToString(CultureInfo.InvariantCulture),
            });

        // An empty / null telemetry array carries nothing to plot; the engine flags it Empty and the
        // view-model renders the web "No telemetry data available" placeholder (also reached for a
        // single-sample trace via the chartData.length > 1 gate).
        var raw = _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            IsEmptyResponse,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return DriveOverviewChartResultMapper.Map(emission);
        }
    }

    private async Task<long?> ResolveDriveIdAsync(CancellationToken cancellationToken)
    {
        if (_driveId is { } explicitDrive)
        {
            return explicitDrive;
        }

        long? vehicleId = await ResolveVehicleIdAsync(cancellationToken).ConfigureAwait(false);
        if (vehicleId is not { } vid)
        {
            return null;
        }

        return await ResolveLatestDriveIdAsync(vid, cancellationToken).ConfigureAwait(false);
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
    /// Drain a cache-then-network read of the drive list and resolve the newest drive id by <c>start_ts</c>
    /// (web's selected / latest drive). Returns <see langword="null"/> when there is no drive; a transport
    /// failure also collapses to <see langword="null"/> so the surface shows the friendly empty state rather
    /// than an error, mirroring the web's disabled drive query. Cancellation still propagates.
    /// </summary>
    private async Task<long?> ResolveLatestDriveIdAsync(long vehicleId, CancellationToken cancellationToken)
    {
        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"drives:list:{vehicleId}:drive-overview");
        var request = new ApiRequest(
            Operations.Drives.List,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                [VehicleQueryParam] = vehicleId,
            });

        long? latestId = null;
        DateTimeOffset? latestTs = null;
        try
        {
            var raw = _engine.StreamAsync<JsonElement>(
                cacheKey,
                ct => _api.SendAsync<JsonElement>(request, ct),
                IsEmptyResponse,
                _json,
                CacheFreshness.LiveStaleSeconds,
                cancellationToken);

            await foreach (var emission in raw.ConfigureAwait(false))
            {
                if (emission.HasValue && TryResolveLatest(emission.Value, out long id, out DateTimeOffset? ts)
                    && (latestId is null || IsNewer(ts, latestTs)))
                {
                    latestId = id;
                    latestTs = ts;
                }
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Best-effort: a drive-list failure leaves the surface empty (web drive === undefined).
        }

        return latestId;
    }

    // Web parity: drives.reduce((a, b) => new Date(a.startTs) > new Date(b.startTs) ? a : b) — the first row
    // wins on ties (strict >), and a null start_ts never supersedes a dated one.
    private static bool TryResolveLatest(JsonElement element, out long id, out DateTimeOffset? startTs)
    {
        id = 0;
        startTs = null;
        if (element.ValueKind != JsonValueKind.Array)
        {
            return false;
        }

        bool found = false;
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object || !TryGetLong(item, "id", out long candidateId))
            {
                continue;
            }

            DateTimeOffset? candidateTs = TryGetDateTime(item, "start_ts");
            if (!found || IsNewer(candidateTs, startTs))
            {
                id = candidateId;
                startTs = candidateTs;
                found = true;
            }
        }

        return found;
    }

    private static bool IsNewer(DateTimeOffset? candidate, DateTimeOffset? current)
    {
        if (candidate is not { } c)
        {
            return false;
        }

        return current is not { } cur || c > cur;
    }

    private static bool TryGetLong(JsonElement obj, string name, out long value)
    {
        value = 0;
        if (!obj.TryGetProperty(name, out var v))
        {
            return false;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out value) => true,
            JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out value) => true,
            _ => false,
        };
    }

    private static DateTimeOffset? TryGetDateTime(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            v.GetString(), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var ts)
            ? ts
            : null;
    }

    private static bool IsEmptyResponse(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Array => element.GetArrayLength() == 0,
        _ => false,
    };
}
