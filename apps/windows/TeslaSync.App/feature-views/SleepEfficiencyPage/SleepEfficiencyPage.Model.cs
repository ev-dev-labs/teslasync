using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Battery;

/// <summary>
/// One row of the web <c>state_distribution</c> array (<c>{ state, total_minutes }</c>) — the per-state dwell the
/// donut and its legend read (web/src/features/battery/pages/SleepEfficiencyPage.tsx L75-83). Pure data; minutes
/// are dimensionless wall-clock minutes exactly as the API returns them.
/// </summary>
public sealed record SleepStateMinutes(string State, double TotalMinutes);

/// <summary>
/// One row of the web <c>sentry_comparison</c> array (<c>{ sentry_mode, avg_drain_rate, avg_battery_lost }</c>)
/// the Sentry-vs-No-Sentry bar chart reads (web source L85-99). Drain rate is %/hour and battery lost is a
/// percentage — both dimensionless, so no SI conversion applies.
/// </summary>
public sealed record SentryComparisonRow(bool SentryMode, double AvgDrainRate, double AvgBatteryLost);

/// <summary>
/// One recent drain event from <c>recent_events</c> (web <c>SleepDrainEvent</c> in web/src/types/energy.ts) the
/// drain-events table reads. The outside temperature is SI Celsius (nullable) and is converted to the user's
/// display unit only at the render boundary; every other field is dimensionless.
/// </summary>
public sealed record SleepDrainEventRecord(
    long Id,
    DateTimeOffset? StartDate,
    double DurationHours,
    double BatteryLost,
    double DrainRate,
    bool SentryMode,
    double? OutsideTemp);

