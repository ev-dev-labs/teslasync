using System.Collections.Generic;
using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Notifications;

/// <summary>
/// The data port the <see cref="AlertsListPageViewModel"/> reads the alert list, the rules and the pins through,
/// and writes the per-alert mutations back through — the native parity of the web hooks the page binds
/// (web/src/features/notifications/pages/AlertsListPage.tsx): <c>useAlerts</c>, <c>useAlertRules</c>,
/// <c>usePinned('alert_rule')</c>, <c>useMarkAlertRead</c>, <c>useAcknowledgeAlert</c>, <c>useReopenAlert</c> and
/// <c>useAlertDetail</c>. The view never performs HTTP itself; the default <see cref="EmptyAlertsFeed"/> resolves
/// to the empty state and the generated-client-backed <see cref="AlertsClientFeed"/> binds to the
/// <c>/alerts</c> + <c>/pinned</c> endpoints (ADR-004).
/// </summary>
public interface IAlertsFeed
{
    /// <summary>Resolve the current alert list (web <c>useAlerts → GET /alerts</c>).</summary>
    Task<IReadOnlyList<Alert>> FetchAlertsAsync(CancellationToken cancellationToken);

    /// <summary>Resolve the current rule list (web <c>useAlertRules → GET /alerts/rules</c>).</summary>
    Task<IReadOnlyList<AlertsRule>> FetchRulesAsync(CancellationToken cancellationToken);

    /// <summary>Resolve the pinned alert-rule references (web <c>usePinned('alert_rule') → GET /pinned?type=alert_rule</c>).</summary>
    Task<IReadOnlyList<PinnedRef>> FetchPinnedRulesAsync(CancellationToken cancellationToken);

    /// <summary>Mark one alert read (web <c>useMarkAlertRead → POST /alerts/{id}/read</c>).</summary>
    Task MarkReadAsync(long id, CancellationToken cancellationToken);

    /// <summary>Acknowledge one alert with an optional note (web <c>useAcknowledgeAlert → POST /alerts/{id}/acknowledge</c>).</summary>
    Task AcknowledgeAsync(long id, string note, CancellationToken cancellationToken);

    /// <summary>Reopen one acknowledged alert (web <c>useReopenAlert → POST /alerts/{id}/reopen</c>).</summary>
    Task ReopenAsync(long id, CancellationToken cancellationToken);

    /// <summary>Resolve one alert with its full event timeline (web <c>useAlertDetail → GET /alerts/{id}</c>).</summary>
    Task<AlertDetail> FetchDetailAsync(long id, CancellationToken cancellationToken);
}

/// <summary>
/// One alert with its audit timeline — the native mirror of the web <c>AlertDetail</c> the timeline modal renders
/// (web <c>useAlertDetail</c>). Carries the title, the message and the ordered events. Pure data so the detail
/// projection is asserted headlessly.
/// </summary>
/// <param name="Title">The alert title (web <c>detail.title</c>).</param>
/// <param name="Message">The alert message (web <c>detail.message</c>).</param>
/// <param name="Events">The ordered audit events (web <c>detail.events</c>).</param>
public sealed record AlertDetail(string Title, string Message, IReadOnlyList<AlertTimelineEvent> Events)
{
    /// <summary>The empty detail (no title / message / events) — the default + the failed-load fallback.</summary>
    public static AlertDetail Empty { get; } = new(string.Empty, string.Empty, Array.Empty<AlertTimelineEvent>());

    /// <summary>Read one alert-detail object from JSON, tolerating missing / null fields.</summary>
    public static AlertDetail FromJson(JsonElement o)
    {
        if (o.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        var events = new List<AlertTimelineEvent>();
        if (o.TryGetProperty("events", out var arr) && arr.ValueKind == JsonValueKind.Array)
        {
            foreach (var ev in arr.EnumerateArray())
            {
                if (ev.ValueKind == JsonValueKind.Object)
                {
                    events.Add(AlertTimelineEvent.FromJson(ev));
                }
            }
        }

        return new AlertDetail(
            Title: JsonReaders.String(o, "title") ?? string.Empty,
            Message: JsonReaders.String(o, "message") ?? string.Empty,
            Events: events);
    }
}

/// <summary>One audit-timeline event (web <c>AlertDetailTimeline</c> row): the kind, the actor, the note and the instant.</summary>
/// <param name="Kind">The event kind (web <c>event.kind</c>, e.g. <c>acknowledged</c> / <c>reopened</c>).</param>
/// <param name="Actor">Who performed the event, or <see langword="null"/> when system-generated.</param>
/// <param name="Note">An optional free-text note attached to the event.</param>
/// <param name="At">When the event occurred, or <see langword="null"/> when absent.</param>
public sealed record AlertTimelineEvent(string Kind, string? Actor, string? Note, DateTimeOffset? At)
{
    /// <summary>Read one timeline event from JSON, tolerating missing / null fields.</summary>
    public static AlertTimelineEvent FromJson(JsonElement o) => new(
        Kind: JsonReaders.String(o, "kind") ?? JsonReaders.String(o, "event_type") ?? string.Empty,
        Actor: JsonReaders.String(o, "actor") ?? JsonReaders.String(o, "user"),
        Note: JsonReaders.String(o, "note") ?? JsonReaders.String(o, "message"),
        At: JsonReaders.Timestamp(o, "created_at") ?? JsonReaders.Timestamp(o, "at"));
}

/// <summary>The default feed — resolves to no data and no-ops every mutation (the empty data state).</summary>
public sealed class EmptyAlertsFeed : IAlertsFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyAlertsFeed Instance { get; } = new();

