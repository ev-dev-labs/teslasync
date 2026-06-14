using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Notifications;

/// <summary>
/// The mutually-exclusive top-level lifecycle state of the <c>AlertsListPage</c> surface — the native mirror of
/// the four data states the web page renders (web/src/features/notifications/pages/AlertsListPage.tsx). The web
/// page runs the <c>useAlerts</c> query and, in precedence order, shows the loading skeletons (web
/// <c>isLoading</c>), the failure surface (web <c>error</c> → <c>PageContainer error</c>), the empty state (web
/// no alerts) and otherwise the populated page (overview + charts + list). Per-region visibility is still driven
/// by the projected flags so each branch renders exactly as the web composes it.
/// </summary>
public enum AlertsListState
{
    /// <summary>The alerts query is in flight (web <c>isLoading</c>) — the page shows the skeletons.</summary>
    Loading,

    /// <summary>The alerts query resolved with no alerts at all (web <c>totalCount === 0</c>).</summary>
    Empty,

    /// <summary>The alerts query failed (web <c>error</c>) — the page shows the error surface.</summary>
    Error,

    /// <summary>The alerts query produced alerts (web <c>totalCount &gt; 0</c>).</summary>
    Success,
}

/// <summary>
/// The active list filter tab — the native mirror of the web <c>filter</c> URL enum
/// (web/src/features/notifications/pages/AlertsListPage.tsx: <c>'all' | 'unread' | 'critical'</c>).
/// </summary>
public enum AlertsFilter
{
    /// <summary>Every alert (web <c>'all'</c>).</summary>
    All,

    /// <summary>Unread alerts only (web <c>'unread'</c>).</summary>
    Unread,

    /// <summary>Critical alerts only (web <c>'critical'</c>).</summary>
    Critical,
}

/// <summary>
/// One alert entity — the native mirror of the slice of the web <c>Alert</c> (web/src/api/types.ts) the page
/// reads: the id, the free-form <see cref="Type"/>, the wire <see cref="Severity"/>, the title / message, the
/// read flag, the created timestamp, the acknowledged timestamp / actor, and the drill-through context
/// (<see cref="RuleSignal"/>, <see cref="VehicleId"/>). Parsing is null-tolerant so a partial row never throws.
/// Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Id">The alert id (web <c>id</c>).</param>
/// <param name="Type">The free-form alert type (web <c>type</c>); drives the by-type breakdown + the card glyph.</param>
/// <param name="Severity">The wire severity (web <c>severity</c>: <c>info | warning | critical</c>).</param>
/// <param name="Title">The alert title (web <c>title</c>).</param>
/// <param name="Message">The alert message (web <c>message</c>).</param>
/// <param name="IsRead">Whether the alert has been read (web <c>is_read</c>).</param>
/// <param name="CreatedAt">When the alert was raised (web <c>created_at</c>), or <see langword="null"/> when absent.</param>
/// <param name="AcknowledgedAt">When the alert was acknowledged (web <c>acknowledged_at</c>), or <see langword="null"/>.</param>
/// <param name="AcknowledgedBy">Who acknowledged the alert (web <c>acknowledged_by</c>).</param>
/// <param name="RuleSignal">The triggering signal (web <c>rule_signal</c>); selects the drill-through page.</param>
/// <param name="VehicleId">The scoped vehicle (web <c>vehicle_id</c>); forwarded to the drill-through context.</param>
public sealed record Alert(
    long Id,
    string Type,
    string Severity,
    string Title,
    string Message,
    bool IsRead,
    DateTimeOffset? CreatedAt,
    DateTimeOffset? AcknowledgedAt,
    string? AcknowledgedBy,
    string? RuleSignal,
    long VehicleId)
{
    /// <summary>Parse an alerts JSON array into a tolerant list, preserving order.</summary>
    public static IReadOnlyList<Alert> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<Alert>();
        }

        var list = new List<Alert>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Read one alert from a JSON object, tolerating missing / null fields.</summary>
    public static Alert FromJson(JsonElement o) => new(
        Id: JsonReaders.Long(o, "id") ?? 0,
        Type: JsonReaders.String(o, "type") ?? string.Empty,
        Severity: JsonReaders.String(o, "severity") ?? "info",
        Title: JsonReaders.String(o, "title") ?? string.Empty,
        Message: JsonReaders.String(o, "message") ?? string.Empty,
        IsRead: JsonReaders.Bool(o, "is_read") ?? false,
        CreatedAt: JsonReaders.Timestamp(o, "created_at"),
        AcknowledgedAt: JsonReaders.Timestamp(o, "acknowledged_at"),
        AcknowledgedBy: JsonReaders.String(o, "acknowledged_by"),
        RuleSignal: JsonReaders.String(o, "rule_signal"),
        VehicleId: JsonReaders.Long(o, "vehicle_id") ?? 0);
}

