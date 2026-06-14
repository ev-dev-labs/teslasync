using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Driving;

/// <summary>
/// The generated-client-backed <see cref="IDrivingDynamicsFeed"/> — the native data adapter for the
/// Driving-Dynamics page (ADR-004). It binds to the generated OpenAPI contract client for the seven reads the
/// web page and its children perform, all scoped to the active vehicle by the snake_case <c>vehicle_id</c> query
/// parameter (or the <c>vehicleID</c> path slot for the vehicle-state read). The latest-motor read
/// (<see cref="DrivingDynamicsRegistration.MotorLatestOperation"/>, web <c>useMotorLatest</c>) is the primary
/// read whose failure surfaces the page error (the web page's <c>loading={motorLoading}</c> driver); every other
/// read is best-effort — a transport failure degrades only that section to its empty state, mirroring the web's
/// independent React-Query hooks. The raw JSON round-trips through the tolerant parsers so the snake_case wire
/// shape is preserved losslessly; no HTTP touches the view.
/// </summary>
public sealed class DrivingDynamicsClientFeed : IDrivingDynamicsFeed
{
    private const string VehicleQueryParam = "vehicle_id";
    private const string LimitQueryParam = "limit";
    private const string FieldQueryParam = "field";
    private const string VehiclePathParam = "vehicleID";
    private const string CruiseSetField = "CruiseSetSpeed";
    private const string FollowDistanceField = "CruiseFollowDistance";

    private readonly IApiClient _api;
    private readonly long _vehicleId;
    private readonly int _motorHistoryLimit;

