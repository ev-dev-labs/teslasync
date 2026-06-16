using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Automations;

/// <summary>
/// The mutually-exclusive lifecycle state of the <c>AutomationsListPage</c> surface — the native mirror of the
/// data states the web hub renders (web/src/features/automations/pages/AutomationsListPage.tsx). The web page
/// runs the <c>useAutomations</c> query and renders, in precedence order, the page-level spinner (web
/// <c>PageContainer loading</c>), the failure surface, the empty state (web <c>items.length === 0</c>) and
/// otherwise the automation cards. This enum is the top-level summary the ledger/Narrator key off; per-region
/// visibility is still driven by the projected flags so each branch renders exactly as the web composes it.
/// </summary>
public enum AutomationsListState
{
    /// <summary>The automations query is in flight (web <c>isLoading</c>).</summary>
    Loading,

    /// <summary>The query resolved with no automations at all (web <c>items.length === 0</c>).</summary>
    Empty,

    /// <summary>The query failed — the cards region shows the query-error surface.</summary>
    Error,

    /// <summary>The query produced at least one automation (web <c>items.length &gt; 0</c>).</summary>
    Success,
}

/// <summary>
/// The status filter the list is narrowed by — the native union of the web <c>StatusFilter</c>
/// (<c>'all' | 'active' | 'disabled' | 'auto-disabled'</c>). The wire token mirrors the web option values.
/// </summary>
public enum AutomationStatusFilter
{
    /// <summary>No status filter (web <c>'all'</c>).</summary>
    All,

    /// <summary>Enabled and not auto-disabled (web <c>'active'</c>).</summary>
    Active,

    /// <summary>Disabled by the user and not auto-disabled (web <c>'disabled'</c>).</summary>
    Disabled,

    /// <summary>Auto-disabled by the engine (web <c>'auto-disabled'</c>).</summary>
    AutoDisabled,
}

/// <summary>Maps the <see cref="AutomationStatusFilter"/> to/from its web wire token.</summary>
public static class AutomationStatusFilters
{
    /// <summary>The web wire token for a filter (the <c>&lt;Select&gt;</c> option value).</summary>
    public static string ToWire(AutomationStatusFilter filter) => filter switch
    {
        AutomationStatusFilter.Active => "active",
        AutomationStatusFilter.Disabled => "disabled",
        AutomationStatusFilter.AutoDisabled => "auto-disabled",
        _ => "all",
    };

    /// <summary>Parse a web wire token back to the filter (unknown tokens fall back to <see cref="AutomationStatusFilter.All"/>).</summary>
    public static AutomationStatusFilter FromWire(string? wire) => wire switch
    {
        "active" => AutomationStatusFilter.Active,
        "disabled" => AutomationStatusFilter.Disabled,
        "auto-disabled" => AutomationStatusFilter.AutoDisabled,
        _ => AutomationStatusFilter.All,
    };
}

