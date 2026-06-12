using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Analytics;

/// <summary>
/// The mutually-exclusive lifecycle state of the <c>TimelinePage</c> surface — the native mirror of the four data
/// states the web page renders (web/src/features/analytics/pages/TimelinePage.tsx). The web page runs
/// <c>useVehicles</c> plus the vehicle-states <c>timeline</c> and <c>summary</c> queries and renders, in precedence
/// order, a failure banner (web <c>anyError</c>), then a full-page loading scaffold (web
/// <c>isLoading &amp;&amp; transitions.length === 0</c>), otherwise the always-present panels whose per-region empty
/// states surface when a vehicle has no recent activity. This enum is the top-level summary the ledger/Narrator key
/// off; per-region visibility is still driven by the projected flags.
/// </summary>
public enum TimelineState
{
    /// <summary>The first load is in flight with no rows yet (web full-page loading).</summary>
    Loading,

    /// <summary>Resolved with no transitions and no state summary (web per-region empty states).</summary>
    Empty,

    /// <summary>A query failed (web <c>anyError</c>) — the failure banner is shown above the panels.</summary>
    Error,

    /// <summary>At least one data source produced rows.</summary>
    Success,
}

/// <summary>The render sub-state of a single data-bound panel (chart / distribution).</summary>
public enum TimelinePanelMode
{
    /// <summary>The panel renders its data (bar / chart / table rows).</summary>
    Content,

    /// <summary>The backing query is in flight — the panel shows a shimmer.</summary>
    Loading,

    /// <summary>The query resolved empty — the panel shows its empty state.</summary>
    Empty,
}

/// <summary>
/// One fleet vehicle for the picker — the native mirror of the web <c>useVehicles</c> row (web/src/api/types.ts).
/// Field names mirror the Go API's snake_case JSON tags; parsing is null-tolerant. Pure data — no WinUI types.
/// </summary>
public sealed record TimelineVehicle(long Id, string? DisplayName, string? Vin)
{
    /// <summary>The picker label (web <c>display_name || vin</c>).</summary>
    public string Label =>
        !string.IsNullOrWhiteSpace(DisplayName) ? DisplayName! :
        !string.IsNullOrWhiteSpace(Vin) ? Vin! : $"Vehicle {Id}";

    /// <summary>Parse a vehicles JSON array into a tolerant list of rows, skipping malformed entries.</summary>
    public static IReadOnlyList<TimelineVehicle> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<TimelineVehicle>();
        }

        var list = new List<TimelineVehicle>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            var id = TimelineJson.Long(item, "id") ?? TimelineJson.Long(item, "vehicle_id");
            if (id is null)
            {
                continue;
            }

            list.Add(new TimelineVehicle(
                id.Value,
                TimelineJson.Str(item, "display_name") ?? TimelineJson.Str(item, "displayName"),
                TimelineJson.Str(item, "vin")));
        }

        return list;
    }
}

/// <summary>
/// A single FSM transition event — the native mirror of the web <c>TransitionRecord</c>
/// (<c>GET /vehicle-states/timeline</c>). Point-in-time, not a state with a duration; durations are computed in the
/// projection from the next transition (or <c>now</c> for the newest row).
/// </summary>
public sealed record TransitionRecord(string Ts, string FromState, string ToState, string? TriggerField, string? TriggerValue)
{
    /// <summary>Parse the timeline payload (<c>{ transitions: [...] }</c> or a bare array) into transition rows.</summary>
    public static IReadOnlyList<TransitionRecord> ParseList(JsonElement element)
    {
        var array = element;
        if (element.ValueKind == JsonValueKind.Object && element.TryGetProperty("transitions", out var inner))
        {
            array = inner;
        }

        if (array.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<TransitionRecord>();
        }

        var list = new List<TransitionRecord>(array.GetArrayLength());
        foreach (var item in array.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            list.Add(new TransitionRecord(
                TimelineJson.Str(item, "ts") ?? string.Empty,
                TimelineJson.Str(item, "from_state") ?? TimelineJson.Str(item, "fromState") ?? string.Empty,
                TimelineJson.Str(item, "to_state") ?? TimelineJson.Str(item, "toState") ?? string.Empty,
                TimelineJson.Str(item, "trigger_field") ?? TimelineJson.Str(item, "triggerField"),
                TimelineJson.Str(item, "trigger_value") ?? TimelineJson.Str(item, "triggerValue")));
        }

        return list;
    }
}

