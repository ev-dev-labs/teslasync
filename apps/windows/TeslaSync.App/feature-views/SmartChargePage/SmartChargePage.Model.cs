using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Charging;

/// <summary>
/// The lifecycle state the <see cref="SmartChargePageViewModel"/>'s plan-history spine can be in — the native
/// union of the web page's data states (web/src/features/charging/pages/SmartChargePage.tsx). The persistent
/// read of the page is the charge-plan history (<c>useChargePlans</c>): while it loads with nothing cached the
/// History panel shows a skeleton (<see cref="Loading"/>); a hard failure with no cache shows the retry surface
/// (<see cref="Error"/>); a successful-but-empty response renders the History empty state (<see cref="Empty"/>);
/// and a populated response renders the History table (<see cref="Ready"/>). The settings form, the rate
/// timeline, the cost comparison and the schedule panels are always present and never collapse — each shows its
/// own empty body until an optimization runs.
/// </summary>
public enum SmartChargeState
{
    /// <summary>Initial plan-history fetch with no cached snapshot — the History panel skeleton.</summary>
    Loading,

    /// <summary>A snapshot with at least one plan — render the History table.</summary>
    Ready,

    /// <summary>A successful-but-empty plan-history response — render the History empty state.</summary>
    Empty,

    /// <summary>The first plan-history read failed with no cache — render the retry surface.</summary>
    Error,
}

/// <summary>
/// One available time-of-use rate plan (web <c>RatePlanInfo</c> from <c>GET /charge-planner/rate-plans</c>). The
/// <see cref="DisplayLabel"/> mirrors the web select option <c>`${name} (${utility})`</c>. Pure data.
/// </summary>
/// <param name="Id">The plan id sent back as <c>rate_plan_id</c> (web <c>id</c>).</param>
/// <param name="Name">The human plan name (web <c>name</c>).</param>
/// <param name="Utility">The issuing utility (web <c>utility</c>).</param>
public sealed record RatePlanOption(string Id, string Name, string Utility)
{
    /// <summary>The select label — <c>name (utility)</c>, or just <c>name</c> when the utility is blank.</summary>
    public string DisplayLabel =>
        string.IsNullOrEmpty(Utility) ? Name : string.Create(CultureInfo.InvariantCulture, $"{Name} ({Utility})");

    /// <summary>Parse one rate-plan object; returns null when the id is absent.</summary>
    public static RatePlanOption? FromJson(JsonElement element)
    {
        var obj = ChargePlannerJson.Unwrap(element);
        string? id = ChargePlannerJson.String(obj, "id");
        if (string.IsNullOrEmpty(id))
        {
            return null;
        }

        return new RatePlanOption(id, ChargePlannerJson.String(obj, "name") ?? id, ChargePlannerJson.String(obj, "utility") ?? string.Empty);
    }

    /// <summary>Parse the rate-plans array (tolerant of a <c>{data:[…]}</c> envelope).</summary>
    public static IReadOnlyList<RatePlanOption> ListFromJson(JsonElement element)
    {
        var list = new List<RatePlanOption>();
        foreach (var item in ChargePlannerJson.Array(element))
        {
            if (FromJson(item) is { } option)
            {
                list.Add(option);
            }
        }

        return list;
    }
}

/// <summary>
/// One persisted charge plan (web <c>ChargePlan</c> from <c>GET /charge-planner/history</c>). Field names mirror
/// the Go API's snake_case JSON tags; parsing is null-tolerant so a partial row never throws. Pure data.
/// </summary>
public sealed record ChargePlanRecord(
    long Id,
    int TargetSoc,
    DateTimeOffset ScheduledStart,
    DateTimeOffset ScheduledEnd,
    string RatePlan,
    double? EstimatedCost,
    double? Savings,
    string Status,
    DateTimeOffset CreatedAt)
{
    /// <summary>Parse one history row.</summary>
    public static ChargePlanRecord FromJson(JsonElement element)
    {
        var obj = ChargePlannerJson.Unwrap(element);
        return new ChargePlanRecord(
            ChargePlannerJson.Long(obj, "id") ?? 0,
            (int)(ChargePlannerJson.Long(obj, "target_soc") ?? 0),
            ChargePlannerJson.Date(obj, "scheduled_start") ?? default,
            ChargePlannerJson.Date(obj, "scheduled_end") ?? default,
            ChargePlannerJson.String(obj, "rate_plan") ?? string.Empty,
            ChargePlannerJson.Double(obj, "estimated_cost"),
            ChargePlannerJson.Double(obj, "savings"),
            ChargePlannerJson.String(obj, "status") ?? string.Empty,
            ChargePlannerJson.Date(obj, "created_at") ?? default);
    }

    /// <summary>Parse the history array (tolerant of a <c>{data:[…]}</c> envelope).</summary>
    public static IReadOnlyList<ChargePlanRecord> ListFromJson(JsonElement element)
    {
        var list = new List<ChargePlanRecord>();
        foreach (var item in ChargePlannerJson.Array(element))
        {
            list.Add(FromJson(item));
        }

        return list;
    }
}

