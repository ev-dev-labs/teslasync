using System.Globalization;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive render branch of the <c>ChartsRow</c> surface — the native union of the states the
/// web component implies (web/src/features/charging/components/charging-list/ChartsRow.tsx). The web source is
/// a pure presentational row (it takes the already-computed <c>energyTrend</c>, <c>chargerBreakdown</c> and
/// <c>costByType</c> arrays as props and performs no fetching), so the branches are a direct function of the
/// input <see cref="ChartsRowModel"/> — there is no fetch-driven error / stale / offline branch to reproduce
/// here. The owning charging-list page owns the query lifecycle (loading / error / stale / offline are handled
/// once for the whole list before this row is composed), exactly as the web page only renders
/// <c>&lt;ChartsRow … /&gt;</c> once its session data has resolved. Every branch maps onto a visible surface;
/// none is ever hidden.
/// </summary>
public enum ChartsRowState
{
    /// <summary>The page is still fetching the sessions this row summarises — skeleton chrome for both panels.</summary>
    Loading,

    /// <summary>Resolved with nothing to chart in either panel — both panels show a friendly empty state.</summary>
    Empty,

    /// <summary>At least one panel has data to plot (web fall-through) — the two GlassPanels of charts.</summary>
    Ready,
}

/// <summary>
/// One point of the energy-vs-cost trend — the native analogue of a single web <c>EnergyTrendPoint</c>
/// (<c>{ date, energy, cost }</c>, helpers.ts <c>computeEnergyTrend</c>). <see cref="Date"/> is the
/// already-short-formatted label the web puts on the recharts <c>XAxis dataKey="date"</c>; <see cref="Energy"/>
/// and <see cref="Cost"/> are the two plotted magnitudes (the web's <c>Area dataKey="energy"</c> /
/// <c>dataKey="cost"</c>). The parent page computes these (out of scope here); this row only renders them.
/// </summary>
public sealed record EnergyTrendPoint(string Date, double Energy, double Cost);

/// <summary>
/// One charger-type wedge of the breakdown donut — the native analogue of a web <c>ChargerBreakdownEntry</c>
/// (<c>{ name, value, fill }</c>, helpers.ts <c>computeChargerBreakdown</c>). <see cref="Name"/> is the
/// already-localized charger-type label and <see cref="Value"/> its session count. The web's <c>fill</c> hex is
/// intentionally dropped: native wedges colour from the theme-aware brand palette by order (ADR-009 — never a
/// hard-coded hex), exactly as <c>ChargingBreakdownSlide</c> does.
/// </summary>
public sealed record ChargerBreakdownEntry(string Name, double Value);

/// <summary>
/// One cost-by-charger-type row — the native analogue of a web <c>CostByTypeEntry</c>
/// (<c>{ name, energy, cost, perKwh }</c>, helpers.ts <c>computeCostByType</c>). <see cref="Name"/> is the
/// already-localized charger-type label; <see cref="Energy"/> is the energy total the web renders with
/// <c>fmtWithUnit(energy, 'kWh')</c>; <see cref="Cost"/> is the "<c>${cost} total</c>" figure; and
/// <see cref="PerKwh"/> is the "<c>${perKwh}/kWh</c>" figure. The parent page computes these.
/// </summary>
public sealed record CostByTypeEntry(string Name, double Energy, double Cost, double PerKwh);

/// <summary>
/// The render-time data model the <c>ChartsRow</c> view binds to — the native analogue of the web component's
/// three props plus the fetch flag the parent supplies. The component is presentational; user-facing labels
/// (titles, units, the "total" word, empty / loading copy) are resolved from the i18n facade by the projection,
/// not passed in. Energy / cost values are the already-computed display magnitudes the page hands the web
/// component (SI lives on disk; the page applies its display conversion before this row). Pure data — no WinUI
/// types — so the projection is unit-tested without a UI host.
/// </summary>
public sealed record ChartsRowModel(
    bool Loading,
    IReadOnlyList<EnergyTrendPoint> EnergyTrend,
    IReadOnlyList<ChargerBreakdownEntry> ChargerBreakdown,
    IReadOnlyList<CostByTypeEntry> CostByType)
{
    /// <summary>The initial model: the page fetch is in flight and no session data has arrived yet.</summary>
    public static ChartsRowModel Pending { get; } =
        new(true, [], [], []);

    /// <summary>A resolved model with nothing to chart in either panel — the empty state.</summary>
    public static ChartsRowModel Empty { get; } =
        new(false, [], [], []);
}

