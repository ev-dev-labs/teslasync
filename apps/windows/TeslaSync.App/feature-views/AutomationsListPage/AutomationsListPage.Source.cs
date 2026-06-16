using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;

namespace TeslaSync.App.FeatureViews.Automations;

/// <summary>
/// The generated-client-backed <see cref="IAutomationsListFeed"/> — the native data adapter for the automations
/// hub. It binds to the generated OpenAPI contract client (ADR-004): the parallel reads
/// <c>GET /automations</c> (web <c>useAutomations</c>), <c>GET /vehicles</c> (web <c>useVehicles</c>),
/// <c>GET /pinned?type=automation</c> (web <c>usePinned('automation')</c>) and
/// <c>GET /automations/history?limit={n}</c> (web <c>useAutomationHistory</c>), plus the per-card writes
/// <c>PATCH /automations/{id}/toggle</c>, <c>PATCH /automations/{id}/re-enable</c>,
/// <c>DELETE /automations/{id}</c>, <c>POST /automations/{id}/test-run</c> and <c>POST /automations/import</c>.
/// No HTTP touches the view; the response JSON round-trips through the tolerant parsers so the snake_case wire
/// shape is preserved losslessly.
/// </summary>
public sealed class AutomationsListClientFeed : IAutomationsListFeed
{
    private const string ListOperation = "get_api_v1_automations";
    private const string VehiclesOperation = "get_api_v1_vehicles";
    private const string PinnedOperation = "get_api_v1_pinned";
    private const string HistoryOperation = "get_api_v1_automations_history";
    private const string ToggleOperation = "patch_api_v1_automations_id_toggle";
    private const string ReEnableOperation = "patch_api_v1_automations_id_re_enable";
    private const string DeleteOperation = "delete_api_v1_automations_id";
    private const string TestRunOperation = "post_api_v1_automations_id_test_run";
    private const string ImportOperation = "post_api_v1_automations_import";
    private const string PinOperation = "post_api_v1_pinned";
    private const string UnpinOperation = "delete_api_v1_pinned_id";

    private readonly IApiClient _api;

    /// <summary>Creates the feed over the generated contract client.</summary>
    /// <param name="api">The generated OpenAPI contract client.</param>
    public AutomationsListClientFeed(IApiClient api)
    {
        ArgumentNullException.ThrowIfNull(api);
        _api = api;
    }