/// <summary>
/// One candidate charge window (web <c>ChargeWindow</c>): start/end instants, the window's rate in cents per
/// kWh, its estimated cost and its time-of-use tier. Pure data.
/// </summary>
public sealed record ChargeWindowRecord(
    DateTimeOffset StartTime,
    DateTimeOffset EndTime,
    double RateCentsKwh,
    double EstimatedCost,
    string RateTier)
{
    /// <summary>Parse one charge-window object.</summary>
    public static ChargeWindowRecord FromJson(JsonElement obj) => new(
        ChargePlannerJson.Date(obj, "start_time") ?? default,
        ChargePlannerJson.Date(obj, "end_time") ?? default,
        ChargePlannerJson.Double(obj, "rate_cents_kwh") ?? 0,
        ChargePlannerJson.Double(obj, "estimated_cost") ?? 0,
        ChargePlannerJson.String(obj, "rate_tier") ?? string.Empty);
}

/// <summary>The charge-now-vs-optimized cost comparison (web <c>CostComparison</c>). Pure data.</summary>
public sealed record CostComparisonRecord(double ChargeNowCost, double OptimizedCost, double Savings, double SavingsPercent)
{
    /// <summary>Parse the comparison object.</summary>
    public static CostComparisonRecord FromJson(JsonElement obj) => new(
        ChargePlannerJson.Double(obj, "charge_now_cost") ?? 0,
        ChargePlannerJson.Double(obj, "optimized_cost") ?? 0,
        ChargePlannerJson.Double(obj, "savings") ?? 0,
        ChargePlannerJson.Double(obj, "savings_percent") ?? 0);
}

/// <summary>One hour of the 24-hour TOU rate curve (web <c>HourlyRate</c>). Pure data.</summary>
public sealed record HourlyRateRecord(int Hour, double RateCents, string Tier)
{
    /// <summary>Parse one hourly-rate object.</summary>
    public static HourlyRateRecord FromJson(JsonElement obj) => new(
        (int)(ChargePlannerJson.Long(obj, "hour") ?? 0),
        ChargePlannerJson.Double(obj, "rate_cents") ?? 0,
        ChargePlannerJson.String(obj, "tier") ?? string.Empty);
}

/// <summary>
/// The optimizer result (web <c>OptimizeChargeResponse</c> from <c>POST /charge-planner/optimize</c>): the
/// recommended schedule, the cost comparison, the alternative windows and the 24-hour rate curve. Pure data.
/// </summary>
public sealed record OptimizeChargeResult(
    long PlanId,
    int CurrentSoc,
    int TargetSoc,
    double KwhNeeded,
    double EstimatedDurationHours,
    ChargeWindowRecord Schedule,
    CostComparisonRecord Comparison,
    IReadOnlyList<ChargeWindowRecord> AlternativeWindows,
    IReadOnlyList<HourlyRateRecord> HourlyRates)
{
    /// <summary>Parse the optimizer response (tolerant of a <c>{data:…}</c> envelope).</summary>
    public static OptimizeChargeResult FromJson(JsonElement element)
    {
        var obj = ChargePlannerJson.Unwrap(element);
        var schedule = obj.TryGetProperty("schedule", out var s) && s.ValueKind == JsonValueKind.Object
            ? ChargeWindowRecord.FromJson(s)
            : new ChargeWindowRecord(default, default, 0, 0, string.Empty);
        var comparison = obj.TryGetProperty("comparison", out var c) && c.ValueKind == JsonValueKind.Object
            ? CostComparisonRecord.FromJson(c)
            : new CostComparisonRecord(0, 0, 0, 0);

        var alternatives = new List<ChargeWindowRecord>();
        if (obj.TryGetProperty("alternative_windows", out var alt) && alt.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in alt.EnumerateArray())
            {
                alternatives.Add(ChargeWindowRecord.FromJson(item));
            }
        }

        var hourly = new List<HourlyRateRecord>();
        if (obj.TryGetProperty("hourly_rates", out var hr) && hr.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in hr.EnumerateArray())
            {
                hourly.Add(HourlyRateRecord.FromJson(item));
            }
        }

        return new OptimizeChargeResult(
            ChargePlannerJson.Long(obj, "plan_id") ?? 0,
            (int)(ChargePlannerJson.Long(obj, "current_soc") ?? 0),
            (int)(ChargePlannerJson.Long(obj, "target_soc") ?? 0),
            ChargePlannerJson.Double(obj, "kwh_needed") ?? 0,
            ChargePlannerJson.Double(obj, "estimated_duration_hours") ?? 0,
            schedule,
            comparison,
            alternatives,
            hourly);
    }
}

