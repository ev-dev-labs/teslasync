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
/// The data port the <see cref="MediaNavigationPanelViewModel"/> binds to (P1/S8 state-holder seam). It yields
/// the cache-then-network sequence of merged <see cref="MediaNavigationSnapshot"/>s (the live media reading +
/// the location reading) — the native analogue of the web live-telemetry parent's <c>useMedia(vehicleId)</c> read
/// (<c>GET /media/latest</c>) and <c>useLocationSnapshotLatest(vehicleId)</c> read
/// (<c>GET /location-snapshots/latest</c>) that feed
/// <c>&lt;MediaNavigationPanel mediaData={…} locationData={…} /&gt;</c>
/// (web/src/features/vehicles/components/telemetry-panels/MediaNavigationPanel.tsx). The view never performs HTTP
/// itself; the concrete <see cref="MediaNavigationPanelSource"/> (or a test fake) drives this.
/// </summary>
public interface IMediaNavigationPanelSource
{
    /// <summary>Stream the cache-then-network media-and-navigation snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<MediaNavigationSnapshot>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IMediaNavigationPanelSource"/> — the native data adapter for the Media &amp;
/// Navigation surface. It resolves the primary (or explicit) vehicle from the shared
/// <see cref="IWidgetVehicleSource"/>, then:
/// <list type="number">
///   <item>Resolves the navigation reading: a best-effort cache-then-network read of
///         <c>GET /location-snapshots/latest?vehicle_id={id}</c> (generated operation
///         <c>get_api_v1_location_snapshots_latest</c>, the web <c>useLocationSnapshotLatest</c> query) reduced to
///         a <see cref="NavigationReading"/>. A location failure leaves the navigation reading null (the panel
///         shows "No location data"), never failing the surface — mirroring the web's two independent queries.</item>
///   <item>Streams the primary read: a cache-then-network read of <c>GET /media/latest?vehicle_id={id}</c>
///         (generated operation <c>get_api_v1_media_latest</c>, the web <c>useMedia</c> query) through the shared
///         <see cref="CacheThenNetworkEngine"/>, caching the raw JSON so the snake_case wire shape round-trips
///         losslessly, parsed (with the resolved navigation reading folded in) into a
///         <see cref="MediaNavigationSnapshot"/> via <see cref="MediaNavigationPanelResultMapper"/>.</item>
/// </list>
/// The media read is never declared "empty" at the engine boundary (a null media body still produces a snapshot
/// so the navigation section keeps rendering); the view-model owns the empty classification from the merged
/// snapshot. When no vehicle is available the read short-circuits to <see cref="RepositoryResult{T}.Empty()"/>,
/// mirroring the web hooks' disabled queries (<c>enabled: !!vehicleId</c> / <c>enabled: vehicleId &gt; 0</c>).
/// No HTTP touches the view.
/// </summary>
public sealed class MediaNavigationPanelSource : IMediaNavigationPanelSource
{
    // The web's useMedia reads /media/latest and useLocationSnapshotLatest reads /location-snapshots/latest;
    // Operations.cs carries no Media / Location group yet, so the generated endpoint ids are referenced verbatim
    // here (scoped to this surface), exactly as the sibling SpeedGearPanelSource / LiveMotorStatusSource do. They
    // resolve against TeslaSync.Windows.Generated.Api.ApiEndpoints.
    private const string MediaLatestOperation = "get_api_v1_media_latest";
    private const string LocationLatestOperation = "get_api_v1_location_snapshots_latest";
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
    public MediaNavigationPanelSource(
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
    public async IAsyncEnumerable<RepositoryResult<MediaNavigationSnapshot>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long? vehicleId = await ResolveVehicleIdAsync(cancellationToken).ConfigureAwait(false);
        if (vehicleId is not { } vid)
        {
            // Web parity: with no vehicle both the media and location queries are disabled.
            yield return RepositoryResult<MediaNavigationSnapshot>.Empty();
            yield break;
        }

        NavigationReading? navigation = await ResolveNavigationAsync(vid, cancellationToken).ConfigureAwait(false);

        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"vehicles:{vid}:media-navigation-panel");
        var request = new ApiRequest(
            MediaLatestOperation,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                [VehicleQueryParam] = vid,
            });

        // The media read is never short-circuited to Empty (isEmpty: never): a null media body still yields a
        // snapshot so the navigation section keeps rendering; the view-model decides Empty from the merged snapshot.
        var raw = _engine.StreamAsync<JsonElement>(
            cacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            static _ => false,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return MediaNavigationPanelResultMapper.Map(emission, navigation);
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
    /// Drain a best-effort cache-then-network read of <c>GET /location-snapshots/latest</c> and reduce it to a
    /// <see cref="NavigationReading"/> (web <c>useLocationSnapshotLatest</c>). The freshest value-bearing emission
    /// wins; a transport failure (or a non-object body) collapses to <see langword="null"/> so the navigation
    /// section shows "No location data" rather than failing the whole surface, mirroring the web's independent
    /// query. Cancellation still propagates.
    /// </summary>
    private async Task<NavigationReading?> ResolveNavigationAsync(long vehicleId, CancellationToken cancellationToken)
    {
        string cacheKey = string.Create(CultureInfo.InvariantCulture, $"vehicles:{vehicleId}:location-latest:media-nav");
        var request = new ApiRequest(
            LocationLatestOperation,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                [VehicleQueryParam] = vehicleId,
            });

        NavigationReading? navigation = null;
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
                if (emission.HasValue)
                {
                    navigation = NavigationReading.FromResponse(emission.Value);
                }
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Best-effort: a location read failure leaves the navigation section showing "No location data".
        }

        return navigation;
    }

    // Web parity: a null / non-object body makes `locationData` falsy → the "No location data" caption.
    private static bool IsEmptyResponse(JsonElement element) => NavigationReading.FromResponse(element) is null;
}
