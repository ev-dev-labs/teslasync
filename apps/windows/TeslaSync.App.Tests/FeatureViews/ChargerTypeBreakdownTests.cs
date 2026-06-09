using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>ChargerTypeBreakdown</c> feature surface's UI-thread-free logic — the
/// branch projection (loading / empty / ready), the per-row currency / count / energy / cost-per-kWh / share
/// formatting (web <c>formatCurrency</c> / <c>fmtInt</c> / <c>fmtWithUnit</c> / <c>fmtNumber</c>), the
/// palette-by-position colour indices, the spoken summary + accessible names, and the diagnostics. Mirrors
/// the web spec (web/src/features/charging/components/cost-analysis/ChargerTypeBreakdown.tsx). The WinUI view
/// itself is exercised by the app build.
/// </summary>
public sealed class ChargerTypeBreakdownTests
{
    private const string EmDash = "\u2014";
    private const string MiddleDot = "\u00B7";
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static ChargerTypeDatum D(
        string name = "Supercharger",
        double cost = 10,
        double energyKwh = 20,
        long sessions = 5) => new(name, cost, energyKwh, sessions);

    private static ChargerTypeBreakdownModel Loaded(double totalCost, params ChargerTypeDatum[] items) =>
        new(false, totalCost, items);

    private static ChargerTypeBreakdownModel Loading(params ChargerTypeDatum[] items) =>
        new(true, 0, items);

    private static ChargerTypeBreakdownDisplay Project(ChargerTypeBreakdownModel model, string? symbol = null) =>
        ChargerTypeBreakdownProjection.Project(model, Localizer, symbol);

    // ── Branch precedence: loading → empty → ready (web source order) ────────────────────────────────

    [Fact]
    public void Loading_when_model_is_loading()
    {
        var display = Project(Loading());

        Assert.Equal(ChargerTypeBreakdownState.Loading, display.State);
    }

    [Fact]
    public void Loading_takes_precedence_over_present_rows()
    {
        // The parent computes the breakdown before this presentational surface is shown; while it is still
        // computing, loading wins even if a previous set of rows is cached on the model.
        var display = Project(Loading(D(), D(name: "Home")));

        Assert.Equal(ChargerTypeBreakdownState.Loading, display.State);
    }

    [Fact]
    public void Empty_when_resolved_with_no_rows()
    {
        var display = Project(Loaded(0));

        Assert.Equal(ChargerTypeBreakdownState.Empty, display.State);
        Assert.Empty(display.Slices);
    }

    [Fact]
    public void Ready_when_rows_present()
    {
        var display = Project(Loaded(40, D(name: "Home", cost: 10), D(name: "Supercharger", cost: 30)));

        Assert.Equal(ChargerTypeBreakdownState.Ready, display.State);
        Assert.Equal(2, display.Slices.Count);
    }

    [Fact]
    public void Empty_is_a_function_of_row_count_not_value()
    {
        // Web `data.length > 0 ? <charts> : <empty>` — a single all-zero-cost row still has length > 0, so it
        // renders the breakdown rather than collapsing to the empty state.
        var display = Project(Loaded(0, D(cost: 0, energyKwh: 0, sessions: 0)));

        Assert.Equal(ChargerTypeBreakdownState.Ready, display.State);
        Assert.Single(display.Slices);
        Assert.Equal(0, display.Slices[0].Percent);
    }

    // ── Slice formatting (currency / count / energy / per-kWh / share) ───────────────────────────────

    [Fact]
    public void Cost_text_uses_currency_symbol_at_two_decimals()
    {
        var slice = Assert.Single(Project(Loaded(40, D(cost: 1234.5))).Slices);

        Assert.Equal("$1,234.50", slice.CostText);
    }

    [Fact]
    public void Sessions_text_groups_thousands_like_fmt_int()
    {
        var slice = Assert.Single(Project(Loaded(40, D(sessions: 1234))).Slices);

        Assert.Equal("1,234", slice.SessionsText);
    }

    [Fact]
    public void Meta_text_joins_cost_middle_dot_sessions_word()
    {
        var slice = Assert.Single(Project(Loaded(40, D(cost: 10, sessions: 5))).Slices);

        Assert.Equal($"$10.00 {MiddleDot} 5 sessions", slice.MetaText);
    }

    [Fact]
    public void Energy_text_labels_kwh_at_one_decimal()
    {
        var slice = Assert.Single(Project(Loaded(40, D(energyKwh: 20))).Slices);

        Assert.Equal("20.0 kWh", slice.EnergyText);
    }

    [Fact]
    public void Per_kwh_text_is_cost_over_energy_at_three_decimals()
    {
        var slice = Assert.Single(Project(Loaded(40, D(cost: 10, energyKwh: 20))).Slices);

        Assert.Equal("$0.500/kWh", slice.PerKwhText);
    }

    [Fact]
    public void Per_kwh_text_is_em_dash_when_no_energy()
    {
        // Web parity: `entry.energy > 0 ? formatCurrency(...) + '/kWh' : '—'`.
        var slice = Assert.Single(Project(Loaded(40, D(cost: 10, energyKwh: 0))).Slices);

        Assert.Equal(EmDash, slice.PerKwhText);
    }

    [Fact]
    public void Percent_is_cost_over_total_cost()
    {
        var slice = Assert.Single(Project(Loaded(40, D(cost: 10))).Slices);

        Assert.Equal(25, slice.Percent);
        Assert.Equal("25.0%", slice.PercentText);
    }

