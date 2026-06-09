using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>ChargerSpecsPanel</c> feature surface's UI-thread-free logic — the branch
/// projection (loading / empty / ready), the web <c>hasData</c> expression (voltage/cable/brand only — phase is
/// intentionally excluded, bug-for-bug), the per-column rows with their raw session count + SI→display energy
/// (kWh) and average-power (kW) conversion at the boundary, the per-column empty states, the accessible names,
/// and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/charging/components/charging-list/ChargerSpecsPanel.tsx). The WinUI view itself is
/// exercised by the app build.
/// </summary>
public sealed class ChargerSpecsPanelTests
{
    private const int Voltage = 0;
    private const int Phase = 1;
    private const int Cable = 2;
    private const int Brand = 3;

    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly UnitPref Units = UnitPref.Metric;

    private static ChargerSpecsEntry Entry(
        string name = "Tesla Wall Connector",
        long count = 5,
        double energyWh = 12_340,
        double? avgPowerW = null) =>
        new(name, count, energyWh, avgPowerW);

    private static ChargerSpecsPanelModel Model(
        bool loading = false,
        IReadOnlyList<ChargerSpecsEntry>? voltage = null,
        IReadOnlyList<ChargerSpecsEntry>? phase = null,
        IReadOnlyList<ChargerSpecsEntry>? cable = null,
        IReadOnlyList<ChargerSpecsEntry>? brand = null) =>
        new(loading, voltage ?? [], phase ?? [], cable ?? [], brand ?? []);

    private static ChargerSpecsPanelDisplay Project(ChargerSpecsPanelModel model) =>
        ChargerSpecsPanelProjection.Project(model, Localizer, Units);

    private static ChargerSpecsPanelDisplay Project(ChargerSpecsPanelModel model, UnitPref units) =>
        ChargerSpecsPanelProjection.Project(model, Localizer, units);

    // ── Branch precedence: loading → empty → ready (web lifecycle) ──────────────────────────────────────

    [Fact]
    public void Loading_when_model_is_loading() =>
        Assert.Equal(ChargerSpecsState.Loading, Project(ChargerSpecsPanelModel.Pending).State);

    [Fact]
    public void Loading_takes_precedence_over_present_data()
    {
        var display = Project(Model(loading: true, brand: [Entry()]));

        Assert.Equal(ChargerSpecsState.Loading, display.State);
    }

    [Fact]
    public void Empty_when_no_groups() =>
        Assert.Equal(ChargerSpecsState.Empty, Project(ChargerSpecsPanelModel.Empty).State);

    [Fact]
    public void Ready_when_brand_has_rows() =>
        Assert.Equal(ChargerSpecsState.Ready, Project(Model(brand: [Entry()])).State);

    [Fact]
    public void Ready_when_voltage_has_rows() =>
        Assert.Equal(ChargerSpecsState.Ready, Project(Model(voltage: [Entry()])).State);

    [Fact]
    public void Ready_when_cable_has_rows() =>
        Assert.Equal(ChargerSpecsState.Ready, Project(Model(cable: [Entry()])).State);

    // ── Web hasData parity: phase is NOT part of the hasData test ───────────────────────────────────────

    [Fact]
    public void Empty_when_only_phase_has_rows()
    {
        // Web: hasData = specs && (voltage.length || cable.length || brand.length) — phase is excluded, so a
        // breakdown with only phase rows still collapses to the overall empty surface.
        var display = Project(Model(phase: [Entry()]));

        Assert.Equal(ChargerSpecsState.Empty, display.State);
    }

    [Fact]
    public void HasData_ignores_phase()
    {
        Assert.False(ChargerSpecsPanelProjection.HasData(Model(phase: [Entry()])));
        Assert.True(ChargerSpecsPanelProjection.HasData(Model(voltage: [Entry()])));
        Assert.True(ChargerSpecsPanelProjection.HasData(Model(cable: [Entry()])));
        Assert.True(ChargerSpecsPanelProjection.HasData(Model(brand: [Entry()])));
    }

    // ── Columns: four, in web order, with their glyphs + localized labels ──────────────────────────────

    [Fact]
    public void Builds_four_columns_in_web_order()
    {
        var columns = Project(Model(brand: [Entry()])).Columns;

        Assert.Equal(4, columns.Count);
        Assert.Equal("By Voltage", columns[Voltage].Label);
        Assert.Equal("By Phase", columns[Phase].Label);
        Assert.Equal("By Cable", columns[Cable].Label);
        Assert.Equal("By Brand", columns[Brand].Label);
    }