    /// <inheritdoc />
    public async Task<AutomationsListSnapshot> FetchAsync(int historyLimit, CancellationToken cancellationToken)
    {
        var automationsJson = await _api.SendAsync<JsonElement>(new ApiRequest(ListOperation), cancellationToken)
            .ConfigureAwait(false);
        var vehiclesJson = await _api.SendAsync<JsonElement>(new ApiRequest(VehiclesOperation), cancellationToken)
            .ConfigureAwait(false);
        var pinnedJson = await _api.SendAsync<JsonElement>(
            new ApiRequest(PinnedOperation, Query: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["type"] = "automation",
            }),
            cancellationToken).ConfigureAwait(false);
        var historyJson = await _api.SendAsync<JsonElement>(
            new ApiRequest(HistoryOperation, Query: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["limit"] = historyLimit,
            }),
            cancellationToken).ConfigureAwait(false);

        var (history, summary) = ParseHistory(historyJson);

        return new AutomationsListSnapshot(
            Automations: AutomationSummary.ParseList(automationsJson),
            Vehicles: AutomationVehicleRef.ParseList(vehiclesJson),
            Pins: AutomationPin.ParseList(pinnedJson),
            History: history,
            HistorySummary: summary);
    }

    /// <inheritdoc />
    public Task ToggleAsync(long id, bool enabled, CancellationToken cancellationToken)
    {
        var request = new ApiRequest(
            ToggleOperation,
            PathParams: PathId(id),
            Body: new Dictionary<string, object?>(StringComparer.Ordinal) { ["enabled"] = enabled });
        return _api.SendAsync<JsonElement>(request, cancellationToken);
    }

    /// <inheritdoc />
    public Task ReEnableAsync(long id, CancellationToken cancellationToken) =>
        _api.SendAsync<JsonElement>(new ApiRequest(ReEnableOperation, PathParams: PathId(id)), cancellationToken);

    /// <inheritdoc />
    public Task DeleteAsync(long id, CancellationToken cancellationToken) =>
        _api.SendAsync<JsonElement>(new ApiRequest(DeleteOperation, PathParams: PathId(id)), cancellationToken);

    /// <inheritdoc />
    public Task TestRunAsync(long id, CancellationToken cancellationToken) =>
        _api.SendAsync<JsonElement>(new ApiRequest(TestRunOperation, PathParams: PathId(id)), cancellationToken);

    /// <inheritdoc />
    public Task ImportAsync(string envelopeJson, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(envelopeJson);

        JsonElement body;
        using (var doc = JsonDocument.Parse(envelopeJson))
        {
            body = doc.RootElement.Clone();
        }

        return _api.SendAsync<JsonElement>(new ApiRequest(ImportOperation, Body: body), cancellationToken);
    }

    /// <inheritdoc />
    public Task PinAsync(string automationId, CancellationToken cancellationToken) =>
        _api.SendAsync<JsonElement>(
            new ApiRequest(PinOperation, Body: new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["item_type"] = "automation",
                ["item_id"] = automationId,
            }),
            cancellationToken);

    /// <inheritdoc />
    public Task UnpinAsync(string pinId, CancellationToken cancellationToken) =>
        _api.SendAsync<JsonElement>(
            new ApiRequest(UnpinOperation, PathParams: new Dictionary<string, string>(StringComparer.Ordinal) { ["id"] = pinId }),
            cancellationToken);

    private static Dictionary<string, string> PathId(long id) => new(StringComparer.Ordinal)
    {
        ["id"] = id.ToString(CultureInfo.InvariantCulture),
    };

    private static (IReadOnlyList<AutomationHistoryEntry> History, AutomationHistorySummary? Summary) ParseHistory(JsonElement o)
    {
        if (o.ValueKind != JsonValueKind.Object)
        {
            return (Array.Empty<AutomationHistoryEntry>(), null);
        }

        var entries = new List<AutomationHistoryEntry>();
        if (o.TryGetProperty("items", out var items) && items.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in items.EnumerateArray())
            {
                if (item.ValueKind == JsonValueKind.Object)
                {
                    entries.Add(ParseHistoryEntry(item));
                }
            }
        }

        AutomationHistorySummary? summary = null;
        if (o.TryGetProperty("summary", out var s) && s.ValueKind == JsonValueKind.Object)
        {
            summary = new AutomationHistorySummary(
                TotalExecutions: AutomationsJson.Long(s, "total_executions") ?? 0,
                SuccessRate: AutomationsJson.Double(s, "success_rate") ?? 0,
                AvgDurationMs: AutomationsJson.Double(s, "avg_duration_ms") ?? 0);
        }

        return (entries, summary);
    }

    private static AutomationHistoryEntry ParseHistoryEntry(JsonElement o) => new(
        Id: AutomationsJson.Long(o, "id") ?? 0,
        AutomationName: AutomationsJson.Str(o, "automation_name") ?? string.Empty,
        Status: AutomationsJson.Str(o, "status") ?? string.Empty,
        Error: AutomationsJson.Str(o, "error"),
        TriggeredAt: ParseTriggeredAt(AutomationsJson.Str(o, "triggered_at")),
        DurationMs: AutomationsJson.Double(o, "duration_ms"),
        ActionsTotal: AutomationsJson.Int(o, "actions_total") ?? 0,
        ActionsSucceeded: AutomationsJson.Int(o, "actions_succeeded") ?? 0);

    private static DateTimeOffset ParseTriggeredAt(string? raw)
    {
        return !string.IsNullOrWhiteSpace(raw) && DateTimeOffset.TryParse(
            raw,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var value)
            ? value
            : DateTimeOffset.MinValue;
    }
}
