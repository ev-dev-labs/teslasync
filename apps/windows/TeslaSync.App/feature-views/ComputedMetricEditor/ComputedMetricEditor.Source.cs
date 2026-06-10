using System.Net.Http;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Data.State;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The data port the view-model binds to for the computed-metric registry (P1/S8 state-holder seam). It
/// yields the cache-then-network sequence of parsed metric snapshots for the registry read — the native
/// analogue of the web <c>useAlertMetrics</c> query consumed by <c>ComputedMetricEditor</c> via
/// <c>useNotifications</c>. The view never performs HTTP itself; the concrete
/// <see cref="ComputedMetricCatalogSource"/> (or a test fake) drives this.
/// </summary>
public interface IComputedMetricCatalogSource
{
    /// <summary>Stream the cache-then-network metric snapshots, cached first.</summary>
    IAsyncEnumerable<RepositoryResult<IReadOnlyList<ComputedMetricSummary>>> StreamAsync(
        CancellationToken cancellationToken = default);
}

/// <summary>
/// The outcome of a single live-preview render — the native analogue of the web
/// <c>usePreviewComputedMetric</c> mutation resolving. On success it carries the verdict
/// <see cref="Result"/>; on an HTTP fault it carries a classified <see cref="Error"/> rather than throwing
/// (web parity: the mutation resolves to a value line or an error string, never an unhandled rejection).
/// </summary>
public sealed record ComputedMetricPreviewOutcome(bool Success, ComputedMetricPreview? Result, RepositoryError? Error)
{
    /// <summary>A successful verdict.</summary>
    public static ComputedMetricPreviewOutcome Ok(ComputedMetricPreview result) => new(true, result, null);

    /// <summary>A classified failure.</summary>
    public static ComputedMetricPreviewOutcome Fail(RepositoryError error) => new(false, null, error);
}

/// <summary>
/// The data port the view-model binds to for the live preview (P1/S8). A fire-on-edit render rather than
/// a cache-then-network read, so it exposes a single awaitable call. Native analogue of
/// <c>usePreviewComputedMetric</c>.
/// </summary>
public interface IComputedMetricPreviewSource
{
    /// <summary>Render <paramref name="request"/> against the preview endpoint; never throws for an HTTP fault.</summary>
    Task<ComputedMetricPreviewOutcome> PreviewAsync(
        ComputedMetricPreviewRequest request,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// The repository-backed <see cref="IComputedMetricCatalogSource"/> — the native data adapter for the
/// computed-metric registry. It runs one cache-then-network read of the metrics endpoint (generated
/// operation <see cref="MetricsOperation"/>) through the shared <see cref="CacheThenNetworkEngine"/>,
/// caching the raw JSON so the snake_case wire shape round-trips losslessly, and maps each emission to
/// typed summaries via <see cref="ComputedMetricCatalogMapper"/>. No HTTP touches the view.
/// </summary>
public sealed class ComputedMetricCatalogSource : IComputedMetricCatalogSource
{
    /// <summary>The generated OpenAPI operation id for the computed-metric registry read.</summary>
    public const string MetricsOperation = "get_api_v1_alerts_metrics";

    private const string MetricsCacheKey = "alerts:metrics";

    private readonly IApiClient _api;
    private readonly CacheThenNetworkEngine _engine;
    private readonly JsonSerializerOptions _json;

    /// <summary>Creates the source over the contract client, cache-then-network engine and JSON settings.</summary>
    public ComputedMetricCatalogSource(IApiClient api, CacheThenNetworkEngine engine, ApiClientOptions options)
    {
        ArgumentNullException.ThrowIfNull(api);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(options);
        _api = api;
        _engine = engine;
        _json = options.Json;
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<ComputedMetricSummary>>> StreamAsync(
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var request = new ApiRequest(MetricsOperation);

        var raw = _engine.StreamAsync<JsonElement>(
            MetricsCacheKey,
            ct => _api.SendAsync<JsonElement>(request, ct),
            ComputedMetricJson.IsEmptyArray,
            _json,
            CacheFreshness.LiveStaleSeconds,
            cancellationToken);

        await foreach (var emission in raw.ConfigureAwait(false))
        {
            yield return ComputedMetricCatalogMapper.Map(emission);
        }
    }
}

/// <summary>
/// The repository-backed <see cref="IComputedMetricPreviewSource"/> — the native data adapter for the live
/// preview. Posts the editor selection to the alert-test endpoint (generated operation
/// <see cref="PreviewOperation"/>) and classifies any fault through the shared <see cref="ApiErrorMapper"/>
/// rather than throwing. No HTTP touches the view.
/// </summary>
public sealed class ComputedMetricPreviewSource : IComputedMetricPreviewSource
{
    /// <summary>The generated OpenAPI operation id for the computed-metric preview render.</summary>
    public const string PreviewOperation = "post_api_v1_alerts_test";

    private readonly IApiClient _api;

    /// <summary>Creates the source over the contract client.</summary>
    public ComputedMetricPreviewSource(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<ComputedMetricPreviewOutcome> PreviewAsync(
        ComputedMetricPreviewRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var apiRequest = new ApiRequest(PreviewOperation, Body: request);
        try
        {
            var element = await _api.SendAsync<JsonElement>(apiRequest, cancellationToken).ConfigureAwait(false);
            return ComputedMetricPreviewOutcome.Ok(ComputedMetricPreview.FromJson(element));
        }
        catch (ApiException ex)
        {
            return ComputedMetricPreviewOutcome.Fail(ApiErrorMapper.Map(ex));
        }
        catch (HttpRequestException ex)
        {
            return ComputedMetricPreviewOutcome.Fail(ApiErrorMapper.Map(ex));
        }
    }
}
