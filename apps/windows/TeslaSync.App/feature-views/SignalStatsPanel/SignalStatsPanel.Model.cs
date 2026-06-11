using System.Globalization;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive surface state for the <c>SignalStatsPanel</c> feature view. The web source
/// (web/src/features/telemetry/components/SignalStatsPanel.tsx) is a pure presentational component: it is
/// fed a fully-resolved <c>stats</c> array and a boolean <c>loading</c> prop by its parent (the Workspace /
/// Explorer page that owns the <c>useLiveSignalStream</c> query) and performs no fetching of its own, so it
/// reproduces exactly the three content branches the web component renders — <see cref="Loading"/> (the
/// <c>loading</c> skeleton grid), <see cref="Ready"/> (the populated stat table) and <see cref="Empty"/>
/// (the "No stats available" surface). There is deliberately no fetch-driven error / stale / offline branch
/// to reproduce here: those belong to the parent page that owns the live-signal query, not this
/// presentational child — the same precedent the sibling <c>DriveStatCards</c> / <c>DriveDetailHeader</c> /
/// <c>SummaryStatsRow</c> surfaces follow. Every branch renders a visible surface (engineering rule #6); the
/// panel is never a blank box.
/// </summary>
public enum SignalStatsState
{
    /// <summary>The parent reports the live-signal query is still loading — render the skeleton grid.</summary>
    Loading,

    /// <summary>At least one row is visible — render the per-signal stat table.</summary>
    Ready,

    /// <summary>No row is visible (no stats, or every row hidden) — render the friendly empty surface.</summary>
    Empty,
}

/// <summary>
/// One per-signal min / max / avg / count summary — the native analogue of the web <c>SignalStat</c>
/// (web/src/features/telemetry/hooks/useLiveSignalStream.ts). <see cref="Min"/> / <see cref="Max"/> /
/// <see cref="Avg"/> are doubles that may be <see cref="double.NaN"/> when a selected signal produced no
/// numeric samples in the queried range (the web fills those gaps with a NaN row), and <see cref="Count"/>
/// is the sample count (zero marks a no-data row). Pure data — no WinUI types — so the projection is
/// unit-tested without a UI host.
/// </summary>
/// <param name="Signal">The signal name (web <c>SignalStat.signal</c>).</param>
/// <param name="Min">The minimum sample, or <see cref="double.NaN"/> when there is no data (web <c>min</c>).</param>
/// <param name="Max">The maximum sample, or <see cref="double.NaN"/> when there is no data (web <c>max</c>).</param>
/// <param name="Avg">The mean sample, or <see cref="double.NaN"/> when there is no data (web <c>avg</c>).</param>
/// <param name="Count">The number of numeric samples in range (web <c>count</c>); zero marks a no-data row.</param>
public sealed record SignalStat(string Signal, double Min, double Max, double Avg, int Count)
{
    /// <summary>
    /// A no-data row for <paramref name="signal"/> — the native port of the web <c>emptyStatRow</c>:
    /// NaN min / max / avg and a zero count, surfaced for a selected signal that the queried range carried
    /// no samples for.
    /// </summary>
    public static SignalStat NoData(string signal) =>
        new(signal, double.NaN, double.NaN, double.NaN, 0);

    /// <summary>True when the signal produced no numeric samples (web <c>isEmptyStat</c>: <c>count === 0</c>).</summary>
    public bool IsEmpty => Count == 0;
}