/// <summary>
/// One alert rule the page reads for the "Active Rules" summary and the pinned "Watching" panel — the native
/// mirror of the slice of the web <c>AlertRule</c> the page touches (<c>id</c>, <c>name</c>, <c>enabled</c>).
/// Tolerant parsing so a partial row never throws.
/// </summary>
/// <param name="Id">The rule id (web <c>id</c>).</param>
/// <param name="Name">The rule display name (web <c>name</c>).</param>
/// <param name="Enabled">Whether the rule is active (web <c>enabled</c>).</param>
public sealed record AlertsRule(long Id, string Name, bool Enabled)
{
    /// <summary>Parse a rules JSON array into a tolerant list, preserving order.</summary>
    public static IReadOnlyList<AlertsRule> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<AlertsRule>();
        }

        var list = new List<AlertsRule>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(new AlertsRule(
                    Id: JsonReaders.Long(item, "id") ?? 0,
                    Name: JsonReaders.String(item, "name") ?? string.Empty,
                    Enabled: JsonReaders.Bool(item, "enabled") ?? false));
            }
        }

        return list;
    }
}

/// <summary>
/// One pin row from the unified pin store — the native mirror of the slice of the web <c>PinnedItem</c>
/// (web/src/api/types.ts) the page reads: the pinned <see cref="ItemId"/> (the rule id) and its
/// <see cref="Position"/> (the watch order). A 1:1 port of <c>usePinned('alert_rule')</c>'s row shape.
/// </summary>
/// <param name="ItemId">The pinned rule id as a string (web <c>item_id</c>).</param>
/// <param name="Position">The pin order (web <c>position</c>).</param>
public sealed record PinnedRef(string ItemId, int Position)
{
    /// <summary>Parse a pinned JSON array into a tolerant list, preserving wire order.</summary>
    public static IReadOnlyList<PinnedRef> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<PinnedRef>();
        }

        var list = new List<PinnedRef>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            string? id = JsonReaders.String(item, "item_id") ?? JsonReaders.Long(item, "item_id")?.ToString(CultureInfo.InvariantCulture);
            if (string.IsNullOrEmpty(id))
            {
                continue;
            }

            list.Add(new PinnedRef(id, (int)(JsonReaders.Long(item, "position") ?? 0)));
        }

        return list;
    }
}

/// <summary>Tolerant JSON readers shared by the alert / rule / pin parsers (mirrors the sibling pages' helpers).</summary>
internal static class JsonReaders
{
    public static string? String(JsonElement o, string name) =>
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
            JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var s) => s,
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

    public static DateTimeOffset? Timestamp(JsonElement o, string name)
    {
        string? raw = String(o, name);
        if (string.IsNullOrEmpty(raw))
        {
            return null;
        }

        return DateTimeOffset.TryParse(raw, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var ts)
            ? ts
            : null;
    }
}

