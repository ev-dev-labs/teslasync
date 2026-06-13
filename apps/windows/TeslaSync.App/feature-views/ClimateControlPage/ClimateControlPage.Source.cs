using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.VehicleSystems;

/// <summary>
/// The data port the <see cref="ClimateControlPageViewModel"/> binds to (P1/S8 state-holder seam, ADR-004). It
/// yields the composed climate snapshot the web Climate page reads through its three queries
/// (web/src/features/vehicle-systems/pages/ClimateControlPage.tsx: <c>useClimate</c> latest, <c>useClimateHistory</c>
/// and <c>useChargingTelemetryLatest</c>). The view never performs HTTP itself; the concrete
/// <see cref="ClimateClientFeed"/> (or a test fake / the <see cref="EmptyClimateFeed"/> default) drives this.
/// </summary>
public interface IClimateFeed
{
    /// <summary>Fetch the current climate snapshot for the scoped vehicle.</summary>
    Task<ClimateSnapshot> FetchAsync(CancellationToken cancellationToken);
}

/// <summary>
/// The no-op <see cref="IClimateFeed"/> the page's parameterless constructor binds to before a host wires the
/// generated client — it always resolves the empty snapshot, so the page renders its page-level empty surface rather
/// than a blank region. Shared singleton; immutable and thread-safe.
/// </summary>
public sealed class EmptyClimateFeed : IClimateFeed
{
    /// <summary>The shared instance.</summary>
    public static EmptyClimateFeed Instance { get; } = new();

    private EmptyClimateFeed()
    {
    }

    /// <inheritdoc />
    public Task<ClimateSnapshot> FetchAsync(CancellationToken cancellationToken) =>
        Task.FromResult(ClimateSnapshot.Empty);
}

/// <summary>
/// The generated-client-backed <see cref="IClimateFeed"/> — the native data adapter for the Climate page (ADR-004).
/// It runs the three reads the web page performs, each scoped to the active vehicle by the snake_case
/// <c>vehicle_id</c> query parameter: <c>GET /climate/latest</c> (web <c>useClimate</c>), <c>GET /climate</c> (web
/// <c>useClimateHistory</c>) and <c>GET /charging-telemetry/latest</c> (web <c>useChargingTelemetryLatest</c>, read
/// only for the not-enough-power-to-heat banner). The latest read drives the page error surface; the history and
/// charging-telemetry reads degrade gracefully to empty / false on failure, mirroring the web's independent queries.
/// The raw JSON round-trips through the tolerant model parsers so the snake_case wire shape is preserved losslessly;
/// no HTTP touches the view.
/// </summary>
public sealed class ClimateClientFeed : IClimateFeed
{
    private const string VehicleQueryParam = "vehicle_id";
    private const string NotEnoughPowerField = "not_enough_power_to_heat";

    private readonly IApiClient _api;
    private readonly long _vehicleId;

    /// <summary>Creates the feed over the generated contract client and the active vehicle id.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    /// <param name="vehicleId">The active vehicle id (web header picker / <c>useSelectedVehicle</c>).</param>
    public ClimateClientFeed(IApiClient api, long vehicleId)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
        _vehicleId = vehicleId;
    }

    /// <inheritdoc />
    public async Task<ClimateSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        // The latest read drives the page-level loading / error state (web useClimate isLoading / error).
        var latestJson = await _api.SendAsync<JsonElement>(LatestRequest(), cancellationToken).ConfigureAwait(false);
        var latest = ClimateReading.FromJson(latestJson);

        var history = await TryFetchHistoryAsync(cancellationToken).ConfigureAwait(false);
        bool notEnoughPower = await TryFetchNotEnoughPowerAsync(cancellationToken).ConfigureAwait(false);

        return new ClimateSnapshot(latest, history, notEnoughPower);
    }

    /// <summary>Parse a <c>GET /climate</c> array body into the tolerant history list (web <c>safeArray</c>).</summary>
    public static IReadOnlyList<ClimateHistoryRow> ParseHistory(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<ClimateHistoryRow>();
        }

        var rows = new List<ClimateHistoryRow>(root.GetArrayLength());
        int index = 0;
        foreach (var item in root.EnumerateArray())
        {
            index++;
            if (ClimateHistoryRow.FromJson(item, index) is { } row)
            {
                rows.Add(row);
            }
        }

        return rows;
    }

    private ApiRequest LatestRequest() =>
        new(
            ClimateControlRegistration.LatestOperation,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal) { [VehicleQueryParam] = _vehicleId });

    private async Task<IReadOnlyList<ClimateHistoryRow>> TryFetchHistoryAsync(CancellationToken cancellationToken)
    {
        try
        {
            var request = new ApiRequest(
                ClimateControlRegistration.HistoryOperation,
                Query: new Dictionary<string, object?>(StringComparer.Ordinal) { [VehicleQueryParam] = _vehicleId });
            var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
            return ParseHistory(json);
        }
        catch (ApiException)
        {
            // Web parity: the history query is independent; its failure leaves the history sections empty.
            return Array.Empty<ClimateHistoryRow>();
        }
    }

    private async Task<bool> TryFetchNotEnoughPowerAsync(CancellationToken cancellationToken)
    {
        try
        {
            var request = new ApiRequest(
                ClimateControlRegistration.ChargingTelemetryOperation,
                Query: new Dictionary<string, object?>(StringComparer.Ordinal) { [VehicleQueryParam] = _vehicleId });
            var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
            return ClimateJson.Bool(json, NotEnoughPowerField) == true;
        }
        catch (ApiException)
        {
            // Web parity: the charging-telemetry query is independent; its failure hides the power-to-heat banner.
            return false;
        }
    }
}
