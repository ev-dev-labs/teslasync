using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="PatternsSlideViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of parsed year-review patterns snapshots from <c>GET /analytics/year-review</c>
/// — the native analogue of the web review deck's <c>useYearReview(year, vehicleId)</c> read whose resolved
/// <c>YearReview</c> the web <c>PatternsSlide</c> consumes as a prop. The view never performs HTTP itself; the
/// concrete <see cref="PatternsSlideSource"/> (or a test fake) drives this.
/// </summary>
public interface IPatternsSlideSource
{
    /// <summary>Stream the cache-then-network year-review patterns snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<YearReviewPatterns>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IPatternsSlideSource"/> — the native data adapter for the Patterns Slide
/// surface. It runs one cache-then-network read of <c>GET /analytics/year-review</c> (generated operation
/// <c>get_api_v1_analytics_year_review</c>) with the same <c>year</c> + <c>vehicle_id</c> query the web review
/// deck requests (web <c>useYearReview(year, vehicleId)</c>), caching the raw JSON so the snake_case wire
/// shape round-trips losslessly, and parses each emission into a <see cref="YearReviewPatterns"/> via
/// <see cref="PatternsSlideResultMapper"/>. No HTTP touches the view.
/// </summary>
public sealed class PatternsSlideSource : IPatternsSlideSource
{
    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly string _cacheKey;
    private readonly ApiRequest _request;

    /// <summary>Creates the source over the contract client, cache-then-network engine, JSON settings, and the
    /// vehicle + year the year-review is scoped to.</summary>
    public PatternsSlideSource(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        long vehicleId,
        int year)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
        _cacheKey = string.Format(CultureInfo.InvariantCulture, "analytics:year-review:{0}:{1}", vehicleId, year);

        // Query keys are snake_case to match the Go API (never camelCase): year + vehicle_id.
        _request = new ApiRequest(
            Operations.Analytics.YearReview,
            Query: new Dictionary<string, object?>
            {
                ["year"] = year,
                ["vehicle_id"] = vehicleId,
            });
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<YearReviewPatterns>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<JsonElement>(
            _cacheKey,
            ct => _api.SendAsync<JsonElement>(_request, ct),
            IsEmptyResponse,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return PatternsSlideResultMapper.Map(emission);
        }
    }

    private static bool IsEmptyResponse(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Object => !element.EnumerateObject().MoveNext(),
        _ => false,
    };
}