/// <summary>
/// The sleep-efficiency rollup from <c>GET /analytics/sleep</c> (web <c>SleepEfficiencyData</c> in
/// web/src/types/energy.ts, hook <c>useSleepEfficiency</c>), narrowed to the fields the page reads. Percentages
/// are 0..100, drain rates are %/hour, costs are currency and energies are kWh exactly as the API returns them
/// (these analytics scalars are dimensionless / already display-shaped, so no SI conversion applies — only the
/// per-event outside temperature is SI). Parsing is null-tolerant so a partial or schema-drifted body never
/// throws (web parity: the page reads every field with a <c>?? 0</c> guard). Pure data — no WinUI types — so the
/// whole projection is unit-tested without a UI host. A non-object body parses to <see langword="null"/> (the
/// web <c>data</c> being undefined → the page-level empty surface).
/// </summary>
public sealed record SleepEfficiencySummary(
    double SleepEfficiencyPct,
    double TimeToSleepAvgMin,
    double SentryOnDrainRate,
    double SentryOffDrainRate,
    double SentryMonthlyCost,
    double SentryMonthlyKwh,
    double SentryExtraDrainRate,
    double SentryExtraMonthlyKwh,
    double SentryExtraMonthlyCost,
    IReadOnlyList<SleepStateMinutes> StateDistribution,
    IReadOnlyList<SentryComparisonRow> SentryComparison,
    IReadOnlyList<SleepDrainEventRecord> RecentEvents)
{
    /// <summary>The all-zero summary used as the empty / fallback backing value.</summary>
    public static SleepEfficiencySummary Zero { get; } = new(
        0, 0, 0, 0, 0, 0, 0, 0, 0,
        Array.Empty<SleepStateMinutes>(),
        Array.Empty<SentryComparisonRow>(),
        Array.Empty<SleepDrainEventRecord>());

    /// <summary>
    /// Project a <c>GET /analytics/sleep</c> response into the summary, or <see langword="null"/> when the body
    /// is not an object (web <c>!sleep</c> → the empty surface). Any object — even all-zero — yields a usable
    /// summary so the cards render at 0 (web <c>{sleep ? content : empty}</c> with <c>sleep</c> truthy). Reads
    /// the snake_case wire shape so the camelCase transform the web client layers on is irrelevant to the parse.
    /// </summary>
    public static SleepEfficiencySummary? FromJson(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new SleepEfficiencySummary(
            SleepEfficiencyPct: SleepJson.Double(root, "sleep_efficiency_pct") ?? 0,
            TimeToSleepAvgMin: SleepJson.Double(root, "time_to_sleep_avg_min") ?? 0,
            SentryOnDrainRate: SleepJson.Double(root, "sentry_on_drain_rate") ?? 0,
            SentryOffDrainRate: SleepJson.Double(root, "sentry_off_drain_rate") ?? 0,
            SentryMonthlyCost: SleepJson.Double(root, "sentry_monthly_cost") ?? 0,
            SentryMonthlyKwh: SleepJson.Double(root, "sentry_monthly_kwh") ?? 0,
            SentryExtraDrainRate: SleepJson.Double(root, "sentry_extra_drain_rate") ?? 0,
            SentryExtraMonthlyKwh: SleepJson.Double(root, "sentry_extra_monthly_kwh") ?? 0,
            SentryExtraMonthlyCost: SleepJson.Double(root, "sentry_extra_monthly_cost") ?? 0,
            StateDistribution: ReadStateDistribution(root),
            SentryComparison: ReadSentryComparison(root),
            RecentEvents: ReadRecentEvents(root));
    }

    /// <summary>The sentry-on comparison row (web <c>sentry_comparison.find(s =&gt; s.sentry_mode)</c>), or null.</summary>
    public SentryComparisonRow? SentryOn()
    {
        foreach (var row in SentryComparison)
        {
            if (row.SentryMode)
            {
                return row;
            }
        }

        return null;
    }

    /// <summary>The sentry-off comparison row (web <c>sentry_comparison.find(s =&gt; !s.sentry_mode)</c>), or null.</summary>
    public SentryComparisonRow? SentryOff()
    {
        foreach (var row in SentryComparison)
        {
            if (!row.SentryMode)
            {
                return row;
            }
        }

        return null;
    }

    private static IReadOnlyList<SleepStateMinutes> ReadStateDistribution(JsonElement root)
    {
        if (!root.TryGetProperty("state_distribution", out var arr) || arr.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<SleepStateMinutes>();
        }

        var list = new List<SleepStateMinutes>(arr.GetArrayLength());
        foreach (var item in arr.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            string state = SleepJson.String(item, "state") ?? string.Empty;
            double minutes = SleepJson.Double(item, "total_minutes") ?? 0;
            list.Add(new SleepStateMinutes(state, minutes));
        }

        return list;
    }

    private static IReadOnlyList<SentryComparisonRow> ReadSentryComparison(JsonElement root)
    {
        if (!root.TryGetProperty("sentry_comparison", out var arr) || arr.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<SentryComparisonRow>();
        }

        var list = new List<SentryComparisonRow>(arr.GetArrayLength());
        foreach (var item in arr.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            list.Add(new SentryComparisonRow(
                SentryMode: SleepJson.Bool(item, "sentry_mode") ?? false,
                AvgDrainRate: SleepJson.Double(item, "avg_drain_rate") ?? 0,
                AvgBatteryLost: SleepJson.Double(item, "avg_battery_lost") ?? 0));
        }

        return list;
    }

    private static IReadOnlyList<SleepDrainEventRecord> ReadRecentEvents(JsonElement root)
    {
        if (!root.TryGetProperty("recent_events", out var arr) || arr.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<SleepDrainEventRecord>();
        }

        var list = new List<SleepDrainEventRecord>(arr.GetArrayLength());
        foreach (var item in arr.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            list.Add(new SleepDrainEventRecord(
                Id: SleepJson.Long(item, "id") ?? 0,
                StartDate: SleepJson.Instant(item, "start_date"),
                DurationHours: SleepJson.Double(item, "duration_hours") ?? 0,
                BatteryLost: SleepJson.Double(item, "battery_lost") ?? 0,
                DrainRate: SleepJson.Double(item, "drain_rate") ?? 0,
                SentryMode: SleepJson.Bool(item, "sentry_mode") ?? false,
                OutsideTemp: SleepJson.Double(item, "outside_temp")));
        }

        return list;
    }
}

/// <summary>
/// The single-source snapshot the page binds to: the backend sleep rollup. Its presence drives the
/// success / empty state exactly as the web page gates on <c>sleep ?</c>.
/// </summary>
public sealed record SleepEfficiencySnapshot(bool HasData, SleepEfficiencySummary Summary)
{
    /// <summary>The empty snapshot (no backend sleep object) — the page-level empty surface.</summary>
    public static SleepEfficiencySnapshot Empty { get; } = new(false, SleepEfficiencySummary.Zero);

    /// <summary>Compose a snapshot from the parsed sleep summary (may be null → the empty surface).</summary>
    public static SleepEfficiencySnapshot Compose(SleepEfficiencySummary? summary) =>
        summary is { } s ? new SleepEfficiencySnapshot(true, s) : Empty;
}

/// <summary>The single-source data port the page binds to (the native P1/S8 seam). The view never performs HTTP.</summary>
public interface ISleepEfficiencyFeed
{
    /// <summary>Fetch the sleep-efficiency rollup for the active vehicle.</summary>
    Task<SleepEfficiencySnapshot> FetchAsync(CancellationToken cancellationToken);
}