/// <summary>
/// The render-time data model the <c>SignalStatsPanel</c> view binds to — the native analogue of the web
/// <c>SignalStatsPanelProps</c> (minus the web-only <c>className</c>). The presentational surface is fed the
/// resolved <see cref="Stats"/> + <see cref="Loading"/> flag by the parent page; <see cref="SelectedSignals"/>,
/// <see cref="Title"/> and <see cref="SignalIndex"/> mirror the optional web props. Pure data — no WinUI types.
/// </summary>
/// <param name="Stats">The per-signal summaries to render (web <c>stats</c>).</param>
/// <param name="SelectedSignals">
/// When non-empty, one row is emitted per selected signal — filling gaps with no-data rows — exactly as the
/// web component does (web <c>selectedSignals</c>); when null / empty only the signals present in
/// <see cref="Stats"/> render (web back-compat).
/// </param>
/// <param name="Loading">True while the parent's live-signal query is loading (web <c>loading</c>).</param>
/// <param name="Title">An optional panel-title override (web <c>title</c>); null uses the localized default.</param>
/// <param name="SignalIndex">An optional signal → colour-index map (web <c>signalIndex</c>).</param>
public sealed record SignalStatsModel(
    IReadOnlyList<SignalStat> Stats,
    IReadOnlyList<string>? SelectedSignals = null,
    bool Loading = false,
    string? Title = null,
    IReadOnlyDictionary<string, int>? SignalIndex = null)
{
    /// <summary>The initial model: the parent's query is still loading, so the skeleton branch renders.</summary>
    public static SignalStatsModel Pending { get; } = new(Array.Empty<SignalStat>(), Loading: true);

    /// <summary>An empty resolved model (no stats) — the "No stats available" branch renders.</summary>
    public static SignalStatsModel Empty { get; } = new(Array.Empty<SignalStat>());
}

/// <summary>
/// One projected numeric cell — the already-formatted <see cref="Text"/> plus whether it is the em-dash
/// no-data marker (the native port of the web <c>renderNumeric</c> coercion: a NaN / non-finite value renders
/// "—" with a "No data" Narrator label, every other value renders the grouped <c>fmtNumber</c> text). Pure data.
/// </summary>
/// <param name="Text">The display text — either the formatted number or the em-dash.</param>
/// <param name="IsNoData">True when the cell is the em-dash no-data marker (NaN / non-finite source).</param>
public sealed record SignalStatCell(string Text, bool IsNoData);

