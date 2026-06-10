using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>MonthlyCostTable</c> feature surface's UI-thread-free logic — the branch
/// projection (empty / ready), the seven columns, every cell renderer (the <c>fmtInt</c> session count, the
/// <c>fmtWithUnit(_, 'kWh', 1)</c> energy, the <c>Currency</c> cost / gas-equivalent / avg-rate precisions and
/// the signed savings), the web <c>sortedData</c> default ordering + comparator (numeric value columns, ordinal
/// text month), the accessible names, and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/charging/components/cost-analysis/MonthlyCostTable.tsx). The WinUI view itself
/// (MonthlyCostTable.cs) is exercised by the app build.
/// </summary>
public sealed class MonthlyCostTableTests
{
    private const string EmDash = "\u2014";
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static MonthlyBucket Bucket(
        string month = "2024-01",
        double cost = 120.5,
        double energy = 42.567,
        double sessions = 12,
        double avgCostPerKwh = 0.1234,
        double gasEquiv = 300,
        double savings = 179.5) =>
        new(month, cost, energy, sessions, avgCostPerKwh, gasEquiv, savings);

    private static MonthlyCostTableModel Ready(params MonthlyBucket[] buckets) => new(buckets);

    private static MonthlyCostTableDisplay Project(MonthlyCostTableModel model) =>
        MonthlyCostTableProjection.Project(model, Localizer);

    private static MonthlyCostTableRow FirstRow(MonthlyBucket bucket) =>
        Assert.Single(Project(Ready(bucket)).Rows);

    // ── Branch selection: web `sortedData.length > 0 ? <DataTable> : "No monthly data available"` ──────

    [Fact]
    public void Empty_when_no_monthly_rows()
    {
        var display = Project(MonthlyCostTableModel.Empty);

        Assert.Equal(MonthlyCostTableState.Empty, display.State);
        Assert.Empty(display.Rows);
    }

    [Fact]
    public void Ready_when_rows_present()
    {
        var display = Project(Ready(Bucket("2024-01"), Bucket("2024-02")));

        Assert.Equal(MonthlyCostTableState.Ready, display.State);
        Assert.Equal(2, display.Rows.Count);
    }

    [Fact]
    public void Ready_is_a_function_of_row_count_not_value()
    {
        // Web parity: emptiness is `sortedData.length === 0`, so a single all-zero month still renders the table.
        var display = Project(Ready(Bucket("2024-01", cost: 0, energy: 0, sessions: 0, avgCostPerKwh: 0, gasEquiv: 0, savings: 0)));

        Assert.Equal(MonthlyCostTableState.Ready, display.State);
        Assert.Single(display.Rows);
    }

    // ── Columns: the seven web columns, in order, with localized headers + numeric flags ──────────────

    [Fact]
    public void Columns_match_the_web_seven_columns()
    {
        var columns = Project(Ready(Bucket())).Columns;

        Assert.Collection(
            columns,
            c => Assert.Equal((MonthlyCostTableProjection.MonthKey, "Month", false), (c.Key, c.Header, c.IsNumeric)),
            c => Assert.Equal((MonthlyCostTableProjection.SessionsKey, "Sessions", true), (c.Key, c.Header, c.IsNumeric)),
            c => Assert.Equal((MonthlyCostTableProjection.EnergyKey, "Energy", true), (c.Key, c.Header, c.IsNumeric)),
            c => Assert.Equal((MonthlyCostTableProjection.CostKey, "Cost", true), (c.Key, c.Header, c.IsNumeric)),
            c => Assert.Equal((MonthlyCostTableProjection.AvgRateKey, "Avg $/kWh", true), (c.Key, c.Header, c.IsNumeric)),
            c => Assert.Equal((MonthlyCostTableProjection.GasEquivKey, "Gas Equiv", true), (c.Key, c.Header, c.IsNumeric)),
            c => Assert.Equal((MonthlyCostTableProjection.SavingsKey, "Savings", true), (c.Key, c.Header, c.IsNumeric)));
    }