/// <summary>
/// One automation row — the native mirror of the web <c>Automation</c> (web/src/api/types.ts), narrowed to the
/// fields the list page reads. Field names mirror the Go API's snake_case JSON tags; parsing is null-tolerant so
/// a partial row never throws. Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
public sealed record AutomationSummary(
    long Id,
    string Name,
    string? Description,
    bool Enabled,
    bool AutoDisabled,
    string? AutoDisabledReason,
    long? VehicleId,
    string? LastTriggeredAt,
    long ExecutionCount,
    long FailureCount,
    string? NextFireTime,
    IReadOnlyList<AutomationConflictModel> Conflicts)
{
    /// <summary>Parse an automations JSON array into a tolerant list of rows, preserving order.</summary>
    public static IReadOnlyList<AutomationSummary> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<AutomationSummary>();
        }

        var list = new List<AutomationSummary>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Read one automation row from a JSON object, tolerating missing / null fields.</summary>
    public static AutomationSummary FromJson(JsonElement o) => new(
        Id: AutomationsJson.Long(o, "id") ?? 0,
        Name: AutomationsJson.Str(o, "name") ?? string.Empty,
        Description: AutomationsJson.Str(o, "description"),
        Enabled: AutomationsJson.Bool(o, "enabled") ?? false,
        AutoDisabled: AutomationsJson.Bool(o, "auto_disabled") ?? false,
        AutoDisabledReason: AutomationsJson.Str(o, "auto_disabled_reason"),
        VehicleId: AutomationsJson.Long(o, "vehicle_id"),
        LastTriggeredAt: AutomationsJson.Str(o, "last_triggered_at"),
        ExecutionCount: AutomationsJson.Long(o, "execution_count") ?? 0,
        FailureCount: AutomationsJson.Long(o, "failure_count") ?? 0,
        NextFireTime: AutomationsJson.Str(o, "next_fire_time"),
        Conflicts: ParseConflicts(o));

    private static IReadOnlyList<AutomationConflictModel> ParseConflicts(JsonElement o)
    {
        if (!o.TryGetProperty("conflicts", out var arr) || arr.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<AutomationConflictModel>();
        }

        var list = new List<AutomationConflictModel>(arr.GetArrayLength());
        foreach (var c in arr.EnumerateArray())
        {
            if (c.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            list.Add(new AutomationConflictModel(
                AutomationName: AutomationsJson.Str(c, "automation_name") ?? string.Empty,
                Reason: AutomationsJson.Str(c, "reason") ?? string.Empty,
                Severity: AutomationsJson.Str(c, "severity") ?? "info"));
        }

        return list;
    }
}

/// <summary>
/// One vehicle reference — the native mirror of the web <c>Vehicle</c> fields the list reads for the per-card
/// scope label (web <c>useVehicles</c> → <c>buildVehicleLookup</c>). Pure data; parsing is null-tolerant.
/// </summary>
public sealed record AutomationVehicleRef(long Id, string DisplayName)
{
    /// <summary>Parse a vehicles JSON array into a tolerant list, preserving order.</summary>
    public static IReadOnlyList<AutomationVehicleRef> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<AutomationVehicleRef>();
        }

        var list = new List<AutomationVehicleRef>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            list.Add(new AutomationVehicleRef(
                Id: AutomationsJson.Long(item, "id") ?? 0,
                DisplayName: AutomationsJson.Str(item, "display_name") ?? string.Empty));
        }

        return list;
    }
}

/// <summary>
/// One pin row — the native mirror of the web <c>PinnedItem</c> fields the list reads to float pinned automations
/// to the top in pin order (web <c>usePinned('automation')</c> → <c>sortedItems</c>). Pure data; null-tolerant.
/// </summary>
public sealed record AutomationPin(string ItemId, int Position, string Id = "")
{
    /// <summary>Parse a pinned JSON array into a tolerant list, preserving order.</summary>
    public static IReadOnlyList<AutomationPin> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<AutomationPin>();
        }

        var list = new List<AutomationPin>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            list.Add(new AutomationPin(
                ItemId: AutomationsJson.Str(item, "item_id") ?? string.Empty,
                Position: AutomationsJson.Int(item, "position") ?? 0,
                Id: PinRowId(item)));
        }

        return list;
    }

    /// <summary>Read the pin row id (web <c>PinnedItem.id</c>) used to unpin, tolerating a string or numeric JSON id.</summary>
    private static string PinRowId(JsonElement item)
    {
        if (!item.TryGetProperty("id", out var v))
        {
            return string.Empty;
        }

        return v.ValueKind switch
        {
            JsonValueKind.String => v.GetString() ?? string.Empty,
            JsonValueKind.Number => v.GetRawText(),
            _ => string.Empty,
        };
    }
}

/// <summary>
/// One resolved snapshot the <c>AutomationsListPage</c> feed answers a load with — the automations list, the
/// vehicle lookup source, the user's automation pins, and the recent execution history plus its aggregate
/// statistics (the native union of the web page's parallel queries). Pure data; defaults to an empty resolved set.
/// </summary>
public sealed record AutomationsListSnapshot(
    IReadOnlyList<AutomationSummary> Automations,
    IReadOnlyList<AutomationVehicleRef> Vehicles,
    IReadOnlyList<AutomationPin> Pins,
    IReadOnlyList<AutomationHistoryEntry> History,
    AutomationHistorySummary? HistorySummary)
{
    /// <summary>An empty, resolved snapshot — the default local-state feed result.</summary>
    public static AutomationsListSnapshot Empty { get; } = new(
        Array.Empty<AutomationSummary>(),
        Array.Empty<AutomationVehicleRef>(),
        Array.Empty<AutomationPin>(),
        Array.Empty<AutomationHistoryEntry>(),
        null);
}

