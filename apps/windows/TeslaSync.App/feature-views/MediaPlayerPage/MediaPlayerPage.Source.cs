using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.VehicleSystems;

/// <summary>
/// The generated-client-backed <see cref="IMediaPlayerFeed"/> — the native data adapter for the Media-Player
/// page (ADR-004). It binds to the generated OpenAPI contract client for the two reads the web page performs,
/// both scoped to the active vehicle by the snake_case <c>vehicle_id</c> query parameter:
/// <c>GET /media/latest</c> (<see cref="MediaPlayerRegistration.LatestOperation"/>, web <c>useMediaLatest</c>) is
/// the primary read whose failure surfaces the page error, and <c>GET /media</c>
/// (<see cref="MediaPlayerRegistration.HistoryOperation"/>, web <c>useMediaHistory</c> with <c>limit=500</c>) is
/// the best-effort supplementary read that feeds the derived stats, the volume-over-time area chart, the
/// source-distribution pie and the history table. The raw JSON round-trips through the tolerant parsers so the
/// snake_case wire shape is preserved losslessly; no HTTP touches the view. A failed now-playing read propagates
/// as the client's <see cref="ApiException"/> so the view-model renders the error surface, while a failed
/// history read degrades gracefully to no rows (mirroring the web's two independent queries, where only the
/// now-playing error reaches the page container).
/// </summary>
public sealed class MediaPlayerClientFeed : IMediaPlayerFeed
{
    private const string VehicleQueryParam = "vehicle_id";
    private const string LimitQueryParam = "limit";
    private const int HistoryLimit = 500;

    private readonly IApiClient _api;
    private readonly long _vehicleId;

    /// <summary>Creates the feed over the generated contract client and the active vehicle id.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    /// <param name="vehicleId">The active vehicle id (web header picker / <c>useSelectedVehicle</c>).</param>
    public MediaPlayerClientFeed(IApiClient api, long vehicleId)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
        _vehicleId = vehicleId;
    }

    /// <inheritdoc />
    public async Task<MediaPlayerSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        var latestRequest = new ApiRequest(MediaPlayerRegistration.LatestOperation, Query: VehicleQuery());
        var latestJson = await _api.SendAsync<JsonElement>(latestRequest, cancellationToken).ConfigureAwait(false);
        MediaReading? latest = MediaReading.FromJson(latestJson);

        IReadOnlyList<MediaHistoryEntry> history = await FetchHistoryAsync(cancellationToken).ConfigureAwait(false);
        return MediaPlayerSnapshot.Compose(latest, history);
    }

    private async Task<IReadOnlyList<MediaHistoryEntry>> FetchHistoryAsync(CancellationToken cancellationToken)
    {
        try
        {
            var request = new ApiRequest(MediaPlayerRegistration.HistoryOperation, Query: HistoryQuery());
            var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
            return MediaHistoryEntry.ParseList(json);
        }
        catch (ApiException)
        {
            // The history read is the web's separate, best-effort query — a transport failure here must never
            // sink the whole page, so the stats, charts and table fall back to empty (the web shows only an
            // inline banner while the now-playing card still renders).
            return Array.Empty<MediaHistoryEntry>();
        }
    }

    private Dictionary<string, object?> VehicleQuery() => new(StringComparer.Ordinal)
    {
        [VehicleQueryParam] = _vehicleId,
    };

    private Dictionary<string, object?> HistoryQuery() => new(StringComparer.Ordinal)
    {
        [VehicleQueryParam] = _vehicleId,
        [LimitQueryParam] = HistoryLimit,
    };
}