/// <summary>The apply result (web <c>ApplyScheduleResponse</c> from <c>POST /charge-planner/apply</c>).</summary>
public sealed record ApplyScheduleResult(string Status, long PlanId, string Message)
{
    /// <summary>Parse the apply response (tolerant of a <c>{data:…}</c> envelope).</summary>
    public static ApplyScheduleResult FromJson(JsonElement element)
    {
        var obj = ChargePlannerJson.Unwrap(element);
        return new ApplyScheduleResult(
            ChargePlannerJson.String(obj, "status") ?? string.Empty,
            ChargePlannerJson.Long(obj, "plan_id") ?? 0,
            ChargePlannerJson.String(obj, "message") ?? string.Empty);
    }
}

/// <summary>
/// The form inputs the optimizer request carries (web <c>OptimizeChargeRequest</c>). The source layer maps this
/// to the snake_case JSON body the Go API expects (<c>vehicle_id</c>, <c>target_soc</c>, <c>depart_by</c>,
/// <c>rate_plan_id</c>, <c>max_amps</c>, <c>battery_capacity_kwh</c>). Pure data.
/// </summary>
public sealed record OptimizeChargeRequestModel(
    long VehicleId,
    int TargetSoc,
    string DepartBy,
    string RatePlanId,
    int MaxAmps,
    double BatteryCapacityKwh);

/// <summary>Null-tolerant JSON readers for the charge-planner reads (mirrors the web hooks' <c>?? 0</c> guards).</summary>
internal static class ChargePlannerJson
{
    /// <summary>Unwrap a platform <c>{data:…}</c> envelope to the inner value when present.</summary>
    public static JsonElement Unwrap(JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.Object
            && element.TryGetProperty("data", out var data)
            && data.ValueKind is JsonValueKind.Object or JsonValueKind.Array)
        {
            return data;
        }

        return element;
    }

    /// <summary>Enumerate an array response, unwrapping a <c>{data:[…]}</c> envelope first (empty when absent).</summary>
    public static IEnumerable<JsonElement> Array(JsonElement element)
    {
        var root = Unwrap(element);
        if (root.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in root.EnumerateArray())
            {
                yield return item;
            }
        }
    }

    public static double? Double(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var n) && !double.IsNaN(n) && !double.IsInfinity(n) => n,
            JsonValueKind.String when double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

    public static long? Long(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out var n) => n,
            JsonValueKind.Number when v.TryGetDouble(out var d) => (long)d,
            JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

    public static string? String(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString()
            : null;

    public static DateTimeOffset? Date(JsonElement obj, string name)
    {
        string? raw = String(obj, name);
        return DateTimeOffset.TryParse(
            raw, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var d)
            ? d
            : null;
    }
}

/// <summary>One projected headline cost tile (web <c>StatCard</c>): label, formatted value, sub-line and glyph.</summary>
public sealed record CostStat(string Label, string Value, string Sublabel, string Glyph);

/// <summary>One projected schedule detail (web schedule grid cell): a label and a formatted value.</summary>
public sealed record ScheduleDetail(string Label, string Value);

/// <summary>One projected alternative-window row (web alternatives list item).</summary>
public sealed record AlternativeWindowRow(string Window, string Tier, string Cost);

/// <summary>
/// One bar of the projected 24-hour rate timeline (web <c>RateTimeline</c> bar). <see cref="HeightFraction"/> is
/// the bar height as a 0..1 fraction of the peak rate; <see cref="InWindow"/> highlights the optimal charge
/// window; <see cref="Status"/> carries the tier's semantic color. Pure data.
/// </summary>
public sealed record RateBar(
    int Hour,
    double HeightFraction,
    StatusKind Status,
    bool InWindow,
    string HourLabel,
    bool ShowLabel,
    string Tooltip);

/// <summary>One projected history-table row — already-formatted cells keyed by column, plus the status color.</summary>
public sealed record SmartChargeHistoryRow(
    long Id,
    string Date,
    string Window,
    string Plan,
    string Cost,
    string Saved,
    string Status,
    StatusKind StatusKind);

/// <summary>One declarative history-table column (web table column descriptor).</summary>
public sealed record SmartChargeColumn(string Key, string Header, bool IsNumeric);

