using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Charging;

/// <summary>
/// The data port the <see cref="ChargingHeatmapPageViewModel"/> binds to (P1/S8 state-holder seam, ADR-004).
/// It yields the parsed charging-sessions snapshot the web Charging-Heatmap page reads through its
/// <c>useChargingSessionsPaginated</c> query (web/src/features/charging/pages/ChargingHeatmapPage.tsx). The
/// view never performs HTTP itself; the concrete <see cref="ChargingHeatmapClientFeed"/> (or a test fake / the
/// <see cref="EmptyChargingHeatmapFeed"/> default) drives this.
/// </summary>
public interface IChargingHeatmapFeed
{
    /// <summary>Fetch the current charging-sessions snapshot for the scoped vehicle.</summary>
    Task<ChargingHeatmapSnapshot> FetchAsync(CancellationToken cancellationToken);
}

/// <summary>
/// The no-op <see cref="IChargingHeatmapFeed"/> the page's parameterless constructor binds to before a host
/// wires the generated client — it always resolves the empty snapshot, so the page renders its zeroed empty
/// layout (stat cards at 0, an all-empty grid and the locations empty state) rather than a blank region.
/// Shared singleton; immutable and thread-safe.
/// </summary>
public sealed class EmptyChargingHeatmapFeed : IChargingHeatmapFeed
{
    /// <summary>The shared instance.</summary>
    public static EmptyChargingHeatmapFeed Instance { get; } = new();

    private EmptyChargingHeatmapFeed()
    {
    }

    /// <inheritdoc />
    public Task<ChargingHeatmapSnapshot> FetchAsync(CancellationToken cancellationToken) =>
        Task.FromResult(ChargingHeatmapSnapshot.Empty);
}

/// <summary>
/// The generated-client-backed <see cref="IChargingHeatmapFeed"/> — the native data adapter for the
/// Charging-Heatmap page (ADR-004). It runs one read of <c>GET /charging-sessions</c> (generated operation
/// <see cref="ChargingHeatmapRegistration.Operation"/>) scoped to the active vehicle by the snake_case
/// <c>vehicle_id</c> query parameter and bounded by the web page's <c>limit=2000</c> page size — the native
/// analogue of the web page's <c>useSelectedVehicle()</c>-scoped
/// <c>useChargingSessionsPaginated(vehicleId, { limit: 2000 })</c> read. The raw JSON round-trips through
/// <see cref="ChargingHeatmapSnapshot.FromJson"/> so the snake_case wire shape is preserved losslessly; no
/// HTTP touches the view.
/// </summary>
public sealed class ChargingHeatmapClientFeed : IChargingHeatmapFeed
{
    private const string VehicleQueryParam = "vehicle_id";
    private const string LimitQueryParam = "limit";

    private readonly IApiClient _api;
    private readonly long _vehicleId;

    /// <summary>Creates the feed over the generated contract client and the active vehicle id.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    /// <param name="vehicleId">The active vehicle id (web header picker / <c>useSelectedVehicle</c>).</param>
    public ChargingHeatmapClientFeed(IApiClient api, long vehicleId)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
        _vehicleId = vehicleId;
    }

    /// <inheritdoc />
    public async Task<ChargingHeatmapSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(
            ChargingHeatmapRegistration.Operation,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                [VehicleQueryParam] = _vehicleId,
                [LimitQueryParam] = ChargingHeatmapRegistration.PageLimit.ToString(CultureInfo.InvariantCulture),
            });

        JsonElement json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return ChargingHeatmapSnapshot.FromJson(json);
    }
}