    [Fact]
    public void Avg_rate_column_key_is_the_web_field_name_not_the_label_key()
    {
        // Web column key is 'avgCostPerKwh' (the data field) even though its header label key is 'avgRate'.
        Assert.Equal("avgCostPerKwh", MonthlyCostTableProjection.AvgRateKey);
    }

    // ── Cell renderers (web column render functions) ──────────────────────────────────────────────────

    [Fact]
    public void Month_cell_renders_the_bucket_verbatim()
    {
        Assert.Equal("2024-07", FirstRow(Bucket(month: "2024-07")).Cells[MonthlyCostTableProjection.MonthKey]);
    }

    [Fact]
    public void Sessions_cell_uses_fmt_int_with_grouping()
    {
        Assert.Equal("12", FirstRow(Bucket(sessions: 12)).Cells[MonthlyCostTableProjection.SessionsKey]);
        Assert.Equal("1,234", FirstRow(Bucket(sessions: 1234)).Cells[MonthlyCostTableProjection.SessionsKey]);
        // fmtInt rounds the underlying number (web type is `number`).
        Assert.Equal("13", FirstRow(Bucket(sessions: 12.6)).Cells[MonthlyCostTableProjection.SessionsKey]);
    }

    [Fact]
    public void Energy_cell_uses_fmt_with_unit_kwh_at_one_decimal()
    {
        Assert.Equal("42.6 kWh", FirstRow(Bucket(energy: 42.567)).Cells[MonthlyCostTableProjection.EnergyKey]);
    }

    [Fact]
    public void Cost_cell_renders_currency_at_two_decimals()
    {
        Assert.Equal("$1,234.50", FirstRow(Bucket(cost: 1234.5)).Cells[MonthlyCostTableProjection.CostKey]);
    }

    [Fact]
    public void Avg_rate_cell_renders_currency_at_three_decimals()
    {
        Assert.Equal("$0.123", FirstRow(Bucket(avgCostPerKwh: 0.1234)).Cells[MonthlyCostTableProjection.AvgRateKey]);
    }

    [Fact]
    public void Gas_equiv_cell_renders_currency_at_two_decimals()
    {
        Assert.Equal("$300.00", FirstRow(Bucket(gasEquiv: 300)).Cells[MonthlyCostTableProjection.GasEquivKey]);
    }

    [Fact]
    public void Savings_cell_prefixes_a_plus_for_non_negative_amounts()
    {
        Assert.Equal("+$179.50", FirstRow(Bucket(savings: 179.5)).Cells[MonthlyCostTableProjection.SavingsKey]);
        Assert.Equal("+$0.00", FirstRow(Bucket(savings: 0)).Cells[MonthlyCostTableProjection.SavingsKey]);
    }

    [Fact]
    public void Savings_cell_renders_a_negative_amount_without_a_plus()
    {
        // Web renders {savings >= 0 ? '+' : ''}<Currency> — a negative reads "$-3.50".
        Assert.Equal("$-3.50", FirstRow(Bucket(savings: -3.5)).Cells[MonthlyCostTableProjection.SavingsKey]);
    }

    [Fact]
    public void Currency_cells_fall_back_to_em_dash_for_non_finite_amounts()
    {
        var row = FirstRow(Bucket(cost: double.NaN, savings: double.NegativeInfinity));

        Assert.Equal(EmDash, row.Cells[MonthlyCostTableProjection.CostKey]);
        Assert.Equal(EmDash, row.Cells[MonthlyCostTableProjection.SavingsKey]);
    }

    [Fact]
    public void Format_currency_matches_the_web_currency_component()
    {
        Assert.Equal("$120.50", MonthlyCostTableProjection.FormatCurrency(120.5, "$", 2));
        Assert.Equal("$0.123", MonthlyCostTableProjection.FormatCurrency(0.1234, "$", 3));
        Assert.Equal("$1,000.00", MonthlyCostTableProjection.FormatCurrency(1000, "$", 2));
        Assert.Equal(EmDash, MonthlyCostTableProjection.FormatCurrency(double.NaN, "$", 2));
    }

