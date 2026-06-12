using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Analytics;

/// <summary>
/// The generated-client-backed <see cref="ITimelineFeed"/> — the native data adapter for the analytics timeline
/// surface. It binds the page's three web data sources to the generated OpenAPI contract client (ADR-004):
/// <c>GET /vehicles</c> (web <c>useVehicles</c>), <c>GET /vehicle-states/timeline</c> and
/// <c>GET /vehicle-states/summary</c> (the page's two TanStack queries). The per-vehicle reads pass the snake_case
/// <c>vehicle_id</c> + <c>days</c> query parameters the Go API expects (never camelCase, never a double
/// <c>/api/v1</c> prefix — the client versions the path exactly once). No HTTP touches the view; each response JSON
/// round-trips through the tolerant model parsers so the snake_case wire shape is preserved losslessly, and a
/// non-success response surfaces as the client's <see cref="ApiException"/> for the view-model's error branch.
/// </summary>
public sealed class TimelineClientFeed : ITimelineFeed
{
    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public TimelineClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<TimelineVehicle>> FetchVehiclesAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(TimelineRegistration.VehiclesOperation);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return TimelineVehicle.ParseList(json);
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<TransitionRecord>> FetchTimelineAsync(long vehicleId, int days, CancellationToken cancellationToken)
    {
        var request = new ApiRequest(TimelineRegistration.TimelineOperation, null, Query(vehicleId, days));
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return TransitionRecord.ParseList(json);
    }

    /// <inheritdoc />
    public async Task<StateSummary> FetchSummaryAsync(long vehicleId, int days, CancellationToken cancellationToken)
    {
        var request = new ApiRequest(TimelineRegistration.SummaryOperation, null, Query(vehicleId, days));
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return StateSummary.FromJson(json);
    }

    private static Dictionary<string, object?> Query(long vehicleId, int days) => new()
    {
        ["vehicle_id"] = vehicleId,
        ["days"] = days,
    };
}
