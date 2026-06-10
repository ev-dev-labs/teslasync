using System.Globalization;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive render branch of the <c>MonthlyCostTable</c> surface — the native union of the states
/// the web component renders
/// (web/src/features/charging/components/cost-analysis/MonthlyCostTable.tsx). The web source is a pure
/// presentational component: it takes a single <c>data: MonthlyBucket[]</c> prop and performs no fetching, so it
/// renders exactly two branches — the sortable cost <c>DataTable</c> when there is at least one month
/// (<c>sortedData.length &gt; 0</c>), or a friendly "No monthly data available" empty state when there is none.
/// There is deliberately NO loading / error / stale / offline branch to reproduce here: the parent
/// <c>CostAnalysisPage</c> owns the whole query lifecycle (it renders a single page-level skeleton while
/// <c>isLoading</c>, and the error / stale / offline chrome is handled once for the page before this component is
/// mounted), exactly as the web source only ever receives already-resolved monthly buckets. The panel title
/// renders in BOTH branches so the surface is never a blank box.
/// </summary>
public enum MonthlyCostTableState
{
    /// <summary>Resolved with no monthly rows (web <c>sortedData.length === 0</c>) — the friendly empty state.</summary>
    Empty,

    /// <summary>At least one month to tabulate (web <c>sortedData.length &gt; 0</c>) — the cost breakdown table.</summary>
    Ready,
}

/// <summary>
/// One month's charging-cost bucket — the native mirror of a single web <c>MonthlyBucket</c> entry in
/// <c>web/src/features/charging/components/cost-analysis/types.ts</c>, carrying every field the table renders.
/// <see cref="Month"/> is the <c>YYYY-MM</c> bucket label; the remaining members are the user-currency / energy
/// amounts the web parent already sums and currency-prepares. <see cref="Sessions"/> is a <c>double</c> (not an
/// <c>int</c>) because the web type is <c>number</c> and the cell formats it with <c>fmtInt</c>, which rounds —
/// modelling it as a double reproduces that rounding faithfully. Pure data — no WinUI types.
/// </summary>
public sealed record MonthlyBucket(
    string Month,
    double Cost,
    double Energy,
    double Sessions,
    double AvgCostPerKwh,
    double GasEquiv,
    double Savings);

/// <summary>
/// The render-time data model the <c>MonthlyCostTable</c> view binds to — the native analogue of the web
/// component's single <c>data</c> prop. The component is presentational; user-facing labels are resolved from
/// the i18n facade by the projection, not passed in. Pure data — no WinUI types — so the projection is
/// unit-tested without a UI host.
/// </summary>
public sealed record MonthlyCostTableModel(IReadOnlyList<MonthlyBucket> Data)
{
    /// <summary>A resolved model with no monthly rows — the empty state.</summary>
    public static MonthlyCostTableModel Empty { get; } = new(Array.Empty<MonthlyBucket>());
}

/// <summary>
/// A declarative table column descriptor — a stable <see cref="Key"/> into each row's cell map, the localized
/// <see cref="Header"/>, and whether the column is <see cref="IsNumeric"/> (which right-aligns its cells in the
/// shared table). The native, WinUI-free analogue of one web <c>Column&lt;MonthlyBucket&gt;</c> the table
/// declares. The view maps each one onto a <c>TsDataColumn</c>.
/// </summary>
public sealed record MonthlyCostTableColumn(string Key, string Header, bool IsNumeric);

/// <summary>
/// A single projected, display-ready table row — the formatted cell text keyed by column key, a stable
/// <see cref="RowKey"/> (the web <c>keyExtractor</c> = <c>row.month</c>), and a Narrator automation name.
/// Mirrors one row of the web <c>sortedData</c> array (each cell already rendered to the string the web cell
/// renderer produces). Pure data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record MonthlyCostTableRow(
    string RowKey,
    IReadOnlyDictionary<string, string> Cells,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the table for one input model — the native analogue of what the web
