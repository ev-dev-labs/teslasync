using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Vehicles;

/// <summary>
/// The generated-client-backed <see cref="IDigitalTwinPageFeed"/> — the native data adapter for the Digital Twin
/// page. It binds the generated OpenAPI contract client (ADR-004): the fleet read (web <c>useVehicles</c> →
/// <c>GET /vehicles</c>), and for the selected vehicle the three concurrent live reads — vehicle state
/// (<c>GET /vehicles/{vehicleID}/state</c>), security latest (<c>GET /security/latest?vehicle_id=</c>) and charging
/// telemetry latest (<c>GET /charging-telemetry/latest?vehicle_id=</c>) — the web <c>useVehicleState</c> +
/// <c>useSecurityLatest</c> + <c>useChargingTelemetryLatest</c> queries. No HTTP touches the view. The reads are
/// tolerant: each settles independently so a slow / failed read just leaves its slice unknown (the twin still renders
/// whenever a vehicle is known), mirroring the web component's independent queries; the snake_case wire shape and the
/// platform <c>{data:…}</c> envelope round-trip losslessly.
/// </summary>
public sealed class DigitalTwinPageClientFeed : IDigitalTwinPageFeed
{
    private const string VehiclePathParam = "vehicleID";
    private const string VehicleQueryParam = "vehicle_id";

    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public DigitalTwinPageClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<DigitalTwinVehicle>> FetchVehiclesAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(DigitalTwinPageRegistration.VehiclesOperation);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return ParseVehicles(json);
    }

    /// <inheritdoc />
    public async Task<DigitalTwinReadings> FetchReadingsAsync(long vehicleId, CancellationToken cancellationToken)
    {
        // Start all three reads concurrently (web independent queries), then settle each.
        var stateTask = ReadStateAsync(vehicleId, cancellationToken);
        var securityTask = ReadLatestAsync(DigitalTwinPageRegistration.SecurityOperation, vehicleId, cancellationToken);
        var chargingTask = ReadLatestAsync(DigitalTwinPageRegistration.ChargingOperation, vehicleId, cancellationToken);

        var state = await stateTask.ConfigureAwait(false);
        var security = await securityTask.ConfigureAwait(false);
        var charging = await chargingTask.ConfigureAwait(false);

        return new DigitalTwinReadings(state.Body, security, charging, state.Live);
    }

    private static IReadOnlyList<DigitalTwinVehicle> ParseVehicles(JsonElement root)
    {
        JsonElement array = root;
        if (root.ValueKind == JsonValueKind.Object && root.TryGetProperty("data", out var data))
        {
            array = data;
        }

        if (array.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<DigitalTwinVehicle>();
        }

        var vehicles = new List<DigitalTwinVehicle>(array.GetArrayLength());
        foreach (var element in array.EnumerateArray())
        {
            if (DigitalTwinVehicle.FromJson(element) is { } vehicle)
            {
                vehicles.Add(vehicle);
            }
        }

        return vehicles;
    }

    private async Task<StateRead> ReadStateAsync(long vehicleId, CancellationToken cancellationToken)
    {
        var request = new ApiRequest(
            DigitalTwinPageRegistration.StateOperation,
            PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [VehiclePathParam] = vehicleId.ToString(CultureInfo.InvariantCulture),
            });

        try
        {
            var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
            JsonElement body = Unwrap(json);
            bool live = body.ValueKind == JsonValueKind.Object &&
                body.TryGetProperty("live", out var liveEl) && liveEl.ValueKind == JsonValueKind.True;
            return new StateRead(AsObjectOrNull(body), live);
        }
        catch (ApiException)
        {
            // Web parity: a failed state read leaves the twin's state slice unknown; the other reads still render.
            return new StateRead(null, false);
        }
    }

    private async Task<JsonElement?> ReadLatestAsync(string operation, long vehicleId, CancellationToken cancellationToken)
    {
        var request = new ApiRequest(
            operation,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                [VehicleQueryParam] = vehicleId,
            });

        try
        {
            var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
            return AsObjectOrNull(Unwrap(json));
        }
        catch (ApiException)
        {
            // Web parity: a failed "latest" read collapses to no data for that slice without breaking the twin.
            return null;
        }
    }

    private static JsonElement Unwrap(JsonElement root) =>
        root.ValueKind == JsonValueKind.Object &&
        root.TryGetProperty("data", out var data) &&
        data.ValueKind == JsonValueKind.Object
            ? data
            : root;

    // Clone so the stored element stays valid after the response's backing JsonDocument is released.
    private static JsonElement? AsObjectOrNull(JsonElement element) =>
        element.ValueKind == JsonValueKind.Object ? element.Clone() : null;

    private readonly record struct StateRead(JsonElement? Body, bool Live);
}
