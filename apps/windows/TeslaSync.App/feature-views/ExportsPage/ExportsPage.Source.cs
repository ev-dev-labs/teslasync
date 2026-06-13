using System.Text.Json;
using System.Text.Json.Serialization;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Exports;

/// <summary>
/// The generated-client-backed <see cref="IExportsFeed"/> — the native data adapter for the exports list surface. It
/// binds to the generated OpenAPI contract client (ADR-004): <c>GET /export/jobs</c> for the list query (web
/// <c>useExportJobs</c>) and <c>POST /export/jobs/bulk</c> for the bulk delete (web <c>useBulkExportsDelete</c>),
/// posting the <c>{ ids, op: 'delete' }</c> body exactly as the web hook does. The download origin (web
/// <c>exportDownloadUrl</c> base) is taken from the shared client options. No HTTP touches the view; the list JSON
/// round-trips through the tolerant <see cref="ExportsListSnapshot"/> parser (which accepts the bare array and the
/// platform <c>{data:…}</c> envelope) and the bulk JSON through <see cref="ExportBulkOutcome"/>. A non-success response
/// surfaces as the client's <see cref="ApiException"/> so the view-model can render the failure surface.
/// </summary>
public sealed class ExportsClientFeed : IExportsFeed
{
    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client and the API download origin.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    /// <param name="downloadBase">The API origin a finished job's artifact downloads from (web download href base).</param>
    public ExportsClientFeed(IApiClient api, Uri? downloadBase = null)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
        DownloadBaseUri = downloadBase;
    }

    /// <inheritdoc />
    public Uri? DownloadBaseUri { get; }

    /// <inheritdoc />
    public async Task<ExportsListSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(ExportsRegistration.ListOperation);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return ExportsListSnapshot.FromJson(json);
    }

    /// <inheritdoc />
    public async Task<ExportBulkOutcome> BulkDeleteAsync(IReadOnlyList<string> ids, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(ids);

        var body = new ExportsBulkRequest(ids, ExportsRegistration.DeleteOp);
        var request = new ApiRequest(ExportsRegistration.BulkOperation, Body: body);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return ExportBulkOutcome.FromJson(json);
    }
}

/// <summary>
/// The <c>POST /export/jobs/bulk</c> request body — the native mirror of the web hook's <c>{ ids: string[], op }</c>
/// payload. The JSON property names are pinned to the snake_case wire contract so the shape is independent of the
/// shared serializer's naming policy.
/// </summary>
internal sealed record ExportsBulkRequest(
    [property: JsonPropertyName("ids")] IReadOnlyList<string> Ids,
    [property: JsonPropertyName("op")] string Op);