/// <summary>One "time spent in state" row — the native mirror of the web <c>ByStateRow</c> (<c>GET /vehicle-states/summary</c>).</summary>
public sealed record ByStateRow(string State, double TotalSeconds, double Percentage, int TransitionCount);

/// <summary>
/// The resolved state-summary payload — the native mirror of the web <c>SummaryResponse</c>
/// (<c>{ total_seconds, by_state: ByStateRow[] }</c>). Tolerant of missing fields and unexpected shapes.
/// </summary>
public sealed record StateSummary(double TotalSeconds, IReadOnlyList<ByStateRow> ByState)
{
    /// <summary>An empty summary (no time accrued in any state).</summary>
    public static StateSummary Empty { get; } = new(0, Array.Empty<ByStateRow>());

    /// <summary>Parse the summary payload into a tolerant <see cref="StateSummary"/>.</summary>
    public static StateSummary FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        var rows = new List<ByStateRow>();
        if (element.TryGetProperty("by_state", out var byState) && byState.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in byState.EnumerateArray())
            {
                if (item.ValueKind != JsonValueKind.Object)
                {
                    continue;
                }

                rows.Add(new ByStateRow(
                    TimelineJson.Str(item, "state") ?? string.Empty,
                    TimelineJson.Double(item, "total_seconds") ?? 0,
                    TimelineJson.Double(item, "percentage") ?? 0,
                    TimelineJson.Int(item, "transition_count") ?? 0));
            }
        }

        return new StateSummary(TimelineJson.Double(element, "total_seconds") ?? 0, rows);
    }
}

/// <summary>One pre-formatted summary metric tile (web <c>MetricCard</c>): a label, a value and an accent brush key.</summary>
public sealed record TimelineMetric(string Label, string Value, string AccentBrushKey);

/// <summary>One proportional segment of the state-distribution bar (web inline-width div).</summary>
public sealed record DistributionSegment(string State, double WidthStar, string BrushKey, string AutomationName);

/// <summary>One legend swatch beneath the distribution bar (web legend row — raw state key, not localized).</summary>
public sealed record DistributionLegendItem(string Label, string BrushKey);

/// <summary>One day's grouped transition counts for the daily-breakdown bar chart (web <c>dailyBreakdown</c>).</summary>
public sealed record DailyBreakdownBar(string Day, int Driving, int Charging, int Idle, int Sleeping);

/// <summary>One projected transition table row (web <c>DataTable</c> row): pre-formatted cells + badge variants.</summary>
public sealed record TimelineTableRow(
    int Index,
    string Time,
    string FromState,
    StatusKind FromStatus,
    string ToState,
    StatusKind ToStatus,
    string Duration,
    string Trigger);

/// <summary>One vehicle dropdown option (value = the vehicle id as a string, matching the web select).</summary>
public sealed record TimelineVehicleOption(string Value, string Label);

/// <summary>One trailing-window range preset (web <c>RangePicker</c> preset → a day count).</summary>
public sealed record TimelineRangeOption(int Days, string Label);