    [Fact]
    public void Format_savings_honors_the_sign_and_em_dash()
    {
        Assert.Equal("+$5.00", MonthlyCostTableProjection.FormatSavings(5, "$"));
        Assert.Equal("$-5.00", MonthlyCostTableProjection.FormatSavings(-5, "$"));
        Assert.Equal(EmDash, MonthlyCostTableProjection.FormatSavings(double.NaN, "$"));
    }

    // ── Currency symbol (web settings.currency_symbol) ────────────────────────────────────────────────

    [Fact]
    public void Cells_use_the_supplied_currency_symbol()
    {
        var display = MonthlyCostTableProjection.Project(Ready(Bucket(cost: 80, savings: 80)), Localizer, "\u20AC");
        var row = Assert.Single(display.Rows);

        Assert.Equal("\u20AC80.00", row.Cells[MonthlyCostTableProjection.CostKey]);
        Assert.Equal("+\u20AC80.00", row.Cells[MonthlyCostTableProjection.SavingsKey]);
    }

    [Fact]
    public void Blank_currency_symbol_falls_back_to_the_default_dollar()
    {
        var display = MonthlyCostTableProjection.Project(Ready(Bucket(cost: 80)), Localizer, "  ");

        Assert.Equal("$80.00", Assert.Single(display.Rows).Cells[MonthlyCostTableProjection.CostKey]);
    }

    // ── Default ordering: web `tableSortKey='month', tableSortDir='desc'` ─────────────────────────────

    [Fact]
    public void Rows_default_to_month_descending()
    {
        var rows = Project(Ready(Bucket("2024-01"), Bucket("2024-03"), Bucket("2024-02"))).Rows;

        Assert.Collection(
            rows,
            r => Assert.Equal("2024-03", r.RowKey),
            r => Assert.Equal("2024-02", r.RowKey),
            r => Assert.Equal("2024-01", r.RowKey));
    }

    [Fact]
    public void Row_key_is_the_month_like_the_web_key_extractor()
    {
        Assert.Equal("2024-09", FirstRow(Bucket("2024-09")).RowKey);
    }

    [Fact]
    public void Default_sort_constants_match_the_web_defaults()
    {
        Assert.Equal("month", MonthlyCostTableProjection.DefaultSortKey);
        Assert.False(MonthlyCostTableProjection.DefaultSortAscending);
    }

    // ── ApplySort: the web `sortedData` comparator (numeric value columns, text month) ────────────────

    [Fact]
    public void Apply_sort_orders_a_numeric_column_by_value_not_text()
    {
        var data = new[]
        {
            Bucket("2024-01", cost: 120.5),
            Bucket("2024-02", cost: 80),
            Bucket("2024-03", cost: 1000),
        };

        var ascending = MonthlyCostTableProjection.ApplySort(data, MonthlyCostTableProjection.CostKey, ascending: true);

        Assert.Collection(
            ascending,
            b => Assert.Equal(80, b.Cost),
            b => Assert.Equal(120.5, b.Cost),
            b => Assert.Equal(1000, b.Cost));
    }

    [Fact]
    public void Apply_sort_descending_reverses_the_order()
    {
        var data = new[] { Bucket("2024-01", savings: 10), Bucket("2024-02", savings: 50), Bucket("2024-03", savings: 30) };

        var descending = MonthlyCostTableProjection.ApplySort(data, MonthlyCostTableProjection.SavingsKey, ascending: false);

        Assert.Collection(
            descending,
            b => Assert.Equal(50, b.Savings),
            b => Assert.Equal(30, b.Savings),
            b => Assert.Equal(10, b.Savings));
    }

    [Fact]
    public void Apply_sort_orders_the_month_column_as_text()
    {
        var data = new[] { Bucket("2024-02"), Bucket("2024-10"), Bucket("2024-01") };

        var ascending = MonthlyCostTableProjection.ApplySort(data, MonthlyCostTableProjection.MonthKey, ascending: true);

        Assert.Equal(new[] { "2024-01", "2024-02", "2024-10" }, ascending.Select(b => b.Month));
    }