/// <summary>The default feed used by the shell registration: always resolves to the empty surface.</summary>
public sealed class EmptySleepEfficiencyFeed : ISleepEfficiencyFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptySleepEfficiencyFeed Instance { get; } = new();

    private EmptySleepEfficiencyFeed()
    {
    }

    /// <inheritdoc />
    public Task<SleepEfficiencySnapshot> FetchAsync(CancellationToken cancellationToken) =>
        Task.FromResult(SleepEfficiencySnapshot.Empty);
}

/// <summary>The mutually-exclusive top-level data state the page renders (web loading / empty / error / success).</summary>
public enum SleepEfficiencyState
{
    /// <summary>The sleep query is in flight with no data yet — the loading shimmer.</summary>
    Loading,

    /// <summary>Resolved with no backend sleep object — the friendly empty surface, never a blank page.</summary>
    Empty,

    /// <summary>The sleep query failed — the retriable error surface.</summary>
    Error,

    /// <summary>The sleep rollup resolved — the full page content.</summary>
    Success,
}

/// <summary>A summary metric tile (web hero <c>MetricCard</c> grid). Pre-formatted value + glyph + label.</summary>
public sealed record SleepMetricCardDisplay(string Glyph, string Value, string Label, string AutomationName);

/// <summary>One donut wedge / legend chip (web per-state pie datum + legend row): name, minutes, colour, hours.</summary>
public sealed record SleepStateSliceDisplay(string Name, double Minutes, int ColorIndex, string HoursText);

/// <summary>The State-Distribution donut projection (web <c>ChartContainer</c> + <c>PieChart</c> + legend).</summary>
public sealed record SleepDonutDisplay(
    bool HasData,
    string Title,
    string AriaLabel,
    string EmptyMessage,
    IReadOnlyList<SleepStateSliceDisplay> Slices,
    IReadOnlyList<ChartPoint> Points);

/// <summary>One grouped bar-chart series (web <c>Bar dataKey="sentry_on"|"sentry_off"</c>).</summary>
public sealed record SleepComparisonSeriesDisplay(string Name, int ColorIndex, IReadOnlyList<ChartPoint> Points);

/// <summary>The Sentry-vs-No-Sentry comparison projection (web <c>ChartContainer</c> + <c>BarChart</c>).</summary>
public sealed record SleepComparisonDisplay(
    bool HasData,
    string Title,
    string AriaLabel,
    string EmptyMessage,
    IReadOnlyList<string> Categories,
    IReadOnlyList<SleepComparisonSeriesDisplay> Series);

/// <summary>One stat in the monthly-sentry-impact callout (web amber 3-up grid): pre-formatted value + label.</summary>
public sealed record SleepImpactStatDisplay(string Value, string Label);

/// <summary>A single recent-drain-events table row (web per-event list item; values already formatted).</summary>
public sealed record SleepDrainRowDisplay(
    string Id,
    string Date,
    string Duration,
    string BatteryLost,
    string DrainRate,
    string Sentry,
    string Temp,
    string AutomationName);

/// <summary>
/// The fully-resolved render model the WinUI view binds to — every branch, format and string the web
/// <c>SleepEfficiencyPage</c> computes, resolved once so the view is a thin renderer. Pure data — no WinUI
/// types — so the whole projection is unit-tested without a UI host.
/// </summary>
public sealed record SleepEfficiencyDisplay(
    SleepEfficiencyState State,
    string Title,
    string Subtitle,
    bool ShowLoading,
    bool ShowError,
    bool ShowEmpty,
    bool ShowContent,
    string ErrorText,
    string RetryLabel,
    string EmptyMessage,
    string SelectVehicleLabel,
    IReadOnlyList<SleepMetricCardDisplay> MetricCards,
    SleepDonutDisplay Donut,
    SleepComparisonDisplay Comparison,
    string ImpactTitle,
    IReadOnlyList<SleepImpactStatDisplay> ImpactStats,
    string RecentTitle,
    IReadOnlyList<string> TableColumns,
    IReadOnlyList<SleepDrainRowDisplay> TableRows,
    string TableEmptyMessage,
    string AutomationName);

/// <summary>
/// The render-time input the projection consumes — the parsed <see cref="Snapshot"/> plus the page lifecycle
/// (the sleep query's <see cref="Loading"/> / <see cref="ErrorDetail"/>). The view-model fills this in; tests
/// construct it directly. Pure data — no WinUI types.
/// </summary>
public sealed record SleepEfficiencyModel(SleepEfficiencySnapshot Snapshot, bool Loading, string? ErrorDetail)
{
    /// <summary>The initial model: the sleep query is in flight with no data yet.</summary>
    public static SleepEfficiencyModel Initial { get; } = new(SleepEfficiencySnapshot.Empty, true, null);
}

