using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the <see cref="FrontendErrorsViewModel"/> binds to (P1/S8 state-holder seam). It exposes the
/// single cache-then-network read the web card composes — the last-hour frontend-error summary (web
/// <c>useWebErrorsSummary</c> → <c>GET /admin/web-errors/summary</c>). The view never performs HTTP itself;
/// the concrete <see cref="FrontendErrorsSource"/> (or a test fake) drives this.
/// </summary>
public interface IFrontendErrorsSource
{
    /// <summary>Stream the cache-then-network web-errors summaries, cached first.</summary>
    IAsyncEnumerable<RepositoryResult<WebErrorsSummary>> StreamSummaryAsync(
        CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IFrontendErrorsSource"/> — the native data adapter for the frontend-errors
/// surface. It runs one cache-then-network read through the shared <see cref="CacheThenNetworkEngine"/>,
/// caching the raw JSON so the snake_case wire shape round-trips losslessly, then maps each emission to a typed
/// <see cref="WebErrorsSummary"/> via <see cref="FrontendErrorsResultMapper"/>:
/// <c>GET /admin/web-errors/summary</c> (generated operation <c>get_api_v1_admin_web_errors_summary</c>). No
/// HTTP touches the view.
/// </summary>
public sealed class FrontendErrorsSource : IFrontendErrorsSource
{
    /// <summary>The generated OpenAPI operation id for the web-errors summary feed.</summary>
    public const string SummaryOperation = "get_api_v1_admin_web_errors_summary";

    private const string CacheKey = "admin:web-errors:summary";

    private static readonly ApiRequest SummaryRequest = new(SummaryOperation);

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    public FrontendErrorsSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<WebErrorsSummary>> StreamSummaryAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var raw = _engine.StreamAsync<JsonElement>(
            CacheKey,
            ct => _api.SendAsync<JsonElement>(SummaryRequest, ct),
            IsEmptyResponse,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return FrontendErrorsResultMapper.Map(emission);
        }
    }

    // A null / non-object body carries no usable summary envelope (web parity: the query has no data → the
    // "Unable to load error summary." surface). A valid object whose `top` array is empty is NOT treated as
    // empty here: the engine keeps the payload so the card still renders the total plus the "No frontend
    // errors reported in the last hour." copy (web: data present, top.length === 0).
    private static bool IsEmptyResponse(JsonElement element) => element.ValueKind != JsonValueKind.Object;
}
