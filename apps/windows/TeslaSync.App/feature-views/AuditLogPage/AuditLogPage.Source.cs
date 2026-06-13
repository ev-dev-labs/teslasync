using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Admin;

/// <summary>
/// The generated-client-backed <see cref="IAuditLogFeed"/> — the native data adapter for the admin audit-log surface.
/// It binds to the generated OpenAPI contract client (ADR-004) and composes the four reads the web page issues:
/// <c>GET /admin/audit-log{qs}</c> (web <c>useAuditLog</c>), <c>GET /admin/audit-log/categories</c>
/// (web <c>useAuditCategories</c>), <c>GET /admin/audit-log/actions</c> (web <c>useAuditActions</c>) and
/// <c>GET /admin/audit-log/verify?limit=</c> (web <c>useAuditChainVerify</c>). Query parameters are emitted as the
/// Go API's snake_case keys; the <c>since</c> / <c>until</c> bounds are normalised to ISO-8601 UTC exactly as the web
/// does with <c>new Date(value).toISOString()</c>. No HTTP touches the view; every response JSON round-trips through
/// the tolerant model parsers so the snake_case wire shape is preserved losslessly. A non-success response surfaces as
/// the client's <see cref="ApiException"/> (carrying the HTTP status) so the view-model can distinguish the HTTP 503
/// "subsystem not configured" branch (web <c>subsystemMissing</c>) from a generic failure.
/// </summary>
public sealed class AuditLogClientFeed : IAuditLogFeed
{
    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public AuditLogClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<AuditLogListSnapshot> FetchLogAsync(AuditLogFilter filter, int offset, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(filter);

        var query = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["limit"] = filter.Limit,
            ["offset"] = Math.Max(0, offset),
        };
        AddIso(query, "since", filter.Since);
        AddIso(query, "until", filter.Until);
        AddNonEmpty(query, "categories", filter.Category);
        AddNonEmpty(query, "actions", filter.Action);
        AddNonEmpty(query, "actors", filter.Actor);
        AddNonEmpty(query, "entity_type", filter.EntityType);

        var request = new ApiRequest(AuditLogRegistration.ListOperation, Query: query);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return AuditLogListSnapshot.FromJson(json);
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<string>> FetchCategoriesAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(AuditLogRegistration.CategoriesOperation);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return AuditLogJson.StrArray(json, "categories");
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<string>> FetchActionsAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(AuditLogRegistration.ActionsOperation);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return AuditLogJson.StrArray(json, "actions");
    }

    /// <inheritdoc />
    public async Task<AuditChainVerify> VerifyChainAsync(int limit, CancellationToken cancellationToken)
    {
        var query = new Dictionary<string, object?>(StringComparer.Ordinal) { ["limit"] = limit };
        var request = new ApiRequest(AuditLogRegistration.VerifyOperation, Query: query);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return AuditChainVerify.FromJson(json);
    }

    private static void AddNonEmpty(Dictionary<string, object?> query, string key, string value)
    {
        if (!string.IsNullOrWhiteSpace(value))
        {
            query[key] = value;
        }
    }

    // web: if (since) p.since = new Date(since).toISOString(); — normalise a datetime-local value to ISO-8601 UTC,
    // falling back to the raw value when it is not a parseable instant.
    private static void AddIso(Dictionary<string, object?> query, string key, string value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return;
        }

        query[key] = DateTimeOffset.TryParse(
            value,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeLocal | DateTimeStyles.AdjustToUniversal,
            out var instant)
            ? instant.UtcDateTime.ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture)
            : value;
    }
}
