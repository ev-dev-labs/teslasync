using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="SavingsSlideViewModel"/> binds to (P1/S8 state-holder seam). It yields the
/// cache-then-network sequence of parsed year-review snapshots from <c>GET /analytics/year-review</c> — the
/// native analogue of the web Year-in-Review page's <c>useYearReview</c> read whose <c>data</c> the web
/// <c>SavingsSlide</c> consumes as a prop. The view never performs HTTP itself; the concrete
/// <see cref="SavingsSlideSource"/> (or a test fake) drives this.
/// </summary>
public interface ISavingsSlideSource
{
    /// <summary>Stream the cache-then-network year-review snapshots, newest cache first.</summary>
    IAsyncEnumerable<RepositoryResult<SavingsSnapshot>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="ISavingsSlideSource"/> — the native data adapter for the Savings slide.
/// It runs one cache-then-network read of <c>GET /analytics/year-review</c> (generated operation
/// <see cref="YearReviewOperation"/>) for a given <c>year</c> (and optional <c>vehicle_id</c>) — mirroring the
/// web hook <c>useYearReview(year, vehicleId)</c> — caching the raw JSON so the snake_case wire shape
/// round-trips losslessly, and parses each emission into a <see cref="SavingsSnapshot"/> via
/// <see cref="SavingsResultMapper"/>. No HTTP touches the view.
/// </summary>
public sealed class SavingsSlideSource : ISavingsSlideSource
{
    /// <summary>
    /// The generated year-review endpoint id (Generated/Api/ApiEndpoints.cs:
    /// <c>get_api_v1_analytics_year_review → GET /analytics/year-review</c>). It is intentionally not surfaced
    /// as an <c>Operations.*</c> constant, so the canonical operation id is pinned here.
    /// </summary>
    public const string YearReviewOperation = "get_api_v1_analytics_year_review";

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;
    private readonly ApiRequest _request;
    private readonly string _cacheKey;

    /// <summary>Creates the source over the contract client, cache-then-network engine, JSON settings, year and optional vehicle filter.</summary>
    public SavingsSlideSource(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        int year,
        string? vehicleId = null)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;

        var query = new Dictionary<string, object?> { ["year"] = year };
        if (!string.IsNullOrEmpty(vehicleId))
        {
            query["vehicle_id"] = vehicleId;
        }

        _request = new ApiRequest(YearReviewOperation, Query: query);
        _cacheKey = string.IsNullOrEmpty(vehicleId)
            ? FormattableString.Invariant($"analytics:year-review:{year}")
            : FormattableString.Invariant($"analytics:year-review:{year}:{vehicleId}");
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<SavingsSnapshot>> StreamAsync(
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
            yield return SavingsResultMapper.Map(emission);
        }
    }

    private static bool IsEmptyResponse(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Null or JsonValueKind.Undefined => true,
        JsonValueKind.Object => !element.EnumerateObject().MoveNext(),
        _ => false,
    };
}