/// <summary>
/// The fully projected, render-ready view of the Smart Charge page — the native analogue of everything the web
/// page computes before returning JSX: the localized header and every panel's labels, the three cost tiles, the
/// recommended-schedule details, the alternative windows, the 24-hour rate-timeline bars + window summary, and
/// the plan-history columns/rows. Pure data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record SmartChargeDisplay(
    string Title,
    string Subtitle,
    string DocumentTitle,
    string SettingsTitle,
    string RatePlanLabel,
    string TargetSocLabel,
    string DepartByLabel,
    string MaxAmpsLabel,
    string BatteryCapacityLabel,
    string OptimizeText,
    string RateTimelineTitle,
    string OffPeakLabel,
    string MidPeakLabel,
    string OnPeakLabel,
    string ChargeWindowLabel,
    string NoRateDataMessage,
    string WindowInfoText,
    IReadOnlyList<RateBar> RateBars,
    IReadOnlyList<CostStat> CostStats,
    string ScheduleTitle,
    string ApplyText,
    string AppliedText,
    IReadOnlyList<ScheduleDetail> ScheduleDetails,
    string AlternativesTitle,
    IReadOnlyList<AlternativeWindowRow> AlternativeWindows,
    bool HasResult,
    string HistoryTitle,
    IReadOnlyList<SmartChargeColumn> HistoryColumns,
    IReadOnlyList<SmartChargeHistoryRow> HistoryRows,
    string HistoryEmptyMessage)
{
    /// <summary>True when the rate timeline carries at least one hour (web <c>rates.length &gt; 0</c>).</summary>
    public bool HasRateBars => RateBars.Count > 0;

    /// <summary>True when the recommended schedule has alternative windows.</summary>
    public bool HasAlternatives => AlternativeWindows.Count > 0;

    /// <summary>True when the plan history has at least one row.</summary>
    public bool HasHistory => HistoryRows.Count > 0;
}

/// <summary>
/// Pure projection from the raw charge-planner reads (rate plans, plan history) and the optimizer result to the
/// render-ready <see cref="SmartChargeDisplay"/> — the native port of the JSX-time computation in
/// web/src/features/charging/pages/SmartChargePage.tsx and the <c>RateTimeline</c> component. Costs are
/// formatted via <see cref="ScalarFormatters"/>; times/dates via <see cref="DateTimeFormatting"/>; every label
/// resolves through the i18n facade with the web key names. No WinUI types.
/// </summary>
public static class SmartChargeProjection
{
    /// <summary>Map a plan status string to its semantic color (web cyan/emerald/red/muted mapping).</summary>
    public static StatusKind StatusFor(string status) => status switch
    {
        "scheduled" => StatusKind.Info,
        "completed" => StatusKind.Success,
        "cancelled" => StatusKind.Danger,
        _ => StatusKind.Neutral,
    };

    /// <summary>Map a TOU tier to its semantic color (web tier color map; off/super-off → success).</summary>
    public static StatusKind TierColor(string tier) => tier switch
    {
        "OFF_PEAK" or "SUPER_OFF_PEAK" => StatusKind.Success,
        "MID_PEAK" => StatusKind.Warning,
        "ON_PEAK" => StatusKind.Danger,
        _ => StatusKind.Neutral,
    };

    /// <summary>Format an hour-of-day as the web timeline does (<c>12a</c>, <c>12p</c>, <c>{h}a</c>, <c>{h}p</c>).</summary>
    public static string FormatHour(int hour)
    {
        int h = (((hour % 24) + 24) % 24);
        if (h == 0)
        {
            return "12a";
        }

        if (h == 12)
        {
            return "12p";
        }

        return h < 12
            ? string.Create(CultureInfo.InvariantCulture, $"{h}a")
            : string.Create(CultureInfo.InvariantCulture, $"{h - 12}p");
    }