    [Fact]
    public void Apply_sort_is_stable_for_equal_keys()
    {
        // Web's Array.prototype.sort is stable; equal keys keep their input order in both directions.
        var data = new[] { Bucket("2024-01", cost: 100), Bucket("2024-02", cost: 100) };

        var ascending = MonthlyCostTableProjection.ApplySort(data, MonthlyCostTableProjection.CostKey, ascending: true);
        var descending = MonthlyCostTableProjection.ApplySort(data, MonthlyCostTableProjection.CostKey, ascending: false);

        Assert.Equal(new[] { "2024-01", "2024-02" }, ascending.Select(b => b.Month));
        Assert.Equal(new[] { "2024-01", "2024-02" }, descending.Select(b => b.Month));
    }

    [Fact]
    public void Apply_sort_does_not_mutate_the_input()
    {
        var data = new[] { Bucket("2024-01"), Bucket("2024-02") };

        MonthlyCostTableProjection.ApplySort(data, MonthlyCostTableProjection.MonthKey, ascending: false);

        Assert.Equal(new[] { "2024-01", "2024-02" }, data.Select(b => b.Month));
    }

    // ── Resolved labels (i18n facade fallbacks) ───────────────────────────────────────────────────────

    [Fact]
    public void Resolves_the_web_title_and_empty_message()
    {
        Assert.Equal("Monthly Cost Breakdown", Project(Ready(Bucket())).Title);
        Assert.Equal("No monthly data available", Project(MonthlyCostTableModel.Empty).EmptyMessage);
    }

    [Fact]
    public void Title_renders_in_the_empty_branch_too()
    {
        // The web GlassPanel header is outside the data/empty conditional, so the title always shows.
        Assert.Equal("Monthly Cost Breakdown", Project(MonthlyCostTableModel.Empty).Title);
    }

    // ── Accessibility: every state + every row exposes a Narrator name ────────────────────────────────

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name()
    {
        Assert.All(
            new[]
            {
                Project(MonthlyCostTableModel.Empty),
                Project(Ready(Bucket())),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
    }

    [Fact]
    public void Empty_automation_name_carries_the_title_and_message()
    {
        var display = Project(MonthlyCostTableModel.Empty);

        Assert.Contains(display.Title, display.AutomationName, StringComparison.Ordinal);
        Assert.Contains(display.EmptyMessage, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Ready_automation_name_carries_the_title_and_row_count()
    {
        var display = Project(Ready(Bucket("2024-01"), Bucket("2024-02")));

        Assert.Contains(display.Title, display.AutomationName, StringComparison.Ordinal);
        Assert.Contains("2", display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Each_row_exposes_a_descriptive_automation_name()
    {
        var row = FirstRow(Bucket("2024-09", cost: 120.5, sessions: 12, savings: 179.5));

        Assert.Contains("Month 2024-09", row.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Sessions 12", row.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Cost $120.50", row.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Savings +$179.50", row.AutomationName, StringComparison.Ordinal);
    }

    // ── Configuration + diagnostics (P1/S11): view.opened slug=MonthlyCostTable, PII-safe ─────────────

    [Fact]
    public void Page_size_matches_the_web_default()
    {
        Assert.Equal(25, MonthlyCostTableProjection.PageSize);
    }

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new MonthlyCostTableDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=MonthlyCostTable", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_month_or_cost_data()
    {
        var captured = new List<string>();
        var diagnostics = new MonthlyCostTableDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.DoesNotContain("2024", line, StringComparison.Ordinal);
        Assert.DoesNotContain("$", line, StringComparison.Ordinal);
        Assert.Equal("view.opened slug=MonthlyCostTable", line);
    }

    [Fact]
    public void Registration_exposes_the_stable_slug_table_id_and_currency()
    {
        Assert.Equal("MonthlyCostTable", MonthlyCostTableRegistration.Slug);
        Assert.Equal("charging:cost-monthly", MonthlyCostTableRegistration.TableId);
        Assert.Equal("$", MonthlyCostTableRegistration.DefaultCurrencySymbol);
        Assert.Equal("\uE950", MonthlyCostTableRegistration.TitleGlyph);
    }
}
