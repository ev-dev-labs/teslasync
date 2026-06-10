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
/// The data port the <see cref="SpeedGearPanelViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of merged <see cref="SpeedGearSnapshot"/>s (the live motor reading + the drive
/// speed aggregate) — the native analogue of the web Driving-Dynamics page's <c>useMotorLatest(vehicleId)</c>
/// read and the <c>useDrives(...)</c> read it reduces to <c>avgDriveSpeedMps</c> / <c>topDriveSpeedMps</c>,
/// both passed into <c>&lt;SpeedGearPanel motorLatest={…} filteredDrives={…} /&gt;</c>
/// (web/src/features/driving/components/driving-dynamics/SpeedGearPanel.tsx). The view never performs HTTP
/// itself; the concrete <see cref="SpeedGearPanelSource"/> (or a test fake) drives this.
/// </summary>
public interface ISpeedGearPanelSource
{
    /// <summary>Stream the cache-then-network speed-and-gear snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<SpeedGearSnapshot>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="ISpeedGearPanelSource"/> — the native data adapter for the Speed &amp; Gear
/// surface. It resolves the primary (or explicit) vehicle from the shared <see cref="IWidgetVehicleSource"/>,
/// then:
/// <list type="number">
///   <item>Resolves the drive speed aggregate: a best-effort cache-then-network read of the drives list
///         (generated operation <c>get_api_v1_drives</c>, scoped by <c>vehicle_id</c>) reduced by
///         <see cref="SpeedGearDriveStats.FromDrives"/> — the native analogue of the web page's
///         <c>avgDriveSpeedMps</c> / <c>topDriveSpeedMps</c> memos. A drives failure leaves the aggregate at
///         <see cref="SpeedGearDriveStats.Empty"/> (the two speed tiles show the em dash), never failing the
///         surface — mirroring the web rows.</item>
///   <item>Streams the primary read: a cache-then-network read of <c>GET /motor/latest?vehicle_id={id}</c>
///         (generated operation <c>get_api_v1_motor_latest</c>, the web <c>useMotorLatest</c> query) through the
///         shared <see cref="CacheThenNetworkEngine"/>, caching the raw JSON so the snake_case wire shape
///         round-trips losslessly, parsed (with the resolved drive aggregate folded in) into a
///         <see cref="SpeedGearSnapshot"/> via <see cref="SpeedGearPanelResultMapper"/>.</item>
/// </list>
/// The motor read is never declared "empty" at the engine boundary (a null motor body still produces a
/// snapshot so the drive speeds keep rendering); the view-model owns the empty classification from the merged
/// snapshot. When no vehicle is available the read short-circuits to <see cref="RepositoryResult{T}.Empty"/>,
/// mirroring the web hook's disabled query (<c>enabled: vehicleId &gt; 0</c>). No HTTP touches the view.
/// </summary>
public sealed class SpeedGearPanelSource : ISpeedGearPanelSource
{
    // The web's useMotorLatest reads /motor/latest; Operations.cs carries no Motor group yet, so the id is
    // referenced verbatim here (scoped to this surface), exactly as the sibling LiveMotorStatusSource does.
    // It resolves against TeslaSync.Windows.Generated.Api.ApiEndpoints.
    private const string MotorLatestOperation = "get_api_v1_motor_latest";
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
    public SpeedGearPanelSource(
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
    public async IAsyncEnumerable<RepositoryResult<SpeedGearSnapshot>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vehicleId = await ResolveVehicleIdAsync(cancellationToken).ConfigureAwait(false);
        if (vehicleId is not { } vid)
        {
            // Web parity: with no vehicle both the motor and drives queries are disabled.
            yield return RepositoryResult<SpeedGearSnapshot>.Empty();
            yield break;
        }

        SpeedGearDriveStats drives = await ResolveDrivesAsync(vid, cancellationToken).ConfigureAwait(false);

        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"vehicles:{vid}:speed-gear-panel");
        var request = new ApiRequest(
            MotorLatestOperation,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                [VehicleQueryParam] = vid,
            });

        // The motor read is never short-circuited to Empty (isEmpty: never): a null motor body still yields a
        // snapshot so the drive speeds keep rendering; the view-model decides Empty from the merged snapshot.
        var raw = _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            static _ => false,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return SpeedGearPanelResultMapper.Map(emission, drives);
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
    /// Drain a best-effort cache-then-network read of the drives list and reduce the speed aggregate via
    /// <see cref="SpeedGearDriveStats.FromDrives"/> (web <c>avgDriveSpeedMps</c> / <c>topDriveSpeedMps</c>). The
    /// freshest value-bearing emission wins; a transport failure (or an empty body) collapses to
    /// <see cref="SpeedGearDriveStats.Empty"/> so the two speed tiles show the em dash rather than an error,
    /// mirroring the web rows. Cancellation still propagates.
    /// </summary>
    private async Task<SpeedGearDriveStats> ResolveDrivesAsync(long vehicleId, CancellationToken cancellationToken)
    {
        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"drives:list:{vehicleId}:speed-gear");
        var request = new ApiRequest(
            Operations.Drives.List,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                [VehicleQueryParam] = vehicleId,
            });

        SpeedGearDriveStats drives = SpeedGearDriveStats.Empty;
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
                drives = emission.HasValue
                    ? SpeedGearDriveStats.FromDrives(emission.Value)
                    : SpeedGearDriveStats.Empty;
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Best-effort: a drives-list failure leaves the average / top speed tiles at the em dash.
        }

        return drives;
    }

    private static bool IsEmptyArray(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Array => element.GetArrayLength() == 0,
        _ => false,
    };
}