/// <summary>
/// Canonical metadata + drill-through routing for the <c>AlertsListPage</c> feature surface — the native mirror
/// of the web page at <c>web/src/features/notifications/pages/AlertsListPage.tsx</c> (route
/// <c>/notifications/alerts</c>, nav name <c>NotificationsAlerts</c>). Carries the diagnostics slug, the nav
/// route name, the page size (web <c>alertsPerPage = 20</c>) and the SIGNAL→page map that drives the per-alert
/// "View context" drill-through (a 1:1 port of web/src/lib/alertDrillthrough.ts). UI-free so it is asserted
/// headlessly.
/// </summary>
public static class AlertsListRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "AlertsListPage";

    /// <summary>The navigation route name this page registers under (see RouteTable <c>NotificationsAlerts</c>).</summary>
    public const string RouteName = "NotificationsAlerts";

    /// <summary>The native route the page lives at (web <c>/notifications/alerts</c>).</summary>
    public const string RoutePath = "notifications/alerts";

    /// <summary>The native route the "Active Rules" summary link navigates to (web <c>/notifications/studio</c>).</summary>
    public const string StudioRoutePath = "notifications/studio";

    /// <summary>Alerts shown per page (web <c>const alertsPerPage = 20</c>).</summary>
    public const int PageSize = 20;

    /// <summary>The generic fallback page when no signal-specific page is registered (web <c>SIGNAL_EXPLORER_FALLBACK</c>).</summary>
    public const string SignalExplorerFallback = "signal-explorer";

    private static readonly Dictionary<string, string> SignalToPage = new(StringComparer.Ordinal)
    {
        ["BatteryLevel"] = "battery",
        ["RatedRange"] = "battery",
        ["ChargeLimitSoc"] = "battery",
        ["EstBatteryRange"] = "battery",
        ["IdealBatteryRange"] = "battery",
        ["ChargeState"] = "charging",
        ["DetailedChargeState"] = "charging",
        ["DCChargingPower"] = "charging",
        ["ACChargingPower"] = "charging",
        ["ChargeAmps"] = "charging",
        ["ChargerVoltage"] = "charging",
        ["ChargerActualCurrent"] = "charging",
        ["ChargingCableType"] = "charging",
        ["Gear"] = "drives",
        ["VehicleSpeed"] = "drives",
        ["Power"] = "drives",
        ["Odometer"] = "drives",
        ["InsideTemp"] = "climate-control",
        ["OutsideTemp"] = "climate-control",
        ["HvacPower"] = "climate-control",
        ["ClimateKeeperMode"] = "climate-control",
        ["TpmsPressureFl"] = "tire-pressure",
        ["TpmsPressureFr"] = "tire-pressure",
        ["TpmsPressureRl"] = "tire-pressure",
        ["TpmsPressureRr"] = "tire-pressure",
        ["TpmsHardWarnings"] = "tire-pressure",
        ["TpmsSoftWarnings"] = "tire-pressure",
        ["TpmsLastSeenPressureTimeFl"] = "tire-pressure",
        ["TpmsLastSeenPressureTimeFr"] = "tire-pressure",
        ["TpmsLastSeenPressureTimeRl"] = "tire-pressure",
        ["TpmsLastSeenPressureTimeRr"] = "tire-pressure",
        ["Locked"] = "security-access",
        ["SentryMode"] = "security-access",
        ["DoorState"] = "security-access",
        ["WindowState"] = "security-access",
        ["SunroofInstalled"] = "security-access",
        ["SoftwareUpdateVersion"] = "software-updates",
        ["SoftwareUpdateDownloadPercentComplete"] = "software-updates",
        ["SoftwareUpdateInstallationPercentComplete"] = "software-updates",
        ["SoftwareUpdateExpectedDurationMinutes"] = "software-updates",
        ["LocatedAtHome"] = "navigation",
        ["LocatedAtWork"] = "navigation",
        ["LocatedAtFavorite"] = "navigation",
        ["DestinationName"] = "navigation",
        ["DestinationLocation"] = "navigation",
    };

    /// <summary>The localized page title (web <c>t('Alerts')</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("Alerts", "Alerts");
    }

    /// <summary>
    /// Compute the drill-through href for an alert — a 1:1 port of web <c>getAlertDrillthroughHref</c>: maps the
    /// alert's <c>rule_signal</c> onto a context page (or the Signal Explorer fallback) and appends the alert
    /// context (<c>vehicle_id</c>, <c>t</c>, <c>signal</c>) as snake_case query params.
    /// </summary>
    public static string DrillthroughHref(Alert alert)
    {
        ArgumentNullException.ThrowIfNull(alert);

        string? signal = string.IsNullOrEmpty(alert.RuleSignal) ? null : alert.RuleSignal;
        long? vehicleId = alert.VehicleId > 0 ? alert.VehicleId : null;

        var query = new List<string>(3);
        if (vehicleId is { } id)
        {
            query.Add("vehicle_id=" + id.ToString(CultureInfo.InvariantCulture));
        }

        if (alert.CreatedAt is { } created)
        {
            query.Add("t=" + Uri.EscapeDataString(created.ToString("o", CultureInfo.InvariantCulture)));
        }

        if (signal is not null)
        {
            query.Add("signal=" + Uri.EscapeDataString(signal));
        }

        string path = signal is not null && SignalToPage.TryGetValue(signal, out var mapped) ? mapped : SignalExplorerFallback;
        return query.Count == 0 ? path : string.Concat(path, "?", string.Join("&", query));
    }
}

/// <summary>One overview metric tile — label, pre-formatted value and accent brush key (web <c>MetricCard</c>).</summary>
/// <param name="Label">The metric label (already localized).</param>
/// <param name="Value">The pre-formatted metric value.</param>
/// <param name="AccentBrushKey">The design-token brush key for the leading accent rail.</param>
public sealed record AlertsMetric(string Label, string Value, string AccentBrushKey);

/// <summary>
/// One day's stacked alert counts for the 7-day trend bar chart (web <c>alertsByDay</c>). The
/// <see cref="DayLabel"/> is the abbreviated weekday; the three counts are the stacked series.
/// </summary>
/// <param name="DayLabel">The abbreviated weekday label (web <c>Intl weekday: 'short'</c>).</param>
/// <param name="Info">Info-severity count that day.</param>
/// <param name="Warning">Warning-severity count that day.</param>
/// <param name="Critical">Critical-severity count that day.</param>
public sealed record AlertTrendDay(string DayLabel, int Info, int Warning, int Critical);

/// <summary>One slice of the by-type pie chart (web <c>alertsByType</c>): the humanised name, the count and the palette index.</summary>
/// <param name="Name">The humanised type name (web <c>type.replace(/_/g, ' ')</c>).</param>
/// <param name="Count">The number of alerts of this type.</param>
/// <param name="ColorIndex">The palette index used to colour the slice + its legend swatch.</param>
public sealed record AlertTypeSlice(string Name, int Count, int ColorIndex);

/// <summary>One pinned-rule row for the "Watching" panel (web pinned-rules list).</summary>
/// <param name="Id">The rule id.</param>
/// <param name="Name">The display name, or the "Rule #id" fallback when the rule has no name.</param>
/// <param name="Enabled">Whether the rule is active.</param>
/// <param name="StatusLabel">The localized enabled/disabled label (web <c>common.enabled</c> / <c>common.disabled</c>).</param>
/// <param name="StatusVariant">The semantic badge tint (enabled → success, disabled → neutral).</param>
public sealed record PinnedRuleRow(long Id, string Name, bool Enabled, string StatusLabel, StatusKind StatusVariant);