/// <summary>The raw inputs the <see cref="TimelineProjection"/> renders (set by the view-model).</summary>
public sealed record TimelineModel(
    IReadOnlyList<TimelineVehicle> Vehicles,
    long? SelectedVehicleId,
    int Days,
    IReadOnlyList<TransitionRecord> Transitions,
    StateSummary Summary,
    bool TimelineLoading,
    bool SummaryLoading,
    bool HasError,
    string? ErrorDetail)
{
    /// <summary>The pre-load model — both queries in flight, nothing resolved yet.</summary>
    public static TimelineModel Initial { get; } = new(
        Vehicles: Array.Empty<TimelineVehicle>(),
        SelectedVehicleId: null,
        Days: TimelineRegistration.DefaultDays,
        Transitions: Array.Empty<TransitionRecord>(),
        Summary: StateSummary.Empty,
        TimelineLoading: true,
        SummaryLoading: true,
        HasError: false,
        ErrorDetail: null);
}

/// <summary>
/// The render-ready projection the WinUI <c>TimelinePage</c> binds to. Every visible string is resolved through the
/// localizer and every numeric value is pre-formatted, so the view is a thin renderer. Mirrors the web page's panels
/// one-for-one: the four summary metrics, the state-distribution bar + legend, the daily-breakdown bar chart and the
/// transitions table — each carrying its own loading / empty / content sub-state so a region never collapses silently.
/// </summary>
public sealed record TimelineDisplay(
    string Title,
    string Subtitle,
    string AutomationName,
    TimelineState State,
    bool ShowError,
    string ErrorBannerText,
    bool ShowLoading,
    bool ShowContent,
    string SelectVehicleHint,
    string RefreshLabel,
    string RangeLabel,
    IReadOnlyList<TimelineRangeOption> RangeOptions,
    int SelectedDays,
    IReadOnlyList<TimelineVehicleOption> VehicleOptions,
    string? SelectedVehicleValue,
    IReadOnlyList<TimelineMetric> Metrics,
    string DistributionTitle,
    TimelinePanelMode DistributionMode,
    IReadOnlyList<DistributionSegment> DistributionSegments,
    IReadOnlyList<DistributionLegendItem> Legend,
    string DistributionEmptyText,
    string DailyTitle,
    TimelinePanelMode DailyMode,
    IReadOnlyList<DailyBreakdownBar> DailyBars,
    string DrivingSeriesName,
    string ChargingSeriesName,
    string IdleSeriesName,
    string SleepingSeriesName,
    string DailyEmptyText,
    string TransitionsTitle,
    string TimeHeader,
    string FromStateHeader,
    string ToStateHeader,
    string DurationHeader,
    string TriggerHeader,
    IReadOnlyList<TimelineTableRow> Rows,
    bool ShowTransitions,
    string NoTransitionsText);

/// <summary>
/// Pure, UI-free projection of the <c>TimelinePage</c>. A 1:1 port of the web page's derived state
/// (web/src/features/analytics/pages/TimelinePage.tsx): the day binning, the four state buckets, the summary
/// metrics, the proportional distribution bar and the transition-duration math. Unit-tested without a XAML host.
/// </summary>
public static class TimelineProjection
{
    /// <summary>Em-dash fallback for missing trigger fields / durations (web <c>'—'</c>).</summary>
    public const string EmDash = "\u2014";

    private const double MinSegmentPercent = 0.3;

    // web STATE_COLORS — the legend order and the set of states with a swatch.
    private static readonly string[] LegendStates =
        ["driving", "charging", "idle", "sleeping", "online", "offline", "parked", "asleep"];