    [Fact]
    public void Columns_carry_their_decorative_glyphs()
    {
        var display = Project(Model(brand: [Entry()]));

        Assert.Equal(ChargerSpecsPanelProjection.HeaderGlyph, display.HeaderGlyph);
        Assert.Equal(ChargerSpecsPanelProjection.VoltageGlyph, display.Columns[Voltage].Glyph);
        Assert.Equal(ChargerSpecsPanelProjection.PhaseGlyph, display.Columns[Phase].Glyph);
        Assert.Equal(ChargerSpecsPanelProjection.CableGlyph, display.Columns[Cable].Glyph);
        Assert.Equal(ChargerSpecsPanelProjection.BrandGlyph, display.Columns[Brand].Glyph);
    }

    [Fact]
    public void Title_resolves_from_the_facade() =>
        Assert.Equal("Charger Specs Breakdown", Project(Model(brand: [Entry()])).Title);

    // ── Empty columns: each shows its own message, never a blank cell ──────────────────────────────────

    [Fact]
    public void Empty_columns_carry_their_own_messages()
    {
        // brand has data (Ready), but voltage/phase/cable are empty → each shows its specific empty message.
        var columns = Project(Model(brand: [Entry()])).Columns;

        Assert.False(columns[Voltage].HasItems);
        Assert.Equal("No voltage data", columns[Voltage].EmptyMessage);
        Assert.Equal("No phase data", columns[Phase].EmptyMessage);
        Assert.Equal("No cable data", columns[Cable].EmptyMessage);
        Assert.Empty(columns[Voltage].Rows);
    }

    // ── Rows: "{count} sessions · {energy|power}" ───────────────────────────────────────────────────────

    [Fact]
    public void Non_brand_row_shows_session_count_and_energy_in_kwh()
    {
        var column = Project(Model(cable: [Entry(name: "CCS", count: 5, energyWh: 12_340)])).Columns[Cable];

        ChargerSpecsRow row = Assert.Single(column.Rows);
        Assert.Equal("CCS", row.Name);
        Assert.Equal("5 sessions \u00B7 12.34 kWh", row.Meta);
    }

    [Fact]
    public void Brand_row_shows_average_power_in_kw_when_present()
    {
        var column = Project(Model(brand: [Entry(name: "Supercharger", count: 9, energyWh: 99_000, avgPowerW: 48_000)])).Columns[Brand];

        ChargerSpecsRow row = Assert.Single(column.Rows);
        Assert.Equal("9 sessions \u00B7 48 kW avg", row.Meta);
    }

    [Fact]
    public void Brand_row_falls_back_to_energy_when_no_average_power()
    {
        // Web: avgPower === undefined ⇒ the ternary falls through to the kWh energy readout.
        var column = Project(Model(brand: [Entry(name: "Home", count: 3, energyWh: 7_500, avgPowerW: null)])).Columns[Brand];

        ChargerSpecsRow row = Assert.Single(column.Rows);
        Assert.Equal("3 sessions \u00B7 7.50 kWh", row.Meta);
    }

    [Fact]
    public void Average_power_rounds_half_away_from_zero_like_fmtInt()
    {
        // 43.6 kW ⇒ fmtInt ⇒ 44.
        var column = Project(Model(brand: [Entry(avgPowerW: 43_600)])).Columns[Brand];

        Assert.Contains("44 kW avg", Assert.Single(column.Rows).Meta, StringComparison.Ordinal);
    }

    [Fact]
    public void Only_the_brand_column_surfaces_average_power()
    {
        // The same avgPower on a non-brand column is ignored — that column still shows energy (web showAvgPower
        // is only set on the Brand SpecColumn).
        var column = Project(Model(voltage: [Entry(name: "400V", count: 2, energyWh: 5_000, avgPowerW: 30_000)])).Columns[Voltage];

        Assert.Equal("2 sessions \u00B7 5.00 kWh", Assert.Single(column.Rows).Meta);
    }

    [Fact]
    public void Session_count_is_rendered_ungrouped_like_the_web_raw_number()
    {
        // Web renders {v.count} raw (no thousands separator), unlike a formatted metric.
        var column = Project(Model(cable: [Entry(count: 1_234, energyWh: 0)])).Columns[Cable];

        string meta = Assert.Single(column.Rows).Meta;
        Assert.StartsWith("1234 sessions", meta, StringComparison.Ordinal);
        Assert.DoesNotContain("1,234", meta, StringComparison.Ordinal);
    }

