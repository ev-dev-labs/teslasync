using System.Globalization;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.YearReview;

/// <summary>
/// The mutually-exclusive render branch of the <c>StatChartSlide</c> surface — the native union of the
/// states the web component renders
/// (web/src/features/analytics/components/review/StatChartSlide.tsx). The web source is a pure
/// presentational slide: it receives a resolved <c>YearReview</c> as a prop and only reads
/// <c>useTranslation</c>, so it performs no fetching. The parent <c>YearReviewPage</c> owns the query
/// lifecycle (loading / error / empty / stale / offline) and only mounts a slide once the data has
/// resolved; the slide itself therefore has no fetch-driven error / stale / offline branch to reproduce.
/// The branches below are a direct function of the input <see cref="StatChartSlideModel"/>, and every one
/// maps onto a visible surface — none is ever hidden.
/// </summary>
public enum StatChartSlideState
{
    /// <summary>The parent has not resolved the year-review data yet — skeleton chrome.</summary>
    Loading,

    /// <summary>Resolved with no drives at all (no total and no months) — a friendly empty surface.</summary>
    Empty,

    /// <summary>At least one drive or month to celebrate — the headline + monthly bar chart.</summary>
    Ready,
}

/// <summary>
/// One month's drive count — the native mirror of the fields the web slide reads off a
/// <c>YearReviewMonthStat</c> (<c>{ month: number; drives: number }</c> in
/// <c>web/src/api/types.ts</c>). <see cref="Month"/> is the 1-based calendar month; <see cref="Drives"/>
/// is the number of drives that month. Pure data — no WinUI types.
/// </summary>
public sealed record StatChartMonth(int Month, long Drives);

/// <summary>
/// The render-time data model the <c>StatChartSlide</c> view binds to — the native analogue of the slice
/// of the web <c>YearReview</c> prop the slide actually reads (<c>total_drives</c>,
/// <c>avg_drives_per_week</c> and <c>monthly_stats</c>). The slide is presentational, so the model also
/// carries the parent's fetch flag (<see cref="Loading"/>) purely so the surface can render a skeleton
/// before the parent resolves the year review. User-facing labels are resolved from the i18n facade by the
/// projection, not passed in. Pure data — no WinUI types — so the projection is unit-tested without a UI
/// host.
/// </summary>
public sealed record StatChartSlideModel(
    bool Loading,
    long TotalDrives,
    double AvgDrivesPerWeek,
    IReadOnlyList<StatChartMonth> MonthlyStats)
{
    /// <summary>The initial model: the parent's year-review fetch is still in flight.</summary>
    public static StatChartSlideModel Pending { get; } =
        new(true, 0, 0, Array.Empty<StatChartMonth>());

    /// <summary>A resolved model with no activity at all — the empty state.</summary>
    public static StatChartSlideModel Empty { get; } =
        new(false, 0, 0, Array.Empty<StatChartMonth>());
}

/// <summary>
/// One projected, render-ready bar — the native analogue of a single recharts <c>&lt;Bar&gt;</c> datum the
/// web slide derives from <c>monthly_stats</c>. <see cref="MonthLabel"/> is the abbreviated month tick
/// (the web <c>MONTH_LABELS[m.month - 1]</c>, localized through the current culture);
/// <see cref="Drives"/> / <see cref="DrivesText"/> is the raw + <c>fmtNumber</c>-grouped count;
/// <see cref="HeightRatio"/> is the bar height as a fraction (0..1) of the busiest month; and
/// <see cref="AutomationName"/> is the spoken "{month}, {n} drives" the visual bar conveys. Pure data.
/// </summary>
public sealed record StatChartSlideBar(
    string MonthLabel,
    long Drives,
    string DrivesText,
    double HeightRatio,
    string AutomationName);

/// <summary>
/// A declarative table column descriptor (key + localized header) — the native, WinUI-free analogue of the
/// accessible Month / Drives fallback table the native chart exposes for the recharts bar chart (which has
/// no screen-reader-navigable tabular form on the web). The view maps each one onto a <c>TsDataColumn</c>;
/// rows address their cells by the same <see cref="Key"/>.
/// </summary>
public sealed record StatChartSlideColumn(string Key, string Header);

