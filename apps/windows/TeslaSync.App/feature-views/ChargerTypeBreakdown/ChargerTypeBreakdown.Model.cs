using System.Globalization;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive render branch of the <c>ChargerTypeBreakdown</c> surface — the native union of the
/// states the web component renders
/// (web/src/features/charging/components/cost-analysis/ChargerTypeBreakdown.tsx). The web source is a pure
/// presentational component (it takes <c>data: ChargerTypeData[]</c> + <c>totalCost</c> as props and performs
/// no fetching), so the branches are a direct function of the input <see cref="ChargerTypeBreakdownModel"/> —
/// there is no fetch-driven error / stale / offline branch to reproduce here. The parent
/// <c>CostAnalysisPage</c> owns the whole query lifecycle (it renders a single page-level
/// <c>LoadingSkeleton</c> while <c>isLoading</c>, and the error / stale / offline chrome is handled once for
/// the page before this component is mounted), exactly as the web source only receives already-resolved
/// <c>chargerTypeData</c>. Every branch maps onto a visible surface; none is ever hidden.
/// </summary>
public enum ChargerTypeBreakdownState
{
    /// <summary>The parent is still computing the cost breakdown — title + skeleton chrome.</summary>
    Loading,

    /// <summary>Resolved with no charger-type rows (web <c>data.length === 0</c>) — friendly empty state.</summary>
    Empty,

    /// <summary>At least one charger-type row to chart (web <c>data.length &gt; 0</c>) — the donut + breakdown.</summary>
    Ready,
}

/// <summary>
/// One charger-type datum — the native mirror of the web <c>ChargerTypeData</c> shape in
/// <c>web/src/features/charging/components/cost-analysis/types.ts</c>
/// (<c>{ name; cost; energy; sessions; color }</c>), narrowed to the fields the surface reads. The web
/// parent already converts the summed SI energy to the user's display unit
/// (<c>energy: convertEnergyFromSI(v.energy, 'kWh')</c>) before handing it to the component, so
/// <see cref="EnergyKwh"/> carries that display-ready kWh figure verbatim — the component labels and divides
/// by it exactly as the web source does. The web <c>color</c> is intentionally dropped: the native pie /
/// legend / bar all tint from the shared brand palette by row position (see
/// <see cref="ChargerTypeBreakdownSlice.ColorIndex"/>), the same parity choice the
/// <c>ChargingBreakdownSlide</c> port made for its connector-mix donut. Pure data — no WinUI types.
/// </summary>
public sealed record ChargerTypeDatum(string Name, double Cost, double EnergyKwh, long Sessions);

/// <summary>
/// The render-time data model the <c>ChargerTypeBreakdown</c> view binds to — the native analogue of the web
/// component's <c>data</c> + <c>totalCost</c> props, plus the fetch flag the parent supplies. The component is
/// presentational; user-facing labels are resolved from the i18n facade by the projection, not passed in.
/// Costs are the user's currency amounts and <see cref="ChargerTypeDatum.EnergyKwh"/> is display-kWh, both
/// already prepared by the parent — no display conversion happens here. Pure data — no WinUI types — so the
/// projection is unit-tested without a UI host.
/// </summary>
public sealed record ChargerTypeBreakdownModel(
    bool Loading,
    double TotalCost,
    IReadOnlyList<ChargerTypeDatum> Items)
{
    /// <summary>The initial model: the parent is still computing the breakdown and no rows have arrived yet.</summary>
    public static ChargerTypeBreakdownModel Pending { get; } =
        new(true, 0, Array.Empty<ChargerTypeDatum>());

    /// <summary>A resolved model with no charger-type rows — the empty state.</summary>
    public static ChargerTypeBreakdownModel Empty { get; } =
        new(false, 0, Array.Empty<ChargerTypeDatum>());
}