    [Fact]
    public void Percent_is_zero_when_total_cost_is_zero()
    {
        // Web parity: `pct = totalCost > 0 ? (entry.cost / totalCost) * 100 : 0`.
        var slice = Assert.Single(Project(Loaded(0, D(cost: 10))).Slices);

        Assert.Equal(0, slice.Percent);
        Assert.Equal("0.0%", slice.PercentText);
    }

    [Fact]
    public void Slice_cost_carries_the_raw_wedge_magnitude()
    {
        // The pie is sized by cost (web `dataKey="cost"`), so the slice keeps the raw cost for the wedge.
        var slice = Assert.Single(Project(Loaded(40, D(cost: 12.34))).Slices);

        Assert.Equal(12.34, slice.Cost);
    }

    // ── Palette-by-position colour indices (wedge / legend / bar share one colour) ───────────────────

    [Fact]
    public void Color_index_follows_row_position()
    {
        var slices = Project(Loaded(60, D(name: "A", cost: 30), D(name: "B", cost: 20), D(name: "C", cost: 10))).Slices;

        Assert.Collection(
            slices,
            s => Assert.Equal(0, s.ColorIndex),
            s => Assert.Equal(1, s.ColorIndex),
            s => Assert.Equal(2, s.ColorIndex));
    }

    // ── Currency symbol (web settings.currency_symbol; default "$") ──────────────────────────────────

    [Fact]
    public void Custom_currency_symbol_is_applied_to_cost_and_per_kwh()
    {
        var slice = Assert.Single(Project(Loaded(40, D(cost: 10, energyKwh: 20)), symbol: "\u20AC").Slices);

        Assert.Equal("\u20AC10.00", slice.CostText);
        Assert.Equal("\u20AC0.500/kWh", slice.PerKwhText);
    }

    [Fact]
    public void Blank_currency_symbol_falls_back_to_default_dollar()
    {
        var slice = Assert.Single(Project(Loaded(40, D(cost: 10)), symbol: "   ").Slices);

        Assert.StartsWith(ChargerTypeBreakdownRegistration.DefaultCurrencySymbol, slice.CostText, StringComparison.Ordinal);
    }

    // ── Resolved labels (i18n facade fallbacks) ─────────────────────────────────────────────────────

    [Fact]
    public void Resolves_title_and_empty_message_from_the_facade()
    {
        var display = Project(Loaded(0));

        Assert.Equal("Cost by Charger Type", display.Title);
        Assert.Equal("Not enough data", display.EmptyMessage);
    }

    [Fact]
    public void Resolves_sessions_word_from_the_facade()
    {
        var slice = Assert.Single(Project(Loaded(40, D(sessions: 3))).Slices);

        Assert.Contains("sessions", slice.MetaText, StringComparison.Ordinal);
    }

    // ── Chart summary (spoken donut share) ───────────────────────────────────────────────────────────

    [Fact]
    public void Chart_summary_lists_each_name_and_share()
    {
        var display = Project(Loaded(40, D(name: "Home", cost: 10), D(name: "Supercharger", cost: 30)));

        Assert.Contains("Home 25.0%", display.ChartSummary, StringComparison.Ordinal);
        Assert.Contains("Supercharger 75.0%", display.ChartSummary, StringComparison.Ordinal);
    }

    // ── Accessibility: every state exposes a non-empty Narrator name ─────────────────────────────────

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name()
    {
        Assert.All(
            new[]
            {
                Project(Loading()),
                Project(Loaded(0)),
                Project(Loaded(40, D())),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
    }

    [Fact]
    public void Ready_automation_name_carries_the_chart_summary()
    {
        var display = Project(Loaded(40, D(name: "Home", cost: 10), D(name: "Supercharger", cost: 30)));

        Assert.Contains(display.ChartSummary, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Empty_automation_name_carries_the_empty_message()
    {
        var display = Project(Loaded(0));

        Assert.Contains(display.EmptyMessage, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Loading_automation_name_carries_the_loading_label()
    {
        var display = Project(Loading());

        Assert.Contains(display.LoadingLabel, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Each_slice_exposes_a_descriptive_automation_name()
    {
        var slice = Assert.Single(Project(Loaded(40, D(name: "Home", cost: 10, energyKwh: 20, sessions: 5))).Slices);

        Assert.Contains("Home", slice.AutomationName, StringComparison.Ordinal);
        Assert.Contains("$10.00", slice.AutomationName, StringComparison.Ordinal);
        Assert.Contains("5 sessions", slice.AutomationName, StringComparison.Ordinal);
        Assert.Contains("20.0 kWh", slice.AutomationName, StringComparison.Ordinal);
        Assert.Contains("$0.500/kWh", slice.AutomationName, StringComparison.Ordinal);
        Assert.Contains("25.0%", slice.AutomationName, StringComparison.Ordinal);
    }

    // ── Diagnostics (P1/S11): view.opened slug=ChargerTypeBreakdown, PII-safe ────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new ChargerTypeBreakdownDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ChargerTypeBreakdown", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_cost_or_energy_data()
    {
        var captured = new List<string>();
        var diagnostics = new ChargerTypeBreakdownDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.DoesNotContain("$", line, StringComparison.Ordinal);
        Assert.DoesNotContain("kWh", line, StringComparison.Ordinal);
        Assert.Equal("view.opened slug=ChargerTypeBreakdown", line);
    }

    [Fact]
    public void Registration_slug_is_stable()
    {
        Assert.Equal("ChargerTypeBreakdown", ChargerTypeBreakdownRegistration.Slug);
    }
}
