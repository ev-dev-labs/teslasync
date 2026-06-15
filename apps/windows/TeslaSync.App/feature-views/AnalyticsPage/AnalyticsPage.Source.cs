using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Analytics;

/// <summary>
/// The generated-client-backed <see cref="IAnalyticsFleetFeed"/> — the native data adapter for the Analytics
/// page (ADR-004). It binds the generated OpenAPI contract client to the single read the web page performs,
/// <c>GET /analytics/fleet</c> (generated operation <see cref="AnalyticsRegistration.FleetOperation"/>, web
/// <c>useFleetAnalytics</c>), with the same trailing <c>days=30</c> window the web analytics default preset
/// requests (<see cref="AnalyticsRegistration.DefaultDays"/>). The raw JSON is detached into the snapshot so
/// the snake_case wire shape round-trips losslessly to every tab's own result mapper; no HTTP touches the
/// view. A failed read propagates as the client's <see cref="ApiException"/> so the view-model renders the
/// page error surface.
/// </summary>
public sealed class AnalyticsFleetClientFeed : IAnalyticsFleetFeed
{
    private static readonly ApiRequest FleetRequest = new(
        AnalyticsRegistration.FleetOperation,
        Query: new Dictionary<string, object?> { ["days"] = AnalyticsRegistration.DefaultDays });

    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public AnalyticsFleetClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<AnalyticsFleetSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        var json = await _api.SendAsync<JsonElement>(FleetRequest, cancellationToken).ConfigureAwait(false);
        return AnalyticsFleetSnapshot.FromJson(json);
    }
}
