using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.SystemOps;

/// <summary>
/// The generated-client-backed <see cref="IDataExportFeed"/> — the native data adapter for the data-export surface. It
/// binds to the generated OpenAPI contract client (ADR-004): <c>GET /export/jobs</c> for the history query (web
/// <c>useQuery(['export-jobs'])</c>), <c>GET /vehicles</c> for the scope picker (web <c>useQuery(['vehicles'])</c>),
/// <c>GET /exports/columns?type=</c> for the column catalog (web <c>useExportColumns</c>), <c>POST /export/jobs</c> for
/// the generic submit (web <c>submitExport</c>) and <c>POST /export/jobs/account</c> for the GDPR "Download my data"
/// export (web <c>useCreateAccountExport</c>). No HTTP touches the view; every read round-trips through the tolerant
/// snapshot parsers and each write posts the exact snake_case body the web hook sends (null fields omitted so the
/// backend preserves its legacy defaults). A non-success response surfaces as the client's
/// <see cref="ApiException"/> so the view-model can render the failure surface.
/// </summary>
public sealed class DataExportClientFeed : IDataExportFeed
{
    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client and the API download origin.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    /// <param name="downloadBase">The API origin a finished job's artifact downloads from (web download href base).</param>
    public DataExportClientFeed(IApiClient api, Uri? downloadBase = null)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
        DownloadBaseUri = downloadBase;
    }

    /// <inheritdoc />
    public Uri? DownloadBaseUri { get; }

    /// <inheritdoc />
    public async Task<ExportJobsSnapshot> FetchJobsAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(DataExportRegistration.JobsOperation);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return ExportJobsSnapshot.FromJson(json);
    }

    /// <inheritdoc />
    public async Task<VehiclesSnapshot> FetchVehiclesAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(DataExportRegistration.VehiclesOperation);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return VehiclesSnapshot.FromJson(json);
    }

    /// <inheritdoc />
    public async Task<ExportColumnsCatalog> FetchColumnsAsync(string catalogType, CancellationToken cancellationToken)
    {
        if (string.IsNullOrEmpty(catalogType))
        {
            return ExportColumnsCatalog.Empty;
        }

        var request = ApiRequest.WithQuery(DataExportRegistration.ColumnsOperation, "type", catalogType);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return ExportColumnsCatalog.FromJson(json);
    }

    /// <inheritdoc />
    public async Task SubmitExportAsync(ExportSubmitPayload payload, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(payload);

        var body = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["type"] = payload.Type,
            ["format"] = payload.Format,
        };
        if (payload.VehicleId is { } vehicleId)
        {
            body["vehicle_id"] = vehicleId;
        }

        if (!string.IsNullOrEmpty(payload.Start))
        {
            body["start"] = payload.Start;
        }

        if (!string.IsNullOrEmpty(payload.End))
        {
            body["end"] = payload.End;
        }

        if (payload.Columns is { Count: > 0 } columns)
        {
            body["columns"] = columns;
        }

        var request = new ApiRequest(DataExportRegistration.SubmitOperation, Body: body);
        _ = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task CreateAccountExportAsync(AccountExportPayload payload, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(payload);

        var body = new Dictionary<string, object?>(StringComparer.Ordinal);
        if (payload.VehicleId is { } vehicleId)
        {
            body["vehicle_id"] = vehicleId;
        }

        if (!string.IsNullOrEmpty(payload.Start))
        {
            body["start"] = payload.Start;
        }

        if (!string.IsNullOrEmpty(payload.End))
        {
            body["end"] = payload.End;
        }

        var request = new ApiRequest(DataExportRegistration.AccountOperation, Body: body);
        _ = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
    }
}