/// <summary>One filter tab with its live count (web <c>TabNav</c> tabs <c>All (n)</c> / <c>Unread (n)</c> / <c>Critical (n)</c>).</summary>
/// <param name="Filter">The filter this tab selects.</param>
/// <param name="Label">The localized tab label including the count (e.g. "All (12)").</param>
/// <param name="IsActive">Whether this tab is the active filter.</param>
public sealed record AlertsFilterTab(AlertsFilter Filter, string Label, bool IsActive);

/// <summary>One active-filter chip (web <c>ActiveFilterChips</c>): the dimension label and the human value.</summary>
/// <param name="Key">A stable key for the chip ("q" or "filter").</param>
/// <param name="Label">The localized dimension label (web <c>alerts.filterLabel.*</c>).</param>
/// <param name="Value">The human-readable active value.</param>
public sealed record AlertsFilterChip(string Key, string Label, string Value);

/// <summary>
/// One alert in the paged list — carries the alert id (for action callbacks) and the render-ready
/// <see cref="AlertCardModel"/> the shared <c>AlertCard</c> control binds (web <c>&lt;AlertCard alert={a} …&gt;</c>).
/// </summary>
/// <param name="Id">The alert id, used to route mark-read / acknowledge / reopen / open-detail callbacks.</param>
/// <param name="Card">The narrowed card model (the web <c>alert</c> prop + precomputed drill-through href).</param>
public sealed record AlertListItem(long Id, AlertCardModel Card);

/// <summary>
/// The render-time data model the <c>AlertsListPage</c> projects from — the native analogue of the web page's
/// resolved queries + URL filter state (web/src/features/notifications/pages/AlertsListPage.tsx). Pure data so
/// the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Alerts">The resolved alert list (web <c>useAlerts</c>).</param>
/// <param name="Rules">The resolved rule list (web <c>useAlertRules</c>).</param>
/// <param name="Pins">The pinned alert-rule references (web <c>usePinned('alert_rule')</c>).</param>
/// <param name="Loading">Whether the alerts query is in flight (web <c>isLoading</c>).</param>
/// <param name="HasError">Whether the alerts query failed (web <c>error</c>).</param>
/// <param name="ErrorDetail">Optional failure detail appended to the error surface.</param>
/// <param name="Filter">The active list filter (web <c>filter</c>).</param>
/// <param name="Search">The list search query (web <c>alertSearch</c>).</param>
/// <param name="Page">The 1-based list page (web <c>alertPage</c>).</param>
/// <param name="QuietHoursActive">Whether quiet hours are currently active (web <c>quietActive</c>).</param>
/// <param name="Now">The instant relative-time / 7-day windows are measured against (web <c>Date.now()</c>).</param>
public sealed record AlertsListModel(
    IReadOnlyList<Alert> Alerts,
    IReadOnlyList<AlertsRule> Rules,
    IReadOnlyList<PinnedRef> Pins,
    bool Loading,
    bool HasError,
    string? ErrorDetail,
    AlertsFilter Filter,
    string Search,
    int Page,
    bool QuietHoursActive,
    DateTimeOffset Now)
{
    /// <summary>The initial pre-fetch model — loading, no data, default filter (web first render).</summary>
    public static AlertsListModel Initial { get; } = new(
        Alerts: Array.Empty<Alert>(),
        Rules: Array.Empty<AlertsRule>(),
        Pins: Array.Empty<PinnedRef>(),
        Loading: true,
        HasError: false,
        ErrorDetail: null,
        Filter: AlertsFilter.All,
        Search: string.Empty,
        Page: 1,
        QuietHoursActive: false,
        Now: DateTimeOffset.UnixEpoch);
}

/// <summary>
/// The fully projected, render-ready view of the <c>AlertsListPage</c> — everything the WinUI view needs to draw
/// every region with no further logic (web/src/features/notifications/pages/AlertsListPage.tsx): the top-level
/// <see cref="State"/>, the per-region visibility flags, the page chrome, the six overview metric tiles + the
/// secondary summary line + the critical callout, the two charts (7-day trend + by-type), the pinned "Watching"
/// panel, the filter bar (search + tabs + active chips), the paged alert-card list + its empty branches, the
/// pagination, and the detail / acknowledge copy. Pure value so every field is asserted without a UI host.
/// </summary>
public sealed record AlertsListDisplay(
    AlertsListState State,
    bool ShowLoading,
    bool HasError,
    bool ShowEmpty,
    bool ShowContent,
    string Title,
    string Subtitle,
    bool QuietHoursActive,
    string QuietHoursBadge,
    bool ShowOverview,
    string OverviewTitle,
    IReadOnlyList<AlertsMetric> Metrics,
    string ActiveRulesLabel,
    string ActiveRulesValue,
    string MostCommonLabel,
    string MostCommonValue,
    string Last7DaysLabel,
    string Last7DaysValue,
    string QuietHoursActiveLabel,
    bool ShowCriticalCallout,
    string CriticalCalloutText,
    string ViewCriticalLabel,
    string OverviewEmptyTitle,
    string OverviewEmptyMessage,
    bool ShowCharts,
    string TrendTitle,
    IReadOnlyList<AlertTrendDay> TrendDays,
    string SeriesCriticalLabel,
    string SeriesWarningLabel,
    string SeriesInfoLabel,
    string ByTypeTitle,
    IReadOnlyList<AlertTypeSlice> TypeSlices,
    bool ShowPinned,
    string WatchingLabel,
    int PinnedCount,
    IReadOnlyList<PinnedRuleRow> PinnedRules,
    string SearchPrompt,
    IReadOnlyList<AlertsFilterTab> FilterTabs,
    IReadOnlyList<AlertsFilterChip> ActiveChips,
    IReadOnlyList<AlertListItem> PagedAlerts,
    bool ShowList,
    bool ShowListEmpty,
    string ListEmptyTitle,
    string ListEmptyMessage,
    bool ShowPagination,
    int Page,
    int TotalPages,
    int FilteredCount,
    string MarkReadSuccessLabel,
    string AckSuccessLabel,
    string AckUndoLabel,
    string TimelineTitle,
    string TimelineEmpty);