    /// <summary>Project <paramref name="model"/> into the render-ready <see cref="TimelineDisplay"/>.</summary>
    public static TimelineDisplay Project(TimelineModel model, ILocalizer localizer, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        var title = localizer.GetString("timeline.title", "Timeline");
        var subtitle = localizer.GetString("timeline.subtitle", "Vehicle state history and transitions");

        var transitions = OrderTransitions(model.Transitions);
        var summaryByState = IndexSummary(model.Summary.ByState);

        // web anyError → the failure banner (shown above the panels). The prefix label is resolved on every
        // projection (part of the page's string contract) so the catalog key is exercised in every data state.
        var hasError = model.HasError;
        var errorPrefix = localizer.GetString("error.loadFailed", "Failed to load data");
        var errorText = hasError
            ? $"{errorPrefix}: {model.ErrorDetail ?? string.Empty}".TrimEnd(' ', ':')
            : string.Empty;

        // web PageContainer loading = isLoading && transitions.length === 0.
        var isLoading = model.TimelineLoading || model.SummaryLoading;
        var showLoading = !hasError && isLoading && transitions.Count == 0;
        var showContent = !showLoading;

        // ── Summary metric cards (web MetricCard ×4) ──────────────────────────
        var totalTransitions = 0;
        foreach (var row in model.Summary.ByState)
        {
            totalTransitions += row.TransitionCount;
        }

        var drivingSec = Seconds(summaryByState, "driving");
        var chargingSec = Seconds(summaryByState, "charging");
        var idleSec = Seconds(summaryByState, "online") + Seconds(summaryByState, "parked") + Seconds(summaryByState, "idle");
        var sleepingSec = Seconds(summaryByState, "asleep") + Seconds(summaryByState, "sleeping") + Seconds(summaryByState, "offline");

        var metrics = new[]
        {
            new TimelineMetric(localizer.GetString("timeline.totalTransitions", "Total Transitions"), FormatInt(totalTransitions), "TsColorAccentBrush"),
            new TimelineMetric(localizer.GetString("timeline.drivingTime", "Driving Time"), FormatHoursFromSeconds(drivingSec), "TsColorSuccessBrush"),
            new TimelineMetric(localizer.GetString("timeline.chargingTime", "Charging Time"), FormatHoursFromSeconds(chargingSec), "TsColorInfoBrush"),
            new TimelineMetric(localizer.GetString("timeline.idleSleepTime", "Idle / Sleep Time"), FormatHoursFromSeconds(idleSec + sleepingSec), "TsColorAccentBrush"),
        };

        // ── State distribution bar (web proportional segments + legend) ───────
        var totalSeconds = model.Summary.TotalSeconds;
        var segments = BuildSegments(model.Summary.ByState, totalSeconds);
        var distributionMode = model.Summary.ByState.Count == 0 || totalSeconds <= 0
            ? (model.SummaryLoading ? TimelinePanelMode.Loading : TimelinePanelMode.Empty)
            : TimelinePanelMode.Content;
        var legend = BuildLegend();

        // ── Daily breakdown chart (web stacked BarChart) ──────────────────────
        var dailyBars = BuildDailyBreakdown(transitions);
        var dailyMode = dailyBars.Count == 0
            ? (model.TimelineLoading ? TimelinePanelMode.Loading : TimelinePanelMode.Empty)
            : TimelinePanelMode.Content;

        // ── Transitions table (web DataTable) ─────────────────────────────────
        var rows = BuildRows(transitions, now);

        var state = hasError ? TimelineState.Error
            : showLoading ? TimelineState.Loading
            : transitions.Count == 0 && model.Summary.ByState.Count == 0 ? TimelineState.Empty
            : TimelineState.Success;

        return new TimelineDisplay(
            Title: title,
            Subtitle: subtitle,
            AutomationName: title,
            State: state,
            ShowError: hasError,
            ErrorBannerText: errorText,
            ShowLoading: showLoading,
            ShowContent: showContent,
            SelectVehicleHint: localizer.GetString("timeline.selectVehicle", "Select Vehicle"),
            RefreshLabel: localizer.GetString("timeline.refresh", "Refresh"),
            RangeLabel: localizer.GetString("timeline.range", "Range"),
            RangeOptions: BuildRangeOptions(localizer),
            SelectedDays: model.Days,
            VehicleOptions: BuildVehicleOptions(model.Vehicles),
            SelectedVehicleValue: model.SelectedVehicleId?.ToString(CultureInfo.InvariantCulture),
            Metrics: metrics,
            DistributionTitle: localizer.GetString("timeline.stateTimeline", "State Distribution"),
            DistributionMode: distributionMode,
            DistributionSegments: segments,
            Legend: legend,
            DistributionEmptyText: localizer.GetString("timeline.noStateData", "No state distribution available yet"),
            DailyTitle: localizer.GetString("timeline.dailyBreakdown", "Daily Breakdown"),
            DailyMode: dailyMode,
            DailyBars: dailyBars,
            DrivingSeriesName: localizer.GetString("timeline.driving", "Driving"),
            ChargingSeriesName: localizer.GetString("timeline.charging", "Charging"),
            IdleSeriesName: localizer.GetString("timeline.idle", "Idle"),
            SleepingSeriesName: localizer.GetString("timeline.sleeping", "Sleeping"),
            DailyEmptyText: localizer.GetString("timeline.noDailyData", "No daily transition activity yet"),
            TransitionsTitle: localizer.GetString("timeline.stateTransitions", "State Transitions"),
            TimeHeader: localizer.GetString("timeline.time", "Time"),
            FromStateHeader: localizer.GetString("timeline.fromState", "From State"),
            ToStateHeader: localizer.GetString("timeline.toState", "To State"),
            DurationHeader: localizer.GetString("timeline.duration", "Duration"),
            TriggerHeader: localizer.GetString("timeline.trigger", "Trigger"),
            Rows: rows,
            ShowTransitions: rows.Count > 0,
            NoTransitionsText: localizer.GetString("timeline.noTransitions", "No state transitions recorded"));
    }

