using System.Collections.Generic;
using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Notifications;

/// <summary>
/// The data port the <see cref="AlertStudioPageViewModel"/> reads through and writes mutations back through — the
/// native parity of the eleven web hooks the page binds (web AlertStudioPage.tsx): <c>useAlertRules</c>,
/// <c>useNotificationChannels</c>, <c>useVehicles</c>, <c>useAlertMetrics</c>, <c>useSaveAlertRule</c>,
/// <c>useDeleteAlertRule</c>, <c>useToggleAlertRule</c>, <c>useSnoozeAlertRule</c>, <c>useTestAlertRule</c>,
/// <c>useBulkEnableRules</c> and <c>useBulkDisableRules</c>. The view never performs HTTP itself; the default
/// <see cref="EmptyAlertStudioFeed"/> resolves to the empty state and the generated-client-backed
/// <see cref="AlertStudioClientFeed"/> binds to the <c>/alerts/*</c>, <c>/notifications</c> and <c>/vehicles</c>
/// endpoints (ADR-004).
/// </summary>
public interface IAlertStudioFeed
{
    /// <summary>Resolve the current rule list (web <c>useAlertRules → GET /alerts/rules</c>).</summary>
    Task<IReadOnlyList<AlertStudioRule>> FetchRulesAsync(CancellationToken cancellationToken);

    /// <summary>Resolve the notification channels (web <c>useNotificationChannels → GET /notifications</c>).</summary>
    Task<IReadOnlyList<AlertStudioChannel>> FetchChannelsAsync(CancellationToken cancellationToken);

    /// <summary>Resolve the fleet vehicles (web <c>useVehicles → GET /vehicles</c>).</summary>
    Task<IReadOnlyList<AlertStudioVehicle>> FetchVehiclesAsync(CancellationToken cancellationToken);

    /// <summary>Resolve the computed metrics (web <c>useAlertMetrics → GET /alerts/metrics</c>).</summary>
    Task<IReadOnlyList<AlertStudioMetric>> FetchMetricsAsync(CancellationToken cancellationToken);

    /// <summary>
    /// Create or update a rule (web <c>useSaveAlertRule</c>): <c>POST /alerts/rules</c> when
    /// <paramref name="id"/> is null, else <c>PUT /alerts/rules/{id}</c> with the same body.
    /// </summary>
    Task SaveRuleAsync(long? id, IReadOnlyDictionary<string, object?> payload, CancellationToken cancellationToken);

    /// <summary>Delete one rule (web <c>useDeleteAlertRule → DELETE /alerts/rules/{id}</c>).</summary>
    Task DeleteRuleAsync(long id, CancellationToken cancellationToken);

    /// <summary>Toggle one rule's enabled flag (web <c>useToggleAlertRule → PUT /alerts/rules/{id}</c>).</summary>
    Task ToggleRuleAsync(long id, bool enabled, CancellationToken cancellationToken);

    /// <summary>Snooze one rule for N minutes (web <c>useSnoozeAlertRule → POST /alerts/rules/{id}/snooze</c>).</summary>
    Task SnoozeRuleAsync(long id, int minutes, CancellationToken cancellationToken);

    /// <summary>Send a test notification (web <c>useTestAlertRule → POST /alerts/test</c>).</summary>
    Task TestRuleAsync(IReadOnlyDictionary<string, object?> payload, CancellationToken cancellationToken);

    /// <summary>Bulk-enable the supplied ids (web <c>useBulkEnableRules → POST /alerts/rules/bulk/enable</c>).</summary>
    Task BulkEnableAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken);

    /// <summary>Bulk-disable the supplied ids (web <c>useBulkDisableRules → POST /alerts/rules/bulk/disable</c>).</summary>
    Task BulkDisableAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken);
}