/// <summary>
/// The fully-resolved set of localized strings the page renders — every key the web <c>SleepEfficiencyPage</c>
/// feeds into <c>t(...)</c>, resolved once through the i18n facade so the projection stays readable and the
/// string-coverage test asserts all of them in one pass. Key names match the web verbatim.
/// </summary>
public sealed record SleepStrings
{
    public required string Title { get; init; }
    public required string Subtitle { get; init; }
    public required string SelectVehicle { get; init; }
    public required string Efficiency { get; init; }
    public required string AvgTimeToSleep { get; init; }
    public required string SentryDrainRate { get; init; }
    public required string SentryMonthlyCost { get; init; }
    public required string StateDistribution { get; init; }
    public required string StateDistributionAria { get; init; }
    public required string NoStateData { get; init; }
    public required string SentryComparison { get; init; }
    public required string SentryComparisonAria { get; init; }
    public required string NoSentryData { get; init; }
    public required string DrainRate { get; init; }
    public required string AvgBatteryLost { get; init; }
    public required string SentryOn { get; init; }
    public required string SentryOff { get; init; }
    public required string MonthlySentryImpact { get; init; }
    public required string ExtraDrainHr { get; init; }
    public required string ExtraMonthly { get; init; }
    public required string ExtraCostMo { get; init; }
    public required string RecentDrainEvents { get; init; }
    public required string Date { get; init; }
    public required string Duration { get; init; }
    public required string BatteryLost { get; init; }
    public required string DrainRateCol { get; init; }
    public required string Sentry { get; init; }
    public required string Temp { get; init; }
    public required string On { get; init; }
    public required string Off { get; init; }
    public required string NoDrainEvents { get; init; }
    public required string NoData { get; init; }
    public required string ErrorTitle { get; init; }
    public required string Retry { get; init; }

    /// <summary>Resolve every string the page renders through the i18n facade (web key names, verbatim).</summary>
    public static SleepStrings Resolve(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return new SleepStrings
        {
            Title = localizer.GetString("sleep.title", "Sleep Efficiency"),
            Subtitle = localizer.GetString(
                "sleep.subtitle",
                "Analyze vehicle sleep patterns, vampire drain, and sentry mode costs"),
            SelectVehicle = localizer.GetString("sleep.selectVehicle", "Select vehicle"),
            Efficiency = localizer.GetString("sleep.efficiency", "Sleep Efficiency"),
            AvgTimeToSleep = localizer.GetString("sleep.avgTimeToSleep", "Avg Time to Sleep"),
            SentryDrainRate = localizer.GetString("sleep.sentryDrainRate", "Sentry Drain Rate"),
            SentryMonthlyCost = localizer.GetString("sleep.sentryMonthlyCost", "Sentry Monthly Cost"),
            StateDistribution = localizer.GetString("sleep.stateDistribution", "State Distribution"),
            StateDistributionAria = localizer.GetString(
                "sleep.stateDistribution.aria",
                "State distribution donut chart with per-state hours in the legend"),
            NoStateData = localizer.GetString("sleep.noStateData", "No state distribution data available"),
            SentryComparison = localizer.GetString("sleep.sentryComparison", "Sentry vs No-Sentry"),
            SentryComparisonAria = localizer.GetString(
                "sleep.sentryComparison.aria",
                "Sentry on versus sentry off drain comparison bar chart"),
            NoSentryData = localizer.GetString("sleep.noSentryData", "No sentry comparison data available"),
            DrainRate = localizer.GetString("sleep.drainRate", "Drain Rate (%/hr)"),
            AvgBatteryLost = localizer.GetString("sleep.avgBatteryLost", "Avg Battery Lost (%)"),
            SentryOn = localizer.GetString("sleep.sentryOn", "Sentry On"),
            SentryOff = localizer.GetString("sleep.sentryOff", "Sentry Off"),
            MonthlySentryImpact = localizer.GetString("sleep.monthlySentryImpact", "Monthly Sentry Mode Impact"),
            ExtraDrainHr = localizer.GetString("sleep.extraDrainHr", "Extra drain/hr"),
            ExtraMonthly = localizer.GetString("sleep.extraMonthly", "Extra monthly"),
            ExtraCostMo = localizer.GetString("sleep.extraCostMo", "Extra cost/mo"),
            RecentDrainEvents = localizer.GetString("sleep.recentDrainEvents", "Recent Drain Events"),
            Date = localizer.GetString("sleep.date", "Date"),
            Duration = localizer.GetString("sleep.duration", "Duration"),
            BatteryLost = localizer.GetString("sleep.batteryLost", "Battery Lost"),
            DrainRateCol = localizer.GetString("sleep.drainRateCol", "Drain Rate"),
            Sentry = localizer.GetString("sleep.sentry", "Sentry"),
            Temp = localizer.GetString("sleep.temp", "Temp"),
            On = localizer.GetString("common.on", "On"),
            Off = localizer.GetString("common.off", "Off"),
            NoDrainEvents = localizer.GetString("sleep.noDrainEvents", "No drain events recorded yet"),
            NoData = localizer.GetString(
                "sleep.noData",
                "No sleep data available. Data will appear after your vehicle records sleep/wake events."),
            ErrorTitle = localizer.GetString("sleep.error", "Unable to load sleep efficiency"),
            Retry = localizer.GetString("common.retry", "Retry"),
        };
    }
}

