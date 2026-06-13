using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>
/// The generated-client-backed <see cref="IRegenEfficiencyFeed"/> — the native data adapter for the
/// Regen-Efficiency page (ADR-004). It binds to the generated OpenAPI contract client for the two reads the web
/// page performs, both scoped to the active vehicle by the snake_case <c>vehicle_id</c> query parameter:
/// <c>GET /analytics/regen</c> (generated <see cref="RegenEfficiencyRegistration.RegenOperation"/>, web
/// <c>useRegenEfficiency</c>) is the primary read whose failure surfaces the page error, and <c>GET /drives</c>
/// (<see cref="RegenEfficiencyRegistration.DrivesOperation"/>, web <c>useDrives</c>) is the best-effort
/// supplementary read that feeds the client-side monthly-trend chart and the recent-regen-drives table. The raw
/// JSON round-trips through the tolerant parsers so the snake_case wire shape is preserved losslessly; no HTTP
/// touches the view. A failed regen read propagates as the client's <see cref="ApiException"/> so the
/// view-model renders the error surface, while a failed drives read degrades gracefully to no drives (mirroring
/// the web's two independent queries).
/// </summary>
public sealed class RegenEfficiencyClientFeed : IRegenEfficiencyFeed
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
    /// <param name="start">Optional inclusive range start (web <c>useRangeState</c> <c>start</c>); null = all.</param>
    /// <param name="end">Optional inclusive range end (web <c>useRangeState</c> <c>end</c>); null = all.</param>
    public RegenEfficiencyClientFeed(IApiClient api, long vehicleId, string? start = null, string? end = null)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
        _vehicleId = vehicleId;
        _start = start;
        _end = end;
    }

    /// <inheritdoc />
    public async Task<RegenEfficiencySnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        var regenRequest = new ApiRequest(RegenEfficiencyRegistration.RegenOperation, Query: RegenQuery());
        var regenJson = await _api.SendAsync<JsonElement>(regenRequest, cancellationToken).ConfigureAwait(false);
        RegenSummary? summary = RegenSummary.FromJson(regenJson);

        IReadOnlyList<RegenDrive> drives = await FetchDrivesAsync(cancellationToken).ConfigureAwait(false);
        return RegenEfficiencySnapshot.Compose(summary, drives);
    }

    private async Task<IReadOnlyList<RegenDrive>> FetchDrivesAsync(CancellationToken cancellationToken)
    {
        try
        {
            var request = new ApiRequest(RegenEfficiencyRegistration.DrivesOperation, Query: VehicleQuery());
            var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
            return ParseDrives(json);
        }
        catch (ApiException)
        {
            // The drives read is the web's separate, best-effort query — a transport failure here must never sink
            // the whole page, so the monthly-trend chart and recent-drives table fall back to empty.
            return Array.Empty<RegenDrive>();
        }
    }

    /// <summary>Parse a <c>GET /drives</c> JSON array into the tolerant drive list (non-array body → empty).</summary>
    public static IReadOnlyList<RegenDrive> ParseDrives(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<RegenDrive>();
        }

        var drives = new List<RegenDrive>(root.GetArrayLength());
        foreach (var item in root.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                drives.Add(RegenDrive.FromJson(item));
            }
        }

        return drives;
    }

    private Dictionary<string, object?> RegenQuery()
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

    private Dictionary<string, object?> VehicleQuery() => new(StringComparer.Ordinal)
    {
        [VehicleQueryParam] = _vehicleId,
    };
}