/// <summary>The default feed — resolves to no data and no-ops every mutation (the empty data state).</summary>
public sealed class EmptyAlertStudioFeed : IAlertStudioFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyAlertStudioFeed Instance { get; } = new();

    private EmptyAlertStudioFeed()
    {
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<AlertStudioRule>> FetchRulesAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<IReadOnlyList<AlertStudioRule>>(Array.Empty<AlertStudioRule>());
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<AlertStudioChannel>> FetchChannelsAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<IReadOnlyList<AlertStudioChannel>>(Array.Empty<AlertStudioChannel>());
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<AlertStudioVehicle>> FetchVehiclesAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<IReadOnlyList<AlertStudioVehicle>>(Array.Empty<AlertStudioVehicle>());
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<AlertStudioMetric>> FetchMetricsAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<IReadOnlyList<AlertStudioMetric>>(Array.Empty<AlertStudioMetric>());
    }

    /// <inheritdoc />
    public Task SaveRuleAsync(long? id, IReadOnlyDictionary<string, object?> payload, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task DeleteRuleAsync(long id, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task ToggleRuleAsync(long id, bool enabled, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task SnoozeRuleAsync(long id, int minutes, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task TestRuleAsync(IReadOnlyDictionary<string, object?> payload, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
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
}

/// <summary>
/// The generated-client-backed <see cref="IAlertStudioFeed"/> — the native data adapter for the alert-studio
/// surface. It binds to the generated OpenAPI contract client (ADR-004) and round-trips every list response
/// through the tolerant parsers so the snake_case wire shape is preserved losslessly. No HTTP touches the view.
/// </summary>
public sealed class AlertStudioClientFeed : IAlertStudioFeed
{
    private const string RulesOperation = "get_api_v1_alerts_rules";
    private const string CreateOperation = "post_api_v1_alerts_rules";
    private const string UpdateOperation = "put_api_v1_alerts_rules_ruleID";
    private const string DeleteOperation = "delete_api_v1_alerts_rules_ruleID";
    private const string SnoozeOperation = "post_api_v1_alerts_rules_ruleID_snooze";
    private const string TestOperation = "post_api_v1_alerts_test";
    private const string MetricsOperation = "get_api_v1_alerts_metrics";
    private const string ChannelsOperation = "get_api_v1_notifications";
    private const string VehiclesOperation = "get_api_v1_vehicles";
    private const string BulkEnableOperation = "post_api_v1_alerts_rules_bulk_enable";
    private const string BulkDisableOperation = "post_api_v1_alerts_rules_bulk_disable";

    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public AlertStudioClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<AlertStudioRule>> FetchRulesAsync(CancellationToken cancellationToken)
    {
        var json = await _api.SendAsync<JsonElement>(new ApiRequest(RulesOperation), cancellationToken).ConfigureAwait(false);
        return AlertStudioRule.ParseList(json);
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<AlertStudioChannel>> FetchChannelsAsync(CancellationToken cancellationToken)
    {
        var json = await _api.SendAsync<JsonElement>(new ApiRequest(ChannelsOperation), cancellationToken).ConfigureAwait(false);
        return AlertStudioChannel.ParseList(json);
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<AlertStudioVehicle>> FetchVehiclesAsync(CancellationToken cancellationToken)
    {
        var json = await _api.SendAsync<JsonElement>(new ApiRequest(VehiclesOperation), cancellationToken).ConfigureAwait(false);
        return AlertStudioVehicle.ParseList(json);
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<AlertStudioMetric>> FetchMetricsAsync(CancellationToken cancellationToken)
    {
        var json = await _api.SendAsync<JsonElement>(new ApiRequest(MetricsOperation), cancellationToken).ConfigureAwait(false);
        return AlertStudioMetric.ParseList(json);
    }

    /// <inheritdoc />
    public async Task SaveRuleAsync(long? id, IReadOnlyDictionary<string, object?> payload, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(payload);
        var body = new Dictionary<string, object?>(payload, StringComparer.Ordinal);

        ApiRequest request = id is { } ruleId
            ? new ApiRequest(UpdateOperation, PathParams: RuleIdPath(ruleId), Body: body)
            : new ApiRequest(CreateOperation, Body: body);

        await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task DeleteRuleAsync(long id, CancellationToken cancellationToken)
    {
        var request = new ApiRequest(DeleteOperation, PathParams: RuleIdPath(id));
        await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task ToggleRuleAsync(long id, bool enabled, CancellationToken cancellationToken)
    {
        var request = new ApiRequest(
            UpdateOperation,
            PathParams: RuleIdPath(id),
            Body: new Dictionary<string, object?>(StringComparer.Ordinal) { ["enabled"] = enabled });

        await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task SnoozeRuleAsync(long id, int minutes, CancellationToken cancellationToken)
    {
        var request = new ApiRequest(
            SnoozeOperation,
            PathParams: RuleIdPath(id),
            Body: new Dictionary<string, object?>(StringComparer.Ordinal) { ["minutes"] = minutes });

        await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public async Task TestRuleAsync(IReadOnlyDictionary<string, object?> payload, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(payload);
        var request = new ApiRequest(
            TestOperation,
            Body: new Dictionary<string, object?>(payload, StringComparer.Ordinal));

        await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
    }

    /// <inheritdoc />
    public Task BulkEnableAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken) =>
        SendBulkAsync(BulkEnableOperation, ids, cancellationToken);

    /// <inheritdoc />
    public Task BulkDisableAsync(IReadOnlyList<long> ids, CancellationToken cancellationToken) =>
        SendBulkAsync(BulkDisableOperation, ids, cancellationToken);

    private async Task SendBulkAsync(string operation, IReadOnlyList<long> ids, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(ids);
        var request = new ApiRequest(
            operation,
            Body: new Dictionary<string, object?>(StringComparer.Ordinal) { ["ids"] = ids });

        await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
    }

    private static Dictionary<string, string> RuleIdPath(long id) =>
        new(StringComparer.Ordinal) { ["ruleID"] = id.ToString(CultureInfo.InvariantCulture) };
}