/// <summary>
/// Pure projection from a <see cref="SleepEfficiencyModel"/> to its <see cref="SleepEfficiencyDisplay"/> — the
/// native port of the render logic in web/src/features/battery/pages/SleepEfficiencyPage.tsx and its
/// <c>STATE_LABELS</c> / <c>STATE_COLORS</c> / <c>pieData</c> / <c>comparisonData</c> derivations. The branch
/// precedence mirrors the web data lifecycle (loading → error → empty → success); the rollup feeds the four
/// metric cards, the state-distribution donut, the sentry-comparison bar chart, the monthly-impact callout and
/// the recent-drain-events table. Every label resolves through the i18n facade using the same keys the web page
/// uses; the only SI value — the per-event outside temperature — is converted at this display boundary.
/// </summary>
public static class SleepEfficiencyProjection
{
    /// <summary>Segoe Fluent — QuietHours crescent moon (web <c>Moon</c>).</summary>
    public const string MoonGlyph = "\uE708";

    /// <summary>Segoe Fluent — Clock (web <c>Clock</c>).</summary>
    public const string ClockGlyph = "\uE917";

    /// <summary>Segoe Fluent — RedEye (web <c>Eye</c>).</summary>
    public const string EyeGlyph = "\uE7B3";

    /// <summary>Segoe Fluent — Money / financial (web <c>DollarSign</c>).</summary>
    public const string MoneyGlyph = "\uE1D6";

    /// <summary>Segoe Fluent — LightningBolt (web <c>Zap</c> in the recent-events header).</summary>
    public const string ZapGlyph = "\uE945";

    private const int PercentPrecision = 2;
    private const int NumberPrecision = 2;
    private const int TempPrecision = 2;
    private const string EmDash = "\u2014";

    /// <summary>The amber accent the sentry-on bars + impact callout use (web <c>#f59e0b</c>, brand index 2).</summary>
    public const int SentryOnColorIndex = 2;

    /// <summary>The purple accent the sentry-off bars use (web <c>#a855f7</c>, brand index 4).</summary>
    public const int SentryOffColorIndex = 4;

    // Web STATE_LABELS (web source L369-376): the FSM state name → its friendly label. These are plain data
    // labels the web hardcodes (never run through t()), so the native port mirrors them verbatim for parity.
    private static readonly IReadOnlyList<string> StateOrder =
        ["asleep", "online", "driving", "charging", "updating", "suspended"];

    private static readonly Dictionary<string, string> StateLabels = new(StringComparer.Ordinal)
    {
        ["asleep"] = "Sleeping",
        ["online"] = "Online/Idle",
        ["driving"] = "Driving",
        ["charging"] = "Charging",
        ["updating"] = "Updating",
        ["suspended"] = "Suspended",
    };