/// <summary>
/// The validation of a typed automation export envelope — the native port of the web
/// <c>isAutomationImportEnvelope</c> gate (web/src/features/automations/pages/AutomationsListPage.tsx). The web
/// import rejects untyped / legacy exports rather than translating them: a valid envelope is a JSON object with a
/// numeric <c>version</c> and an <c>automations</c> array. Pure — unit-tested without a UI host.
/// </summary>
public static class AutomationImportEnvelope
{
    /// <summary>True when <paramref name="json"/> parses to a typed CTI automation export envelope.</summary>
    public static bool IsValid(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return false;
        }

        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            return root.ValueKind == JsonValueKind.Object
                && root.TryGetProperty("version", out var version)
                && version.ValueKind == JsonValueKind.Number
                && root.TryGetProperty("automations", out var automations)
                && automations.ValueKind == JsonValueKind.Array;
        }
        catch (JsonException)
        {
            return false;
        }
    }
}

/// <summary>
/// The data port the <see cref="AutomationsListPageViewModel"/> reads the hub through and writes the per-card
/// actions back through — the native parity of the web <c>useAutomations</c> / <c>useAutomationHistory</c> /
/// <c>useVehicles</c> / <c>usePinned</c> queries and the <c>useToggleAutomation</c> / <c>useReEnableAutomation</c>
/// / <c>useDeleteAutomation</c> / <c>useTestRunAutomation</c> mutations. The view never performs HTTP itself; the
/// default <see cref="EmptyAutomationsListFeed"/> resolves to the empty state and the generated-client-backed
/// <see cref="AutomationsListClientFeed"/> binds to the OpenAPI contract (ADR-004).
/// </summary>
public interface IAutomationsListFeed
{
    /// <summary>Resolve the hub snapshot (web parallel queries); <paramref name="historyLimit"/> is the history page size.</summary>
    Task<AutomationsListSnapshot> FetchAsync(int historyLimit, CancellationToken cancellationToken);

    /// <summary>Toggle an automation enabled/disabled (web <c>useToggleAutomation</c>, <c>PATCH /automations/{id}/toggle</c>).</summary>
    Task ToggleAsync(long id, bool enabled, CancellationToken cancellationToken);

    /// <summary>Re-enable an auto-disabled automation (web <c>useReEnableAutomation</c>, <c>PATCH /automations/{id}/re-enable</c>).</summary>
    Task ReEnableAsync(long id, CancellationToken cancellationToken);

    /// <summary>Delete an automation (web <c>useDeleteAutomation</c>, <c>DELETE /automations/{id}</c>).</summary>
    Task DeleteAsync(long id, CancellationToken cancellationToken);

    /// <summary>Queue a test run (web <c>useTestRunAutomation</c>, <c>POST /automations/{id}/test-run</c>).</summary>
    Task TestRunAsync(long id, CancellationToken cancellationToken);

    /// <summary>Import a typed automation export (web import handler, <c>POST /automations/import</c>).</summary>
    Task ImportAsync(string envelopeJson, CancellationToken cancellationToken);

    /// <summary>Pin an automation (web <c>useTogglePin('automation')</c> pin, <c>POST /pinned</c>). Default no-op.</summary>
    Task PinAsync(string automationId, CancellationToken cancellationToken) => Task.CompletedTask;

    /// <summary>Unpin an automation by its pin-row id (web unpin, <c>DELETE /pinned/{id}</c>). Default no-op.</summary>
    Task UnpinAsync(string pinId, CancellationToken cancellationToken) => Task.CompletedTask;
}