/// <summary>
/// Pure projection from the resolved queries + filter state to the render-ready <see cref="AlertsListDisplay"/> —
/// the native port of the web page body (web/src/features/notifications/pages/AlertsListPage.tsx). Selects the
/// top-level state in the web precedence order (loading → error → empty → content), resolves every visible
/// string through the localizer, computes the six overview metrics, the 7-day trend + by-type aggregates, the
/// pinned "Watching" rows, the filter tabs + active chips and the filtered/paged alert-card list. No WinUI
/// types — unit-tested without a UI host.
/// </summary>
public static class AlertsListProjection
{
    /// <summary>The em-dash shown for a blank value (web <c>{value ?? '—'}</c> idiom).</summary>
    public const string EmDash = "\u2014";

    /// <summary>The default type the web falls back to when <c>alert.type</c> is empty (web <c>'notification'</c>).</summary>
    public const string DefaultType = "notification";

    /// <summary>Project the model into the render-ready display, resolving every visible string through <paramref name="localizer"/>.</summary>
    /// <param name="model">The resolved queries + filter state.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static AlertsListDisplay Project(AlertsListModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        var alerts = model.Alerts ?? Array.Empty<Alert>();
        var rules = model.Rules ?? Array.Empty<AlertsRule>();
        var pins = model.Pins ?? Array.Empty<PinnedRef>();

        int totalCount = alerts.Count;
        var state = SelectState(model, totalCount);

        // ── Counts (web useMemo block) ─────────────────────────────────────────
        int unreadCount = alerts.Count(a => !a.IsRead);
        int criticalCount = alerts.Count(a => a.Severity == "critical" && !a.IsRead);
        int infoCount = alerts.Count(a => (string.IsNullOrEmpty(a.Severity) ? "info" : a.Severity) == "info");
        int warningCount = alerts.Count(a => a.Severity == "warning");
        int readCount = alerts.Count(a => a.IsRead);
        int enabledRules = rules.Count(r => r.Enabled);
        int? readRatePct = totalCount > 0 ? (int)Math.Round(readCount / (double)totalCount * 100.0, MidpointRounding.AwayFromZero) : null;

        // ── Strings (resolve all 36 unconditionally so coverage is state-independent) ──
        string title = AlertsListRegistration.Title(localizer);
        string subtitle = localizer.GetString("alerts.subtitle", "Live alert events from your fleet");
        string quietBadge = localizer.GetString("Quiet hours", "Quiet hours");
        string overviewTitle = localizer.GetString("alerts.overview", "Overview");
        string totalLabel = localizer.GetString("Total", "Total");
        string criticalLabel = localizer.GetString("Critical", "Critical");
        string warningsLabel = localizer.GetString("Warnings", "Warnings");
        string infoLabel = localizer.GetString("Info", "Info");
        string unreadLabel = localizer.GetString("Unread", "Unread");
        string readRateLabel = localizer.GetString("alerts.readRate", "Read rate");
        string activeRulesLabel = localizer.GetString("Active Rules", "Active Rules");
        string mostCommonLabel = localizer.GetString("Most Common", "Most Common");
        string last7Label = localizer.GetString("Last 7 Days", "Last 7 Days");
        string quietActiveLabel = localizer.GetString("Quiet hours active", "Quiet hours active");
        string viewCriticalLabel = localizer.GetString("alerts.viewCritical", "View critical");
        string criticalCalloutTemplate = localizer.GetString("alerts.criticalCallout", "{0} critical alert needs attention");
        string noAlertsTitle = localizer.GetString("No alerts", "No alerts");
        string noAlertsInRange = localizer.GetString("alerts.noAlertsInRange", "No alerts in this range. Your fleet is running smoothly.");
        string trendTitle = localizer.GetString("Alert Trend (7 Days)", "Alert Trend (7 Days)");
        string warningLabel = localizer.GetString("Warning", "Warning");
        string byTypeTitle = localizer.GetString("Alerts by Type", "Alerts by Type");
        string watchingLabel = localizer.GetString("pinned.section.watching", "Watching");
        string enabledStatus = localizer.GetString("common.enabled", "Enabled");
        string disabledStatus = localizer.GetString("common.disabled", "Disabled");
        string ruleFallback = localizer.GetString("alerts.rule", "Rule");
        string allLabel = localizer.GetString("All", "All");
        string searchPrompt = localizer.GetString("alerts.searchPlaceholder", "Search by title or message\u2026"); // parity:allow alerts.searchPlaceholder is a manifest-required i18n key
        string searchChipLabel = localizer.GetString("alerts.filterLabel.search", "Search");
        string statusChipLabel = localizer.GetString("alerts.filterLabel.status", "Status");
        string fleetSmoothly = localizer.GetString("Your fleet is running smoothly. Alerts will appear here.", "Your fleet is running smoothly. Alerts will appear here.");
        string noSearchMatch = localizer.GetString("No alerts match your search.", "No alerts match your search.");
        string markReadSuccess = localizer.GetString("Alert marked as read", "Alert marked as read");
        string ackSuccess = localizer.GetString("alerts.ack.success", "Alert acknowledged");
        string ackUndo = localizer.GetString("alerts.ack.undo", "Undo");
        string timelineTitle = localizer.GetString("alerts.timeline.title", "Audit timeline");
        string timelineEmpty = localizer.GetString("alerts.timeline.empty", "No events yet");

