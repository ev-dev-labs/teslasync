using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The repository-backed <see cref="IAnalyticsSummarySource"/> — the native data adapter for the
/// Analytics Summary surface. It runs one cache-then-network read of <c>GET /analytics/fleet</c>
/// (generated operation <c>get_api_v1_analytics_fleet</c>) with the same trailing
/// <c>days=30</c> window the web hook requests (<see cref="AnalyticsSummaryRegistration.DefaultDays"/>),
/// caching the raw JSON so the snake_case wire shape round-trips losslessly, and parses each emission
/// into an <see cref="AnalyticsSummary"/> via <see cref="AnalyticsSummaryResultMapper"/>. No HTTP
/// touches the view.
/// </summary>
public sealed class AnalyticsSummarySource : IAnalyticsSummarySource
{
    private const string CacheKey = "analytics:fleet:summary";

    private static readonly ApiRequest FleetRequest = new(
        Operations.Analytics.Fleet,
        Query: new Dictionary<string, object?> { ["days"] = AnalyticsSummaryRegistration.DefaultDays });

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    public AnalyticsSummarySource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<AnalyticsSummary>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<JsonElement>(
            CacheKey,
            ct => _api.SendAsync<JsonElement>(FleetRequest, ct),
            IsEmptyResponse,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return AnalyticsSummaryResultMapper.Map(emission);
        }
    }

    private static bool IsEmptyResponse(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Object => !element.EnumerateObject().MoveNext(),
        _ => false,
    };
}
