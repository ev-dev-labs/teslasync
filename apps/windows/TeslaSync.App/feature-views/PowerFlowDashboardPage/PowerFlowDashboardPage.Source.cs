using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Battery;

/// <summary>
/// The generated-client-backed <see cref="IPowerFlowFeed"/> — the native data adapter for the battery power-flow
/// dashboard. It binds to the generated OpenAPI contract client (ADR-004):
/// <c>GET /tesla/energy-sites/{siteID}/live-status</c> for the current snapshot (web
/// <c>useTeslaEnergyLiveStatus</c>), <c>GET /tesla/energy-sites/{siteID}/live-status/history</c> for the chart
/// samples (web <c>useTeslaEnergyLiveStatusHistory</c>, with the trailing snake_case <c>since</c>/<c>until</c>/
/// <c>limit</c> query exactly as the web hook appends it) and <c>POST /tesla/energy-sites/{siteID}/live-status/
/// refresh</c> for the manual refresh (web <c>useRefreshTeslaEnergyLiveStatus</c>). No HTTP touches the view; every
/// response round-trips through the tolerant <see cref="PowerFlowLiveReading"/> / <see cref="PowerFlowHistoryEntry"/>
/// parsers so the snake_case SI wire shape and the platform <c>{data:…}</c> envelope are preserved losslessly. A
/// non-success response surfaces as the client's <see cref="ApiException"/> so the view-model can surface the
/// retryable error branch.
/// </summary>
public sealed class PowerFlowClientFeed : IPowerFlowFeed
{
    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public PowerFlowClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<PowerFlowLiveReading> FetchLiveStatusAsync(long siteId, CancellationToken cancellationToken)
    {
        var request = new ApiRequest(
            PowerFlowDashboardRegistration.OperationLiveStatus,
            PathParams: SitePath(siteId));

        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return PowerFlowLiveReading.FromJson(json);
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<PowerFlowHistoryEntry>> FetchLiveStatusHistoryAsync(
        long siteId, string? since, string? until, int limit, CancellationToken cancellationToken)
    {
        var query = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["limit"] = limit.ToString(CultureInfo.InvariantCulture),
        };
        if (!string.IsNullOrWhiteSpace(since))
        {
            query["since"] = since;
        }

        if (!string.IsNullOrWhiteSpace(until))
        {
            query["until"] = until;
        }

        var request = new ApiRequest(
            PowerFlowDashboardRegistration.OperationHistory,
            PathParams: SitePath(siteId),
            Query: query);

        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return PowerFlowHistoryEntry.ListFromJson(json);
    }

    /// <inheritdoc />
    public async Task<PowerFlowLiveReading> RefreshLiveStatusAsync(long siteId, CancellationToken cancellationToken)
    {
        var request = new ApiRequest(
            PowerFlowDashboardRegistration.OperationRefresh,
            PathParams: SitePath(siteId));

        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return PowerFlowLiveReading.FromJson(json);
    }

    private static Dictionary<string, string> SitePath(long siteId) =>
        new(StringComparer.Ordinal) { ["siteID"] = siteId.ToString(CultureInfo.InvariantCulture) };
}