/// <c>MonthlyCostTable</c> returns. Holds the active <see cref="State"/>, the resolved <see cref="Title"/> and
/// <see cref="EmptyMessage"/>, the ordered <see cref="Columns"/> + already-sorted <see cref="Rows"/>, and the
/// surface <see cref="AutomationName"/>. Pure data so every branch is asserted headlessly.
/// </summary>
public sealed record MonthlyCostTableDisplay(
    MonthlyCostTableState State,
    string Title,
    string EmptyMessage,
    IReadOnlyList<MonthlyCostTableColumn> Columns,
    IReadOnlyList<MonthlyCostTableRow> Rows,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="MonthlyCostTableModel"/> to its <see cref="MonthlyCostTableDisplay"/> — the
/// native port of web/src/features/charging/components/cost-analysis/MonthlyCostTable.tsx. The branch selection
/// mirrors the web source exactly (<c>sortedData.length &gt; 0 ? &lt;DataTable&gt; : "No monthly data
/// available"</c>); the seven columns reproduce the web <c>columns</c> array in order; each cell reproduces the
/// web cell renderer (<c>fmtInt</c>, <c>fmtWithUnit(_, 'kWh', 1)</c> and the <c>Currency</c> precisions, plus
/// the signed savings); and the rows arrive pre-sorted in the web default order (<c>month</c> descending) via
/// <see cref="ApplySort"/>, which reproduces the web <c>sortedData</c> comparator (numeric for the value
/// columns, ordinal text for the month). Every label resolves through the i18n facade using the same keys the
/// web source feeds into <c>t(...)</c>. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class MonthlyCostTableProjection
{
    /// <summary>Column key for the month bucket (web <c>key: 'month'</c>).</summary>
    public const string MonthKey = "month";

    /// <summary>Column key for the session count (web <c>key: 'sessions'</c>).</summary>
    public const string SessionsKey = "sessions";

    /// <summary>Column key for the energy column (web <c>key: 'energy'</c>).</summary>
    public const string EnergyKey = "energy";

    /// <summary>Column key for the cost column (web <c>key: 'cost'</c>).</summary>
    public const string CostKey = "cost";

    /// <summary>Column key for the average rate column (web <c>key: 'avgCostPerKwh'</c>).</summary>
    public const string AvgRateKey = "avgCostPerKwh";

    /// <summary>Column key for the gas-equivalent column (web <c>key: 'gasEquiv'</c>).</summary>
    public const string GasEquivKey = "gasEquiv";

    /// <summary>Column key for the savings column (web <c>key: 'savings'</c>).</summary>
    public const string SavingsKey = "savings";

    /// <summary>Page size for the data table (web <c>pagination</c> default).</summary>
    public const int PageSize = 25;

    /// <summary>Decimals the cost / gas-equivalent / savings currency cells render at (web <c>Currency</c> default).</summary>
    public const int CurrencyDecimals = 2;

    /// <summary>Decimals the average-rate currency cell renders at (web <c>precision={3}</c>).</summary>
    public const int AvgRateDecimals = 3;

    /// <summary>Decimals the energy cell renders at (web <c>fmtWithUnit(_, 'kWh', 1)</c>).</summary>
    public const int EnergyDecimals = 1;

    /// <summary>Unit suffix on the energy cell (web <c>fmtWithUnit(_, 'kWh', 1)</c>).</summary>
    public const string EnergyUnit = "kWh";

    /// <summary>The web default sort column (web <c>tableSortKey = 'month'</c>).</summary>
    public const string DefaultSortKey = MonthKey;

    /// <summary>The web default sort direction is descending (web <c>tableSortDir = 'desc'</c>).</summary>
    public const bool DefaultSortAscending = false;

    private const string EmDash = "\u2014";
    private const string PositivePrefix = "+";

    /// <summary>
    /// Format a currency amount the way the web <c>Currency</c> component renders it: a non-finite amount falls
    /// back to the em-dash, otherwise <c>{symbol}{fmtNumber(amount, decimals)}</c> with en-US grouping.
    /// </summary>
    /// <param name="amount">The currency amount.</param>
    /// <param name="symbol">The currency symbol.</param>
    /// <param name="decimals">Fixed fraction digits.</param>
    public static string FormatCurrency(double amount, string symbol, int decimals) =>
        double.IsFinite(amount) ? symbol + NumberFormatting.Format(amount, null, decimals) : EmDash;

    /// <summary>
    /// Format the signed savings cell the way the web renders it: the web prefixes a literal <c>+</c> when
    /// <c>savings &gt;= 0</c> and renders the <c>Currency</c> amount otherwise unprefixed (so a negative amount
    /// reads <c>$-3.50</c>). A non-finite amount is not <c>&gt;= 0</c>, so it falls back to the em-dash with no
    /// prefix.
    /// </summary>
    /// <param name="savings">The savings amount.</param>
    /// <param name="symbol">The currency symbol.</param>
    public static string FormatSavings(double savings, string symbol)
    {
        string amount = FormatCurrency(savings, symbol, CurrencyDecimals);
        return savings >= 0 ? PositivePrefix + amount : amount;
    }

    /// <summary>
    /// Order the buckets the way the web <c>sortedData</c> memo does — numerically for every value column
    /// (the web <c>a - b</c> path) and by an ordinal text compare for the month column (the web
    /// <c>String(a).localeCompare(String(b))</c> path), honouring the direction. A stable order is used so equal
    /// keys keep their input order, matching the web's stable <c>Array.prototype.sort</c>.
    /// </summary>
    /// <param name="data">The buckets to order.</param>
    /// <param name="sortKey">The column key to sort by.</param>
    /// <param name="ascending">Ascending when <see langword="true"/>, descending otherwise.</param>
    public static IReadOnlyList<MonthlyBucket> ApplySort(
        IReadOnlyList<MonthlyBucket> data,
        string sortKey,
        bool ascending)
    {
        ArgumentNullException.ThrowIfNull(data);
        if (data.Count <= 1)
        {
            return data.ToList();
        }

        var comparer = Comparer<MonthlyBucket>.Create((a, b) => CompareField(a, b, sortKey));
        IEnumerable<MonthlyBucket> ordered = ascending
            ? data.OrderBy(bucket => bucket, comparer)
            : data.OrderByDescending(bucket => bucket, comparer);
        return ordered.ToList();
    }

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web <c>data</c> prop).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="currencySymbol">The currency symbol (web <c>settings.currency_symbol</c>; default "$").</param>
    public static MonthlyCostTableDisplay Project(
        MonthlyCostTableModel model,
        ILocalizer localizer,
        string? currencySymbol = null)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        string symbol = string.IsNullOrWhiteSpace(currencySymbol)
            ? MonthlyCostTableRegistration.DefaultCurrencySymbol
            : currencySymbol;

        string title = localizer.GetString("costAnalysis.table.title", "Monthly Cost Breakdown");
        string emptyMessage = localizer.GetString("costAnalysis.table.noData", "No monthly data available");

        IReadOnlyList<MonthlyCostTableColumn> columns = BuildColumns(localizer);
        IReadOnlyList<MonthlyBucket> sorted = ApplySort(model.Data, DefaultSortKey, DefaultSortAscending);
        IReadOnlyList<MonthlyCostTableRow> rows = BuildRows(sorted, columns, symbol);

        MonthlyCostTableState state = model.Data.Count > 0
            ? MonthlyCostTableState.Ready
            : MonthlyCostTableState.Empty;

        return new MonthlyCostTableDisplay(
            State: state,
            Title: title,
            EmptyMessage: emptyMessage,
            Columns: columns,
            Rows: rows,
            AutomationName: BuildAutomationName(state, title, emptyMessage, rows.Count));
    }

    private static IReadOnlyList<MonthlyCostTableColumn> BuildColumns(ILocalizer localizer) =>
    [
        new MonthlyCostTableColumn(MonthKey, localizer.GetString("costAnalysis.table.month", "Month"), IsNumeric: false),
        new MonthlyCostTableColumn(SessionsKey, localizer.GetString("costAnalysis.table.sessions", "Sessions"), IsNumeric: true),
        new MonthlyCostTableColumn(EnergyKey, localizer.GetString("costAnalysis.table.energy", "Energy"), IsNumeric: true),
        new MonthlyCostTableColumn(CostKey, localizer.GetString("costAnalysis.table.cost", "Cost"), IsNumeric: true),
        new MonthlyCostTableColumn(AvgRateKey, localizer.GetString("costAnalysis.table.avgRate", "Avg $/kWh"), IsNumeric: true),
        new MonthlyCostTableColumn(GasEquivKey, localizer.GetString("costAnalysis.table.gasEquiv", "Gas Equiv"), IsNumeric: true),
        new MonthlyCostTableColumn(SavingsKey, localizer.GetString("costAnalysis.table.savings", "Savings"), IsNumeric: true),
    ];

    private static IReadOnlyList<MonthlyCostTableRow> BuildRows(
        IReadOnlyList<MonthlyBucket> data,
        IReadOnlyList<MonthlyCostTableColumn> columns,
        string symbol)
    {
        if (data.Count == 0)
        {
            return Array.Empty<MonthlyCostTableRow>();
        }

        var rows = new List<MonthlyCostTableRow>(data.Count);
        foreach (MonthlyBucket bucket in data)
        {
            var cells = new Dictionary<string, string>(StringComparer.Ordinal)
            {
                // Web: <span className="font-medium text-white">{row.month}</span>.
                [MonthKey] = bucket.Month,

                // Web: fmtInt(row.sessions).
                [SessionsKey] = NumberFormatting.Format(bucket.Sessions, null, 0),

                // Web: fmtWithUnit(row.energy, 'kWh', 1).
                [EnergyKey] = NumberFormatting.Format(bucket.Energy, null, EnergyDecimals) + " " + EnergyUnit,

                // Web: <Currency value={row.cost} className="text-cyan-400" />.
                [CostKey] = FormatCurrency(bucket.Cost, symbol, CurrencyDecimals),

                // Web: <Currency value={row.avgCostPerKwh} precision={3} />.
                [AvgRateKey] = FormatCurrency(bucket.AvgCostPerKwh, symbol, AvgRateDecimals),

                // Web: <Currency value={row.gasEquiv} className="text-red-400" />.
                [GasEquivKey] = FormatCurrency(bucket.GasEquiv, symbol, CurrencyDecimals),

                // Web: {savings >= 0 ? '+' : ''}<Currency value={row.savings} />.
                [SavingsKey] = FormatSavings(bucket.Savings, symbol),
            };

            rows.Add(new MonthlyCostTableRow(
                RowKey: bucket.Month,
                Cells: cells,
                AutomationName: BuildRowAutomationName(columns, cells)));
        }

        return rows;
    }

    private static string BuildRowAutomationName(
        IReadOnlyList<MonthlyCostTableColumn> columns,
        Dictionary<string, string> cells)
    {
        var parts = new List<string>(columns.Count);
        foreach (MonthlyCostTableColumn column in columns)
        {
            if (cells.TryGetValue(column.Key, out string? text))
            {
                parts.Add(string.Create(CultureInfo.CurrentCulture, $"{column.Header} {text}"));
            }
        }

        return string.Join(", ", parts);
    }

    private static string BuildAutomationName(
        MonthlyCostTableState state,
        string title,
        string emptyMessage,
        int rowCount) => state switch
        {
            MonthlyCostTableState.Empty => string.Create(CultureInfo.CurrentCulture, $"{title}. {emptyMessage}"),
            _ => string.Create(CultureInfo.CurrentCulture, $"{title}. {rowCount}"),
        };

    private static int CompareField(MonthlyBucket a, MonthlyBucket b, string sortKey) => sortKey switch
    {
        SessionsKey => a.Sessions.CompareTo(b.Sessions),
        EnergyKey => a.Energy.CompareTo(b.Energy),
        CostKey => a.Cost.CompareTo(b.Cost),
        AvgRateKey => a.AvgCostPerKwh.CompareTo(b.AvgCostPerKwh),
        GasEquivKey => a.GasEquiv.CompareTo(b.GasEquiv),
        SavingsKey => a.Savings.CompareTo(b.Savings),
        _ => string.Compare(a.Month, b.Month, StringComparison.Ordinal),
    };
}

/// <summary>
/// PII-safe diagnostics for the <c>MonthlyCostTable</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a month or a cost — so a diagnostics line
/// can never leak a user's charging spend. Thread-safe.
/// </summary>
public sealed class MonthlyCostTableDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">Receives the formatted <c>view.opened</c> line; <see langword="null"/> to only count.</param>
    public MonthlyCostTableDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=MonthlyCostTable</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={MonthlyCostTableRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>MonthlyCostTable</c> feature surface — the native mirror of the web component at
/// <c>web/src/features/charging/components/cost-analysis/MonthlyCostTable.tsx</c>.
/// </summary>
public static class MonthlyCostTableRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "MonthlyCostTable";

    /// <summary>The stable table id the web component keys its column layout by (web <c>tableId</c>).</summary>
    public const string TableId = "charging:cost-monthly";

    /// <summary>The default currency symbol (web parity for an unset <c>settings.currency_symbol</c>).</summary>
    public const string DefaultCurrencySymbol = "$";

    /// <summary>Segoe Fluent glyph for the title icon (web lucide <c>BarChart3</c>).</summary>
    public const string TitleGlyph = "\uE950";
}