    /// <summary>Build the render-ready display from the current reads, optimizer result and preferences.</summary>
    public static SmartChargeDisplay Project(
        OptimizeChargeResult? result,
        IReadOnlyList<ChargePlanRecord> plans,
        ILocalizer localizer,
        string currencySymbol,
        int currencyPrecision,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        plans ??= System.Array.Empty<ChargePlanRecord>();
        string symbol = string.IsNullOrEmpty(currencySymbol) ? "$" : currencySymbol;
        int precision = currencyPrecision < 0 ? 0 : currencyPrecision;

        return new SmartChargeDisplay(
            Title: localizer.GetString("chargePlanner.title", "Smart Charge"),
            Subtitle: localizer.GetString("chargePlanner.subtitle", "Optimize charging schedule for the cheapest TOU rates"),
            DocumentTitle: localizer.GetString("chargePlanner.title", "Smart Charge"),
            SettingsTitle: localizer.GetString("chargePlanner.settings", "Charge Settings"),
            RatePlanLabel: localizer.GetString("chargePlanner.ratePlan", "Rate Plan"),
            TargetSocLabel: localizer.GetString("chargePlanner.targetSoc", "Target SOC"),
            DepartByLabel: localizer.GetString("chargePlanner.departBy", "Depart By"),
            MaxAmpsLabel: localizer.GetString("chargePlanner.maxAmps", "Max Amps"),
            BatteryCapacityLabel: localizer.GetString("chargePlanner.batteryCapacity", "Battery Capacity"),
            OptimizeText: localizer.GetString("chargePlanner.optimize", "Find Cheapest Window"),
            RateTimelineTitle: localizer.GetString("chargePlanner.rateTimeline", "24-Hour Rate Timeline"),
            OffPeakLabel: localizer.GetString("chargePlanner.offPeak", "Off-Peak"),
            MidPeakLabel: localizer.GetString("chargePlanner.midPeak", "Mid-Peak"),
            OnPeakLabel: localizer.GetString("chargePlanner.onPeak", "On-Peak"),
            ChargeWindowLabel: localizer.GetString("chargePlanner.chargeWindow", "Charge Window"),
            NoRateDataMessage: localizer.GetString("chargePlanner.noRateData", "No rate data available"),
            WindowInfoText: WindowInfo(result, localizer, now),
            RateBars: BuildRateBars(result),
            CostStats: BuildCostStats(result, localizer, symbol, precision),
            ScheduleTitle: localizer.GetString("chargePlanner.schedule", "Recommended Schedule"),
            ApplyText: localizer.GetString("chargePlanner.applySchedule", "Apply Schedule"),
            AppliedText: localizer.GetString("chargePlanner.applied", "Schedule Applied!"),
            ScheduleDetails: BuildScheduleDetails(result, localizer, now),
            AlternativesTitle: localizer.GetString("chargePlanner.alternatives", "Alternative Windows"),
            AlternativeWindows: BuildAlternativeWindows(result, symbol, precision, now),
            HasResult: result is not null,
            HistoryTitle: localizer.GetString("chargePlanner.history", "Plan History"),
            HistoryColumns: BuildHistoryColumns(localizer),
            HistoryRows: BuildHistoryRows(plans, symbol, precision, now),
            HistoryEmptyMessage: localizer.GetString(
                "chargePlanner.noHistory",
                "No charge plans yet. Optimize a schedule above to get started."));
    }

    private static IReadOnlyList<CostStat> BuildCostStats(
        OptimizeChargeResult? result,
        ILocalizer localizer,
        string symbol,
        int precision)
    {
        const string emDash = UnitFormatters.DefaultEmptyDisplay;
        string chargeNowLabel = localizer.GetString("chargePlanner.chargeNowCost", "Charge Now");
        string optimizedLabel = localizer.GetString("chargePlanner.optimizedCost", "Optimized Cost");
        string savingsLabel = localizer.GetString("chargePlanner.savings", "Savings");
        string currentRate = localizer.GetString("chargePlanner.currentRate", "At current rates");

        if (result is null)
        {
            return
            [
                new CostStat(chargeNowLabel, emDash, currentRate, "\uE1D6"),
                new CostStat(optimizedLabel, emDash, string.Empty, "\uE1A6"),
                new CostStat(savingsLabel, emDash, string.Empty, "\uEC48"),
            ];
        }

        string optimizedSub = string.Create(
            CultureInfo.InvariantCulture,
            $"{result.Schedule.RateTier} \u00B7 {ScalarFormatters.FormatNumber(result.Schedule.RateCentsKwh, 1)}\u00A2/kWh");
        string savingsSub = string.Create(
            CultureInfo.InvariantCulture,
            $"{ScalarFormatters.FormatPercentage(result.Comparison.SavingsPercent, 0)} \u00B7 {ScalarFormatters.FormatNumber(result.KwhNeeded, 1)} kWh \u00B7 ~{ScalarFormatters.FormatNumber(result.EstimatedDurationHours, 1)}h");

        return
        [
            new CostStat(chargeNowLabel, ScalarFormatters.FormatCurrency(result.Comparison.ChargeNowCost, symbol, precision), currentRate, "\uE1D6"),
            new CostStat(optimizedLabel, ScalarFormatters.FormatCurrency(result.Comparison.OptimizedCost, symbol, precision), optimizedSub, "\uE1A6"),
            new CostStat(savingsLabel, ScalarFormatters.FormatCurrency(result.Comparison.Savings, symbol, precision), savingsSub, "\uEC48"),
        ];
    }