    /// <summary>Project <paramref name="model"/> into a render-ready display using the active units + localizer.</summary>
    /// <param name="model">The parsed sleep data plus the page lifecycle flags.</param>
    /// <param name="units">The user's unit-display preference (applied only at this boundary).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">Injectable clock for deterministic date formatting in tests.</param>
    public static SleepEfficiencyDisplay Project(
        SleepEfficiencyModel model,
        UnitPref units,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var s = SleepStrings.Resolve(localizer);
        var snapshot = model.Snapshot;
        var data = snapshot.Summary;

        SleepEfficiencyState state =
            model.Loading && !snapshot.HasData ? SleepEfficiencyState.Loading
            : model.ErrorDetail is not null ? SleepEfficiencyState.Error
            : !snapshot.HasData ? SleepEfficiencyState.Empty
            : SleepEfficiencyState.Success;

        string errorText = string.IsNullOrWhiteSpace(model.ErrorDetail)
            ? s.ErrorTitle
            : $"{s.ErrorTitle}: {model.ErrorDetail}";

        var metricCards = BuildMetricCards(data, s);
        var donut = BuildDonut(data, s);
        var comparison = BuildComparison(data, s);
        var impactStats = BuildImpactStats(data, s);
        var (columns, rows) = BuildTable(data, s, units, now);

        return new SleepEfficiencyDisplay(
            State: state,
            Title: s.Title,
            Subtitle: s.Subtitle,
            ShowLoading: state == SleepEfficiencyState.Loading,
            ShowError: state == SleepEfficiencyState.Error,
            ShowEmpty: state == SleepEfficiencyState.Empty,
            ShowContent: state == SleepEfficiencyState.Success,
            ErrorText: errorText,
            RetryLabel: s.Retry,
            EmptyMessage: s.NoData,
            SelectVehicleLabel: s.SelectVehicle,
            MetricCards: metricCards,
            Donut: donut,
            Comparison: comparison,
            ImpactTitle: s.MonthlySentryImpact,
            ImpactStats: impactStats,
            RecentTitle: s.RecentDrainEvents,
            TableColumns: columns,
            TableRows: rows,
            TableEmptyMessage: s.NoDrainEvents,
            AutomationName: $"{s.Title}. {s.Subtitle}");
    }

    /// <summary>Map a state FSM name to its friendly donut label (web <c>STATE_LABELS[s.state] ?? s.state</c>).</summary>
    public static string StateLabel(string state) =>
        StateLabels.TryGetValue(state, out var label) ? label : state;

    /// <summary>
    /// The brand palette index a state's donut wedge + legend chip share (web <c>STATE_COLORS</c>): a fixed
    /// per-state index so the colour is stable across renders, falling back to the slice position for any state
    /// the web map does not name (web <c>STATE_COLORS[s.state] ?? CHART_COLORS[0]</c>).
    /// </summary>
    public static int StateColorIndex(string state, int position)
    {
        for (int i = 0; i < StateOrder.Count; i++)
        {
            if (string.Equals(StateOrder[i], state, StringComparison.Ordinal))
            {
                return i;
            }
        }

        return position;
    }

    private static IReadOnlyList<SleepMetricCardDisplay> BuildMetricCards(SleepEfficiencySummary data, SleepStrings s)
    {
        // Web parity (web source L180-231): four MetricCards reading the rollup scalars verbatim. The unit
        // suffixes ("%", " min", "%/hr") and the currency symbol are the web's literal formats.
        string efficiency = ScalarFormatters.FormatPercentage(data.SleepEfficiencyPct, PercentPrecision);
        string timeToSleep = $"{ScalarFormatters.FormatNumber(data.TimeToSleepAvgMin, 0)} min";
        string sentryDrain = $"{ScalarFormatters.FormatNumber(data.SentryOnDrainRate, NumberPrecision)}%/hr";
        string sentryCost = ScalarFormatters.FormatCurrency(data.SentryMonthlyCost);

        return
        [
            new SleepMetricCardDisplay(MoonGlyph, efficiency, s.Efficiency, $"{s.Efficiency}: {efficiency}"),
            new SleepMetricCardDisplay(ClockGlyph, timeToSleep, s.AvgTimeToSleep, $"{s.AvgTimeToSleep}: {timeToSleep}"),
            new SleepMetricCardDisplay(EyeGlyph, sentryDrain, s.SentryDrainRate, $"{s.SentryDrainRate}: {sentryDrain}"),
            new SleepMetricCardDisplay(MoneyGlyph, sentryCost, s.SentryMonthlyCost, $"{s.SentryMonthlyCost}: {sentryCost}"),
        ];
    }

    private static SleepDonutDisplay BuildDonut(SleepEfficiencySummary data, SleepStrings s)
    {
        // Web parity (web source L75-83): pieData maps each state slice to { name, value=round(minutes),
        // color, hours=fmtNumber(minutes/60) }.
        var slices = new List<SleepStateSliceDisplay>(data.StateDistribution.Count);
        var points = new List<ChartPoint>(data.StateDistribution.Count);
        for (int i = 0; i < data.StateDistribution.Count; i++)
        {
            var slice = data.StateDistribution[i];
            string name = StateLabel(slice.State);
            double minutes = Math.Round(slice.TotalMinutes);
            int colorIndex = StateColorIndex(slice.State, i);
            string hours = $"{ScalarFormatters.FormatNumber(slice.TotalMinutes / 60.0, NumberPrecision)}h";

            slices.Add(new SleepStateSliceDisplay(name, minutes, colorIndex, hours));
            points.Add(new ChartPoint(0, minutes, name));
        }

        return new SleepDonutDisplay(
            HasData: slices.Count > 0,
            Title: s.StateDistribution,
            AriaLabel: s.StateDistributionAria,
            EmptyMessage: s.NoStateData,
            Slices: slices,
            Points: points);
    }

