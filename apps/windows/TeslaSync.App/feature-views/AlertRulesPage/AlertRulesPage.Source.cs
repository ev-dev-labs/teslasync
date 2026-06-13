using System.Collections.Generic;
using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Notifications;

/// <summary>
/// The data port the <see cref="AlertRulesPageViewModel"/> reads the rule list through and writes bulk / rename
/// mutations back through — the native parity of the web hooks the page binds
/// (web/src/features/notifications/pages/AlertRulesPage.tsx): <c>useAlertRules</c>, <c>useBulkEnableRules</c>,
/// <c>useBulkDisableRules</c>, <c>useDeleteAlertRule</c> and <c>useSaveAlertRule</c>. The view never performs
/// HTTP itself; the default <see cref="EmptyAlertRulesFeed"/> resolves to the empty state and the
/// generated-client-backed <see cref="AlertRulesClientFeed"/> binds to the <c>/alerts/rules</c> endpoints
/// (ADR-004).
/// </summary>
public interface IAlertRulesFeed
{
    /// <summary>Resolve the current rule list (web <c>useAlertRules → GET /alerts/rules</c>).</summary>
    Task<IReadOnlyList<AlertRule>> FetchAsync(CancellationToken cancellationToken);

    /// <summary>Enable every rule in <paramref name="ids"/> (web <c>useBulkEnableRules → POST /alerts/rules/bulk/enable</c>).</summary>
    Task BulkEnableAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken);

    /// <summary>Disable every rule in <paramref name="ids"/> (web <c>useBulkDisableRules → POST /alerts/rules/bulk/disable</c>).</summary>
    Task BulkDisableAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken);

    /// <summary>Delete one rule (web <c>useDeleteAlertRule → DELETE /alerts/rules/{id}</c>).</summary>
    Task DeleteAsync(long id, CancellationToken cancellationToken);

    /// <summary>Rename one rule (web <c>useSaveAlertRule → PUT /alerts/rules/{id}</c> with the new name).</summary>
    Task RenameAsync(long id, string name, CancellationToken cancellationToken);
}

/// <summary>The default feed — resolves to no rules and no-ops every mutation (the empty data state).</summary>
public sealed class EmptyAlertRulesFeed : IAlertRulesFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyAlertRulesFeed Instance { get; } = new();

    private EmptyAlertRulesFeed()
    {
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<AlertRule>> FetchAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<IReadOnlyList<AlertRule>>(Array.Empty<AlertRule>());
    }

    /// <inheritdoc />
    public Task BulkEnableAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task BulkDisableAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task DeleteAsync(long id, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task RenameAsync(long id, string name, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }
}

/// <summary>
/// The generated-client-backed <see cref="IAlertRulesFeed"/> — the native data adapter for the alert-rules
/// surface. It binds to the generated OpenAPI contract client (ADR-004): <c>GET /alerts/rules</c> for the list
/// (web <c>useAlertRules</c>), <c>POST /alerts/rules/bulk/enable</c> + <c>POST /alerts/rules/bulk/disable</c> for
/// the bulk toggles (web <c>useBulkEnableRules</c> / <c>useBulkDisableRules</c>, each sending the snake_case
/// <c>{ ids }</c> body), <c>DELETE /alerts/rules/{ruleID}</c> for a single delete (web <c>useDeleteAlertRule</c>;
/// the page has no bulk-delete endpoint so it deletes per id), and <c>PUT /alerts/rules/{ruleID}</c> for the
/// inline rename (web <c>useSaveAlertRule</c>, sending only the touched <c>{ name }</c> field). No HTTP touches
/// the view; the list response JSON round-trips through the tolerant <see cref="AlertRule.ParseList"/> parser so
/// the snake_case wire shape is preserved losslessly.
/// </summary>
public sealed class AlertRulesClientFeed : IAlertRulesFeed
{
    private const string ListOperation = "get_api_v1_alerts_rules";
    private const string BulkEnableOperation = "post_api_v1_alerts_rules_bulk_enable";
    private const string BulkDisableOperation = "post_api_v1_alerts_rules_bulk_disable";
    private const string DeleteOperation = "delete_api_v1_alerts_rules_ruleID";
    private const string RenameOperation = "put_api_v1_alerts_rules_ruleID";

    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public AlertRulesClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<AlertRule>> FetchAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(ListOperation);
        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return AlertRule.ParseList(json);
    }

    /// <inheritdoc />
    public Task BulkEnableAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken) =>
        SendBulkAsync(BulkEnableOperation, ids, cancellationToken);

    /// <inheritdoc />
    public Task BulkDisableAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken) =>
        SendBulkAsync(BulkDisableOperation, ids, cancellationToken);

    /// <inheritdoc />
    public async Task DeleteAsync(long id, CancellationToken cancellationToken)
    {
        var request = new ApiRequest(
            DeleteOperation,
            PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                ["ruleID"] = id.ToString(CultureInfo.InvariantCulture),
            });

        await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task RenameAsync(long id, string name, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(name);

        var request = new ApiRequest(
            RenameOperation,
            PathParams: new Dictionary<string, string>(StringComparer.Ordinal)
            {
                ["ruleID"] = id.ToString(CultureInfo.InvariantCulture),
            },
            Body: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["name"] = name,
            });

        await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
    }

    private async Task SendBulkAsync(string operation, IReadOnlyList<long> ids, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(ids);

        var request = new ApiRequest(
            operation,
            Body: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["ids"] = ids,
            });

        await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
    }
}
