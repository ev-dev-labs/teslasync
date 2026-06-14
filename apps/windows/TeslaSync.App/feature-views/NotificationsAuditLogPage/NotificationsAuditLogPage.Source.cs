using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Notifications;

/// <summary>
/// The generated-client-backed <see cref="IAuditLogsFeed"/> — the native data adapter for the notifications
/// audit-log surface. It binds to the generated OpenAPI contract client (ADR-004) and composes the single read the
/// web page issues: <c>GET /system/audit</c> (operation <c>get_api_v1_system_audit</c>, web <c>useAuditLogs</c>). The
/// response JSON round-trips through the tolerant <see cref="AuditLogEntry.ListFromJson"/> parser so the Go API's
/// snake_case wire shape is preserved losslessly. A non-success response surfaces as the client's
/// <see cref="ApiException"/> so the view-model renders its inline failure surface (web <c>error</c>). No HTTP touches
/// the view.
/// </summary>
public sealed class AuditLogsClientFeed : IAuditLogsFeed
{
    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public AuditLogsClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<AuditLogEntry>> FetchAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(NotificationsAuditLogRegistration.ListOperation);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return AuditLogEntry.ListFromJson(json);
    }
}