    private static IReadOnlyList<ScheduleDetail> BuildScheduleDetails(
        OptimizeChargeResult? result,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        const string emDash = UnitFormatters.DefaultEmptyDisplay;
        string currentSocLabel = localizer.GetString("chargePlanner.currentSoc", "Current SOC");
        string targetSocLabel = localizer.GetString("chargePlanner.targetSocLabel", "Target SOC");
        string startLabel = localizer.GetString("chargePlanner.startTime", "Start Time");
        string endLabel = localizer.GetString("chargePlanner.endTime", "End Time");

        if (result is null)
        {
            return
            [
                new ScheduleDetail(currentSocLabel, emDash),
                new ScheduleDetail(targetSocLabel, emDash),
                new ScheduleDetail(startLabel, emDash),
                new ScheduleDetail(endLabel, emDash),
            ];
        }

        return
        [
            new ScheduleDetail(currentSocLabel, ScalarFormatters.FormatPercentage(result.CurrentSoc, 0)),
            new ScheduleDetail(targetSocLabel, ScalarFormatters.FormatPercentage(result.TargetSoc, 0)),
            new ScheduleDetail(startLabel, DateTimeFormatting.Format(result.Schedule.StartTime, DateTimeVariant.Time, now)),
            new ScheduleDetail(endLabel, DateTimeFormatting.Format(result.Schedule.EndTime, DateTimeVariant.Time, now)),
        ];
    }

    private static IReadOnlyList<AlternativeWindowRow> BuildAlternativeWindows(
        OptimizeChargeResult? result,
        string symbol,
        int precision,
        DateTimeOffset now)
    {
        if (result is null || result.AlternativeWindows.Count == 0)
        {
            return System.Array.Empty<AlternativeWindowRow>();
        }

        var rows = new List<AlternativeWindowRow>(result.AlternativeWindows.Count);
        foreach (var window in result.AlternativeWindows)
        {
            string range = string.Create(
                CultureInfo.InvariantCulture,
                $"{DateTimeFormatting.Format(window.StartTime, DateTimeVariant.Time, now)} \u2014 {DateTimeFormatting.Format(window.EndTime, DateTimeVariant.Time, now)}");
            rows.Add(new AlternativeWindowRow(range, window.RateTier, ScalarFormatters.FormatCurrency(window.EstimatedCost, symbol, precision)));
        }

        return rows;
    }

    private static IReadOnlyList<RateBar> BuildRateBars(OptimizeChargeResult? result)
    {
        if (result is null || result.HourlyRates.Count == 0)
        {
            return System.Array.Empty<RateBar>();
        }

        double maxRate = 0;
        foreach (var rate in result.HourlyRates)
        {
            if (rate.RateCents > maxRate)
            {
                maxRate = rate.RateCents;
            }
        }

        if (maxRate <= 0)
        {
            maxRate = 1;
        }

        int startHour = result.Schedule.StartTime.LocalDateTime.Hour;
        int endHour = result.Schedule.EndTime.LocalDateTime.Hour;
        if (endHour == 0)
        {
            endHour = 24;
        }

        var bars = new List<RateBar>(result.HourlyRates.Count);
        foreach (var rate in result.HourlyRates)
        {
            double fraction = Math.Max(rate.RateCents / maxRate, 0.05);
            string tooltip = string.Create(
                CultureInfo.InvariantCulture,
                $"{FormatHour(rate.Hour)}  {ScalarFormatters.FormatNumber(rate.RateCents, 1)}\u00A2/kWh");
            bars.Add(new RateBar(
                rate.Hour,
                fraction,
                TierColor(rate.Tier),
                InWindow(rate.Hour, startHour, endHour),
                FormatHour(rate.Hour),
                rate.Hour % 3 == 0,
                tooltip));
        }

        return bars;
    }

    private static bool InWindow(int hour, int startHour, int endHour)
    {
        if (startHour <= endHour)
        {
            return hour >= startHour && hour < endHour;
        }

        return hour >= startHour || hour < endHour;
    }

    private static string WindowInfo(OptimizeChargeResult? result, ILocalizer localizer, DateTimeOffset now)
    {
        if (result is null)
        {
            return string.Empty;
        }

        string template = localizer.GetString("chargePlanner.windowInfo", "Optimal window: {{start}} \u2014 {{end}}");
        string start = DateTimeFormatting.Format(result.Schedule.StartTime, DateTimeVariant.Time, now);
        string end = DateTimeFormatting.Format(result.Schedule.EndTime, DateTimeVariant.Time, now);
        return template
            .Replace("{{start}}", start, StringComparison.Ordinal)
            .Replace("{{end}}", end, StringComparison.Ordinal);
    }