    private static SleepComparisonDisplay BuildComparison(SleepEfficiencySummary data, SleepStrings s)
    {
        // Web parity (web source L85-99): comparisonData has two categories (Drain Rate, Avg Battery Lost) each
        // with a sentry_on / sentry_off value drawn from the matching comparison row.
        var on = data.SentryOn();
        var off = data.SentryOff();

        double onDrain = on?.AvgDrainRate ?? 0;
        double offDrain = off?.AvgDrainRate ?? 0;
        double onLost = on?.AvgBatteryLost ?? 0;
        double offLost = off?.AvgBatteryLost ?? 0;

        var categories = new[] { s.DrainRate, s.AvgBatteryLost };

        var series = new List<SleepComparisonSeriesDisplay>
        {
            new(s.SentryOn, SentryOnColorIndex, [new ChartPoint(0, onDrain, s.DrainRate), new ChartPoint(1, onLost, s.AvgBatteryLost)]),
            new(s.SentryOff, SentryOffColorIndex, [new ChartPoint(0, offDrain, s.DrainRate), new ChartPoint(1, offLost, s.AvgBatteryLost)]),
        };

        // Web parity: the chart renders only when some value is positive (comparisonData.some(d => on>0||off>0)).
        bool hasData = onDrain > 0 || offDrain > 0 || onLost > 0 || offLost > 0;

        return new SleepComparisonDisplay(
            HasData: hasData,
            Title: s.SentryComparison,
            AriaLabel: s.SentryComparisonAria,
            EmptyMessage: s.NoSentryData,
            Categories: categories,
            Series: series);
    }

    private static IReadOnlyList<SleepImpactStatDisplay> BuildImpactStats(SleepEfficiencySummary data, SleepStrings s)
    {
        // Web parity (web source L313-326): the amber callout's three stats.
        string extraDrain = $"{ScalarFormatters.FormatNumber(data.SentryExtraDrainRate, NumberPrecision)}%";
        string extraMonthly = $"{ScalarFormatters.FormatNumber(data.SentryExtraMonthlyKwh, NumberPrecision)} kWh";
        string extraCost = ScalarFormatters.FormatCurrency(data.SentryExtraMonthlyCost);

        return
        [
            new SleepImpactStatDisplay(extraDrain, s.ExtraDrainHr),
            new SleepImpactStatDisplay(extraMonthly, s.ExtraMonthly),
            new SleepImpactStatDisplay(extraCost, s.ExtraCostMo),
        ];
    }

    private static (IReadOnlyList<string> Columns, IReadOnlyList<SleepDrainRowDisplay> Rows) BuildTable(
        SleepEfficiencySummary data,
        SleepStrings s,
        UnitPref units,
        DateTimeOffset now)
    {
        var columns = new[] { s.Date, s.Duration, s.BatteryLost, s.DrainRateCol, s.Sentry, s.Temp };

        var rows = new List<SleepDrainRowDisplay>(data.RecentEvents.Count);
        foreach (var e in data.RecentEvents)
        {
            string date = e.StartDate is { } ts
                ? DateTimeFormatting.Format(ts, DateTimeVariant.Full, now)
                : EmDash;
            string duration = $"{ScalarFormatters.FormatNumber(e.DurationHours, NumberPrecision)}h";
            string batteryLost = $"{ScalarFormatters.FormatNumber(e.BatteryLost, NumberPrecision)}%";
            string drainRate = $"{ScalarFormatters.FormatNumber(e.DrainRate, NumberPrecision)}%/hr";
            string sentry = e.SentryMode ? s.On : s.Off;
            string temp = e.OutsideTemp is { } celsius
                ? $"{ScalarFormatters.FormatNumber(UnitConverters.TemperatureFromSi(celsius, units.Temperature), TempPrecision)}{UnitLabels.Label(units.Temperature)}"
                : EmDash;

            rows.Add(new SleepDrainRowDisplay(
                e.Id.ToString(CultureInfo.InvariantCulture),
                date,
                duration,
                batteryLost,
                drainRate,
                sentry,
                temp,
                $"{date}, {duration}, {batteryLost}, {drainRate}, {sentry}, {temp}"));
        }

        return (columns, rows);
    }
}

/// <summary>
/// Null-tolerant <see cref="JsonElement"/> readers for the Sleep-Efficiency page — every getter returns a
/// nullable rather than throwing so a partial or schema-drifted body never aborts the parse (web parity: the
/// page tolerates undefined fields). WinUI-free so the parse is unit-tested without a UI host. Reads the
/// snake_case wire shape (no camelCaseKeys transform on native) but also accepts the camelCase alias.
/// </summary>
internal static class SleepJson
{
    /// <summary>The numeric value of <paramref name="name"/>, tolerating a numeric or numeric-string field.</summary>
    public static double? Double(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !TryGet(obj, name, out var prop))
        {
            return null;
        }

