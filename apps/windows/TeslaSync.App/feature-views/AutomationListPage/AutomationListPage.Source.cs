using System.Text.Json;
using System.Text.Json.Serialization;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Automations;

/// <summary>
/// The generated-client-backed <see cref="IAutomationListFeed"/> — the native data adapter for the automations list
/// surface. It binds to the generated OpenAPI contract client (ADR-004): <c>GET /automations</c> for the list query
/// (web <c>useAutomations</c>) and <c>POST /automations/bulk</c> for the allowlisted bulk operation (web
/// <c>useBulkAutomationsUpdate</c>), posting the <c>{ ids, op }</c> body exactly as the web hook does. No HTTP touches
/// the view; the list JSON round-trips through the tolerant <see cref="AutomationListSnapshot"/> parser (which accepts
/// the bare array and the platform <c>{data:…}</c> envelope) and the bulk JSON through
/// <see cref="AutomationBulkOutcome"/>. A non-success response surfaces as the client's <see cref="ApiException"/> so
/// the view-model can render the failure surface.
/// </summary>
public sealed class AutomationListClientFeed : IAutomationListFeed
{
    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public AutomationListClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<AutomationListSnapshot> FetchAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(AutomationListRegistration.ListOperation);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return AutomationListSnapshot.FromJson(json);
    }

    /// <inheritdoc />
    public async Task<AutomationBulkOutcome> BulkUpdateAsync(IReadOnlyList<long> ids, AutomationBulkOp op, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(ids);

        var body = new AutomationBulkRequest(ids, AutomationListRegistration.Wire(op));
        var request = new ApiRequest(AutomationListRegistration.BulkOperation, Body: body);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return AutomationBulkOutcome.FromJson(json);
    }
}

/// <summary>
/// The <c>POST /automations/bulk</c> request body — the native mirror of the web hook's
/// <c>{ ids: number[], op }</c> payload. The JSON property names are pinned to the snake_case wire contract so the
/// shape is independent of the shared serializer's naming policy.
/// </summary>
internal sealed record AutomationBulkRequest(
    [property: JsonPropertyName("ids")] IReadOnlyList<long> Ids,
    [property: JsonPropertyName("op")] string Op);