    private static IReadOnlyList<SmartChargeColumn> BuildHistoryColumns(ILocalizer localizer) =>
    [
        new SmartChargeColumn("date", localizer.GetString("chargePlanner.date", "Date"), false),
        new SmartChargeColumn("window", localizer.GetString("chargePlanner.window", "Window"), false),
        new SmartChargeColumn("plan", localizer.GetString("chargePlanner.plan", "Plan"), false),
        new SmartChargeColumn("cost", localizer.GetString("chargePlanner.cost_decimal", "Cost"), true),
        new SmartChargeColumn("saved", localizer.GetString("chargePlanner.savedAmount", "Saved"), true),
        new SmartChargeColumn("status", localizer.GetString("chargePlanner.status", "Status"), false),
    ];

    private static IReadOnlyList<SmartChargeHistoryRow> BuildHistoryRows(
        IReadOnlyList<ChargePlanRecord> plans,
        string symbol,
        int precision,
        DateTimeOffset now)
    {
        if (plans.Count == 0)
        {
            return System.Array.Empty<SmartChargeHistoryRow>();
        }

        const string emDash = UnitFormatters.DefaultEmptyDisplay;
        var rows = new List<SmartChargeHistoryRow>(plans.Count);
        foreach (var plan in plans)
        {
            string window = string.Create(
                CultureInfo.InvariantCulture,
                $"{DateTimeFormatting.Format(plan.ScheduledStart, DateTimeVariant.Time, now)} \u2014 {DateTimeFormatting.Format(plan.ScheduledEnd, DateTimeVariant.Time, now)}");
            string cost = plan.EstimatedCost is { } ec ? ScalarFormatters.FormatCurrency(ec, symbol, precision) : emDash;
            string saved = plan.Savings is { } sv && sv > 0 ? ScalarFormatters.FormatCurrency(sv, symbol, precision) : emDash;
            rows.Add(new SmartChargeHistoryRow(
                plan.Id,
                DateTimeFormatting.Format(plan.CreatedAt, DateTimeVariant.Date, now),
                window,
                plan.RatePlan,
                cost,
                saved,
                plan.Status,
                StatusFor(plan.Status)));
        }

        return rows;
    }
}

/// <summary>
/// The cache-then-network rate-plans port — the native analogue of the web <c>useRatePlans</c> hook
/// (<c>GET /charge-planner/rate-plans</c>). Streams one or more <see cref="RepositoryResult{T}"/> snapshots.
/// </summary>
public interface IRatePlansSource
{
    /// <summary>Stream the cache-then-network rate-plan snapshots, newest cache first.</summary>
    IAsyncEnumerable<TeslaSync.App.Core.Data.State.RepositoryResult<IReadOnlyList<RatePlanOption>>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The cache-then-network plan-history port — the native analogue of the web <c>useChargePlans</c> hook
/// (<c>GET /charge-planner/history?vehicle_id</c>). Scoped to the selected (or primary) vehicle.
/// </summary>
public interface IChargePlansSource
{
    /// <summary>Stream the cache-then-network plan-history snapshots, newest cache first.</summary>
    IAsyncEnumerable<TeslaSync.App.Core.Data.State.RepositoryResult<IReadOnlyList<ChargePlanRecord>>> StreamAsync(CancellationToken cancellationToken = default);
}

/// <summary>
/// The optimize mutation port — the native analogue of the web <c>useOptimizeCharge</c> hook
/// (<c>POST /charge-planner/optimize</c>).
/// </summary>
public interface IOptimizeChargeClient
{
    /// <summary>Run the optimizer for <paramref name="request"/> and return the recommended plan.</summary>
    Task<OptimizeChargeResult> OptimizeAsync(OptimizeChargeRequestModel request, CancellationToken cancellationToken = default);
}

/// <summary>
/// The apply mutation port — the native analogue of the web <c>useApplySchedule</c> hook
/// (<c>POST /charge-planner/apply</c>).
/// </summary>
public interface IApplyScheduleClient
{
    /// <summary>Apply the plan identified by <paramref name="planId"/> to the vehicle.</summary>
    Task<ApplyScheduleResult> ApplyAsync(long planId, CancellationToken cancellationToken = default);
}

/// <summary>The default empty rate-plans feed — yields a single empty result (the parameterless page's feed).</summary>
public sealed class EmptyRatePlansSource : IRatePlansSource
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyRatePlansSource Instance { get; } = new();