    private EmptyAlertsFeed()
    {
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<Alert>> FetchAlertsAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<IReadOnlyList<Alert>>(Array.Empty<Alert>());
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<AlertsRule>> FetchRulesAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<IReadOnlyList<AlertsRule>>(Array.Empty<AlertsRule>());
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<PinnedRef>> FetchPinnedRulesAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<IReadOnlyList<PinnedRef>>(Array.Empty<PinnedRef>());
    }

    /// <inheritdoc />
    public Task MarkReadAsync(long id, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task AcknowledgeAsync(long id, string note, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task ReopenAsync(long id, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }

    /// <inheritdoc />
    public Task<AlertDetail> FetchDetailAsync(long id, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(AlertDetail.Empty);
    }
}

/// <summary>
/// The generated-client-backed <see cref="IAlertsFeed"/> — the native data adapter for the alerts surface. It
/// binds to the generated OpenAPI contract client (ADR-004): <c>GET /alerts</c> for the list (web
/// <c>useAlerts</c>), <c>GET /alerts/rules</c> for the rules (web <c>useAlertRules</c>),
/// <c>GET /pinned?type=alert_rule</c> for the pins (web <c>usePinned('alert_rule')</c>),
/// <c>POST /alerts/{alertID}/read</c> for mark-read (web <c>useMarkAlertRead</c>),
/// <c>POST /alerts/{alertID}/acknowledge</c> with the <c>{ note }</c> body (web <c>useAcknowledgeAlert</c>),
/// <c>POST /alerts/{alertID}/reopen</c> for reopen (web <c>useReopenAlert</c>) and
/// <c>GET /alerts/{alertID}</c> for the detail timeline (web <c>useAlertDetail</c>). No HTTP touches the view;
/// each list response round-trips through the tolerant parsers so the snake_case wire shape is preserved
/// losslessly.
/// </summary>
public sealed class AlertsClientFeed : IAlertsFeed
{
    private const string AlertsOperation = "get_api_v1_alerts";
    private const string RulesOperation = "get_api_v1_alerts_rules";
    private const string PinnedOperation = "get_api_v1_pinned";
    private const string ReadOperation = "post_api_v1_alerts_alertID_read";
    private const string AcknowledgeOperation = "post_api_v1_alerts_alertID_acknowledge";
    private const string ReopenOperation = "post_api_v1_alerts_alertID_reopen";
    private const string DetailOperation = "get_api_v1_alerts_alertID";
    private const string PinnedType = "alert_rule";

    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public AlertsClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<Alert>> FetchAlertsAsync(CancellationToken cancellationToken)
    {
        var json = await _api.SendAsync<JsonElement>(new ApiRequest(AlertsOperation), cancellationToken).ConfigureAwait(false);
        return Alert.ParseList(json);
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<AlertsRule>> FetchRulesAsync(CancellationToken cancellationToken)
    {
        var json = await _api.SendAsync<JsonElement>(new ApiRequest(RulesOperation), cancellationToken).ConfigureAwait(false);
        return AlertsRule.ParseList(json);
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<PinnedRef>> FetchPinnedRulesAsync(CancellationToken cancellationToken)
    {
        var request = new ApiRequest(
            PinnedOperation,
            Query: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["type"] = PinnedType,
            });

        var json = await _api.SendAsync<JsonElement>(request, cancellationToken).ConfigureAwait(false);
        return PinnedRef.ParseList(json);
    }

    /// <inheritdoc />
    public Task MarkReadAsync(long id, CancellationToken cancellationToken) =>
        _api.SendAsync<JsonElement>(WithAlertId(ReadOperation, id), cancellationToken);

    /// <inheritdoc />
    public Task AcknowledgeAsync(long id, string note, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(note);

        var request = new ApiRequest(
            AcknowledgeOperation,
            PathParams: AlertIdPath(id),
            Body: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["note"] = note,
            });

        return _api.SendAsync<JsonElement>(request, cancellationToken);
    }

    /// <inheritdoc />
    public Task ReopenAsync(long id, CancellationToken cancellationToken) =>
        _api.SendAsync<JsonElement>(WithAlertId(ReopenOperation, id), cancellationToken);

    /// <inheritdoc />
    public async Task<AlertDetail> FetchDetailAsync(long id, CancellationToken cancellationToken)
    {
        var json = await _api.SendAsync<JsonElement>(WithAlertId(DetailOperation, id), cancellationToken).ConfigureAwait(false);
        return AlertDetail.FromJson(json);
    }

    private static ApiRequest WithAlertId(string operation, long id) => new(operation, PathParams: AlertIdPath(id));

    private static Dictionary<string, string> AlertIdPath(long id) => new(StringComparer.Ordinal)
    {
        ["alertID"] = id.ToString(CultureInfo.InvariantCulture),
    };
}
