using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Charging;

/// <summary>
/// The data port the <see cref="ChargingDetailPageViewModel"/> reads through — the native parity of the web
/// page's four hooks (web/src/features/charging/pages/ChargingDetailPage.tsx): <c>useChargingSessionDetail</c>
/// (the required <c>GET /charging/{id}</c> read), <c>useChargeTelemetry</c> (<c>GET /charging/{id}/telemetry</c>),
/// <c>useVehicle</c> (<c>GET /vehicles/{id}</c>) and <c>useChargingTelemetryLatest</c>
/// (<c>GET /charging-telemetry/latest?vehicle_id=</c>). The view never performs HTTP itself; the default
/// <see cref="EmptyChargingDetailPageFeed"/> resolves to the empty state and the generated-client-backed
/// <see cref="ChargingDetailPageClientFeed"/> binds the OpenAPI contract client (ADR-004). A failing primary
/// read throws so the view-model can surface the never-blank error branch.
/// </summary>
public interface IChargingDetailPageFeed
{
    /// <summary>Resolve the four-source snapshot for a charging session id (web's four hooks fused).</summary>
    Task<ChargingDetailSnapshot> FetchAsync(long sessionId, CancellationToken cancellationToken);
}

/// <summary>The default feed — resolves to the empty snapshot (the loading/empty state the shell shows by default).</summary>
public sealed class EmptyChargingDetailPageFeed : IChargingDetailPageFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyChargingDetailPageFeed Instance { get; } = new();

    private EmptyChargingDetailPageFeed()
    {
    }

    /// <inheritdoc />
    public Task<ChargingDetailSnapshot> FetchAsync(long sessionId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(ChargingDetailSnapshot.Empty);
    }
}

/// <summary>
/// The generated-client-backed <see cref="IChargingDetailPageFeed"/> — the native data adapter for the
/// Charging-detail page (ADR-004). It binds to the generated OpenAPI contract client for the four reads the web
/// page performs. The session read (<see cref="ChargingDetailPageRegistration.SessionOperation"/>) is the
/// primary query whose failure surfaces the page error; the telemetry, vehicle and live reads are best-effort
/// supplementary queries (mirroring the web's three independent queries) that degrade to empty on a transport
/// failure. Every response round-trips through the tolerant <see cref="ChargingSessionData"/> /
/// <see cref="ChargeReadingData"/> / <see cref="ChargingVehicleData"/> / <see cref="LiveChargingData"/> parsers
/// so the snake_case wire shape is preserved losslessly; no HTTP touches the view.
/// </summary>
public sealed class ChargingDetailPageClientFeed : IChargingDetailPageFeed
{
    private const string SessionIdParam = "sessionID";
    private const string VehicleIdParam = "vehicleID";
    private const string VehicleQueryParam = "vehicle_id";

    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public ChargingDetailPageClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<ChargingDetailSnapshot> FetchAsync(long sessionId, CancellationToken cancellationToken)
    {
        var sessionRequest = ApiRequest.WithPath(
            ChargingDetailPageRegistration.SessionOperation,
            SessionIdParam,
            sessionId.ToString(CultureInfo.InvariantCulture));
        var sessionJson = await _api.SendAsync<JsonElement>(sessionRequest, cancellationToken).ConfigureAwait(false);
        ChargingSessionData? session = ChargingSessionData.FromJson(sessionJson);

        IReadOnlyList<ChargeReadingData> telemetry = await FetchTelemetryAsync(sessionId, cancellationToken).ConfigureAwait(false);
        ChargingVehicleData? vehicle = session is { } s
            ? await FetchVehicleAsync(s.VehicleId, cancellationToken).ConfigureAwait(false)
            : null;
        LiveChargingData? live = session is { } sv
            ? await FetchLiveAsync(sv.VehicleId, cancellationToken).ConfigureAwait(false)
            : null;

        return new ChargingDetailSnapshot(session, telemetry, vehicle, live);
    }

    private async Task<IReadOnlyList<ChargeReadingData>> FetchTelemetryAsync(long sessionId, CancellationToken cancellationToken)
    {
        try
        {
            var request = ApiRequest.WithPath(
                ChargingDetailPageRegistration.TelemetryOperation,
                SessionIdParam,
                sessionId.ToString(CultureInfo.InvariantCulture));
            var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
            if (json.ValueKind != JsonValueKind.Array)
            {
                return Array.Empty<ChargeReadingData>();
            }

            var readings = new List<ChargeReadingData>(json.GetArrayLength());
            foreach (var element in json.EnumerateArray())
            {
                readings.Add(ChargeReadingData.FromJson(element));
            }

            return readings;
        }
        catch (ApiException)
        {
            // Best-effort, like the web's separate telemetry query — a transport failure leaves the charts on
            // their synthesized / empty fallback instead of sinking the whole page.
            return Array.Empty<ChargeReadingData>();
        }
    }

    private async Task<ChargingVehicleData?> FetchVehicleAsync(long vehicleId, CancellationToken cancellationToken)
    {
        try
        {
            var request = ApiRequest.WithPath(
                ChargingDetailPageRegistration.VehicleOperation,
                VehicleIdParam,
                vehicleId.ToString(CultureInfo.InvariantCulture));
            var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
            return ChargingVehicleData.FromJson(json);
        }
        catch (ApiException)
        {
            return null;
        }
    }

    private async Task<LiveChargingData?> FetchLiveAsync(long vehicleId, CancellationToken cancellationToken)
    {
        try
        {
            var request = new ApiRequest(
                ChargingDetailPageRegistration.LatestOperation,
                Query: new Dictionary<string, object?>(StringComparer.Ordinal) { [VehicleQueryParam] = vehicleId });
            var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
            return LiveChargingData.FromJson(json);
        }
        catch (ApiException)
        {
            return null;
        }
    }
}
