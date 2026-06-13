using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The generated-client-backed <see cref="IGDPRExportFeed"/> — the native data adapter for the admin GDPR-export
/// surface. It binds to the generated OpenAPI contract client (ADR-004) and issues the one read the web page makes:
/// <c>GET /admin/gdpr/exports/{id}</c> (web <c>useGDPRExport</c>), with the id filling the path template's <c>{id}</c>
/// slot. No HTTP touches the view; the response JSON round-trips through the tolerant <see cref="GDPRArtifact"/> parser
/// so the snake_case wire shape is preserved losslessly. A non-success response surfaces as the client's
/// <see cref="ApiException"/> (carrying the HTTP status) so the view-model can distinguish the 503 "subsystem not
/// configured" branch (web <c>subsystemMissing</c>) and the 404 "artifact not found" branch (web <c>notFound</c>) from
/// a generic failure.
/// </summary>
public sealed class GDPRExportClientFeed : IGDPRExportFeed
{
    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public GDPRExportClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<GDPRArtifact?> FetchAsync(string id, CancellationToken cancellationToken)
    {
        var request = ApiRequest.WithPath(GDPRExportRegistration.FetchOperation, "id", id ?? string.Empty);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return GDPRArtifact.FromJson(json);
    }
}