    /// <summary>Creates the feed over the generated contract client, the active vehicle id and a history limit.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    /// <param name="vehicleId">The active vehicle id (web header picker / <c>useSelectedVehicle</c>).</param>
    /// <param name="motorHistoryLimit">The motor-history row cap (web <c>useMotorHistory(vehicleId, 200)</c>).</param>
    public DrivingDynamicsClientFeed(IApiClient api, long vehicleId, int motorHistoryLimit = 200)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
        _vehicleId = vehicleId;
        _motorHistoryLimit = motorHistoryLimit;
    }

    /// <inheritdoc />
    public async Task<DrivingDynamicsSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        // Primary read (web useMotorLatest) — its failure is the page error surface.
        var motorRequest = new ApiRequest(DrivingDynamicsRegistration.MotorLatestOperation, Query: VehicleQuery());
        var motorJson = await _api.SendAsync<JsonElement>(motorRequest, cancellationToken).ConfigureAwait(false);
        MotorReading? motorLatest = MotorReading.FromResponse(motorJson);

        var history = await BestEffortAsync(
            () => FetchMotorHistoryAsync(cancellationToken),
            System.Array.Empty<MotorReading>()).ConfigureAwait(false);

        var drives = await BestEffortAsync(
            () => FetchDrivesAsync(cancellationToken),
            System.Array.Empty<DriveRow>()).ConfigureAwait(false);

        var coach = await BestEffortAsync(
            () => FetchCoachAsync(cancellationToken),
            (CoachData?)null).ConfigureAwait(false);

        var dynamics = await BestEffortAsync(
            () => FetchDriveDynamicsAsync(cancellationToken),
            DriveDynamicsReading.Empty).ConfigureAwait(false);

        var autopilot = await BestEffortAsync(
            () => FetchAutopilotAsync(cancellationToken),
            AutopilotReading.Empty).ConfigureAwait(false);

        return DrivingDynamicsSnapshot.Compose(motorLatest, history, drives, coach, dynamics, autopilot);
    }

    private async Task<IReadOnlyList<MotorReading>> FetchMotorHistoryAsync(CancellationToken cancellationToken)
    {
        var query = VehicleQuery();
        query[LimitQueryParam] = _motorHistoryLimit;
        var request = new ApiRequest(DrivingDynamicsRegistration.MotorHistoryOperation, Query: query);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return ParseMotorHistory(json);
    }

    private async Task<IReadOnlyList<DriveRow>> FetchDrivesAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(DrivingDynamicsRegistration.DrivesOperation, Query: VehicleQuery());
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return DriveRow.ParseDrives(json);
    }

    private async Task<CoachData?> FetchCoachAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(DrivingDynamicsRegistration.CoachOperation, Query: VehicleQuery());
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return CoachData.FromJson(json);
    }

    private async Task<DriveDynamicsReading> FetchDriveDynamicsAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(DrivingDynamicsRegistration.DriveDynamicsLatestOperation, Query: VehicleQuery());
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return DriveDynamicsReading.FromJson(json);
    }

    private async Task<AutopilotReading> FetchAutopilotAsync(CancellationToken cancellationToken)
    {
        double? speed = await BestEffortAsync(() => FetchVehicleSpeedAsync(cancellationToken), (double?)null).ConfigureAwait(false);
        double? cruiseSet = await BestEffortAsync(() => FetchObservationNumericAsync(CruiseSetField, cancellationToken), (double?)null).ConfigureAwait(false);
        string? follow = await BestEffortAsync(() => FetchObservationTextAsync(FollowDistanceField, cancellationToken), (string?)null).ConfigureAwait(false);
        return new AutopilotReading(speed, cruiseSet, AutopilotReading.ParseFollowDistance(follow));
    }

    private async Task<double?> FetchVehicleSpeedAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(
            DrivingDynamicsRegistration.VehicleStateOperation,
            PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [VehiclePathParam] = _vehicleId.ToString(CultureInfo.InvariantCulture),
            });
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return ParseVehicleSpeed(json);
    }

    private async Task<double?> FetchObservationNumericAsync(string field, CancellationToken cancellationToken)
    {
        var json = await FetchObservationAsync(field, cancellationToken).ConfigureAwait(false);
        return FirstObservation(json) is { } row ? DynamicsJson.Double(row, "value_numeric", "valueNumeric") : null;
    }

    private async Task<string?> FetchObservationTextAsync(string field, CancellationToken cancellationToken)
    {
        var json = await FetchObservationAsync(field, cancellationToken).ConfigureAwait(false);
        if (FirstObservation(json) is not { } row)
        {
            return null;
        }

        string? text = DynamicsJson.Text(row, "value_text") ?? DynamicsJson.Text(row, "valueText");
        if (text is not null)
        {
            return text;
        }

        double? numeric = DynamicsJson.Double(row, "value_numeric", "valueNumeric");
        return numeric?.ToString(CultureInfo.InvariantCulture);
    }

    private async Task<JsonElement> FetchObservationAsync(string field, CancellationToken cancellationToken)
    {
        var query = VehicleQuery();
        query[FieldQueryParam] = field;
        query[LimitQueryParam] = 1;
        var request = new ApiRequest(DrivingDynamicsRegistration.ObservationsOperation, Query: query);
        return await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Parse a <c>GET /motor</c> body into the reading list, unwrapping a common envelope when present.</summary>
    public static IReadOnlyList<MotorReading> ParseMotorHistory(JsonElement root)
    {
        if (root.ValueKind == JsonValueKind.Array)
        {
            return MotorReading.ParseHistory(root);
        }

        if (root.ValueKind == JsonValueKind.Object)
        {
            foreach (var key in new[] { "readings", "data", "motor", "items", "observations" })
            {
                if (root.TryGetProperty(key, out var arr) && arr.ValueKind == JsonValueKind.Array)
                {
                    return MotorReading.ParseHistory(arr);
                }
            }
        }

        return System.Array.Empty<MotorReading>();
    }

    /// <summary>Parse the SI m/s speed from a <c>GET /vehicles/{id}/state</c> body (<c>state.speed</c> then <c>speed</c>).</summary>
    public static double? ParseVehicleSpeed(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        if (root.TryGetProperty("state", out var state) && state.ValueKind == JsonValueKind.Object)
        {
            double? nested = DynamicsJson.Double(state, "speed");
            if (nested is not null)
            {
                return nested;
            }
        }

        return DynamicsJson.Double(root, "speed");
    }

    /// <summary>The first row of a <c>{ observations: [...] }</c> envelope (or a bare array), else null.</summary>
    public static JsonElement? FirstObservation(JsonElement root)
    {
        if (root.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in root.EnumerateArray())
            {
                return item;
            }

            return null;
        }

        if (root.ValueKind == JsonValueKind.Object
            && root.TryGetProperty("observations", out var arr)
            && arr.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in arr.EnumerateArray())
            {
                return item;
            }
        }

        return null;
    }

    private static async Task<T> BestEffortAsync<T>(Func<Task<T>> read, T fallback)
    {
        try
        {
            return await read().ConfigureAwait(false);
        }
        catch (ApiException)
        {
            // Web parity: every secondary query is independent — a transport failure leaves that section empty.
            return fallback;
        }
    }

    private Dictionary<string, object?> VehicleQuery() => new(StringComparer.Ordinal)
    {
        [VehicleQueryParam] = _vehicleId,
    };
}