    [Fact]
    public void Energy_precision_follows_the_unit_pref_global_precision()
    {
        // Web fmtWithUnit uses the global precision; the unit-pref Precision is that analogue.
        var column = Project(Model(cable: [Entry(count: 1, energyWh: 12_340)]), Units with { Precision = 1 }).Columns[Cable];

        Assert.Equal("1 sessions \u00B7 12.3 kWh", Assert.Single(column.Rows).Meta);
    }

    [Fact]
    public void Multiple_rows_are_projected_in_order()
    {
        var column = Project(Model(brand:
        [
            Entry(name: "Supercharger", count: 10, avgPowerW: 120_000),
            Entry(name: "Home", count: 4, energyWh: 8_000),
        ])).Columns[Brand];

        Assert.Collection(
            column.Rows,
            r => Assert.Equal("Supercharger", r.Name),
            r => Assert.Equal("Home", r.Name));
        Assert.True(column.HasItems);
    }

    // ── Accessibility: every state + column + row exposes a meaningful Narrator name ────────────────────

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name()
    {
        Assert.All(
            new[]
            {
                Project(ChargerSpecsPanelModel.Pending),
                Project(ChargerSpecsPanelModel.Empty),
                Project(Model(brand: [Entry()])),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
    }

    [Fact]
    public void Loading_automation_name_is_the_loading_label()
    {
        var display = Project(ChargerSpecsPanelModel.Pending);

        Assert.Equal("Loading...", display.LoadingLabel);
        Assert.Equal("Loading...", display.AutomationName);
    }

    [Fact]
    public void Empty_automation_name_carries_the_title_and_empty_message()
    {
        var display = Project(ChargerSpecsPanelModel.Empty);

        Assert.Equal("No charger specification data available yet", display.EmptyMessage);
        Assert.Equal("Charger Specs Breakdown. No charger specification data available yet", display.AutomationName);
    }

    [Fact]
    public void Ready_automation_name_carries_the_title()
    {
        var display = Project(Model(brand: [Entry()]));

        Assert.StartsWith("Charger Specs Breakdown", display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Populated_column_automation_name_carries_label_and_rows()
    {
        var column = Project(Model(brand: [Entry(name: "Supercharger", count: 9, avgPowerW: 48_000)])).Columns[Brand];

        Assert.StartsWith("By Brand", column.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Supercharger: 9 sessions", column.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Empty_column_automation_name_carries_label_and_message()
    {
        var column = Project(Model(brand: [Entry()])).Columns[Voltage];

        Assert.Equal("By Voltage. No voltage data", column.AutomationName);
    }

    [Fact]
    public void Row_automation_name_is_name_then_meta()
    {
        var row = Assert.Single(Project(Model(cable: [Entry(name: "CCS", count: 5, energyWh: 12_340)])).Columns[Cable].Rows);

        Assert.Equal("CCS: 5 sessions \u00B7 12.34 kWh", row.AutomationName);
    }

    // ── Diagnostics (P1/S11): view.opened slug=ChargerSpecsPanel, PII-safe ─────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new ChargerSpecsPanelDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ChargerSpecsPanel", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_charging_behaviour()
    {
        var captured = new List<string>();
        var diagnostics = new ChargerSpecsPanelDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        string line = Assert.Single(captured);
        Assert.Equal("view.opened slug=ChargerSpecsPanel", line);
        Assert.DoesNotContain("kWh", line, StringComparison.Ordinal);
        Assert.DoesNotContain("sessions", line, StringComparison.Ordinal);
    }

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("ChargerSpecsPanel", ChargerSpecsPanelRegistration.Slug);

    // ── Argument validation ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(
            () => ChargerSpecsPanelProjection.Project(null!, Localizer, Units));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(
            () => ChargerSpecsPanelProjection.Project(ChargerSpecsPanelModel.Pending, null!, Units));

    [Fact]
    public void Project_rejects_a_null_units() =>
        Assert.Throws<ArgumentNullException>(
            () => ChargerSpecsPanelProjection.Project(ChargerSpecsPanelModel.Pending, Localizer, null!));

    [Fact]
    public void HasData_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(() => ChargerSpecsPanelProjection.HasData(null!));
}