/// <summary>
/// One projected trend datum ready to become a <c>ChartPoint</c> — <see cref="X"/> is the ordinal position on
/// the (categorical-date) axis, <see cref="Value"/> the plotted magnitude and <see cref="DateLabel"/> the
/// short date the web shows on the x-axis / tooltip. Pure data.
/// </summary>
public sealed record ChartsRowTrendPoint(double X, double Value, string DateLabel);

/// <summary>
/// One projected, render-ready donut wedge — the native analogue of a recharts <c>&lt;Cell&gt;</c>.
/// <see cref="Name"/> is the localized charger-type label, <see cref="Value"/> its raw session count,
/// <see cref="ValueText"/> the grouped integer count, <see cref="ColorIndex"/> the zero-based palette position
/// (by order, matching the web's <c>chargerBreakdown.map((d, i) =&gt; …)</c>) and <see cref="AutomationName"/>
/// the spoken "<c>{name}, {count}</c>". Pure data.
/// </summary>
public sealed record ChartsRowChargerSlice(
    string Name,
    double Value,
    string ValueText,
    int ColorIndex,
    string AutomationName);

/// <summary>
/// One projected, render-ready cost-by-type row — the native analogue of the web entry block (helpers
/// <c>CostByTypeEntry</c> rendered in ChartsRow.tsx lines 71-82). <see cref="Name"/> is the charger-type label;
/// <see cref="EnergyText"/> is "<c>{energy} kWh</c>"; <see cref="CostText"/> is "<c>${cost} total</c>"; and
/// <see cref="PerKwhText"/> is "<c>${perKwh}/kWh</c>". <see cref="AutomationName"/> folds all four into one
/// spoken line. Pure data.
/// </summary>
public sealed record ChartsRowCostRow(
    string Name,
    string EnergyText,
    string CostText,
    string PerKwhText,
    string AutomationName);

/// <summary>
/// The fully projected "Energy &amp; Cost Trend" panel (web ChartsRow.tsx lines 26-48). Holds the localized
/// <see cref="Title"/>, the two plotted series (<see cref="EnergyPoints"/> / <see cref="CostPoints"/>) and
/// their localized <see cref="EnergySeriesName"/> / <see cref="CostSeriesName"/>, the
/// <see cref="DateRangeText"/> that surfaces the categorical-date axis, a spoken <see cref="ChartSummary"/>,
/// the <see cref="EmptyMessage"/> shown when there is no trend, and the panel <see cref="AutomationName"/>.
/// <see cref="HasData"/> is the web's "<c>energyTrend.length &gt; 0</c>". Pure data.
/// </summary>
public sealed record ChartsRowEnergyPanel(
    string Title,
    bool HasData,
    IReadOnlyList<ChartsRowTrendPoint> EnergyPoints,
    IReadOnlyList<ChartsRowTrendPoint> CostPoints,
    string EnergySeriesName,
    string CostSeriesName,
    string DateRangeText,
    string ChartSummary,
    string EmptyMessage,
    string AutomationName);

/// <summary>
/// The fully projected "Charger Breakdown" panel (web ChartsRow.tsx lines 51-86). Holds the localized
/// <see cref="Title"/>, the donut <see cref="Slices"/> (web <c>chargerBreakdown</c>), the
/// <see cref="CostRows"/> (web <c>costByType</c>), a spoken <see cref="ChartSummary"/> of the donut, the
/// <see cref="EmptyMessage"/>, and the panel <see cref="AutomationName"/>. <see cref="HasPie"/> /
/// <see cref="HasRows"/> gate the two halves independently so neither ever renders a blank box, and
/// <see cref="HasData"/> is true when either half has content. Pure data.
/// </summary>
public sealed record ChartsRowChargerPanel(
    string Title,
    bool HasData,
    bool HasPie,
    bool HasRows,
    IReadOnlyList<ChartsRowChargerSlice> Slices,
    IReadOnlyList<ChartsRowCostRow> CostRows,
    string ChartSummary,
    string EmptyMessage,
    string AutomationName);

