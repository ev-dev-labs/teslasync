using System.Collections.Generic;
using System.Globalization;
using System.Text;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive render branch of the <c>ChargingSection</c> surface — the native union of the
/// states the web component participates in
/// (web/src/features/analytics/components/weekly-digest/ChargingSection.tsx). The web source is a pure
/// presentational child of the Weekly-Digest page (it takes <c>metrics</c> + <c>dailyEnergyData</c> props and
/// performs no fetching), so the branches are a direct function of the input <see cref="ChargingSectionModel"/>
/// — the parent page owns the query lifecycle (the web <c>WeeklyDigestPage</c> renders a skeleton while the
/// drives/charging/alerts queries load and a page-level empty state when the whole week has no data, mounting
/// the sections only once data has resolved). There is therefore no fetch-driven error / stale / offline
/// branch to reproduce inside this surface; every branch maps onto a visible surface and none is ever hidden.
/// </summary>
public enum ChargingSectionState
{
    /// <summary>The Weekly-Digest queries have not resolved yet (the parent is still fetching) — skeleton chrome.</summary>
    Loading,

    /// <summary>Resolved with no charging activity for the week — friendly empty state instead of an all-zero chart.</summary>
    Empty,

    /// <summary>At least one charge session / some energy added (web fall-through) — the chart + stats + week badge.</summary>
    Ready,
}

/// <summary>
/// One projected day bucket of the Daily-Energy-Added bar chart — the native analogue of a single
/// <c>DailyEnergyEntry</c> the web <c>useWeeklyDigest</c> hook bins (<c>{ day, energy }</c>). <see cref="Day"/>
/// is the already-localized weekday label the parent supplies (Mon..Sun); <see cref="Energy"/> is the summed
/// energy added for that day, carried verbatim from the web metric and rendered with the web's "kWh" axis
/// label. Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
public sealed record ChargingSectionDailyEnergy(string Day, double Energy);

/// <summary>
/// The render-time data model the <c>ChargingSection</c> view binds to — the native analogue of the web
/// component's two props (<c>metrics: DigestMetrics</c> narrowed to the charging fields the section reads, plus
/// <c>dailyEnergyData</c>) and the parent's fetch flag. The component is presentational; user-facing labels are
/// resolved from the i18n facade by the projection, not passed in. The numeric fields mirror the web digest
/// metrics verbatim (<c>chargingSessionCount</c>, <c>chargeEnergyAdded</c>, <c>avgChargeRate</c>,
/// <c>chargingCost</c>, <c>prevChargeEnergy</c>) and are rendered with the web's exact formatting and unit
/// suffixes — no display conversion happens here, matching the presentational web source. Pure data — no WinUI
/// types — so the projection is unit-tested without a UI host.
/// </summary>
public sealed record ChargingSectionModel(
    bool Loading,
    long ChargingSessionCount,
    double ChargeEnergyAdded,
    double AvgChargeRate,
    double ChargingCost,
    double PrevChargeEnergy,
    IReadOnlyList<ChargingSectionDailyEnergy> DailyEnergy)
{
    /// <summary>The initial model: the Weekly-Digest fetch is in flight and no charging data has arrived yet.</summary>
    public static ChargingSectionModel Pending { get; } =
        new(true, 0, 0, 0, 0, 0, []);

    /// <summary>A resolved model with no charging activity — the empty state.</summary>
    public static ChargingSectionModel Empty { get; } =
        new(false, 0, 0, 0, 0, 0, []);
}

