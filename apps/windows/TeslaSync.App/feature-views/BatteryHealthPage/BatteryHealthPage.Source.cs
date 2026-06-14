using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Battery;

/// <summary>
/// The generated-client-backed <see cref="IBatteryHealthFeed"/> — the native data adapter for the Battery
/// Health page (ADR-004). It binds to the generated OpenAPI contract client for the four reads the web page
/// performs, all scoped to the active vehicle by the snake_case <c>vehicle_id</c> query parameter:
/// <c>GET /analytics/battery-health</c> (<see cref="BatteryHealthRegistration.HealthOperation"/>, web
/// <c>useBatteryHealthAnalytics</c>) is the primary read whose failure surfaces the page error;
/// <c>GET /analytics/battery-degradation</c> (<see cref="BatteryHealthRegistration.DegradationOperation"/>, web
/// <c>useBatteryDegradation</c>) supplies the capacity-trend projection; <c>GET /charging</c>
/// (<see cref="BatteryHealthRegistration.SessionsOperation"/>, web <c>useChargingSessionsPaginated</c>, limit
/// 100) powers the distribution / habits / breakdown / insights; and <c>GET /charging-telemetry/latest</c>
/// (<see cref="BatteryHealthRegistration.TelemetryLatestOperation"/>, web <c>useChargingTelemetryLatest</c>)
/// powers the thermal monitoring. The raw JSON round-trips through the tolerant parsers so the snake_case wire
/// shape is preserved losslessly; no HTTP touches the view. A failed health read propagates as the client's
/// <see cref="ApiException"/> so the view-model renders the error surface, while each supplementary read
/// degrades gracefully to its empty shape (mirroring the web's four independent queries).
/// </summary>
public sealed class BatteryHealthClientFeed : IBatteryHealthFeed
{
    private const string VehicleQueryParam = "vehicle_id";
    private const int SessionLimit = 100;

    private readonly IApiClient _api;
    private readonly long _vehicleId;

    /// <summary>Creates the feed over the generated contract client and the active vehicle id.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    /// <param name="vehicleId">The active vehicle id (web header picker / <c>useSelectedVehicle</c>).</param>
    public BatteryHealthClientFeed(IApiClient api, long vehicleId)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
        _vehicleId = vehicleId;
    }

    /// <inheritdoc />
    public async Task<BatteryHealthPageSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        var healthRequest = new ApiRequest(BatteryHealthRegistration.HealthOperation, Query: VehicleQuery());
        var healthJson = await _api.SendAsync<JsonElement>(healthRequest, cancellationToken).ConfigureAwait(false);
        BatteryHealthAnalytics? health = BatteryHealthAnalytics.FromJson(healthJson);

        BatteryHealthForecast forecast = await FetchForecastAsync(cancellationToken).ConfigureAwait(false);
        IReadOnlyList<ChargeSessionSummary> sessions = await FetchSessionsAsync(cancellationToken).ConfigureAwait(false);
        ChargeThermalLatest? thermal = await FetchThermalAsync(cancellationToken).ConfigureAwait(false);

        return BatteryHealthPageSnapshot.Compose(health, forecast, sessions, thermal);
    }

    private async Task<BatteryHealthForecast> FetchForecastAsync(CancellationToken cancellationToken)
    {
        try
        {
            var request = new ApiRequest(BatteryHealthRegistration.DegradationOperation, Query: VehicleQuery());
            var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
            return BatteryHealthForecast.FromJson(json);
        }
        catch (ApiException)
        {
            // The degradation read is the web's separate, best-effort query — a transport failure here must
            // never sink the whole page, so the capacity-trend projection falls back to the actual line only.
            return BatteryHealthForecast.Empty;
        }
    }

    private async Task<IReadOnlyList<ChargeSessionSummary>> FetchSessionsAsync(CancellationToken cancellationToken)
    {
        try
        {
            var request = new ApiRequest(BatteryHealthRegistration.SessionsOperation, Query: SessionsQuery());
            var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
            return ParseSessions(json);
        }
        catch (ApiException)
        {
            // Mirrors the web's independent useChargingSessionsPaginated query — a failure leaves the
            // distribution / habits / breakdown / insights sections in their empty state, not the whole page.
            return Array.Empty<ChargeSessionSummary>();
        }
    }

    private async Task<ChargeThermalLatest?> FetchThermalAsync(CancellationToken cancellationToken)
    {
        try
        {
            var request = new ApiRequest(BatteryHealthRegistration.TelemetryLatestOperation, Query: VehicleQuery());
            var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
            return ChargeThermalLatest.FromJson(json);
        }
        catch (ApiException)
        {
            // The latest charging-telemetry read is the web's separate useChargingTelemetryLatest query — a
            // failure leaves every thermal card in its em-dash reading, not the whole page in error.
            return null;
        }
    }

    // The web endpoint returns a bare ChargingSession[]; tolerate a defensive object wrapper (safeArray parity).
    private static IReadOnlyList<ChargeSessionSummary> ParseSessions(JsonElement root)
    {
        JsonElement array = root.ValueKind switch
        {
            JsonValueKind.Array => root,
            JsonValueKind.Object => FirstArray(root),
            _ => default,
        };

        if (array.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<ChargeSessionSummary>();
        }

        var list = new List<ChargeSessionSummary>(array.GetArrayLength());
        foreach (var item in array.EnumerateArray())
        {
            list.Add(ChargeSessionSummary.FromJson(item));
        }

        return list;
    }

    private static JsonElement FirstArray(JsonElement obj)
    {
        foreach (var name in new[] { "sessions", "items", "data", "results" })
        {
            if (obj.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Array)
            {
                return value;
            }
        }

        return default;
    }

    private Dictionary<string, object?> VehicleQuery() => new(StringComparer.Ordinal)
    {
        [VehicleQueryParam] = _vehicleId,
    };

    private Dictionary<string, object?> SessionsQuery() => new(StringComparer.Ordinal)
    {
        [VehicleQueryParam] = _vehicleId,
        ["limit"] = SessionLimit,
        ["offset"] = 0,
    };
}
