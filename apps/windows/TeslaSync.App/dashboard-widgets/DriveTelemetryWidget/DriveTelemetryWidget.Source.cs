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
/// The data port the <see cref="DriveTelemetryViewModel"/> binds to (P1/S8 state-holder seam). It yields
/// the cache-then-network sequence of the latest drive's telemetry (paired with that drive's summary) for
/// the primary (or explicit) vehicle — the native analogue of the web <c>useVehicles</c> + <c>useDrives</c>
/// + <c>useDriveTelemetry</c> hook composition
/// (web/src/features/dashboard/widgets/DriveTelemetryWidget.tsx). The view never performs HTTP itself; the
/// concrete <see cref="DriveTelemetrySource"/> (or a test fake) drives this.
/// </summary>
public interface IDriveTelemetrySource
{
    /// <summary>Stream the cache-then-network drive-telemetry snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<DriveTelemetrySnapshot>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IDriveTelemetrySource"/> — the native data adapter for the Drive
/// Telemetry surface. It resolves the primary (or explicit) vehicle from the shared
/// <see cref="IWidgetVehicleSource"/> (the native analogue of the web <c>vehicleId ?? vehicles?.[0]?.id</c>),
/// then composes the web's hook chain:
/// <list type="number">
///   <item>One cache-then-network read of the drive list (generated operation <c>get_api_v1_drives</c>,
///         scoped by <c>vehicle_id</c>) to resolve the newest drive by <c>start_ts</c> — the web
///         <c>useDrives</c> + the <c>latestDrive</c> reduce. No drive → <see cref="RepositoryResult{T}.Empty"/>
///         (the web <c>!latestDrive</c> gate).</item>
///   <item>The primary cache-then-network read of that drive's telemetry (generated operation
///         <c>get_api_v1_drives_driveID_telemetry</c>) — the web <c>useDriveTelemetry</c>, which drives the
///         replay chart and the freshness / error chrome.</item>
/// </list>
/// Each telemetry emission is combined with the resolved drive summary via
/// <see cref="DriveTelemetryResultMapper"/>. When no vehicle is available the read short-circuits to
/// <see cref="RepositoryResult{T}.Empty"/>, mirroring the web hooks' disabled queries
/// (<c>enabled: !!vehicleId</c> / <c>!!driveId</c>). No HTTP touches the view.
/// </summary>
public sealed class DriveTelemetrySource : IDriveTelemetrySource
{
    private const string DrivePathParam = "driveID";
    private const string VehicleQueryParam = "vehicle_id";

    private readonly IWidgetVehicleSource _vehicles;
    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly long? _vehicleId;

    /// <summary>Creates the source over the vehicle source, contract client, engine and JSON settings.</summary>
    /// <param name="vehicles">Resolves the primary (or explicit) vehicle to scope the reads to.</param>
    /// <param name="api">The generated contract client.</param>
    /// <param name="engine">The shared cache-then-network read engine.</param>
    /// <param name="options">The shared API client options (for JSON settings).</param>
    /// <param name="vehicleId">An explicit vehicle id; when null the primary cached vehicle is used.</param>
    public DriveTelemetrySource(
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
    public async IAsyncEnumerable<RepositoryResult<DriveTelemetrySnapshot>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vehicleId = await ResolveVehicleIdAsync(cancellationToken).ConfigureAwait(false);
        if (vehicleId is not { } vid)
        {
            // Web parity: with no vehicle the drive queries are disabled and `latestDrive` is null.
            yield return RepositoryResult<DriveTelemetrySnapshot>.Empty();
            yield break;
        }

        DriveSummary? latestDrive = await ResolveLatestDriveAsync(vid, cancellationToken).ConfigureAwait(false);
        if (latestDrive is not { } drive)
        {
            // Web parity: latestDrive === null disables the telemetry query — `!latestDrive` → empty surface.
            yield return RepositoryResult<DriveTelemetrySnapshot>.Empty();
            yield break;
        }

        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"drives:{drive.Id}:telemetry");
        var request = new ApiRequest(
            Operations.Drives.Telemetry,
            PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [DrivePathParam] = drive.Id.ToString(CultureInfo.InvariantCulture),
            });

        // The telemetry array drives the freshness chrome; an empty array is still valid content (the drive
        // is resolved), so the read is never gated to "empty" — the mapper folds it into a curve-less
        // snapshot (web chartData.length === 0 → "No telemetry for this drive").
        var raw = _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            static _ => false,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return DriveTelemetryResultMapper.Map(emission, drive);
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
    /// Drain a cache-then-network read of the drive list and resolve the newest drive by <c>start_ts</c>
    /// (web <c>useDrives</c> + the <c>latestDrive</c> reduce). Returns <see langword="null"/> when there is
    /// no drive (web <c>latestDrive === null</c>); a transport failure also collapses to
    /// <see langword="null"/> so the surface shows the friendly empty state rather than an error, mirroring
    /// the web's disabled telemetry query. Cancellation still propagates.
    /// </summary>
    private async Task<DriveSummary?> ResolveLatestDriveAsync(long vid, CancellationToken cancellationToken)
    {
        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"drives:list:{vid}:drive-telemetry");
        var request = new ApiRequest(
            Operations.Drives.List,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                [VehicleQueryParam] = vid,
            });

        DriveSummary? latest = null;
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
                if (emission.HasValue && DriveSummary.Latest(emission.Value) is { } drive)
                {
                    latest = drive;
                }
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Best-effort: a drive-list failure leaves the surface empty (web latestDrive === null).
        }

        return latest;
    }

    private static bool IsEmptyArray(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Array => element.GetArrayLength() == 0,
        _ => false,
    };
}
