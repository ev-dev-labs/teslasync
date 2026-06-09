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
/// The data port the <see cref="VehicleUpgradesViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of combined <see cref="VehicleUpgradesSnapshot"/> values — the native analogue
/// of the web <c>useVehicles</c> + <c>useVehicleUpgrades</c> (shell chrome) plus the independent
/// <c>useDrives</c> → <c>useShareLinks</c> chain (Share Links section) in
/// web/src/features/dashboard/widgets/VehicleUpgradesWidget.tsx. The view never performs HTTP itself; the
/// concrete <see cref="VehicleUpgradesSource"/> (or a test fake) drives this.
/// </summary>
public interface IVehicleUpgradesSource
{
    /// <summary>Stream the cache-then-network upgrades + share-links snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<VehicleUpgradesSnapshot>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IVehicleUpgradesSource"/> — the native data adapter for the Upgrades &amp;
/// Sharing surface. It resolves the primary (or explicit) vehicle from the shared
/// <see cref="IWidgetVehicleSource"/> (the native analogue of the web <c>vehicleId ?? vehicles?.[0]?.id</c>),
/// then composes the web's two independent hook chains:
/// <list type="number">
///   <item>A best-effort cache-then-network read of the drive list (generated operation
///         <c>get_api_v1_drives</c>, scoped by <c>vehicle_id</c>) to resolve the most-recent drive id — the
///         web <c>useDrives</c> + <c>drives[0].id</c> — followed by that drive's share links (generated
///         operation <c>get_api_v1_drives_driveID_shares</c>, the web <c>useShareLinks</c>). These feed only
///         the Share Links section and never gate the surface: any failure leaves the section empty, exactly
///         as the web's disabled / erroring queries collapse <c>activeShareLinks</c> to <c>[]</c>.</item>
///   <item>The primary cache-then-network read of the vehicle's upgrades (operation
///         <see cref="VehicleUpgradesRegistration.UpgradesOperationId"/>, the web <c>useVehicleUpgrades</c>),
///         which drives the loading / error / freshness chrome. Each emission is folded with the resolved
///         share links via <see cref="VehicleUpgradesResultMapper"/>.</item>
/// </list>
/// When no vehicle is available the read short-circuits to <see cref="RepositoryResult{T}.Empty"/>, mirroring
/// the web hooks' disabled queries (<c>enabled: !!vehicleId</c>) — the surface still renders its two-section
/// body from the empty snapshot. No HTTP touches the view.
/// </summary>
public sealed class VehicleUpgradesSource : IVehicleUpgradesSource
{
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
    public VehicleUpgradesSource(
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
    public async IAsyncEnumerable<RepositoryResult<VehicleUpgradesSnapshot>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vehicleId = await ResolveVehicleIdAsync(cancellationToken).ConfigureAwait(false);
        if (vehicleId is not { } vid)
        {
            // Web parity: with no vehicle the upgrades + drives + share-links queries are all disabled; the
            // widget still renders its two-section body (empty upgrades + no share links) from the empty
            // snapshot the Empty result projects.
            yield return RepositoryResult<VehicleUpgradesSnapshot>.Empty();
            yield break;
        }

        // Share Links section (best-effort, non-gating): most-recent drive → that drive's share links.
        long? recentDriveId = await ResolveRecentDriveIdAsync(vid, cancellationToken).ConfigureAwait(false);
        IReadOnlyList<ShareLinkInfo> shareLinks = recentDriveId is { } driveId
            ? await ResolveShareLinksAsync(driveId, cancellationToken).ConfigureAwait(false)
            : Array.Empty<ShareLinkInfo>();

        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"vehicles:{vid}:upgrades");
        var request = new ApiRequest(
            VehicleUpgradesRegistration.UpgradesOperationId,
            PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [VehicleUpgradesRegistration.VehiclePathParam] = vid.ToString(CultureInfo.InvariantCulture),
            });

        // The upgrades data object is always meaningful (an empty object renders the "All upgrades applied"
        // inline empty state, not the engine's generic Empty), so nothing is gated to empty here.
        var stream = _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            static _ => false,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in stream.ConfigureAwait(false))
        {
            yield return VehicleUpgradesResultMapper.Map(emission, shareLinks);
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
    /// Drain a cache-then-network read of the drive list and resolve the most-recent drive id — the web
    /// <c>useDrives</c> + <c>drives[0].id</c>. Returns <see langword="null"/> when there is no drive (web
    /// <c>drives.length === 0</c>); a transport failure also collapses to <see langword="null"/> so the Share
    /// Links section simply shows its empty state, mirroring the web's disabled share-links query.
    /// Cancellation still propagates.
    /// </summary>
    private async Task<long?> ResolveRecentDriveIdAsync(long vid, CancellationToken cancellationToken)
    {
        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"drives:list:{vid}:vehicle-upgrades");
        var request = new ApiRequest(
            Operations.Drives.List,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                [VehicleUpgradesRegistration.VehicleQueryParam] = vid,
            });

        long? recent = null;
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
                if (emission.HasValue && FirstDriveId(emission.Value) is { } driveId)
                {
                    recent = driveId;
                }
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Best-effort: a drive-list failure leaves the Share Links section empty (web disabled query).
        }

        return recent;
    }

    /// <summary>
    /// Drain a cache-then-network read of one drive's share links (web <c>useShareLinks(recentDriveId)</c>),
    /// projecting the terminal array into <see cref="ShareLinkInfo"/> rows. A transport failure or absent
    /// payload yields an empty list so the section shows "No active share links". Cancellation still
    /// propagates.
    /// </summary>
    private async Task<IReadOnlyList<ShareLinkInfo>> ResolveShareLinksAsync(long driveId, CancellationToken cancellationToken)
    {
        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"drives:{driveId}:shares");
        var request = new ApiRequest(
            Operations.Sharing.DriveShares,
            PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [VehicleUpgradesRegistration.DrivePathParam] = driveId.ToString(CultureInfo.InvariantCulture),
            });

        IReadOnlyList<ShareLinkInfo> links = Array.Empty<ShareLinkInfo>();
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
                if (emission.HasValue)
                {
                    links = ShareLinkInfo.FromArray(emission.Value);
                }
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Best-effort: a share-links failure leaves the section empty (web disabled / erroring query).
        }

        return links;
    }

    /// <summary>
    /// Resolve the most-recent drive id from a drive-history JSON array — the native port of the web
    /// <c>drives[0].id</c>: the first array element's numeric <c>id</c> (the list arrives newest-first), or
    /// <see langword="null"/> when the payload is not a non-empty array of objects with an id.
    /// </summary>
    private static long? FirstDriveId(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object &&
                item.TryGetProperty("id", out var id) &&
                id.ValueKind == JsonValueKind.Number &&
                id.TryGetInt64(out var value))
            {
                return value;
            }

            // Web parity: only drives[0] is consulted; a non-object / id-less first row yields no drive.
            return null;
        }

        return null;
    }

    private static bool IsEmptyArray(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Array => element.GetArrayLength() == 0,
        _ => false,
    };
}