    private EmptyRatePlansSource()
    {
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<TeslaSync.App.Core.Data.State.RepositoryResult<IReadOnlyList<RatePlanOption>>> StreamAsync(
        [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        yield return TeslaSync.App.Core.Data.State.RepositoryResult<IReadOnlyList<RatePlanOption>>.Empty();
        await Task.CompletedTask.ConfigureAwait(false);
    }
}

/// <summary>The default empty plan-history feed — yields a single empty result.</summary>
public sealed class EmptyChargePlansSource : IChargePlansSource
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyChargePlansSource Instance { get; } = new();

    private EmptyChargePlansSource()
    {
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<TeslaSync.App.Core.Data.State.RepositoryResult<IReadOnlyList<ChargePlanRecord>>> StreamAsync(
        [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        yield return TeslaSync.App.Core.Data.State.RepositoryResult<IReadOnlyList<ChargePlanRecord>>.Empty();
        await Task.CompletedTask.ConfigureAwait(false);
    }
}

/// <summary>The default no-op optimize client — used by the parameterless page until a real client is wired.</summary>
public sealed class NoopOptimizeChargeClient : IOptimizeChargeClient
{
    /// <summary>The shared singleton instance.</summary>
    public static NoopOptimizeChargeClient Instance { get; } = new();

    private NoopOptimizeChargeClient()
    {
    }

    /// <inheritdoc />
    public Task<OptimizeChargeResult> OptimizeAsync(OptimizeChargeRequestModel request, CancellationToken cancellationToken = default) =>
        Task.FromException<OptimizeChargeResult>(new InvalidOperationException("No optimize client is configured."));
}

/// <summary>The default no-op apply client — used by the parameterless page until a real client is wired.</summary>
public sealed class NoopApplyScheduleClient : IApplyScheduleClient
{
    /// <summary>The shared singleton instance.</summary>
    public static NoopApplyScheduleClient Instance { get; } = new();

    private NoopApplyScheduleClient()
    {
    }

    /// <inheritdoc />
    public Task<ApplyScheduleResult> ApplyAsync(long planId, CancellationToken cancellationToken = default) =>
        Task.FromException<ApplyScheduleResult>(new InvalidOperationException("No apply client is configured."));
}

/// <summary>The default no-vehicle source — resolves no scoped vehicle (the parameterless page's vehicle feed).</summary>
public sealed class NoVehicleSource : TeslaSync.App.Core.Widgets.IWidgetVehicleSource
{
    /// <summary>The shared singleton instance.</summary>
    public static NoVehicleSource Instance { get; } = new();

    private NoVehicleSource()
    {
    }

    /// <inheritdoc />
    public Task<TeslaSync.App.Core.Widgets.WidgetVehicleSnapshot?> GetPrimaryAsync(CancellationToken cancellationToken = default) =>
        Task.FromResult<TeslaSync.App.Core.Widgets.WidgetVehicleSnapshot?>(null);

    /// <inheritdoc />
    public Task<TeslaSync.App.Core.Widgets.WidgetVehicleSnapshot?> GetAsync(long vehicleId, CancellationToken cancellationToken = default) =>
        Task.FromResult<TeslaSync.App.Core.Widgets.WidgetVehicleSnapshot?>(null);
}

/// <summary>
/// Canonical metadata for the Smart Charge page — the native mirror of the web routes <c>/charging/schedule</c>
/// and <c>/smart-charge</c> (nav name <c>SmartCharge</c>). The shell page factory registers the surface under
/// <see cref="RouteName"/>; the title and subtitle resolve through the i18n facade with the web key names.
/// </summary>
public static class SmartChargeRegistration
{
    /// <summary>The navigation route name the shell page factory registers this surface under.</summary>
    public const string RouteName = "SmartCharge";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "SmartChargePage";

    /// <summary>The localized page title (web <c>chargePlanner.title</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("chargePlanner.title", "Smart Charge");
    }

    /// <summary>The localized page subtitle (web <c>chargePlanner.subtitle</c>).</summary>
    public static string Subtitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("chargePlanner.subtitle", "Optimize charging schedule for the cheapest TOU rates");
    }
}

/// <summary>
/// PII-safe diagnostics for the Smart Charge page. Records only the operational <c>view.opened</c> event with
/// the surface slug — never a cost, schedule, vehicle id or VIN — so a diagnostics line can never leak fleet
/// data. Thread-safe.
/// </summary>
public sealed class SmartChargeDiagnostics
{
    private int _viewOpenedCount;

    /// <summary>The number of times the surface has been opened (test-observable; carries no fleet data).</summary>
    public int ViewOpenedCount => System.Threading.Volatile.Read(ref _viewOpenedCount);

    /// <summary>Record that the surface was opened.</summary>
    public void RecordViewOpened() => System.Threading.Interlocked.Increment(ref _viewOpenedCount);
}