    /// <summary>web <c>formatHoursFromSeconds</c> — "Nm" under an hour, otherwise "Hh Mm" (dropping a near-zero minute).</summary>
    public static string FormatHoursFromSeconds(double seconds)
    {
        var minutes = seconds / 60.0;
        var hours = minutes / 60.0;
        var h = (int)Math.Floor(hours);
        var m = (hours - h) * 60.0;
        if (h == 0)
        {
            return $"{FormatInt(m)}m";
        }

        return m >= 0.5 ? $"{h}h {FormatInt(m)}m" : $"{h}h";
    }

    /// <summary>web <c>formatDurationFromSeconds</c> — "Ns" under a minute, otherwise the hours/minutes form.</summary>
    public static string FormatDurationFromSeconds(double seconds)
    {
        if (seconds < 60)
        {
            return $"{FormatInt(seconds)}s";
        }

        return FormatHoursFromSeconds(seconds);
    }

    /// <summary>web <c>fmtInt</c> — en-US grouped integer (rounded half-away-from-zero).</summary>
    public static string FormatInt(double value) => NumberFormatting.Format(value, null, 0);

    /// <summary>web <c>fmtPercent(value, 1)</c> — one-decimal percent of an already-scaled (0-100) value.</summary>
    public static string FormatPercent(double value) => $"{NumberFormatting.Format(value, null, 1)}%";

    /// <summary>web <c>STATE_BADGE</c> — the badge tone for a raw FSM state.</summary>
    public static StatusKind BadgeFor(string state) => state switch
    {
        "driving" => StatusKind.Success,
        "charging" => StatusKind.Info,
        "idle" => StatusKind.Warning,
        "online" => StatusKind.Info,
        "offline" => StatusKind.Danger,
        "parked" => StatusKind.Warning,
        "sleeping" => StatusKind.Neutral,
        "asleep" => StatusKind.Neutral,
        _ => StatusKind.Neutral,
    };

    /// <summary>web <c>STATE_COLORS</c> mapped to a theme-aware token brush key (never a hardcoded hex).</summary>
    public static string StateBrushKey(string state) => state switch
    {
        "driving" => "TsColorSuccessBrush",
        "charging" => "TsColorInfoBrush",
        "idle" => "TsColorWarningBrush",
        "online" => "TsColorInfoBrush",
        "parked" => "TsColorWarningBrush",
        "sleeping" => "TsColorTextSecondaryBrush",
        "asleep" => "TsColorTextSecondaryBrush",
        "offline" => "TsColorTextMutedBrush",
        _ => "TsColorTextMutedBrush",
    };