/// <summary>The default feed — resolves every load to the empty snapshot and no-ops the writes (the empty data state).</summary>
public sealed class EmptyAutomationsListFeed : IAutomationsListFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyAutomationsListFeed Instance { get; } = new();

    private EmptyAutomationsListFeed()
    {
    }

    /// <inheritdoc />
    public Task<AutomationsListSnapshot> FetchAsync(int historyLimit, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(AutomationsListSnapshot.Empty);
    }

    /// <inheritdoc />
    public Task ToggleAsync(long id, bool enabled, CancellationToken cancellationToken) => Done(cancellationToken);

    /// <inheritdoc />
    public Task ReEnableAsync(long id, CancellationToken cancellationToken) => Done(cancellationToken);

    /// <inheritdoc />
    public Task DeleteAsync(long id, CancellationToken cancellationToken) => Done(cancellationToken);

    /// <inheritdoc />
    public Task TestRunAsync(long id, CancellationToken cancellationToken) => Done(cancellationToken);

    /// <inheritdoc />
    public Task ImportAsync(string envelopeJson, CancellationToken cancellationToken) => Done(cancellationToken);

    private static Task Done(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.CompletedTask;
    }
}

/// <summary>The aggregate stat-bar counts — the native mirror of the web <c>AutomationStats</c> (web <c>computeStats</c>).</summary>
public sealed record AutomationStatCounts(int Total, int Active, int Disabled, int AutoDisabled)
{
    /// <summary>Count an automation list by status, mirroring the web <c>computeStats</c> precedence (auto-disabled &gt; enabled &gt; disabled).</summary>
    public static AutomationStatCounts Compute(IReadOnlyList<AutomationSummary> automations)
    {
        ArgumentNullException.ThrowIfNull(automations);
        int active = 0;
        int disabled = 0;
        int autoDisabled = 0;
        foreach (var a in automations)
        {
            if (a.AutoDisabled)
            {
                autoDisabled++;
            }
            else if (a.Enabled)
            {
                active++;
            }
            else
            {
                disabled++;
            }
        }

        return new AutomationStatCounts(automations.Count, active, disabled, autoDisabled);
    }
}

/// <summary>One <c>&lt;Select&gt;</c> filter option (web option object): a wire value and its localized label.</summary>
public sealed record AutomationFilterOption(string Value, string Label);

/// <summary>
/// The render-time data model the <c>AutomationsListPage</c> projects from — the native analogue of the web
/// page's resolved queries + URL state (web/src/features/automations/pages/AutomationsListPage.tsx). Pure data so
/// the projection is unit-tested without a UI host.
/// </summary>
public sealed record AutomationsListModel(
    IReadOnlyList<AutomationSummary> Items,
    IReadOnlyList<AutomationVehicleRef> Vehicles,
    IReadOnlyList<AutomationPin> Pins,
    IReadOnlyList<AutomationHistoryEntry> History,
    AutomationHistorySummary? HistorySummary,
    bool Loading,
    bool HasError,
    string? ErrorDetail,
    AutomationStatusFilter StatusFilter,
    string Search)
{
    /// <summary>The initial model — the first load, no data yet.</summary>
    public static AutomationsListModel Initial { get; } = new(
        Items: Array.Empty<AutomationSummary>(),
        Vehicles: Array.Empty<AutomationVehicleRef>(),
        Pins: Array.Empty<AutomationPin>(),
        History: Array.Empty<AutomationHistoryEntry>(),
        HistorySummary: null,
        Loading: true,
        HasError: false,
        ErrorDetail: null,
        StatusFilter: AutomationStatusFilter.All,
        Search: string.Empty);
}