        return prop.ValueKind switch
        {
            JsonValueKind.Number when prop.TryGetDouble(out var n) && !double.IsNaN(n) && !double.IsInfinity(n) => n,
            JsonValueKind.String when double.TryParse(prop.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var sv) => sv,
            _ => null,
        };
    }

    /// <summary>The integer value of <paramref name="name"/>, tolerating a numeric or numeric-string field.</summary>
    public static long? Long(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !TryGet(obj, name, out var prop))
        {
            return null;
        }

        return prop.ValueKind switch
        {
            JsonValueKind.Number when prop.TryGetInt64(out var n) => n,
            JsonValueKind.Number when prop.TryGetDouble(out var d) => (long)d,
            JsonValueKind.String when long.TryParse(prop.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var sv) => sv,
            _ => null,
        };
    }

    /// <summary>The boolean value of <paramref name="name"/>, tolerating a bool or "true"/"false" string.</summary>
    public static bool? Bool(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !TryGet(obj, name, out var prop))
        {
            return null;
        }

        return prop.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.String when bool.TryParse(prop.GetString(), out var bv) => bv,
            _ => null,
        };
    }

    /// <summary>The string value of <paramref name="name"/>, or null when absent / not a string.</summary>
    public static string? String(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object
            || !TryGet(obj, name, out var prop)
            || prop.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return prop.GetString();
    }

    /// <summary>The timestamp value of <paramref name="name"/>, or null when absent / unparseable.</summary>
    public static DateTimeOffset? Instant(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object
            || !TryGet(obj, name, out var prop)
            || prop.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            prop.GetString(),
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var parsed)
            ? parsed
            : null;
    }

    private static bool TryGet(JsonElement obj, string snake, out JsonElement value)
    {
        if (obj.TryGetProperty(snake, out value))
        {
            return true;
        }

        return obj.TryGetProperty(ToCamel(snake), out value);
    }

    private static string ToCamel(string snake)
    {
        if (!snake.Contains('_', StringComparison.Ordinal))
        {
            return snake;
        }

        var parts = snake.Split('_', StringSplitOptions.RemoveEmptyEntries);
        var sb = new System.Text.StringBuilder(parts[0]);
        for (int i = 1; i < parts.Length; i++)
        {
            sb.Append(char.ToUpperInvariant(parts[i][0])).Append(parts[i], 1, parts[i].Length - 1);
        }

        return sb.ToString();
    }
}

/// <summary>
/// Canonical navigation + diagnostics metadata for the Sleep-Efficiency page — the native mirror of the web
/// page at web/src/features/battery/pages/SleepEfficiencyPage.tsx (route <c>/sleep-efficiency</c>, nav name
/// <c>SleepEfficiency</c>). The page reads the same sleep-analytics rollup the web <c>useSleepEfficiency</c>
/// hook reads (generated operation <c>get_api_v1_analytics_sleep</c>).
/// </summary>
public static class SleepEfficiencyRegistration
{
    /// <summary>The navigation route name the shell registers this page under (matches <c>RouteTable</c>).</summary>
    public const string RouteName = "SleepEfficiency";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "SleepEfficiencyPage";

    /// <summary>The generated operation id for the sleep-analytics read (web <c>useSleepEfficiency</c>).</summary>
    public const string SleepOperation = Operations.Analytics.Sleep;

    /// <summary>The Segoe Fluent glyph for the page-level empty surface (web <c>Moon</c>).</summary>
    public const string EmptyGlyph = SleepEfficiencyProjection.MoonGlyph;

    /// <summary>The localized page title (web <c>t('sleep.title')</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("sleep.title", "Sleep Efficiency");
    }
}

/// <summary>
/// PII-safe diagnostics sink for the Sleep-Efficiency surface — records only the <c>view.opened</c> event with
/// the surface slug, never any vehicle data. Mirrors the sibling feature-view diagnostics.
/// </summary>
public sealed class SleepEfficiencyDiagnostics
{
    private readonly Action<string>? _sink;
    private int _viewsOpened;

    /// <summary>Creates the diagnostics sink over an optional line writer.</summary>
    public SleepEfficiencyDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>The number of times the surface was opened.</summary>
    public int ViewsOpened => _viewsOpened;

    /// <summary>Record that the surface was opened (PII-safe).</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SleepEfficiencyRegistration.Slug}");
    }
}