    private static IReadOnlyList<TransitionRecord> OrderTransitions(IReadOnlyList<TransitionRecord> raw)
    {
        if (raw.Count == 0)
        {
            return raw;
        }

        var ordered = new List<TransitionRecord>(raw);
        ordered.Sort((a, b) => ParseInstant(a.Ts).CompareTo(ParseInstant(b.Ts)));
        return ordered;
    }

    private static Dictionary<string, ByStateRow> IndexSummary(IReadOnlyList<ByStateRow> rows)
    {
        var map = new Dictionary<string, ByStateRow>(StringComparer.Ordinal);
        foreach (var row in rows)
        {
            map[row.State] = row;
        }

        return map;
    }

    private static double Seconds(Dictionary<string, ByStateRow> map, string state) =>
        map.TryGetValue(state, out var row) ? row.TotalSeconds : 0;

    private static IReadOnlyList<DistributionSegment> BuildSegments(IReadOnlyList<ByStateRow> rows, double totalSeconds)
    {
        if (totalSeconds <= 0)
        {
            return Array.Empty<DistributionSegment>();
        }

        var segments = new List<DistributionSegment>(rows.Count);
        foreach (var row in rows)
        {
            var pct = row.TotalSeconds / totalSeconds * 100.0;
            if (pct < MinSegmentPercent)
            {
                continue;
            }

            var tooltip = $"{row.State}: {FormatDurationFromSeconds(row.TotalSeconds)} ({FormatPercent(row.Percentage)})";
            segments.Add(new DistributionSegment(row.State, pct, StateBrushKey(row.State), tooltip));
        }

        return segments;
    }

    private static List<DistributionLegendItem> BuildLegend()
    {
        var legend = new List<DistributionLegendItem>(LegendStates.Length);
        foreach (var state in LegendStates)
        {
            legend.Add(new DistributionLegendItem(Capitalize(state), StateBrushKey(state)));
        }

        return legend;
    }

    private static IReadOnlyList<DailyBreakdownBar> BuildDailyBreakdown(IReadOnlyList<TransitionRecord> transitions)
    {
        if (transitions.Count == 0)
        {
            return Array.Empty<DailyBreakdownBar>();
        }

        var buckets = new Dictionary<string, int[]>(StringComparer.Ordinal);
        foreach (var row in transitions)
        {
            var instant = ParseInstant(row.Ts);
            if (instant == DateTimeOffset.MinValue)
            {
                continue;
            }

            var day = instant.UtcDateTime.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            if (!buckets.TryGetValue(day, out var counts))
            {
                counts = new int[4];
                buckets[day] = counts;
            }

            switch (row.ToState)
            {
                case "driving":
                    counts[0]++;
                    break;
                case "charging":
                    counts[1]++;
                    break;
                case "idle":
                case "online":
                case "parked":
                    counts[2]++;
                    break;
                case "sleeping":
                case "asleep":
                case "offline":
                    counts[3]++;
                    break;
            }
        }

        var bars = new List<DailyBreakdownBar>(buckets.Count);
        foreach (var entry in buckets)
        {
            bars.Add(new DailyBreakdownBar(entry.Key, entry.Value[0], entry.Value[1], entry.Value[2], entry.Value[3]));
        }

        bars.Sort((a, b) => string.CompareOrdinal(a.Day, b.Day));
        return bars;
    }

