using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Maps;

/// <summary>
/// The generated-client-backed <see cref="INavigationRouteFeed"/> — the native data adapter for the
/// Navigation-Route page (ADR-004) and the C# port of the three web queries the page composes
/// (web/src/features/maps/pages/NavigationRoutePage.tsx): the latest location snapshot
/// (<c>useLocationSnapshotLatest</c> → <c>GET /location-snapshots/latest?vehicle_id={id}</c>), the snapshot
/// history (<c>useLocationSnapshots</c> → <c>GET /location-snapshots?vehicle_id={id}&amp;limit=200</c>) and the
/// charging-telemetry rollup (<c>useChargingTelemetryLatest</c> → <c>GET /charging-telemetry/latest?vehicle_id={id}</c>).
/// The latest read is the primary read: a failure propagates as the client's <see cref="ApiException"/> so the
/// view-model renders the retriable error surface (web parity: the page's <c>latestError</c>). The history and
/// charging reads are best-effort — a failure degrades to an empty list / absent percentage so a partial outage
/// never blanks the whole page (web parity: the page body renders whenever a vehicle is selected). No HTTP touches
/// the view; the snake_case wire shape round-trips losslessly through the tolerant parsers.
/// </summary>
public sealed class NavigationRouteClientFeed : INavigationRouteFeed
{
    private const string VehicleQueryParam = "vehicle_id";
    private const string LimitQueryParam = "limit";
    private const int HistoryLimit = 200;

    private readonly IApiClient _api;
    private readonly long _vehicleId;

    /// <summary>Creates the feed over the generated contract client and the active vehicle id.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    /// <param name="vehicleId">The active vehicle id (web header picker / <c>useSelectedVehicle</c>).</param>
    public NavigationRouteClientFeed(IApiClient api, long vehicleId)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
        _vehicleId = vehicleId;
    }

    /// <inheritdoc />
    public async Task<NavigationSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        var latest = await FetchLatestAsync(cancellationToken).ConfigureAwait(false);
        var history = await FetchHistoryAsync(cancellationToken).ConfigureAwait(false);
        var energy = await FetchChargingAsync(cancellationToken).ConfigureAwait(false);
        return new NavigationSnapshot(latest, history, energy);
    }

    private async Task<LocationSnapshotModel?> FetchLatestAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(NavigationRouteRegistration.LatestOperation, Query: ScopedQuery());
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return NavigationSnapshot.ParseLatest(json);
    }

    private async Task<IReadOnlyList<LocationSnapshotModel>> FetchHistoryAsync(CancellationToken cancellationToken)
    {
        var query = ScopedQuery();
        query[LimitQueryParam] = HistoryLimit;
        var request = new ApiRequest(NavigationRouteRegistration.HistoryOperation, Query: query);

        try
        {
            var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
            return NavigationSnapshot.ParseHistory(json);
        }
        catch (ApiException)
        {
            // Best-effort: a history outage degrades to "no snapshots" rather than failing the whole page.
            return Array.Empty<LocationSnapshotModel>();
        }
    }

    private async Task<double?> FetchChargingAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(NavigationRouteRegistration.ChargingOperation, Query: ScopedQuery());

        try
        {
            var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
            return NavigationSnapshot.ParseExpectedEnergy(json);
        }
        catch (ApiException)
        {
            // Best-effort: charging telemetry is absent when not charging (web renders the em dash).
            return null;
        }
    }

    private Dictionary<string, object?> ScopedQuery() => new(StringComparer.Ordinal)
    {
        [VehicleQueryParam] = _vehicleId,
    };
}