/// <summary>
/// The fully projected, render-ready view of the page for one input model — everything the WinUI view binds to,
/// with every visible literal already resolved through the i18n facade. Holds the header (title / subtitle /
/// import / create), the four stat tiles (the web <c>StatCard</c> bar — Total / Active / Disabled /
/// Auto-Disabled), the auto-disabled warning banner, the filters region (status select + search + count badge),
/// the collapsible preset gallery panel, the cards region with its four data-state flags, and the composed
/// activity-feed model. Pure data so every branch is asserted headlessly.
/// </summary>
public sealed record AutomationsListDisplay(
    AutomationsListState State,
    string Title,
    string Subtitle,
    string ImportLabel,
    string CreateLabel,
    string TotalLabel,
    string TotalValue,
    string ActiveLabel,
    string ActiveValue,
    string DisabledLabel,
    string DisabledValue,
    string AutoDisabledLabel,
    string AutoDisabledValue,
    bool ShowAutoDisabledWarning,
    string AutoDisabledWarning,
    string FilterStatusLabel,
    IReadOnlyList<AutomationFilterOption> StatusFilterOptions,
    string SelectedStatusFilter,
    string SearchHint,
    bool ShowFilterCount,
    string FilterCountText,
    string PresetsTitle,
    string PresetsHint,
    string PresetsExpandLabel,
    string PresetsCollapseLabel,
    string PresetsToggleAria,
    bool ShowLoading,
    string LoadingText,
    bool HasError,
    string ErrorText,
    string RetryLabel,
    bool ShowEmpty,
    string EmptyMessage,
    string EmptyCtaLabel,
    bool ShowNoMatch,
    string NoMatchMessage,
    string NoMatchCtaLabel,
    bool ShowCards,
    IReadOnlyList<AutomationCardModel> Cards,
    AutomationActivityFeedModel ActivityFeed,
    string ImportTypedEnvelopeRequired,
    string ImportFailedTemplate,
    string ImportUnknownError,
    string AutomationName);

