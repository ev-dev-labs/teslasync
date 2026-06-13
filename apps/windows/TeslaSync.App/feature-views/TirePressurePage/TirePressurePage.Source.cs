using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.VehicleSystems;

/// <summary>
/// The generated-client-backed <see cref="ITirePressureFeed"/> — the native data adapter for the Tire-Pressure
/// page (ADR-004). It binds to the generated OpenAPI contract client for the two reads the web page performs,
/// both scoped to the active vehicle by the snake_case <c>vehicle_id</c> query parameter:
/// <c>GET /tire-pressure/latest</c> (generated <see cref="TirePressureRegistration.LatestOperation"/>, web
/// latest query) is the primary read whose failure surfaces the page error, and <c>GET /tire-pressure</c>
/// (<see cref="TirePressureRegistration.HistoryOperation"/>, web history query) is the best-effort supplementary
/// read that feeds the pressure-history chart and the history table. The raw JSON round-trips through the
/// tolerant parsers so the snake_case wire shape is preserved losslessly; no HTTP touches the view. A failed
/// latest read propagates as the client's <see cref="ApiException"/> so the view-model renders the error
/// surface, while a failed history read degrades gracefully to no history (mirroring the web's two independent
/// queries).
/// </summary>
public sealed class TirePressureClientFeed : ITirePressureFeed
{
    private const string VehicleQueryParam = "vehicle_id";
    private const string StartQueryParam = "start";
    private const string EndQueryParam = "end";

    private readonly IApiClient _api;
    private readonly long _vehicleId;
    private readonly string? _start;
    private readonly string? _end;

    /// <summary>Creates the feed over the generated contract client, the active vehicle id and an optional range.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    /// <param name="vehicleId">The active vehicle id (web header picker / <c>useSelectedVehicle</c>).</param>
    /// <param name="start">Optional inclusive range start (web <c>useRangeState</c> <c>start</c>); null = default window.</param>
    /// <param name="end">Optional inclusive range end (web <c>useRangeState</c> <c>end</c>); null = default window.</param>
    public TirePressureClientFeed(IApiClient api, long vehicleId, string? start = null, string? end = null)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
        _vehicleId = vehicleId;
        _start = start;
        _end = end;
    }

    /// <inheritdoc />
    public async Task<TirePressureSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        var latestRequest = new ApiRequest(TirePressureRegistration.LatestOperation, Query: VehicleQuery());
        var latestJson = await _api.SendAsync<JsonElement>(latestRequest, cancellationToken).ConfigureAwait(false);
        TirePressureRow? latest = latestJson.ValueKind == JsonValueKind.Object
            ? TirePressureRow.FromJson(latestJson)
            : null;

        IReadOnlyList<TirePressureRow> history = await FetchHistoryAsync(cancellationToken).ConfigureAwait(false);
        return TirePressureSnapshot.Compose(latest, history);
    }

    /// <summary>Parse a <c>GET /tire-pressure</c> JSON array into the tolerant row list (non-array body → empty).</summary>
    /// <param name="root">The raw history JSON.</param>
    /// <returns>The tolerant history rows.</returns>
    public static IReadOnlyList<TirePressureRow> ParseHistory(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<TirePressureRow>();
        }

        var rows = new List<TirePressureRow>(root.GetArrayLength());
        foreach (var item in root.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                rows.Add(TirePressureRow.FromJson(item));
            }
        }

        return rows;
    }

    private async Task<IReadOnlyList<TirePressureRow>> FetchHistoryAsync(CancellationToken cancellationToken)
    {
        try
        {
            var request = new ApiRequest(TirePressureRegistration.HistoryOperation, Query: HistoryQuery());
            var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
            return ParseHistory(json);
        }
        catch (ApiException)
        {
            // The history read is the web's separate, best-effort query — a transport failure here must never
            // sink the whole page, so the pressure-history chart and table fall back to empty.
            return Array.Empty<TirePressureRow>();
        }
    }

    private Dictionary<string, object?> VehicleQuery() => new(StringComparer.Ordinal)
    {
        [VehicleQueryParam] = _vehicleId,
    };

    private Dictionary<string, object?> HistoryQuery()
    {
        var query = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            [VehicleQueryParam] = _vehicleId,
        };

        if (!string.IsNullOrWhiteSpace(_start))
        {
            query[StartQueryParam] = _start;
        }

        if (!string.IsNullOrWhiteSpace(_end))
        {
            query[EndQueryParam] = _end;
        }

        return query;
    }
}