/// <summary>
/// One projected, render-ready charging mini-stat — the native analogue of a single web <c>MiniStat</c> tile
/// (label + value + decorative icon inside a glass panel). <see cref="Label"/> is the localized caption;
/// <see cref="Value"/> is the pre-formatted value string (already carrying its unit suffix / currency symbol so
/// the view never does number math); <see cref="Glyph"/> is the decorative Segoe Fluent glyph; and
/// <see cref="AutomationName"/> is the spoken "<c>{label}: {value}</c>". Pure data.
/// </summary>
public sealed record ChargingSectionStat(string Label, string Value, string Glyph, string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the section for one input model — the native analogue of what the
/// web <c>ChargingSection</c> renders. Holds the active <see cref="State"/>, the "Charging" <see cref="Title"/>
/// + its decorative <see cref="TitleGlyph"/>, the Daily-Energy chart's <see cref="ChartTitle"/> /
/// <see cref="EnergySeriesLabel"/> / <see cref="DailyEnergy"/> buckets and a spoken <see cref="ChartSummary"/>,
/// the four <see cref="Stats"/>, the week-over-week row (<see cref="WeekOverWeekLabel"/>, the success/warning
/// <see cref="WeekOverWeekStatus"/>, the <see cref="WeekOverWeekText"/> percentage-or-dash and its
/// <see cref="WeekOverWeekAutomationName"/>), the empty + loading copy, and the surface
/// <see cref="AutomationName"/>. Pure data so every branch is asserted headlessly.
/// </summary>
public sealed record ChargingSectionDisplay(
    ChargingSectionState State,
    string Title,
    string TitleGlyph,
    string ChartTitle,
    string EnergySeriesLabel,
    IReadOnlyList<ChargingSectionDailyEnergy> DailyEnergy,
    string ChartSummary,
    IReadOnlyList<ChargingSectionStat> Stats,
    string WeekOverWeekLabel,
    StatusKind WeekOverWeekStatus,
    string WeekOverWeekText,
    string WeekOverWeekAutomationName,
    string EmptyMessage,
    string LoadingLabel,
    string AutomationName)
{
    /// <summary>True when there is at least one day bucket to chart (otherwise the view shows an empty-chart note).</summary>
    public bool HasChart => DailyEnergy.Count > 0;
}

/// <summary>
/// Pure projection from a <see cref="ChargingSectionModel"/> to its <see cref="ChargingSectionDisplay"/> — the
/// native port of web/src/features/analytics/components/weekly-digest/ChargingSection.tsx. The branch precedence
/// mirrors the web data lifecycle the parent page drives (loading → empty → ready); the four mini-stats render
/// through <see cref="NumberFormatting"/> with the web's exact precisions and literal unit suffixes
/// (<c>fmtInt</c> sessions, <c>fmtNumber(_, 1) + " kWh"</c>, <c>fmtNumber(_, 1) + " kW"</c>, and
/// <c>formatCurrency(_, 2)</c> = <c>{symbol}{fmtNumber(_, 2)}</c>); and the week-over-week chip reproduces the
/// web badge exactly — <c>variant = chargeEnergyAdded &gt;= prevChargeEnergy ? success : warning</c> and
/// <c>text = prevChargeEnergy &gt; 0 ? `${fmtNumber(pctChange(...), 1)}%` : '—'</c>. Non-finite inputs are
/// coerced to zero (the web <c>safeNumber</c> guard inside <c>fmtNumber</c>). Every label resolves through the
/// i18n facade using the same keys the web source feeds into <c>t(...)</c>. No WinUI types — unit-tested
/// without a UI host.
/// </summary>
public static class ChargingSectionProjection
{
    /// <summary>Decorative lightning glyph (Segoe Fluent — LightningBolt; web <c>Zap</c>).</summary>
    public const string ZapGlyph = "\uE945";

    /// <summary>Decorative activity glyph (Segoe Fluent — activity line; web <c>Activity</c>).</summary>
    public const string ActivityGlyph = "\uE9D2";

    /// <summary>Decorative money glyph (Segoe Fluent — money; the native cost mapping of the web <c>Fuel</c> icon).</summary>
    public const string CostGlyph = "\uE1D3";

    /// <summary>The em-dash the web badge shows when there is no previous-week baseline to compare against.</summary>
    public const string EmDash = "\u2014";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade + currency.</summary>
    /// <param name="model">The render-time data model (the web props, narrowed to the charging fields).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="currencySymbol">The active currency symbol for the Total Cost stat (defaults to <c>$</c>).</param>
    public static ChargingSectionDisplay Project(
        ChargingSectionModel model,
        ILocalizer localizer,
        string? currencySymbol = null)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        string currency = string.IsNullOrWhiteSpace(currencySymbol) ? "$" : currencySymbol;

        string title = localizer.GetString("analytics.weeklyDigest.chargingSection", "Charging");
        string chartTitle = localizer.GetString("analytics.weeklyDigest.dailyEnergyAdded", "Daily Energy Added (kWh)");
        string energyLabel = localizer.GetString("analytics.weeklyDigest.energyAdded", "Energy Added");
        string emptyMessage = localizer.GetString("chart.noData", "No data available");
        string loadingLabel = localizer.GetString("common.loading", "Loading");

        IReadOnlyList<ChargingSectionDailyEnergy> daily = NormalizeDaily(model.DailyEnergy);
        ChargingSectionState state = SelectState(model, daily);

        IReadOnlyList<ChargingSectionStat> stats = BuildStats(model, localizer, currency);
        string chartSummary = BuildChartSummary(chartTitle, daily);

        string wowLabel = localizer.GetString("analytics.weeklyDigest.energyVsLastWeek", "Energy vs. Last Week");
        StatusKind wowStatus = Safe(model.ChargeEnergyAdded) >= Safe(model.PrevChargeEnergy)
            ? StatusKind.Success
            : StatusKind.Warning;
        string wowText = Safe(model.PrevChargeEnergy) > 0
            ? NumberFormatting.Format(Safe(PctChange(Safe(model.ChargeEnergyAdded), Safe(model.PrevChargeEnergy))), null, 1) + "%"
            : EmDash;
        string wowAutomation = $"{wowLabel}: {wowText}";

        string automationName = BuildAutomationName(state, title, stats, wowLabel, wowText, emptyMessage, loadingLabel);

        return new ChargingSectionDisplay(
            State: state,
            Title: title,
            TitleGlyph: ZapGlyph,
            ChartTitle: chartTitle,
            EnergySeriesLabel: energyLabel,
            DailyEnergy: daily,
            ChartSummary: chartSummary,
            Stats: stats,
            WeekOverWeekLabel: wowLabel,
            WeekOverWeekStatus: wowStatus,
            WeekOverWeekText: wowText,
            WeekOverWeekAutomationName: wowAutomation,
            EmptyMessage: emptyMessage,
            LoadingLabel: loadingLabel,
            AutomationName: automationName);
    }

    /// <summary>Branch precedence from the web data lifecycle: loading → empty → ready.</summary>
    private static ChargingSectionState SelectState(
        ChargingSectionModel model,
        IReadOnlyList<ChargingSectionDailyEnergy> daily)
    {
        if (model.Loading)
        {
            return ChargingSectionState.Loading;
        }

        // A week with no sessions, no energy added and no charted energy has no charging story to tell —
        // collapse to a friendly empty state rather than rendering an all-zero chart and "0" stats.
        bool hasActivity =
            model.ChargingSessionCount > 0
            || Safe(model.ChargeEnergyAdded) > 0
            || HasPositiveEnergy(daily);

        return hasActivity ? ChargingSectionState.Ready : ChargingSectionState.Empty;
    }

    private static IReadOnlyList<ChargingSectionStat> BuildStats(
        ChargingSectionModel model,
        ILocalizer localizer,
        string currency)
    {
        // Web: fmtInt(metrics.chargingSessionCount)
        var sessions = Stat(
            localizer.GetString("analytics.weeklyDigest.sessions", "Sessions"),
            NumberFormatting.Format(model.ChargingSessionCount, null, 0),
            ZapGlyph);

        // Web: `${fmtNumber(metrics.chargeEnergyAdded, 1)} kWh`
        var totalEnergy = Stat(
            localizer.GetString("analytics.weeklyDigest.totalEnergyAdded", "Total Energy Added"),
            NumberFormatting.Format(Safe(model.ChargeEnergyAdded), null, 1) + " kWh",
            ZapGlyph);

        // Web: `${fmtNumber(metrics.avgChargeRate, 1)} kW`
        var avgRate = Stat(
            localizer.GetString("analytics.weeklyDigest.avgChargeRate", "Avg Charge Rate"),
            NumberFormatting.Format(Safe(model.AvgChargeRate), null, 1) + " kW",
            ActivityGlyph);

        // Web: formatCurrency(metrics.chargingCost, 2) = `${currencySymbol}${fmtNumber(amount, 2)}`
        var totalCost = Stat(
            localizer.GetString("analytics.weeklyDigest.totalCost", "Total Cost"),
            currency + NumberFormatting.Format(Safe(model.ChargingCost), null, 2),
            CostGlyph);

        return [sessions, totalEnergy, avgRate, totalCost];
    }

    private static ChargingSectionStat Stat(string label, string value, string glyph) =>
        new(label, value, glyph, $"{label}: {value}");

    private static List<ChargingSectionDailyEnergy> NormalizeDaily(
        IReadOnlyList<ChargingSectionDailyEnergy>? source)
    {
        if (source is null || source.Count == 0)
        {
            return [];
        }

        var list = new List<ChargingSectionDailyEnergy>(source.Count);
        foreach (var entry in source)
        {
            if (entry is null)
            {
                continue;
            }

            list.Add(new ChargingSectionDailyEnergy(entry.Day ?? string.Empty, Safe(entry.Energy)));
        }

        return list;
    }

    private static string BuildChartSummary(string chartTitle, IReadOnlyList<ChargingSectionDailyEnergy> daily)
    {
        if (daily.Count == 0)
        {
            return chartTitle;
        }

        var parts = new List<string>(daily.Count);
        foreach (var entry in daily)
        {
            parts.Add($"{entry.Day} {NumberFormatting.Format(entry.Energy, null, 1)}");
        }

        return $"{chartTitle}: {string.Join(", ", parts)}";
    }

    private static string BuildAutomationName(
        ChargingSectionState state,
        string title,
        IReadOnlyList<ChargingSectionStat> stats,
        string wowLabel,
        string wowText,
        string emptyMessage,
        string loadingLabel) => state switch
        {
            ChargingSectionState.Loading => loadingLabel,
            ChargingSectionState.Empty => emptyMessage,
            _ => BuildReadyAutomationName(title, stats, wowLabel, wowText),
        };

    private static string BuildReadyAutomationName(
        string title,
        IReadOnlyList<ChargingSectionStat> stats,
        string wowLabel,
        string wowText)
    {
        var builder = new StringBuilder(title);
        foreach (var stat in stats)
        {
            builder.Append(CultureInfo.CurrentCulture, $". {stat.Label} {stat.Value}");
        }

        builder.Append(CultureInfo.CurrentCulture, $". {wowLabel} {wowText}");
        return builder.ToString();
    }

    private static bool HasPositiveEnergy(IReadOnlyList<ChargingSectionDailyEnergy> daily)
    {
        foreach (var entry in daily)
        {
            if (entry.Energy > 0)
            {
                return true;
            }
        }

        return false;
    }

    // Web parity: pctChange(current, previous) — guards a zero denominator before the percentage math. In the
    // badge the caller already gates on previous > 0, but the helper stays faithful to the web for reuse.
    private static double PctChange(double current, double previous)
    {
        if (previous == 0)
        {
            return current > 0 ? 100 : 0;
        }

        return (current - previous) / Math.Abs(previous) * 100;
    }

    // The web safeNumber() guard inside fmtNumber: a non-finite value formats as 0 rather than "NaN"/"∞".
    private static double Safe(double value) => double.IsFinite(value) ? value : 0;
}

/// <summary>
/// PII-safe diagnostics for the <c>ChargingSection</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a session count, energy figure, charge
/// rate or cost — so a diagnostics line can never leak a user's charging behaviour. Thread-safe.
/// </summary>
public sealed class ChargingSectionDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public ChargingSectionDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ChargingSection</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ChargingSectionRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>ChargingSection</c> feature surface — the native mirror of the web component
/// at <c>web/src/features/analytics/components/weekly-digest/ChargingSection.tsx</c>.
/// </summary>
public static class ChargingSectionRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "ChargingSection";
}