/// <summary>
/// One projected, render-ready stat row — the native analogue of a web <c>DataTable</c> row. Holds the signal
/// name, the resolved categorical colour-token brush key (never a literal hex), whether the row carries no
/// data (web <c>isEmptyStat</c>), the optional "No data in range" subtitle, the three formatted numeric cells
/// and the formatted count, plus the composed Narrator name. Pure data.
/// </summary>
/// <param name="Signal">The signal name (rendered in mono, tinted by <see cref="ColorKey"/>).</param>
/// <param name="ColorKey">The categorical chart-token brush key (web <c>CHART_COLORS[idx]</c>; theme-aware, never hex).</param>
/// <param name="IsEmpty">True when the row produced no numeric samples (web <c>isEmptyStat</c>).</param>
/// <param name="NoDataSubtitle">The localized "No data in range" caption shown under an empty signal, else null.</param>
/// <param name="Min">The formatted minimum cell (web <c>renderNumeric(min)</c>).</param>
/// <param name="Max">The formatted maximum cell (web <c>renderNumeric(max)</c>).</param>
/// <param name="Avg">The formatted average cell (web <c>renderNumeric(avg)</c>).</param>
/// <param name="CountText">The formatted sample count (web <c>fmtInt(count)</c>; never a no-data marker).</param>
/// <param name="AutomationName">The composed Narrator name for the whole row.</param>
public sealed record SignalStatRow(
    string Signal,
    string ColorKey,
    bool IsEmpty,
    string? NoDataSubtitle,
    SignalStatCell Min,
    SignalStatCell Max,
    SignalStatCell Avg,
    string CountText,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the stat panel for one input model — the resolved
/// <see cref="State"/>, the ordered visible <see cref="Rows"/> (the web <c>visibleStats</c> after the
/// hide-empty filter), the <see cref="EmptyCount"/> driving the hide-empty toggle, the toggle's resolved
/// <see cref="HideEmpty"/> state + interpolated <see cref="HideEmptyLabel"/>, the localized title, column
/// headers, empty / no-data copy and the Narrator-only region + loading announcements. Pure data so the
/// projection is unit-tested without a UI host.
/// </summary>
/// <param name="State">The mutually-exclusive surface state (<see cref="SignalStatsState"/>).</param>
/// <param name="Rows">The ordered visible rows (empty while loading / when nothing is visible).</param>
/// <param name="EmptyCount">The number of no-data rows in the full set (web <c>emptyCount</c>).</param>
/// <param name="ShowHideEmptyToggle">True when the hide-empty toggle is shown (web <c>emptyCount &gt; 0</c>).</param>
/// <param name="HideEmpty">Whether the hide-empty toggle is on (web <c>hideEmpty</c> state).</param>
/// <param name="Title">The resolved panel title (web <c>title ?? t('Stats Summary')</c>).</param>
/// <param name="HideEmptyLabel">The interpolated toggle label (web <c>Hide empty ({{count}})</c>).</param>
/// <param name="SignalHeader">The "Signal" column header.</param>
/// <param name="MinHeader">The "Min" column header.</param>
/// <param name="MaxHeader">The "Max" column header.</param>
/// <param name="AvgHeader">The "Avg" column header.</param>
/// <param name="CountHeader">The "Count" column header.</param>
/// <param name="EmptyMessage">The "No stats available" empty-surface message.</param>
/// <param name="NoDataLabel">The "No data" Narrator label for an em-dash cell (web <c>aria-label</c>).</param>
/// <param name="RegionLabel">The Narrator group name for the surface (Windows accessibility minimum).</param>
/// <param name="LoadingLabel">The Narrator announcement while the skeleton renders.</param>
public sealed record SignalStatsDisplay(
    SignalStatsState State,
    IReadOnlyList<SignalStatRow> Rows,
    int EmptyCount,
    bool ShowHideEmptyToggle,
    bool HideEmpty,
    string Title,
    string HideEmptyLabel,
    string SignalHeader,
    string MinHeader,
    string MaxHeader,
    string AvgHeader,
    string CountHeader,
    string EmptyMessage,
    string NoDataLabel,
    string RegionLabel,
    string LoadingLabel)
{
    /// <summary>The number of visible rows (web <c>visibleStats.length</c>).</summary>
    public int RowCount => Rows.Count;
}

/// <summary>
/// Pure projection from a <see cref="SignalStatsModel"/> + the local hide-empty toggle state to its
/// <see cref="SignalStatsDisplay"/> — the native port of web/src/features/telemetry/components/SignalStatsPanel.tsx.
/// Reproduces the web derivations exactly: <c>displayStats</c> emits one row per <c>selectedSignals</c> entry
/// (filling gaps with <see cref="SignalStat.NoData"/>) or passes <c>stats</c> through; <c>emptyCount</c> counts
/// the no-data rows; <c>visibleStats</c> drops the no-data rows when hide-empty is on; each numeric cell is the
/// web <c>renderNumeric</c> coercion (NaN / non-finite → em-dash, else <c>fmtNumber</c>); the count is
/// <c>fmtInt</c>; and the signal colour is <c>CHART_COLORS[Math.max(0, signalIndex?.[signal] ?? index) % len]</c>
/// resolved to a theme-aware chart-token brush key. Every number formats through the en-US
/// <see cref="NumberFormatting"/> port and every label resolves through the i18n facade. No WinUI types —
/// unit-tested headless.
/// </summary>
public static class SignalStatsProjection
{
    /// <summary>The web em-dash (U+2014) rendered for a NaN / non-finite numeric cell.</summary>
    public const string EmDash = "\u2014";

    /// <summary>The web default decimal precision used by <c>fmtNumber</c> (web <c>_globalPrecision</c>).</summary>
    public const int DefaultPrecision = 2;

    /// <summary>
    /// Project <paramref name="model"/> into a render-ready display, applying the local hide-empty toggle
    /// (<paramref name="hideEmpty"/>) and formatting numbers at <paramref name="precision"/> decimals (the
    /// web global decimal precision; defaults to <see cref="DefaultPrecision"/>).
    /// </summary>
    /// <param name="model">The render-time data model (the web props).</param>
    /// <param name="hideEmpty">Whether the hide-empty toggle is on (web <c>hideEmpty</c> state).</param>
    /// <param name="precision">The decimal precision for min / max / avg (web <c>fmtNumber</c> precision).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static SignalStatsDisplay Project(
        SignalStatsModel model,
        bool hideEmpty,
        int precision,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        int digits = precision < 0 ? 0 : precision;
        var stats = model.Stats ?? Array.Empty<SignalStat>();
        var displayStats = BuildDisplayStats(stats, model.SelectedSignals);

        int emptyCount = 0;
        foreach (var stat in displayStats)
        {
            if (stat.IsEmpty)
            {
                emptyCount++;
            }
        }

        string noDataInRange = localizer.GetString(
            SignalStatsPanelRegistration.NoDataInRangeKey, SignalStatsPanelRegistration.NoDataInRangeFallback);
        string signalHeader = localizer.GetString(
            SignalStatsPanelRegistration.SignalHeaderKey, SignalStatsPanelRegistration.SignalHeaderFallback);
        string minHeader = localizer.GetString(
            SignalStatsPanelRegistration.MinHeaderKey, SignalStatsPanelRegistration.MinHeaderFallback);
        string maxHeader = localizer.GetString(
            SignalStatsPanelRegistration.MaxHeaderKey, SignalStatsPanelRegistration.MaxHeaderFallback);
        string avgHeader = localizer.GetString(
            SignalStatsPanelRegistration.AvgHeaderKey, SignalStatsPanelRegistration.AvgHeaderFallback);
        string countHeader = localizer.GetString(
            SignalStatsPanelRegistration.CountHeaderKey, SignalStatsPanelRegistration.CountHeaderFallback);
        string noDataLabel = localizer.GetString(
            SignalStatsPanelRegistration.NoDataKey, SignalStatsPanelRegistration.NoDataFallback);

        // web: only signals NOT hidden by the toggle render; the colour index is the position in the full
        // displayStats list (or the explicit signalIndex), so the colour is stable as rows are hidden.
        var rows = new List<SignalStatRow>(displayStats.Count);
        for (int i = 0; i < displayStats.Count; i++)
        {
            var stat = displayStats[i];
            if (hideEmpty && stat.IsEmpty)
            {
                continue;
            }

            rows.Add(BuildRow(
                stat,
                ColorIndexFor(stat.Signal, i, model.SignalIndex),
                digits,
                noDataInRange,
                noDataLabel,
                signalHeader,
                minHeader,
                maxHeader,
                avgHeader,
                countHeader));
        }

        SignalStatsState state = model.Loading
            ? SignalStatsState.Loading
            : rows.Count > 0 ? SignalStatsState.Ready : SignalStatsState.Empty;

        // web: t('signalStats.hideEmpty', 'Hide empty ({{count}})', { count }) — i18next replaces {{count}}.
        string hideEmptyLabel = localizer
            .GetString(SignalStatsPanelRegistration.HideEmptyKey, SignalStatsPanelRegistration.HideEmptyFallback)
            .Replace(
                SignalStatsPanelRegistration.CountToken,
                emptyCount.ToString(CultureInfo.CurrentCulture),
                StringComparison.Ordinal);

        // web: title ?? t('Stats Summary').
        string title = string.IsNullOrEmpty(model.Title)
            ? localizer.GetString(SignalStatsPanelRegistration.TitleKey, SignalStatsPanelRegistration.TitleFallback)
            : model.Title;

        return new SignalStatsDisplay(
            state,
            rows,
            emptyCount,
            emptyCount > 0,
            hideEmpty,
            title,
            hideEmptyLabel,
            signalHeader,
            minHeader,
            maxHeader,
            avgHeader,
            countHeader,
            localizer.GetString(SignalStatsPanelRegistration.NoStatsKey, SignalStatsPanelRegistration.NoStatsFallback),
            noDataLabel,
            localizer.GetString(
                SignalStatsPanelRegistration.RegionLabelKey, SignalStatsPanelRegistration.RegionLabelFallback),
            localizer.GetString(SignalStatsPanelRegistration.LoadingKey, SignalStatsPanelRegistration.LoadingFallback));
    }

    /// <summary>
    /// The web <c>displayStats</c> derivation: when <paramref name="selectedSignals"/> is non-empty, emit one
    /// row per selected signal — using the matching stat or a <see cref="SignalStat.NoData"/> gap row — else
    /// pass <paramref name="stats"/> through unchanged.
    /// </summary>
    public static IReadOnlyList<SignalStat> BuildDisplayStats(
        IReadOnlyList<SignalStat> stats,
        IReadOnlyList<string>? selectedSignals)
    {
        ArgumentNullException.ThrowIfNull(stats);
        if (selectedSignals is not { Count: > 0 })
        {
            return stats;
        }

        // web: new Map(stats.map(s => [s.signal, s])) — last entry for a name wins.
        var byName = new Dictionary<string, SignalStat>(StringComparer.Ordinal);
        foreach (var stat in stats)
        {
            byName[stat.Signal] = stat;
        }

        var result = new List<SignalStat>(selectedSignals.Count);
        foreach (var signal in selectedSignals)
        {
            result.Add(byName.TryGetValue(signal, out var match) ? match : SignalStat.NoData(signal));
        }

        return result;
    }

    /// <summary>
    /// The web <c>renderNumeric</c> coercion: a NaN / non-finite value becomes the em-dash no-data marker,
    /// any finite value becomes its grouped <c>fmtNumber</c> text at <paramref name="digits"/> decimals.
    /// </summary>
    public static SignalStatCell NumericCell(double value, int digits) =>
        double.IsFinite(value)
            ? new SignalStatCell(NumberFormatting.Format(value, null, digits < 0 ? 0 : digits), false)
            : new SignalStatCell(EmDash, true);

    // web: signalIndex?.[s.signal] ?? displayStats.indexOf(s), then CHART_COLORS[Math.max(0, idx) % len].
    private static int ColorIndexFor(string signal, int position, IReadOnlyDictionary<string, int>? signalIndex)
    {
        int index = signalIndex is not null && signalIndex.TryGetValue(signal, out var mapped) ? mapped : position;
        return Math.Max(0, index);
    }

    private static SignalStatRow BuildRow(
        SignalStat stat,
        int colorIndex,
        int digits,
        string noDataInRange,
        string noDataLabel,
        string signalHeader,
        string minHeader,
        string maxHeader,
        string avgHeader,
        string countHeader)
    {
        var min = NumericCell(stat.Min, digits);
        var max = NumericCell(stat.Max, digits);
        var avg = NumericCell(stat.Avg, digits);
        string countText = NumberFormatting.Format(stat.Count, null, 0);
        string? subtitle = stat.IsEmpty ? noDataInRange : null;

        string automation = ComposeNarrator(
            stat,
            min,
            max,
            avg,
            countText,
            noDataLabel,
            signalHeader,
            minHeader,
            maxHeader,
            avgHeader,
            countHeader);

        return new SignalStatRow(
            stat.Signal,
            ChartPalette.KeyForIndex(colorIndex),
            stat.IsEmpty,
            subtitle,
            min,
            max,
            avg,
            countText,
            automation);
    }

    private static string ComposeNarrator(
        SignalStat stat,
        SignalStatCell min,
        SignalStatCell max,
        SignalStatCell avg,
        string countText,
        string noDataLabel,
        string signalHeader,
        string minHeader,
        string maxHeader,
        string avgHeader,
        string countHeader)
    {
        _ = signalHeader;

        // A no-data cell is announced with the "No data" label rather than the bare em-dash glyph.
        string minText = min.IsNoData ? noDataLabel : min.Text;
        string maxText = max.IsNoData ? noDataLabel : max.Text;
        string avgText = avg.IsNoData ? noDataLabel : avg.Text;
        return string.Format(
            CultureInfo.CurrentCulture,
            "{0}, {1}: {2}, {3}: {4}, {5}: {6}, {7}: {8}",
            stat.Signal,
            minHeader,
            minText,
            maxHeader,
            maxText,
            avgHeader,
            avgText,
            countHeader,
            countText);
    }
}

