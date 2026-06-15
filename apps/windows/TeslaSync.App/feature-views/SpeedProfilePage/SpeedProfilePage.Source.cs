using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>
/// The generated-client-backed <see cref="ISpeedProfileFeed"/> — the native data adapter for the Speed-Profile
/// page (ADR-004). It binds to the generated OpenAPI contract client for the two reads the web page performs,
/// both scoped to the active vehicle by the snake_case <c>vehicle_id</c> query parameter:
/// <c>GET /analytics/speed-profile</c> (generated <see cref="SpeedProfileRegistration.SpeedProfileOperation"/>,
/// web <c>useSpeedProfile</c>) is the primary read whose failure surfaces the page error, and <c>GET /drives</c>
/// (<see cref="SpeedProfileRegistration.DrivesOperation"/>, web <c>useDrives</c>) is the best-effort
/// supplementary read that feeds the client-side per-bucket efficiency block and the efficiency-vs-speed
/// scatter. The raw JSON round-trips through the tolerant parsers so the snake_case wire shape is preserved
/// losslessly; no HTTP touches the view. A failed speed-profile read propagates as the client's
/// <see cref="ApiException"/> so the view-model renders the error surface, while a failed drives read degrades
/// gracefully to no drives (mirroring the web's two independent queries).
/// </summary>
public sealed class SpeedProfileClientFeed : ISpeedProfileFeed
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
    public SpeedProfileClientFeed(IApiClient api, long vehicleId, string? start = null, string? end = null)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
        _vehicleId = vehicleId;
        _start = start;
        _end = end;
    }

    /// <inheritdoc />
    public async Task<SpeedProfileSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        var profileRequest = new ApiRequest(SpeedProfileRegistration.SpeedProfileOperation, Query: ProfileQuery());
        var profileJson = await _api.SendAsync<JsonElement>(profileRequest, cancellationToken).ConfigureAwait(false);
        SpeedProfileSummary? summary = SpeedProfileSummary.FromJson(profileJson);

        IReadOnlyList<SpeedDrive> drives = await FetchDrivesAsync(cancellationToken).ConfigureAwait(false);
        return SpeedProfileSnapshot.Compose(summary, drives);
    }

    private async Task<IReadOnlyList<SpeedDrive>> FetchDrivesAsync(CancellationToken cancellationToken)
    {
        try
        {
            var request = new ApiRequest(SpeedProfileRegistration.DrivesOperation, Query: VehicleQuery());
            var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
            return ParseDrives(json);
        }
        catch (ApiException)
        {
            // The drives read is the web's separate, best-effort query — a transport failure here must never sink
            // the whole page, so the per-bucket efficiency block and the scatter fall back to empty.
            return Array.Empty<SpeedDrive>();
        }
    }

    /// <summary>Parse a <c>GET /drives</c> JSON array into the tolerant drive list (non-array body → empty).</summary>
    public static IReadOnlyList<SpeedDrive> ParseDrives(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<SpeedDrive>();
        }

        var drives = new List<SpeedDrive>(root.GetArrayLength());
        foreach (var item in root.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                drives.Add(SpeedDrive.FromJson(item));
            }
        }

        return drives;
    }

    private Dictionary<string, object?> ProfileQuery()
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