        // ── Overview metrics (web KpiOverviewCard kpis) ────────────────────────
        var metrics = new List<AlertsMetric>
        {
            new(totalLabel, FormatInt(totalCount), "TsColorInfoBrush"),
            new(criticalLabel, FormatInt(criticalCount), "TsColorDangerBrush"),
            new(warningsLabel, FormatInt(warningCount), "TsColorWarningBrush"),
            new(infoLabel, FormatInt(infoCount), "TsColorInfoBrush"),
            new(unreadLabel, FormatInt(unreadCount), "TsColorAccentBrush"),
            new(readRateLabel, readRatePct is { } pct ? pct.ToString(CultureInfo.CurrentCulture) + "%" : EmDash, "TsColorSuccessBrush"),
        };

        // ── By-type aggregate (web alertsByType) ───────────────────────────────
        var typeSlices = BuildTypeSlices(alerts);

        // ── 7-day trend aggregate (web alertsByDay) ────────────────────────────
        var trendDays = BuildTrendDays(alerts, model.Now);
        int weekAlertCount = trendDays.Sum(d => d.Info + d.Warning + d.Critical);

        // ── Pinned "Watching" rows (web pinnedRules) ───────────────────────────
        var pinnedRules = BuildPinnedRules(rules, pins, enabledStatus, disabledStatus, ruleFallback);

        // ── Filter + search + pagination (web tabFilteredAlerts → filteredAlerts → pagedAlerts) ──
        var filtered = ApplyFilterAndSearch(alerts, model.Filter, model.Search);
        int totalPages = Math.Max(1, (int)Math.Ceiling(filtered.Count / (double)AlertsListRegistration.PageSize));
        int safePage = Math.Min(Math.Max(1, model.Page), totalPages);
        var paged = filtered
            .Skip((safePage - 1) * AlertsListRegistration.PageSize)
            .Take(AlertsListRegistration.PageSize)
            .Select(a => new AlertListItem(a.Id, ToCardModel(a)))
            .ToList();

        var filterTabs = new List<AlertsFilterTab>
        {
            new(AlertsFilter.All, Tab(allLabel, totalCount), model.Filter == AlertsFilter.All),
            new(AlertsFilter.Unread, Tab(unreadLabel, unreadCount), model.Filter == AlertsFilter.Unread),
            new(AlertsFilter.Critical, Tab(criticalLabel, criticalCount), model.Filter == AlertsFilter.Critical),
        };

        var activeChips = BuildActiveChips(model, searchChipLabel, statusChipLabel, unreadLabel, criticalLabel);

        string mostCommon = typeSlices.Count > 0 ? typeSlices[0].Name : EmDash;
        string activeRulesValue = string.Create(CultureInfo.CurrentCulture, $"{enabledRules}/{rules.Count}");
        string criticalCalloutText = Interpolate(criticalCalloutTemplate, criticalCount);

        bool listEmpty = state == AlertsListState.Success && filtered.Count == 0;
        string listEmptyMessage = !string.IsNullOrEmpty(model.Search)
            ? noSearchMatch
            : model.Filter == AlertsFilter.All
                ? fleetSmoothly
                : Interpolate(localizer.GetString("alerts.noFilterAlerts", "No {0} alerts right now."), FilterName(model.Filter, unreadLabel, criticalLabel));