/// <summary>
/// Canonical metadata for the <c>SignalStatsPanel</c> feature surface — the native mirror of the web
/// component at <c>web/src/features/telemetry/components/SignalStatsPanel.tsx</c>: the stable diagnostics
/// slug, the i18n keys + English fallbacks the web source feeds into <c>t()</c> (verbatim, including the
/// bare-string keys the web uses for its column headers, plus the <c>common.loading</c> and region-label
/// keys backing the Narrator-only affordances Windows accessibility minimums require), and the interpolation
/// token. UI-free so the metadata is asserted in tests.
/// </summary>
public static class SignalStatsPanelRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "SignalStatsPanel";

    /// <summary>The interpolation token in the hide-empty label (web i18next <c>{{count}}</c>).</summary>
    public const string CountToken = "{{count}}";

    /// <summary>i18n key for the panel title (web <c>t('Stats Summary')</c>).</summary>
    public const string TitleKey = "Stats Summary";

    /// <summary>English fallback for the panel title — verbatim from the web source.</summary>
    public const string TitleFallback = "Stats Summary";

    /// <summary>i18n key for the Signal column header (web <c>t('Signal')</c>).</summary>
    public const string SignalHeaderKey = "Signal";

    /// <summary>English fallback for the Signal column header — verbatim from the web source.</summary>
    public const string SignalHeaderFallback = "Signal";

    /// <summary>i18n key for the Min column header (web <c>t('Min')</c>).</summary>
    public const string MinHeaderKey = "Min";

    /// <summary>English fallback for the Min column header — verbatim from the web source.</summary>
    public const string MinHeaderFallback = "Min";

    /// <summary>i18n key for the Max column header (web <c>t('Max')</c>).</summary>
    public const string MaxHeaderKey = "Max";

    /// <summary>English fallback for the Max column header — verbatim from the web source.</summary>
    public const string MaxHeaderFallback = "Max";

    /// <summary>i18n key for the Avg column header (web <c>t('Avg')</c>).</summary>
    public const string AvgHeaderKey = "Avg";

    /// <summary>English fallback for the Avg column header — verbatim from the web source.</summary>
    public const string AvgHeaderFallback = "Avg";

    /// <summary>i18n key for the Count column header (web <c>t('Count')</c>).</summary>
    public const string CountHeaderKey = "Count";

    /// <summary>English fallback for the Count column header — verbatim from the web source.</summary>
    public const string CountHeaderFallback = "Count";

    /// <summary>i18n key for the no-data signal subtitle (web <c>t('signalStats.noDataInRange', …)</c>).</summary>
    public const string NoDataInRangeKey = "signalStats.noDataInRange";

    /// <summary>English fallback for the no-data signal subtitle — verbatim from the web source.</summary>
    public const string NoDataInRangeFallback = "No data in range";

    /// <summary>i18n key for the hide-empty toggle (web <c>t('signalStats.hideEmpty', …)</c>).</summary>
    public const string HideEmptyKey = "signalStats.hideEmpty";

    /// <summary>English fallback for the hide-empty toggle — verbatim from the web source (interpolated).</summary>
    public const string HideEmptyFallback = "Hide empty ({{count}})";

    /// <summary>i18n key for the empty-surface message (web <c>t('No stats available')</c>).</summary>
    public const string NoStatsKey = "No stats available";

    /// <summary>English fallback for the empty-surface message — verbatim from the web source.</summary>
    public const string NoStatsFallback = "No stats available";

    /// <summary>i18n key for the em-dash Narrator label (web <c>aria-label="No data"</c>).</summary>
    public const string NoDataKey = "signalStats.noData";

    /// <summary>English fallback for the em-dash Narrator label — verbatim from the web source.</summary>
    public const string NoDataFallback = "No data";

    /// <summary>i18n key for the surface's Narrator group label (Windows accessibility minimum; no visible web text).</summary>
    public const string RegionLabelKey = "signalStats.region";

    /// <summary>English fallback for the surface's Narrator group label.</summary>
    public const string RegionLabelFallback = "Statistics summary";

    /// <summary>i18n key for the skeleton's Narrator announcement.</summary>
    public const string LoadingKey = "common.loading";

    /// <summary>English fallback for the skeleton's Narrator announcement.</summary>
    public const string LoadingFallback = "Loading";
}

/// <summary>
/// PII-safe diagnostics for the <c>SignalStatsPanel</c> surface (P1/S11 diagnostics contract). Records only
/// the operational <c>view.opened</c> event with the surface slug — never a signal name, statistic value or
/// sample count — so a diagnostics line can never leak which signals a user inspected. Thread-safe.
/// </summary>
public sealed class SignalStatsPanelDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public SignalStatsPanelDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SignalStatsPanel</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SignalStatsPanelRegistration.Slug}");
    }
}
