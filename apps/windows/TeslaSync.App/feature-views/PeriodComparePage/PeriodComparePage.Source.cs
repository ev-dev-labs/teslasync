using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Analytics;

/// <summary>
/// The read seam the <see cref="PeriodComparePageViewModel"/> binds to (P1/S8 state-holder layer) — the native port
/// of the web page's data sources (web/src/features/analytics/pages/PeriodComparePage.tsx): the <c>useVehicles</c>
/// fleet list that fills the picker, and the two <c>GET /analytics/period-stats</c> queries (one per period) that
/// fill the panels. Each period is fetched independently so the view-model can mirror the web's
/// <c>statsA.error ?? statsB.error</c> precedence and the <c>!a || !b</c> empty gate. The view never performs HTTP;
/// the contract-client-backed <see cref="PeriodCompareClientFeed"/> (or a test fake) drives this.
/// </summary>
public interface IPeriodCompareFeed
{
    /// <summary>Fetch the fleet list for the vehicle picker (web <c>useVehicles → GET /vehicles</c>).</summary>
    Task<IReadOnlyList<PeriodCompareVehicle>> FetchVehiclesAsync(CancellationToken cancellationToken);

    /// <summary>Fetch the period-stats envelope for <paramref name="vehicleId"/> over the trailing <paramref name="days"/> window (<c>0</c> = all time).</summary>
    Task<PeriodStats> FetchStatsAsync(long vehicleId, int days, CancellationToken cancellationToken);
}

/// <summary>The default feed — resolves to an empty fleet and a zero envelope (the empty data state, no HTTP).</summary>
public sealed class EmptyPeriodCompareFeed : IPeriodCompareFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyPeriodCompareFeed Instance { get; } = new();

    private EmptyPeriodCompareFeed()
    {
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<PeriodCompareVehicle>> FetchVehiclesAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<IReadOnlyList<PeriodCompareVehicle>>(Array.Empty<PeriodCompareVehicle>());
    }

    /// <inheritdoc />
    public Task<PeriodStats> FetchStatsAsync(long vehicleId, int days, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(PeriodStats.Zero);
    }
}

/// <summary>
/// The generated-client-backed <see cref="IPeriodCompareFeed"/> — the native data adapter for the period-comparison
/// surface. It binds the page's web data sources to the generated OpenAPI contract client (ADR-004):
/// <c>GET /vehicles</c> (web <c>useVehicles</c>) and <c>GET /analytics/period-stats</c> (the page's two TanStack
/// queries). The per-period reads pass the snake_case <c>vehicle_id</c> + <c>days</c> query parameters the Go API
/// expects (never camelCase, never a double <c>/api/v1</c> prefix — the client versions the path exactly once). No
/// HTTP touches the view; each response JSON round-trips through the tolerant model parsers so the snake_case wire
/// shape is preserved losslessly, and a non-success response surfaces as the client's <c>ApiException</c> for the
/// view-model's error branch.
/// </summary>
public sealed class PeriodCompareClientFeed : IPeriodCompareFeed
{
    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public PeriodCompareClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<PeriodCompareVehicle>> FetchVehiclesAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(PeriodCompareRegistration.VehiclesOperation);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return PeriodCompareVehicle.ParseList(json);
    }

    /// <inheritdoc />
    public async Task<PeriodStats> FetchStatsAsync(long vehicleId, int days, CancellationToken cancellationToken)
    {
        var query = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["vehicle_id"] = vehicleId,
            ["days"] = days,
        };
        var request = new ApiRequest(PeriodCompareRegistration.PeriodStatsOperation, null, query);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return PeriodStats.FromJson(json);
    }
}