/// <summary>
/// One projected, render-ready charger-type row — the native union of a single recharts <c>&lt;Cell&gt;</c>,
/// its legend chip, and its detail bar (web <c>data.map(...)</c>). <see cref="Name"/> is the charger-category
/// label; <see cref="Cost"/> is the raw currency amount the pie wedge is sized by (web <c>dataKey="cost"</c>);
/// <see cref="ColorIndex"/> is the zero-based palette position shared by the wedge, legend dot and bar fill;
/// <see cref="CostText"/> is <c>formatCurrency(cost, 2)</c>; <see cref="MetaText"/> is the
/// "<c>{cost} · {n} sessions</c>" caption; <see cref="Percent"/> is its 0..100 share of
/// <c>totalCost</c>; <see cref="PercentText"/> is <c>fmtNumber(pct, 1)%</c>; <see cref="EnergyText"/> is
/// <c>fmtWithUnit(energy, 'kWh', 1)</c>; <see cref="PerKwhText"/> is
/// <c>formatCurrency(cost / energy, 3)/kWh</c> (the em-dash when there is no energy); and
/// <see cref="AutomationName"/> is the spoken row. Pure data.
/// </summary>
public sealed record ChargerTypeBreakdownSlice(
    string Name,
    double Cost,
    int ColorIndex,
    string CostText,
    string MetaText,
    string SessionsText,
    double Percent,
    string PercentText,
    string EnergyText,
    string PerKwhText,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the surface for one input model — the native analogue of what the
/// web <c>ChargerTypeBreakdown</c> renders. Holds the active <see cref="State"/>, the resolved
/// <see cref="Title"/>, the empty + loading copy, the projected <see cref="Slices"/>, a spoken
/// <see cref="ChartSummary"/> of the donut, and the surface <see cref="AutomationName"/>. Pure data so every
/// branch is asserted headlessly.
/// </summary>
public sealed record ChargerTypeBreakdownDisplay(
    ChargerTypeBreakdownState State,
    string Title,
    string EmptyMessage,
    string LoadingLabel,
    IReadOnlyList<ChargerTypeBreakdownSlice> Slices,
    string ChartSummary,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="ChargerTypeBreakdownModel"/> to its
/// <see cref="ChargerTypeBreakdownDisplay"/> — the native port of
/// web/src/features/charging/components/cost-analysis/ChargerTypeBreakdown.tsx. The branch precedence mirrors
/// the web source (loading → empty → ready, where emptiness is the row <em>count</em>, not the values, so a
/// window of all-zero-cost rows still renders). Currency renders through the web
/// <c>useFormatting().formatCurrency</c> rule (<c>{symbol}{fmtNumber(amount, decimals)}</c>), counts through
/// <c>fmtInt</c>, the energy figure through <c>fmtWithUnit(energy, 'kWh', 1)</c>, and the share through
/// <c>fmtNumber(pct, 1)%</c> — every numeric helper reusing <see cref="NumberFormatting"/> so grouping /
/// rounding match the web's <c>Intl.NumberFormat</c> exactly. Every label resolves through the i18n facade
/// using the same keys the web source feeds into <c>t(...)</c>. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class ChargerTypeBreakdownProjection
{
    /// <summary>Em-dash shown for an absent per-kWh value (web parity '—').</summary>
    public const string EmDash = "\u2014";

    /// <summary>Energy unit suffix the web source labels every figure with (<c>fmtWithUnit(energy, 'kWh', 1)</c>).</summary>
    public const string UnitKwh = "kWh";

    private const string MiddleDot = "\u00B7";

    /// <summary>Web <c>safeNumber</c>: a finite number passes through, anything else becomes 0.</summary>
    public static double Safe(double value) => double.IsFinite(value) ? value : 0;

    /// <summary>Format a number with en-US grouping at <paramref name="decimals"/> places (web <c>fmtNumber</c>).</summary>
    public static string FormatNumber(double value, int decimals) =>
        NumberFormatting.Format(Safe(value), null, decimals);

    /// <summary>Format a session count with grouping at 0 dp (web <c>fmtInt</c>).</summary>
    public static string FormatInt(long count) => NumberFormatting.Format(count, null, 0);

    /// <summary>
    /// Format a currency amount as <c>{symbol}{fmtNumber(amount, decimals)}</c> — the web
    /// <c>useFormatting().formatCurrency</c> rule (which leans on <c>safeNumber</c>, so a non-finite amount
    /// renders the symbol + 0 rather than the em-dash).
    /// </summary>
    public static string FormatCurrency(double amount, string symbol, int decimals) =>
        symbol + FormatNumber(amount, decimals);

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web props).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="currencySymbol">The currency symbol (web <c>settings.currency_symbol</c>; default "$").</param>
    public static ChargerTypeBreakdownDisplay Project(
        ChargerTypeBreakdownModel model,
        ILocalizer localizer,
        string? currencySymbol = null)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        string symbol = string.IsNullOrWhiteSpace(currencySymbol)
            ? ChargerTypeBreakdownRegistration.DefaultCurrencySymbol
            : currencySymbol;

        string title = localizer.GetString("costAnalysis.chargerType.title", "Cost by Charger Type");
        string emptyMessage = localizer.GetString("costAnalysis.charts.noData", "Not enough data");
        string loadingLabel = localizer.GetString("common.loading", "Loading");
        string sessionsWord = localizer.GetString("costAnalysis.chargerType.sessions", "sessions");

        IReadOnlyList<ChargerTypeBreakdownSlice> slices = BuildSlices(model, symbol, sessionsWord);
        string chartSummary = BuildChartSummary(slices);
        ChargerTypeBreakdownState state = SelectState(model);

        return new ChargerTypeBreakdownDisplay(
            State: state,
            Title: title,
            EmptyMessage: emptyMessage,
            LoadingLabel: loadingLabel,
            Slices: slices,
            ChartSummary: chartSummary,
            AutomationName: BuildAutomationName(state, title, chartSummary, emptyMessage, loadingLabel));
    }

    /// <summary>Branch precedence from the web source: loading → empty → ready.</summary>
    private static ChargerTypeBreakdownState SelectState(ChargerTypeBreakdownModel model)
    {
        if (model.Loading)
        {
            return ChargerTypeBreakdownState.Loading;
        }

        // Web parity: `data.length > 0 ? <charts> : <empty>` — emptiness is a function of the row COUNT, not
        // the values, so a set of all-zero-cost rows still renders the breakdown rather than collapsing.
        return model.Items.Count == 0 ? ChargerTypeBreakdownState.Empty : ChargerTypeBreakdownState.Ready;
    }

    private static IReadOnlyList<ChargerTypeBreakdownSlice> BuildSlices(
        ChargerTypeBreakdownModel model,
        string symbol,
        string sessionsWord)
    {
        if (model.Items.Count == 0)
        {
            return Array.Empty<ChargerTypeBreakdownSlice>();
        }

        double totalCost = model.TotalCost;
        var slices = new List<ChargerTypeBreakdownSlice>(model.Items.Count);
        for (int i = 0; i < model.Items.Count; i++)
        {
            var item = model.Items[i];

            // Web: `pct = totalCost > 0 ? (entry.cost / totalCost) * 100 : 0`.
            double percent = totalCost > 0 ? Safe(item.Cost) / totalCost * 100 : 0;

            string costText = FormatCurrency(item.Cost, symbol, 2);
            string sessionsText = FormatInt(item.Sessions);
            string metaText = $"{costText} {MiddleDot} {sessionsText} {sessionsWord}";
            string energyText = $"{FormatNumber(item.EnergyKwh, 1)} {UnitKwh}";

            // Web: `entry.energy > 0 ? formatCurrency(entry.cost / entry.energy, 3) + '/kWh' : '—'`.
            string perKwhText = item.EnergyKwh > 0
                ? $"{FormatCurrency(item.Cost / item.EnergyKwh, symbol, 3)}/{UnitKwh}"
                : EmDash;
            string percentText = $"{FormatNumber(percent, 1)}%";

            string automationName = string.Join(", ", new[]
            {
                item.Name,
                costText,
                $"{sessionsText} {sessionsWord}",
                energyText,
                perKwhText,
                percentText,
            });

            slices.Add(new ChargerTypeBreakdownSlice(
                Name: item.Name,
                Cost: Safe(item.Cost),
                ColorIndex: i,
                CostText: costText,
                MetaText: metaText,
                SessionsText: sessionsText,
                Percent: percent,
                PercentText: percentText,
                EnergyText: energyText,
                PerKwhText: perKwhText,
                AutomationName: automationName));
        }

        return slices;
    }

    private static string BuildChartSummary(IReadOnlyList<ChargerTypeBreakdownSlice> slices)
    {
        if (slices.Count == 0)
        {
            return string.Empty;
        }

        var parts = new List<string>(slices.Count);
        foreach (var slice in slices)
        {
            parts.Add($"{slice.Name} {slice.PercentText}");
        }

        return string.Join(", ", parts);
    }

    private static string BuildAutomationName(
        ChargerTypeBreakdownState state,
        string title,
        string chartSummary,
        string emptyMessage,
        string loadingLabel) => state switch
        {
            ChargerTypeBreakdownState.Loading => string.Create(CultureInfo.CurrentCulture, $"{title}. {loadingLabel}"),
            ChargerTypeBreakdownState.Empty => string.Create(CultureInfo.CurrentCulture, $"{title}. {emptyMessage}"),
            _ => string.Create(CultureInfo.CurrentCulture, $"{title}. {chartSummary}"),
        };
}

/// <summary>
/// PII-safe diagnostics for the <c>ChargerTypeBreakdown</c> surface (P1/S11 diagnostics contract). Records only
/// the operational <c>view.opened</c> event with the surface slug — never a cost, energy figure or session
/// count — so a diagnostics line can never leak a user's charging spend. Thread-safe.
/// </summary>
public sealed class ChargerTypeBreakdownDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public ChargerTypeBreakdownDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ChargerTypeBreakdown</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ChargerTypeBreakdownRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>ChargerTypeBreakdown</c> feature surface — the native mirror of the web
/// component at <c>web/src/features/charging/components/cost-analysis/ChargerTypeBreakdown.tsx</c>.
/// </summary>
public static class ChargerTypeBreakdownRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "ChargerTypeBreakdown";

    /// <summary>The default currency symbol (web parity for an unset <c>settings.currency_symbol</c>).</summary>
    public const string DefaultCurrencySymbol = "$";

    /// <summary>Segoe Fluent "LightningBolt" glyph — native stand-in for the web Lucide <c>Zap</c> icon.</summary>
    public const string TitleGlyph = "\uE945";
}