    private static IReadOnlyList<TimelineTableRow> BuildRows(IReadOnlyList<TransitionRecord> transitions, DateTimeOffset now)
    {
        if (transitions.Count == 0)
        {
            return Array.Empty<TimelineTableRow>();
        }

        var rows = new List<TimelineTableRow>(transitions.Count);
        for (var i = 0; i < transitions.Count; i++)
        {
            var record = transitions[i];
            var start = ParseInstant(record.Ts);
            var end = i + 1 < transitions.Count ? ParseInstant(transitions[i + 1].Ts) : now;

            string duration;
            if (start == DateTimeOffset.MinValue || end <= start)
            {
                duration = EmDash;
            }
            else
            {
                duration = FormatDurationFromSeconds((end - start).TotalSeconds);
            }

            var time = start == DateTimeOffset.MinValue
                ? EmDash
                : DateTimeFormatting.Format(start, DateTimeVariant.Full, now);

            rows.Add(new TimelineTableRow(
                Index: i,
                Time: time,
                FromState: record.FromState,
                FromStatus: BadgeFor(record.FromState),
                ToState: record.ToState,
                ToStatus: BadgeFor(record.ToState),
                Duration: duration,
                Trigger: string.IsNullOrEmpty(record.TriggerField) ? EmDash : record.TriggerField));
        }

        return rows;
    }

    private static List<TimelineVehicleOption> BuildVehicleOptions(IReadOnlyList<TimelineVehicle> vehicles)
    {
        var options = new List<TimelineVehicleOption>(vehicles.Count);
        foreach (var vehicle in vehicles)
        {
            options.Add(new TimelineVehicleOption(vehicle.Id.ToString(CultureInfo.InvariantCulture), vehicle.Label));
        }

        return options;
    }

    private static IReadOnlyList<TimelineRangeOption> BuildRangeOptions(ILocalizer localizer) =>
    [
        new TimelineRangeOption(7, localizer.GetString("timeline.range.last7Days", "Last 7 days")),
        new TimelineRangeOption(30, localizer.GetString("timeline.range.last30Days", "Last 30 days")),
        new TimelineRangeOption(90, localizer.GetString("timeline.range.last90Days", "Last 90 days")),
    ];

    private static DateTimeOffset ParseInstant(string ts)
    {
        if (string.IsNullOrEmpty(ts))
        {
            return DateTimeOffset.MinValue;
        }

        return DateTimeOffset.TryParse(
            ts, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var parsed)
            ? parsed
            : DateTimeOffset.MinValue;
    }

    private static string Capitalize(string value) =>
        string.IsNullOrEmpty(value) ? value : char.ToUpperInvariant(value[0]) + value[1..];
}

/// <summary>
/// Navigation / diagnostics constants for the <c>TimelinePage</c> surface — the native parity port of the web page
/// <c>web/src/features/analytics/pages/TimelinePage.tsx</c> (route <c>/timeline</c>, nav name <c>Timeline</c>).
/// </summary>
public static class TimelineRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "TimelinePage";

    /// <summary>The navigation route name this page registers under (see RouteTable <c>Timeline</c>).</summary>
    public const string RouteName = "Timeline";

    /// <summary>The default trailing window in days (web <c>defaultPresetId: '7d'</c>).</summary>
    public const int DefaultDays = 7;

    /// <summary>Generated operation id for <c>GET /api/v1/vehicles</c> (web <c>useVehicles</c>).</summary>
    public const string VehiclesOperation = "get_api_v1_vehicles";

    /// <summary>Generated operation id for <c>GET /api/v1/vehicle-states/timeline</c>.</summary>
    public const string TimelineOperation = "get_api_v1_vehicle_states_timeline";

    /// <summary>Generated operation id for <c>GET /api/v1/vehicle-states/summary</c>.</summary>
    public const string SummaryOperation = "get_api_v1_vehicle_states_summary";

    /// <summary>The localized page title (web <c>timeline.title</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("timeline.title", "Timeline");
    }

    /// <summary>The localized page subtitle (web <c>timeline.subtitle</c>).</summary>
    public static string Subtitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("timeline.subtitle", "Vehicle state history and transitions");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>TimelinePage</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a vehicle id, VIN or location — so a
/// diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class TimelineDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public TimelineDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=TimelinePage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={TimelineRegistration.Slug}");
    }
}

/// <summary>Small null-tolerant JSON readers for the timeline / summary / vehicles parsers (UI-free, unit-tested).</summary>
internal static class TimelineJson
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
}