/// <summary>
/// Pure projection from an <see cref="AutomationsListModel"/> to its <see cref="AutomationsListDisplay"/> — the
/// native port of the render logic in web/src/features/automations/pages/AutomationsListPage.tsx. Every visible
/// literal resolves through the i18n facade using the exact web key names; the stat bar mirrors <c>computeStats</c>,
/// the client-side status/search filter mirrors <c>filteredItems</c>, the pin ordering mirrors <c>sortedItems</c>,
/// and each surviving automation is projected into an <see cref="AutomationCardModel"/> (vehicle scope label + pin
/// flag resolved here). Every chrome string is resolved on every projection (visibility is gated by the returned
/// flags), so the i18n contract holds in every data state. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class AutomationsListProjection
{
    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the resolved web queries + URL state).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">The reference instant relative-time labels are measured against.</param>
    public static AutomationsListDisplay Project(AutomationsListModel model, ILocalizer localizer, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        // ── Header ───────────────────────────────────────────────────────────────────────────────────────
        string title = localizer.GetString("automations.title", "Automations");
        string subtitle = localizer.GetString(
            "automations.subtitle",
            "Automate vehicle actions with typed triggers, conditions, and action chains");
        string importLabel = localizer.GetString("automations.import", "Import");
        string createLabel = localizer.GetString("automations.create", "Create");

        // ── Stat bar (web computeStats) ────────────────────────────────────────────────────────────────────
        var stats = AutomationStatCounts.Compute(model.Items);
        string totalLabel = localizer.GetString("automations.stats.total", "Total");
        string activeLabel = localizer.GetString("automations.stats.active", "Active");
        string disabledLabel = localizer.GetString("automations.stats.disabled", "Disabled");
        string autoDisabledLabel = localizer.GetString("automations.stats.autoDisabled", "Auto-Disabled");

        // ── Auto-disabled warning banner (web stats.autoDisabled > 0) ────────────────────────────────────────
        string warningTemplate = localizer.GetString(
            "automations.autoDisabledWarning",
            "{0} automation(s) have been auto-disabled due to repeated failures.");
        string autoDisabledWarning = string.Format(CultureInfo.CurrentCulture, warningTemplate, stats.AutoDisabled);

        // ── Filters region ───────────────────────────────────────────────────────────────────────────────────
        string filterStatusLabel = localizer.GetString("automations.filterStatus", "Filter by status");
        string searchHint = localizer.GetString("automations.search", "Search automations...");
        var statusFilterOptions = new List<AutomationFilterOption>(4)
        {
            new("all", localizer.GetString("automations.filters.all", "All")),
            new("active", activeLabel),
            new("disabled", disabledLabel),
            new("auto-disabled", autoDisabledLabel),
        };

        // ── Preset gallery (web collapsible details) ─────────────────────────────────────────────────────────
        string presetsTitle = localizer.GetString("automations.presets.title", "Quick Start Templates");
        string presetsHint = localizer.GetString("automations.presets.hint", "One-click install");
        string presetsExpand = localizer.GetString("automations.presets.expand", "Click to expand");
        string presetsCollapse = localizer.GetString("automations.presets.collapse", "Click to collapse");
        string presetsToggleAria = localizer.GetString(
            "automations.presets.toggleAria",
            "Show or hide quick start templates");

        // ── Empty / no-match branches ───────────────────────────────────────────────────────────────────────
        string emptyMessage = localizer.GetString(
            "automations.empty",
            "No automations yet. Create a typed automation to get started!");
        string emptyCta = localizer.GetString("automations.empty.cta", "Create automation");
        string noMatchMessage = localizer.GetString("automations.noMatch", "No automations match your filters");
        string noMatchCta = localizer.GetString("automations.noMatch.cta", "Reset filters");

        // ── Import strings (web import handler) ──────────────────────────────────────────────────────────────
        string importTypedEnvelopeRequired = localizer.GetString(
            "automations.importTypedEnvelopeRequired",
            "Import a typed TeslaSync CTI automation export file. Legacy automation exports are rejected rather than translated.");
        string importFailedTemplate = localizer.GetString(
            "automations.importFailedWithReason",
            "Typed automation import failed: {0}");
        string importUnknownError = localizer.GetString("automations.importUnknownError", "Unknown error");

        // ── State chrome ─────────────────────────────────────────────────────────────────────────────────────
        string loadingText = localizer.GetString("common.loading", "Loading...");
        string loadFailed = localizer.GetString("error.loadFailed", "Failed to load data");
        string errorText = model.HasError && !string.IsNullOrEmpty(model.ErrorDetail)
            ? $"{loadFailed}: {model.ErrorDetail}"
            : loadFailed;
        string retryLabel = localizer.GetString("common.retry", "Retry");

        // ── Client-side filter + pin ordering (web filteredItems → sortedItems) ──────────────────────────────
        var filtered = Filter(model.Items, model.StatusFilter, model.Search);
        var sorted = SortByPins(filtered, model.Pins);

        var vehicleLookup = BuildVehicleLookup(model.Vehicles);
        var pinnedIds = BuildPinnedIdSet(model.Pins);
        var cards = new List<AutomationCardModel>(sorted.Count);
        foreach (var item in sorted)
        {
            cards.Add(ToCardModel(item, vehicleLookup, pinnedIds));
        }

        // ── State machine (loading > error > empty(no items) > success) ──────────────────────────────────────
        bool showLoading = model.Loading;
        bool showError = !model.Loading && model.HasError;
        bool noItemsAtAll = model.Items.Count == 0;
        bool showEmpty = !model.Loading && !model.HasError && noItemsAtAll;
        bool hasFilter = model.StatusFilter != AutomationStatusFilter.All || model.Search.Trim().Length > 0;
        bool showNoMatch = !model.Loading && !model.HasError && !noItemsAtAll && cards.Count == 0;
        bool showCards = !model.Loading && !model.HasError && cards.Count > 0;

        var state = SelectState(model, noItemsAtAll);

        // ── Filter count badge (web {filteredItems.length} / {items.length}) ─────────────────────────────────
        string filterCountText = string.Format(
            CultureInfo.CurrentCulture,
            "{0} / {1}",
            filtered.Count,
            model.Items.Count);

        // ── Activity feed (composed leaf; built from the history slice) ──────────────────────────────────────
        var activityFeed = new AutomationActivityFeedModel(
            Loading: model.Loading,
            History: model.History,
            Stats: model.HistorySummary,
            LiveEvents: Array.Empty<AutomationLiveEvent>(),
            Connection: AutomationFeedConnection.Connected);

        return new AutomationsListDisplay(
            State: state,
            Title: title,
            Subtitle: subtitle,
            ImportLabel: importLabel,
            CreateLabel: createLabel,
            TotalLabel: totalLabel,
            TotalValue: stats.Total.ToString(CultureInfo.CurrentCulture),
            ActiveLabel: activeLabel,
            ActiveValue: stats.Active.ToString(CultureInfo.CurrentCulture),
            DisabledLabel: disabledLabel,
            DisabledValue: stats.Disabled.ToString(CultureInfo.CurrentCulture),
            AutoDisabledLabel: autoDisabledLabel,
            AutoDisabledValue: stats.AutoDisabled.ToString(CultureInfo.CurrentCulture),
            ShowAutoDisabledWarning: stats.AutoDisabled > 0,
            AutoDisabledWarning: autoDisabledWarning,
            FilterStatusLabel: filterStatusLabel,
            StatusFilterOptions: statusFilterOptions,
            SelectedStatusFilter: AutomationStatusFilters.ToWire(model.StatusFilter),
            SearchHint: searchHint,
            ShowFilterCount: hasFilter,
            FilterCountText: filterCountText,
            PresetsTitle: presetsTitle,
            PresetsHint: presetsHint,
            PresetsExpandLabel: presetsExpand,
            PresetsCollapseLabel: presetsCollapse,
            PresetsToggleAria: presetsToggleAria,
            ShowLoading: showLoading,
            LoadingText: loadingText,
            HasError: showError,
            ErrorText: errorText,
            RetryLabel: retryLabel,
            ShowEmpty: showEmpty,
            EmptyMessage: emptyMessage,
            EmptyCtaLabel: emptyCta,
            ShowNoMatch: showNoMatch,
            NoMatchMessage: noMatchMessage,
            NoMatchCtaLabel: noMatchCta,
            ShowCards: showCards,
            Cards: cards,
            ActivityFeed: activityFeed,
            ImportTypedEnvelopeRequired: importTypedEnvelopeRequired,
            ImportFailedTemplate: importFailedTemplate,
            ImportUnknownError: importUnknownError,
            AutomationName: title);
    }

    /// <summary>Apply the web client-side status + search filter (web <c>filteredItems</c>).</summary>
    public static IReadOnlyList<AutomationSummary> Filter(
        IReadOnlyList<AutomationSummary> items,
        AutomationStatusFilter statusFilter,
        string search)
    {
        ArgumentNullException.ThrowIfNull(items);
        IEnumerable<AutomationSummary> result = items;

        if (statusFilter != AutomationStatusFilter.All)
        {
            result = result.Where(a => statusFilter switch
            {
                AutomationStatusFilter.Active => a.Enabled && !a.AutoDisabled,
                AutomationStatusFilter.Disabled => !a.Enabled && !a.AutoDisabled,
                AutomationStatusFilter.AutoDisabled => a.AutoDisabled,
                _ => true,
            });
        }

        string query = (search ?? string.Empty).Trim();
        if (query.Length > 0)
        {
            result = result.Where(a =>
                (a.Name ?? string.Empty).Contains(query, StringComparison.OrdinalIgnoreCase) ||
                (a.Description ?? string.Empty).Contains(query, StringComparison.OrdinalIgnoreCase));
        }

        return result.ToList();
    }

    /// <summary>Float pinned automations to the top in pin order, preserving the rest (web <c>sortedItems</c>).</summary>
    public static IReadOnlyList<AutomationSummary> SortByPins(
        IReadOnlyList<AutomationSummary> items,
        IReadOnlyList<AutomationPin> pins)
    {
        ArgumentNullException.ThrowIfNull(items);
        ArgumentNullException.ThrowIfNull(pins);
        if (pins.Count == 0)
        {
            return items;
        }

        var order = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var pin in pins)
        {
            order[pin.ItemId] = pin.Position;
        }

        // Stable sort: pinned (by position) first, then the original relative order for everything else.
        return items
            .Select((item, index) => (item, index))
            .OrderBy(t => order.TryGetValue(t.item.Id.ToString(CultureInfo.InvariantCulture), out var p) ? p : int.MaxValue)
            .ThenBy(t => t.index)
            .Select(t => t.item)
            .ToList();
    }

    /// <summary>Project one automation into the card model the <c>AutomationCard</c> renders (vehicle scope + pin flag resolved).</summary>
    public static AutomationCardModel ToCardModel(
        AutomationSummary item,
        IReadOnlyDictionary<long, string> vehicleLookup,
        IReadOnlySet<long> pinnedIds)
    {
        ArgumentNullException.ThrowIfNull(item);
        ArgumentNullException.ThrowIfNull(vehicleLookup);
        ArgumentNullException.ThrowIfNull(pinnedIds);

        string? vehicleName = item.VehicleId is { } vid && vehicleLookup.TryGetValue(vid, out var name)
            ? name
            : null;

        return new AutomationCardModel(
            Id: item.Id,
            Name: item.Name,
            Description: item.Description,
            Enabled: item.Enabled,
            AutoDisabled: item.AutoDisabled,
            AutoDisabledReason: item.AutoDisabledReason,
            LastTriggeredAt: ParseTimestamp(item.LastTriggeredAt),
            ExecutionCount: item.ExecutionCount,
            FailureCount: item.FailureCount,
            NextFireTime: ParseTimestamp(item.NextFireTime),
            Conflicts: item.Conflicts,
            IsFiring: false,
            VehicleName: vehicleName,
            IsPinned: pinnedIds.Contains(item.Id));
    }

    private static Dictionary<long, string> BuildVehicleLookup(IReadOnlyList<AutomationVehicleRef> vehicles)
    {
        var map = new Dictionary<long, string>();
        foreach (var v in vehicles)
        {
            map[v.Id] = v.DisplayName;
        }

        return map;
    }

    private static HashSet<long> BuildPinnedIdSet(IReadOnlyList<AutomationPin> pins)
    {
        var set = new HashSet<long>();
        foreach (var pin in pins)
        {
            if (long.TryParse(pin.ItemId, NumberStyles.Integer, CultureInfo.InvariantCulture, out var id))
            {
                set.Add(id);
            }
        }

        return set;
    }

    private static DateTimeOffset? ParseTimestamp(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            raw,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var value)
            ? value
            : null;
    }

    // Top-level state: loading dominates, then failure, then the no-automations empty branch, otherwise success.
    private static AutomationsListState SelectState(AutomationsListModel model, bool noItemsAtAll)
    {
        if (model.Loading)
        {
            return AutomationsListState.Loading;
        }

        if (model.HasError)
        {
            return AutomationsListState.Error;
        }

        return noItemsAtAll ? AutomationsListState.Empty : AutomationsListState.Success;
    }
}

