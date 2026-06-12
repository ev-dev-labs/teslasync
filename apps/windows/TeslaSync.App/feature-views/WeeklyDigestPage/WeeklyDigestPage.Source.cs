using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Analytics;

/// <summary>
/// The generated-client-backed <see cref="IWeeklyDigestFeed"/> — the native data adapter for the Weekly Digest
/// page. It binds to the generated OpenAPI contract client (ADR-004) and reproduces the web
/// <c>useWeeklyDigest</c> read order: first the vehicle list
/// (<see cref="WeeklyDigestRegistration.VehiclesOperation"/>), resolving the requested-or-first vehicle (web
/// <c>vehicleId || String(vehicles?.[0]?.id)</c>); then, for that vehicle, the drives
/// (<see cref="WeeklyDigestRegistration.DrivesOperation"/> with <c>vehicle_id</c>), the charging sessions
/// (<see cref="WeeklyDigestRegistration.ChargingOperation"/> with <c>vehicle_id</c>) and the alerts
/// (<see cref="WeeklyDigestRegistration.AlertsOperation"/>). No HTTP touches the view; every response round-trips
/// through the tolerant row parsers so the SI snake_case wire shape is preserved losslessly. A non-success
/// response surfaces as the client's <see cref="ApiException"/> so the view-model can show the retriable error
/// branch (web <c>error</c>).
/// </summary>
public sealed class WeeklyDigestClientFeed : IWeeklyDigestFeed
{
    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public WeeklyDigestClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<WeeklyDigestSnapshot> FetchAsync(string? requestedVehicleId, CancellationToken cancellationToken)
    {
        var vehicles = ParseVehicles(await _api.SendAsync<JsonElement>(
            new ApiRequest(WeeklyDigestRegistration.VehiclesOperation), cancellationToken).ConfigureAwait(false));

        string selectedId = ResolveSelectedId(requestedVehicleId, vehicles);
        if (string.IsNullOrEmpty(selectedId))
        {
            // Web parity: the drives/charging/alerts queries are disabled (enabled: !!selectedVehicleId) until a
            // vehicle resolves, so with no vehicles the page renders the empty state.
            return new WeeklyDigestSnapshot(
                vehicles, string.Empty,
                Array.Empty<DigestDriveRow>(), Array.Empty<DigestChargeRow>(), Array.Empty<DigestAlertRow>());
        }

        long vehicleId = long.Parse(selectedId, CultureInfo.InvariantCulture);

        var drivesJson = await _api.SendAsync<JsonElement>(
            ApiRequest.WithQuery(WeeklyDigestRegistration.DrivesOperation, "vehicle_id", vehicleId), cancellationToken)
            .ConfigureAwait(false);
        var chargingJson = await _api.SendAsync<JsonElement>(
            ApiRequest.WithQuery(WeeklyDigestRegistration.ChargingOperation, "vehicle_id", vehicleId), cancellationToken)
            .ConfigureAwait(false);
        var alertsJson = await _api.SendAsync<JsonElement>(
            new ApiRequest(WeeklyDigestRegistration.AlertsOperation), cancellationToken).ConfigureAwait(false);

        return new WeeklyDigestSnapshot(
            vehicles,
            selectedId,
            ParseList(drivesJson, "drives", DigestDriveRow.FromJson),
            ParseList(chargingJson, "sessions", "charging", DigestChargeRow.FromJson),
            ParseList(alertsJson, "alerts", DigestAlertRow.FromJson));
    }

    private static string ResolveSelectedId(string? requested, IReadOnlyList<WeeklyDigestVehicleOption> vehicles)
    {
        if (!string.IsNullOrEmpty(requested) && vehicles.Any(v => string.Equals(v.Id, requested, StringComparison.Ordinal)))
        {
            return requested;
        }

        return vehicles.Count > 0 ? vehicles[0].Id : string.Empty;
    }

    private static IReadOnlyList<WeeklyDigestVehicleOption> ParseVehicles(JsonElement root)
    {
        var array = ExtractArray(root, "vehicles", "items");
        if (array is null)
        {
            return Array.Empty<WeeklyDigestVehicleOption>();
        }

        var list = new List<WeeklyDigestVehicleOption>(array.Value.GetArrayLength());
        foreach (var item in array.Value.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            string? id = ReadId(item);
            if (string.IsNullOrEmpty(id))
            {
                continue;
            }

            string label = DigestJson.Str(item, "display_name") is { Length: > 0 } name
                ? name
                : DigestJson.Str(item, "vin") ?? id;
            list.Add(new WeeklyDigestVehicleOption(id, label));
        }

        return list;
    }

    private static string? ReadId(JsonElement item)
    {
        if (!item.TryGetProperty("id", out var idEl))
        {
            return null;
        }

        return idEl.ValueKind switch
        {
            JsonValueKind.Number when idEl.TryGetInt64(out var n) => n.ToString(CultureInfo.InvariantCulture),
            JsonValueKind.String => idEl.GetString(),
            _ => null,
        };
    }

    private static IReadOnlyList<T> ParseList<T>(JsonElement root, string envelopeKey, Func<JsonElement, T> parse) =>
        ParseList(root, envelopeKey, null, parse);

    private static IReadOnlyList<T> ParseList<T>(
        JsonElement root, string envelopeKey, string? altKey, Func<JsonElement, T> parse)
    {
        var array = altKey is null
            ? ExtractArray(root, envelopeKey, "items")
            : ExtractArray(root, envelopeKey, altKey, "items");
        if (array is null)
        {
            return Array.Empty<T>();
        }

        var list = new List<T>(array.Value.GetArrayLength());
        foreach (var item in array.Value.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(parse(item));
            }
        }

        return list;
    }

    // The list endpoints return a bare JSON array (web request<T[]>), but tolerate a paginated envelope
    // ({ "<key>": [...] } or { "items": [...] }) so a wrapped response still parses rather than reading empty.
    private static JsonElement? ExtractArray(JsonElement root, params string[] envelopeKeys)
    {
        if (root.ValueKind == JsonValueKind.Array)
        {
            return root;
        }

        if (root.ValueKind == JsonValueKind.Object)
        {
            foreach (var key in envelopeKeys)
            {
                if (root.TryGetProperty(key, out var nested) && nested.ValueKind == JsonValueKind.Array)
                {
                    return nested;
                }
            }
        }

        return null;
    }
}