/// <summary>
/// A single projected, display-ready table row — the cell values keyed by column key, a stable
/// <see cref="RowKey"/>, and a Narrator automation name. Mirrors one month of the bar chart. Pure data so
/// the projection is unit-tested without a UI host.
/// </summary>
public sealed record StatChartSlideRow(
    string RowKey,
    IReadOnlyDictionary<string, string> Cells,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the slide for one input model — the native analogue of what
/// the web <c>StatChartSlide</c> returns. Holds the resolved headline (emoji, the animated
/// <c>total_drives</c> value + its grouped text + tween duration, the "drives" label, and the
/// avg-per-week sentence), the monthly bar chart (the <see cref="Bars"/> plus the accessible
/// <see cref="Columns"/> / <see cref="Rows"/> table and its caption), the empty messages, and the
/// per-state Narrator names. Pure data so every branch is asserted headlessly.
/// </summary>
public sealed record StatChartSlideDisplay(
    StatChartSlideState State,
    string Emoji,
    long TotalDrives,
    string TotalDrivesText,
    double TotalDrivesDurationSeconds,
    string DrivesLabel,
    string AvgPerWeekText,
    string HeadlineAutomationName,
    string ChartLabel,
    string ChartAriaLabel,
    string ChartEmptyMessage,
    string EmptyMessage,
    string TableLabel,
    bool HasChartData,
    IReadOnlyList<StatChartSlideBar> Bars,
    IReadOnlyList<StatChartSlideColumn> Columns,
    IReadOnlyList<StatChartSlideRow> Rows,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="StatChartSlideModel"/> to its <see cref="StatChartSlideDisplay"/> —
/// the native port of web/src/features/analytics/components/review/StatChartSlide.tsx. The branch
/// precedence mirrors the web data flow (the parent shows loading first, then the resolved slide); the
/// animated headline value renders through <see cref="NumberFormatting"/> with no fraction digits (the web
/// <c>AnimatedNumber</c> + <c>fmtNumber(_, 0)</c>) and the avg-per-week count with one digit (the web
/// <c>fmtNumber(avg_drives_per_week, 1)</c>); the bar month ticks render through the supplied culture's
/// abbreviated month names (the web hard-coded English <c>MONTH_LABELS</c>, localized here). Every label
/// resolves through the i18n facade using the keys the web source feeds <c>useTranslation</c>, plus the
/// shared chart keys for the accessible fallback table. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class StatChartSlideProjection
{
    /// <summary>The calendar emoji the web slide renders (🗓️) — locale-neutral, decorative.</summary>
    public const string Emoji = "\U0001F5D3\uFE0F";

    /// <summary>Column key for the month column.</summary>
    public const string MonthKey = "month";

    /// <summary>Column key for the drive-count column.</summary>
    public const string DrivesKey = "drives";

    /// <summary>The web <c>AnimatedNumber duration={1.2}</c> tween length, in seconds.</summary>
    public const double TotalDrivesDurationSeconds = 1.2;

    private const int MonthsInYear = 12;

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the slice of the web <c>YearReview</c> prop).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="culture">The culture whose abbreviated month names label the bars (display boundary).</param>
    public static StatChartSlideDisplay Project(
        StatChartSlideModel model,
        ILocalizer localizer,
        CultureInfo? culture = null)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        CultureInfo resolved = culture ?? CultureInfo.CurrentCulture;

        string drivesLabel = localizer.GetString("yearReview.drives", "drives");
        string totalDrivesText = NumberFormatting.Format(model.TotalDrives, null, 0);
        string avgCount = NumberFormatting.Format(model.AvgDrivesPerWeek, null, 1);
        string avgPerWeekText = string.Format(
            resolved,
            localizer.GetString("yearReview.avgPerWeek", "{0} drives per week on average"),
            avgCount);

        string chartLabel = localizer.GetString("yearReview.monthlyChart.label", "Drives by month");
        string chartAriaLabel = localizer.GetString(
            "yearReview.monthlyChart.ariaLabel",
            "Bar chart of drives per month.");
        string chartEmptyMessage = localizer.GetString("chart.noData", "No data available");
        string emptyMessage = localizer.GetString("yearReview.noDriveData", "No drive data for this year");
        string tableLabel = string.Format(
            resolved,
            localizer.GetString("chart.a11y.fallbackTableLabel", "{0} \u2014 data table"),
            chartLabel);

        IReadOnlyList<StatChartSlideColumn> columns = BuildColumns(localizer);
        IReadOnlyList<StatChartSlideBar> bars = BuildBars(model.MonthlyStats, drivesLabel, resolved);
        IReadOnlyList<StatChartSlideRow> rows = BuildRows(bars, drivesLabel);

        StatChartSlideState state = SelectState(model);
        string headlineAutomationName =
            string.Concat(totalDrivesText, " ", drivesLabel, ". ", avgPerWeekText);

        return new StatChartSlideDisplay(
            State: state,
            Emoji: Emoji,
            TotalDrives: model.TotalDrives,
            TotalDrivesText: totalDrivesText,
            TotalDrivesDurationSeconds: TotalDrivesDurationSeconds,
            DrivesLabel: drivesLabel,
            AvgPerWeekText: avgPerWeekText,
            HeadlineAutomationName: headlineAutomationName,
            ChartLabel: chartLabel,
            ChartAriaLabel: chartAriaLabel,
            ChartEmptyMessage: chartEmptyMessage,
            EmptyMessage: emptyMessage,
            TableLabel: tableLabel,
            HasChartData: bars.Count > 0,
            Bars: bars,
            Columns: columns,
            Rows: rows,
            AutomationName: BuildAutomationName(
                state, headlineAutomationName, chartAriaLabel, emptyMessage, localizer));
    }

    /// <summary>
    /// Branch precedence: the parent's fetch flag (loading) wins; otherwise the slide is empty only when
    /// there is genuinely nothing to show (no total drives and no months) — a degenerate year with a
    /// non-zero total but missing months still renders the headline, with the chart region showing its own
    /// friendly empty state rather than collapsing the slide.
    /// </summary>
    private static StatChartSlideState SelectState(StatChartSlideModel model)
    {
        if (model.Loading)
        {
            return StatChartSlideState.Loading;
        }

        return model.TotalDrives <= 0 && model.MonthlyStats.Count == 0
            ? StatChartSlideState.Empty
            : StatChartSlideState.Ready;
    }

    private static IReadOnlyList<StatChartSlideColumn> BuildColumns(ILocalizer localizer) =>
    [
        new StatChartSlideColumn(MonthKey, localizer.GetString("yearReview.monthlyChart.cols.month", "Month")),
        new StatChartSlideColumn(DrivesKey, localizer.GetString("yearReview.monthlyChart.cols.drives", "Drives")),
    ];

    private static IReadOnlyList<StatChartSlideBar> BuildBars(
        IReadOnlyList<StatChartMonth> months,
        string drivesLabel,
        CultureInfo culture)
    {
        if (months.Count == 0)
        {
            return Array.Empty<StatChartSlideBar>();
        }

        long max = 0;
        foreach (var month in months)
        {
            if (month.Drives > max)
            {
                max = month.Drives;
            }
        }

        string[] abbreviated = culture.DateTimeFormat.AbbreviatedMonthNames;
        var bars = new List<StatChartSlideBar>(months.Count);
        foreach (var month in months)
        {
            string label = MonthLabel(month.Month, abbreviated, culture);
            string drivesText = NumberFormatting.Format(month.Drives, null, 0);
            double ratio = max > 0 ? Math.Clamp(month.Drives / (double)max, 0.0, 1.0) : 0.0;

            bars.Add(new StatChartSlideBar(
                MonthLabel: label,
                Drives: month.Drives,
                DrivesText: drivesText,
                HeightRatio: ratio,
                AutomationName: $"{label}, {drivesText} {drivesLabel}"));
        }

        return bars;
    }

    // Web parity: MONTH_LABELS[m.month - 1] ?? `M${m.month}`. A valid 1..12 month resolves to the culture's
    // abbreviated name (localized rather than hard-coded English); anything out of range falls back to "M{n}".
    private static string MonthLabel(int month, string[] abbreviated, CultureInfo culture)
    {
        if (month >= 1 && month <= MonthsInYear && month - 1 < abbreviated.Length
            && !string.IsNullOrEmpty(abbreviated[month - 1]))
        {
            return abbreviated[month - 1];
        }

        return string.Create(culture, $"M{month}");
    }

    private static IReadOnlyList<StatChartSlideRow> BuildRows(
        IReadOnlyList<StatChartSlideBar> bars,
        string drivesLabel)
    {
        if (bars.Count == 0)
        {
            return Array.Empty<StatChartSlideRow>();
        }

        var rows = new List<StatChartSlideRow>(bars.Count);
        for (int i = 0; i < bars.Count; i++)
        {
            var bar = bars[i];
            var cells = new Dictionary<string, string>(StringComparer.Ordinal)
            {
                [MonthKey] = bar.MonthLabel,
                [DrivesKey] = bar.DrivesText,
            };

            rows.Add(new StatChartSlideRow(
                RowKey: string.Create(CultureInfo.InvariantCulture, $"row-{i}"),
                Cells: cells,
                AutomationName: $"{bar.MonthLabel}. {bar.DrivesText} {drivesLabel}"));
        }

        return rows;
    }

    private static string BuildAutomationName(
        StatChartSlideState state,
        string headlineAutomationName,
        string chartAriaLabel,
        string emptyMessage,
        ILocalizer localizer) => state switch
        {
            StatChartSlideState.Loading => localizer.GetString("common.loading", "Loading"),
            StatChartSlideState.Empty => emptyMessage,
            _ => $"{headlineAutomationName} {chartAriaLabel}",
        };
}

/// <summary>
/// PII-safe diagnostics for the <c>StatChartSlide</c> surface (P1/S11 diagnostics contract). Records only
/// the operational <c>view.opened</c> event with the surface slug — never a drive count, month or average
/// — so a diagnostics line can never leak how much the owner drove. Thread-safe.
/// </summary>
public sealed class StatChartSlideDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public StatChartSlideDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=StatChartSlide</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={StatChartSlideRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>StatChartSlide</c> feature surface — the native mirror of the web
/// component at <c>web/src/features/analytics/components/review/StatChartSlide.tsx</c>.
/// </summary>
public static class StatChartSlideRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "StatChartSlide";
}