/// <summary>
/// The fully projected view of the row for one input model — the native analogue of what the web
/// <c>ChartsRow</c> renders. Holds the active <see cref="State"/>, the two panel projections, the shared
/// loading copy, and the surface <see cref="AutomationName"/>. Pure data so every branch is asserted headlessly.
/// </summary>
public sealed record ChartsRowDisplay(
    ChartsRowState State,
    ChartsRowEnergyPanel EnergyPanel,
    ChartsRowChargerPanel ChargerPanel,
    string LoadingLabel,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="ChartsRowModel"/> to its <see cref="ChartsRowDisplay"/> — the native port
/// of web/src/features/charging/components/charging-list/ChartsRow.tsx. The branch precedence mirrors the web
/// data lifecycle (loading → empty → ready); each panel's <c>HasData</c> reproduces the web's per-array
/// length checks; the donut wedges colour by order like the web's <c>chargerBreakdown.map((d, i) =&gt; …)</c>;
/// and every value renders through <see cref="NumberFormatting"/> at the web's default display precision
/// (<c>numberFormat.ts</c> <c>_globalPrecision = 2</c>). Every label resolves through the i18n facade using
/// the keys the web feeds into <c>t(...)</c> plus the shared unit / word keys the literal web strings map onto.
/// No WinUI types — unit-tested without a UI host.
/// </summary>
public static class ChartsRowProjection
{
    /// <summary>
    /// The default fixed display precision (web <c>numberFormat.ts</c> <c>_globalPrecision = 2</c>, the value
    /// <c>fmtNumber</c> / <c>fmtWithUnit</c> use when the charging-list page supplies no per-call override).
    /// </summary>
    public const int ValueDecimals = 2;

    private const string CurrencyPrefix = "$"; // web literal "$" prefix on cost / perKwh
    private const string DateRangeSeparator = " \u2013 "; // en-dash between first and last trend date

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web props, plus the parent's fetch flag).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static ChartsRowDisplay Project(ChartsRowModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        string emptyMessage = localizer.GetString("chart.noData", "No data available");
        string loadingLabel = localizer.GetString("common.loading", "Loading...");

        ChartsRowEnergyPanel energyPanel = ProjectEnergyPanel(model.EnergyTrend, localizer, emptyMessage);
        ChartsRowChargerPanel chargerPanel = ProjectChargerPanel(
            model.ChargerBreakdown, model.CostByType, localizer, emptyMessage);

        ChartsRowState state = SelectState(model, energyPanel, chargerPanel);

        return new ChartsRowDisplay(
            State: state,
            EnergyPanel: energyPanel,
            ChargerPanel: chargerPanel,
            LoadingLabel: loadingLabel,
            AutomationName: BuildSurfaceAutomationName(state, energyPanel, chargerPanel, emptyMessage, loadingLabel));
    }

    /// <summary>Branch precedence from the web data lifecycle: loading → empty → ready.</summary>
    private static ChartsRowState SelectState(
        ChartsRowModel model,
        ChartsRowEnergyPanel energyPanel,
        ChartsRowChargerPanel chargerPanel)
    {
        if (model.Loading)
        {
            return ChartsRowState.Loading;
        }

        // Nothing to chart in either panel ⇒ the whole row collapses to friendly empty states rather than two
        // blank panels (the web would render empty charts; we never show a blank box — ADR-002).
        return energyPanel.HasData || chargerPanel.HasData
            ? ChartsRowState.Ready
            : ChartsRowState.Empty;
    }

    // ── Energy & Cost Trend panel ────────────────────────────────────────────────────────────────────────

    private static ChartsRowEnergyPanel ProjectEnergyPanel(
        IReadOnlyList<EnergyTrendPoint> trend,
        ILocalizer localizer,
        string emptyMessage)
    {
        string title = localizer.GetString("charging.charts.energyCostTrend", "Energy & Cost Trend");
        string kwh = localizer.GetString("units.kwh", "kWh");
        string energySeriesName = $"{localizer.GetString("common.energy", "Energy")} ({kwh})"; // web "Energy (kWh)"
        string costSeriesName = $"{localizer.GetString("common.cost", "Cost")} ({CurrencyPrefix})"; // web "Cost ($)"

        var energyPoints = new List<ChartsRowTrendPoint>(trend.Count);
        var costPoints = new List<ChartsRowTrendPoint>(trend.Count);
        for (int i = 0; i < trend.Count; i++)
        {
            string date = string.IsNullOrWhiteSpace(trend[i].Date) ? "\u2014" : trend[i].Date;
            energyPoints.Add(new ChartsRowTrendPoint(i, trend[i].Energy, date));
            costPoints.Add(new ChartsRowTrendPoint(i, trend[i].Cost, date));
        }

        bool hasData = trend.Count > 0;
        string dateRangeText = BuildDateRange(trend);
        string chartSummary = hasData
            ? $"{energySeriesName}, {costSeriesName}. {dateRangeText}"
            : emptyMessage;

        return new ChartsRowEnergyPanel(
            Title: title,
            HasData: hasData,
            EnergyPoints: energyPoints,
            CostPoints: costPoints,
            EnergySeriesName: energySeriesName,
            CostSeriesName: costSeriesName,
            DateRangeText: dateRangeText,
            ChartSummary: chartSummary,
            EmptyMessage: emptyMessage,
            AutomationName: $"{title}. {chartSummary}");
    }

    private static string BuildDateRange(IReadOnlyList<EnergyTrendPoint> trend)
    {
        if (trend.Count == 0)
        {
            return string.Empty;
        }

        string first = string.IsNullOrWhiteSpace(trend[0].Date) ? "\u2014" : trend[0].Date;
        if (trend.Count == 1)
        {
            return first;
        }

        string last = string.IsNullOrWhiteSpace(trend[^1].Date) ? "\u2014" : trend[^1].Date;
        return $"{first}{DateRangeSeparator}{last}";
    }

    // ── Charger Breakdown panel ──────────────────────────────────────────────────────────────────────────

    private static ChartsRowChargerPanel ProjectChargerPanel(
        IReadOnlyList<ChargerBreakdownEntry> breakdown,
        IReadOnlyList<CostByTypeEntry> costByType,
        ILocalizer localizer,
        string emptyMessage)
    {
        string title = localizer.GetString("charging.charts.chargerBreakdown", "Charger Breakdown");
        string kwh = localizer.GetString("units.kwh", "kWh");
        string totalWord = localizer.GetString("total", "total");

        var slices = new List<ChartsRowChargerSlice>(breakdown.Count);
        for (int i = 0; i < breakdown.Count; i++)
        {
            string name = string.IsNullOrWhiteSpace(breakdown[i].Name) ? "\u2014" : breakdown[i].Name;
            string valueText = NumberFormatting.Format(breakdown[i].Value, null, 0);
            slices.Add(new ChartsRowChargerSlice(
                Name: name,
                Value: breakdown[i].Value,
                ValueText: valueText,
                ColorIndex: i,
                AutomationName: $"{name}, {valueText}"));
        }

        var rows = new List<ChartsRowCostRow>(costByType.Count);
        foreach (var entry in costByType)
        {
            string name = string.IsNullOrWhiteSpace(entry.Name) ? "\u2014" : entry.Name;
            string energyText = $"{NumberFormatting.Format(entry.Energy, null, ValueDecimals)} {kwh}";
            string costText = $"{CurrencyPrefix}{NumberFormatting.Format(entry.Cost, null, ValueDecimals)} {totalWord}";
            string perKwhText = $"{CurrencyPrefix}{NumberFormatting.Format(entry.PerKwh, null, ValueDecimals)}/{kwh}";
            rows.Add(new ChartsRowCostRow(
                Name: name,
                EnergyText: energyText,
                CostText: costText,
                PerKwhText: perKwhText,
                AutomationName: $"{name}: {energyText}, {costText}, {perKwhText}"));
        }

        bool hasPie = slices.Count > 0;
        bool hasRows = rows.Count > 0;
        bool hasData = hasPie || hasRows;
        string chartSummary = hasPie ? BuildSliceSummary(slices) : hasRows ? BuildRowSummary(rows) : emptyMessage;

        return new ChartsRowChargerPanel(
            Title: title,
            HasData: hasData,
            HasPie: hasPie,
            HasRows: hasRows,
            Slices: slices,
            CostRows: rows,
            ChartSummary: chartSummary,
            EmptyMessage: emptyMessage,
            AutomationName: hasData ? $"{title}. {chartSummary}" : $"{title}. {emptyMessage}");
    }

    private static string BuildSliceSummary(List<ChartsRowChargerSlice> slices)
    {
        var parts = new List<string>(slices.Count);
        foreach (var slice in slices)
        {
            parts.Add($"{slice.Name} {slice.ValueText}");
        }

        return string.Join(", ", parts);
    }

    private static string BuildRowSummary(List<ChartsRowCostRow> rows)
    {
        var parts = new List<string>(rows.Count);
        foreach (var row in rows)
        {
            parts.Add(row.Name);
        }

        return string.Join(", ", parts);
    }

    private static string BuildSurfaceAutomationName(
        ChartsRowState state,
        ChartsRowEnergyPanel energyPanel,
        ChartsRowChargerPanel chargerPanel,
        string emptyMessage,
        string loadingLabel) => state switch
        {
            ChartsRowState.Loading => loadingLabel,
            ChartsRowState.Empty => emptyMessage,
            _ => string.Create(CultureInfo.CurrentCulture, $"{energyPanel.Title}. {chargerPanel.Title}"),
        };
}

/// <summary>
/// PII-safe diagnostics for the <c>ChartsRow</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never an energy figure, cost, or charger
/// count — so a diagnostics line can never leak a user's charging behaviour. Thread-safe.
/// </summary>
public sealed class ChartsRowDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public ChartsRowDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ChartsRow</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ChartsRowRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>ChartsRow</c> feature surface — the native mirror of the web component at
/// <c>web/src/features/charging/components/charging-list/ChartsRow.tsx</c>.
/// </summary>
public static class ChartsRowRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "ChartsRow";
}