/// <summary>
/// Canonical metadata for the <c>AutomationsListPage</c> feature surface — the native mirror of the web page at
/// <c>web/src/features/automations/pages/AutomationsListPage.tsx</c> (route <c>/automations</c>, nav name
/// <c>Automations</c>).
/// </summary>
public static class AutomationsListRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "AutomationsListPage";

    /// <summary>The navigation route name this page registers under (see RouteTable <c>Automations</c>).</summary>
    public const string RouteName = "Automations";

    /// <summary>The recent-execution history page size (web <c>useAutomationHistory(20)</c>).</summary>
    public const int HistoryLimit = 20;

    /// <summary>The localized page title (web <c>automations.title</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("automations.title", "Automations");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>AutomationsListPage</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never an automation name, vehicle, or id — so a
/// diagnostics line can never leak user content. Thread-safe.
/// </summary>
public sealed class AutomationsListDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public AutomationsListDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=AutomationsListPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={AutomationsListRegistration.Slug}");
    }
}

/// <summary>Small null-tolerant JSON readers shared by the automations-list parsers (UI-free, unit-tested).</summary>
internal static class AutomationsJson
{
    public static string? Str(JsonElement o, string name) =>
        o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    public static long? Long(JsonElement o, string name)
    {
        if (!o.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out var n) => n,
            JsonValueKind.Number when v.TryGetDouble(out var d) => (long)d,
            JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var s) => s,
            _ => null,
        };
    }

    public static int? Int(JsonElement o, string name)
    {
        var value = Long(o, name);
        return value is null ? null : (int)value.Value;
    }

    public static double? Double(JsonElement o, string name)
    {
        if (!o.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var d) => d,
            JsonValueKind.String when double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var s) => s,
            _ => null,
        };
    }

    public static bool? Bool(JsonElement o, string name)
    {
        if (!o.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => null,
        };
    }
}