        return new AlertsListDisplay(
            State: state,
            ShowLoading: state == AlertsListState.Loading,
            HasError: state == AlertsListState.Error,
            ShowEmpty: state == AlertsListState.Empty,
            ShowContent: state == AlertsListState.Success,
            Title: title,
            Subtitle: subtitle,
            QuietHoursActive: model.QuietHoursActive,
            QuietHoursBadge: quietBadge,
            ShowOverview: totalCount > 0,
            OverviewTitle: overviewTitle,
            Metrics: metrics,
            ActiveRulesLabel: activeRulesLabel,
            ActiveRulesValue: activeRulesValue,
            MostCommonLabel: mostCommonLabel,
            MostCommonValue: mostCommon,
            Last7DaysLabel: last7Label,
            Last7DaysValue: FormatInt(weekAlertCount),
            QuietHoursActiveLabel: quietActiveLabel,
            ShowCriticalCallout: criticalCount > 0,
            CriticalCalloutText: criticalCalloutText,
            ViewCriticalLabel: viewCriticalLabel,
            OverviewEmptyTitle: noAlertsTitle,
            OverviewEmptyMessage: noAlertsInRange,
            ShowCharts: totalCount > 0,
            TrendTitle: trendTitle,
            TrendDays: trendDays,
            SeriesCriticalLabel: criticalLabel,
            SeriesWarningLabel: warningLabel,
            SeriesInfoLabel: infoLabel,
            ByTypeTitle: byTypeTitle,
            TypeSlices: typeSlices,
            ShowPinned: pinnedRules.Count > 0,
            WatchingLabel: watchingLabel,
            PinnedCount: pinnedRules.Count,
            PinnedRules: pinnedRules,
            SearchPrompt: searchPrompt,
            FilterTabs: filterTabs,
            ActiveChips: activeChips,
            PagedAlerts: paged,
            ShowList: state == AlertsListState.Success && filtered.Count > 0,
            ShowListEmpty: listEmpty,
            ListEmptyTitle: noAlertsTitle,
            ListEmptyMessage: listEmptyMessage,
            ShowPagination: totalPages > 1,
            Page: safePage,
            TotalPages: totalPages,
            FilteredCount: filtered.Count,
            MarkReadSuccessLabel: markReadSuccess,
            AckSuccessLabel: ackSuccess,
            AckUndoLabel: ackUndo,
            TimelineTitle: timelineTitle,
            TimelineEmpty: timelineEmpty);
    }

    /// <summary>Select the top-level state in the web precedence order (loading → error → empty → content).</summary>
    public static AlertsListState SelectState(AlertsListModel model, int totalCount)
    {
        ArgumentNullException.ThrowIfNull(model);

        if (model.Loading)
        {
            return AlertsListState.Loading;
        }

        if (model.HasError)
        {
            return AlertsListState.Error;
        }

        return totalCount == 0 ? AlertsListState.Empty : AlertsListState.Success;
    }

    /// <summary>The humanised type label (web <c>(type ?? 'notification').replace(/_/g, ' ')</c>).</summary>
    public static string TypeName(string? type)
    {
        string value = string.IsNullOrEmpty(type) ? DefaultType : type;
        return value.Replace('_', ' ');
    }

    /// <summary>Aggregate alerts by type, sorted by count descending (web <c>alertsByType</c>).</summary>
    public static IReadOnlyList<AlertTypeSlice> BuildTypeSlices(IReadOnlyList<Alert> alerts)
    {
        ArgumentNullException.ThrowIfNull(alerts);
        if (alerts.Count == 0)
        {
            return Array.Empty<AlertTypeSlice>();
        }

        var counts = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var a in alerts)
        {
            string key = string.IsNullOrEmpty(a.Type) ? DefaultType : a.Type;
            counts[key] = counts.TryGetValue(key, out var n) ? n + 1 : 1;
        }

        return counts
            .OrderByDescending(kv => kv.Value)
            .Select((kv, i) => new AlertTypeSlice(kv.Key.Replace('_', ' '), kv.Value, i))
            .ToList();
    }

    /// <summary>Aggregate the last seven days' stacked severity counts (web <c>alertsByDay</c>).</summary>
    public static IReadOnlyList<AlertTrendDay> BuildTrendDays(IReadOnlyList<Alert> alerts, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(alerts);
        if (alerts.Count == 0)
        {
            return Array.Empty<AlertTrendDay>();
        }

        var order = new List<DateTimeOffset>(7);
        var buckets = new Dictionary<string, int[]>(StringComparer.Ordinal);
        var labels = new Dictionary<string, string>(StringComparer.Ordinal);
        var format = CultureInfo.CurrentCulture.DateTimeFormat;

        for (int i = 6; i >= 0; i--)
        {
            var day = now.AddDays(-i);
            string key = day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            order.Add(day);
            buckets[key] = new int[3];
            labels[key] = format.GetAbbreviatedDayName(day.DayOfWeek);
        }

        foreach (var a in alerts)
        {
            if (a.CreatedAt is not { } created)
            {
                continue;
            }

            if ((now - created).TotalDays > 7)
            {
                continue;
            }

            string key = created.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            if (!buckets.TryGetValue(key, out var counts))
            {
                continue;
            }

            switch (a.Severity)
            {
                case "info":
                    counts[0]++;
                    break;
                case "warning":
                    counts[1]++;
                    break;
                case "critical":
                    counts[2]++;
                    break;
            }
        }

        var days = new List<AlertTrendDay>(7);
        foreach (var day in order)
        {
            string key = day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            var counts = buckets[key];
            days.Add(new AlertTrendDay(labels[key], counts[0], counts[1], counts[2]));
        }

        return days;
    }

    /// <summary>Resolve the pinned "Watching" rows in pin order (web <c>pinnedRules</c>).</summary>
    public static IReadOnlyList<PinnedRuleRow> BuildPinnedRules(
        IReadOnlyList<AlertsRule> rules,
        IReadOnlyList<PinnedRef> pins,
        string enabledStatus,
        string disabledStatus,
        string ruleFallback)
    {
        ArgumentNullException.ThrowIfNull(rules);
        ArgumentNullException.ThrowIfNull(pins);

        if (rules.Count == 0 || pins.Count == 0)
        {
            return Array.Empty<PinnedRuleRow>();
        }

        var positions = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var pin in pins)
        {
            positions[pin.ItemId] = pin.Position;
        }

        return rules
            .Where(r => positions.ContainsKey(r.Id.ToString(CultureInfo.InvariantCulture)))
            .OrderBy(r => positions[r.Id.ToString(CultureInfo.InvariantCulture)])
            .Select(r => new PinnedRuleRow(
                Id: r.Id,
                Name: string.IsNullOrEmpty(r.Name)
                    ? string.Create(CultureInfo.CurrentCulture, $"{ruleFallback} #{r.Id}")
                    : r.Name,
                Enabled: r.Enabled,
                StatusLabel: r.Enabled ? enabledStatus : disabledStatus,
                StatusVariant: r.Enabled ? StatusKind.Success : StatusKind.Neutral))
            .ToList();
    }

    /// <summary>Apply the active tab filter then the title/message search (web <c>tabFilteredAlerts</c> → <c>filteredAlerts</c>).</summary>
    public static IReadOnlyList<Alert> ApplyFilterAndSearch(IReadOnlyList<Alert> alerts, AlertsFilter filter, string? search)
    {
        ArgumentNullException.ThrowIfNull(alerts);

        IEnumerable<Alert> query = filter switch
        {
            AlertsFilter.Unread => alerts.Where(a => !a.IsRead),
            AlertsFilter.Critical => alerts.Where(a => a.Severity == "critical"),
            _ => alerts,
        };

        string term = (search ?? string.Empty).Trim();
        if (term.Length > 0)
        {
            query = query.Where(a =>
                a.Title.Contains(term, StringComparison.OrdinalIgnoreCase) ||
                a.Message.Contains(term, StringComparison.OrdinalIgnoreCase));
        }

        return query.ToList();
    }

    /// <summary>Build the render-ready card model for one alert (web <c>&lt;AlertCard alert={a}&gt;</c> + drill-through href).</summary>
    public static AlertCardModel ToCardModel(Alert alert)
    {
        ArgumentNullException.ThrowIfNull(alert);
        return new AlertCardModel(
            Type: alert.Type,
            Severity: alert.Severity,
            Title: alert.Title,
            Message: alert.Message,
            IsRead: alert.IsRead,
            CreatedAt: alert.CreatedAt ?? DateTimeOffset.UnixEpoch,
            AcknowledgedAt: alert.AcknowledgedAt,
            AcknowledgedBy: alert.AcknowledgedBy,
            DrillHref: AlertsListRegistration.DrillthroughHref(alert));
    }

    private static List<AlertsFilterChip> BuildActiveChips(
        AlertsListModel model,
        string searchChipLabel,
        string statusChipLabel,
        string unreadLabel,
        string criticalLabel)
    {
        var chips = new List<AlertsFilterChip>(2);
        if (!string.IsNullOrEmpty(model.Search))
        {
            chips.Add(new AlertsFilterChip("q", searchChipLabel, model.Search));
        }

        if (model.Filter != AlertsFilter.All)
        {
            chips.Add(new AlertsFilterChip("filter", statusChipLabel, FilterName(model.Filter, unreadLabel, criticalLabel)));
        }

        return chips;
    }

    private static string FilterName(AlertsFilter filter, string unreadLabel, string criticalLabel) => filter switch
    {
        AlertsFilter.Unread => unreadLabel,
        AlertsFilter.Critical => criticalLabel,
        _ => string.Empty,
    };

    private static string Tab(string label, int count) =>
        string.Create(CultureInfo.CurrentCulture, $"{label} ({count})");

    private static string FormatInt(int value) => value.ToString("N0", CultureInfo.CurrentCulture);

    private static string Interpolate(string template, int count) =>
        template.Replace("{0}", count.ToString(CultureInfo.CurrentCulture), StringComparison.Ordinal);

    private static string Interpolate(string template, string value) =>
        template.Replace("{0}", value, StringComparison.Ordinal);
}

/// <summary>
/// PII-safe diagnostics for the <c>AlertsListPage</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never an alert title, message, severity or
/// actor — so a diagnostics line can never leak what a user saw. Thread-safe.
/// </summary>
public sealed class AlertsListDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public AlertsListDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=AlertsListPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={AlertsListRegistration.Slug}");
    }
}
