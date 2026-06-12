using TeslaSync.App.Core.Charts;
using TeslaSync.App.WidgetPrimitives;
using Xunit;

namespace TeslaSync.App.Tests.Widgets;

/// <summary>
/// Headless verification of the WidgetGaugeHero shared widget primitive's UI-thread-free logic — the projection
/// adapter (diameter, value clamp + formatting, stats-row and children gates, stat projection, Narrator names),
/// the state-holder view-model's re-projection on every input change, and the PII-safe diagnostics. Mirrors the
/// web spec (web/src/features/dashboard/widgets/shared/WidgetGaugeHero.tsx): a pure-presentational primitive
/// whose "states" are its render branches (compact vs standard, with/without stats, with/without children).
/// </summary>
public sealed class WidgetGaugeHeroTests
{
    private static GaugeHeroConfig Gauge(
        double value = 72,
        double max = 100,
        string label = "Battery",
        string unit = "%",
        ChartRole role = ChartRole.None,
        int colorIndex = 0) => new(value, max, label, unit, role, colorIndex);

    private static IReadOnlyList<GaugeHeroStat> SampleStats() =>
    [
        new GaugeHeroStat("Range", "250", "mi"),
        new GaugeHeroStat("Efficiency", "4.2"),
    ];

    // ---- Diameter (web: size = compact ? 70 : 100) ---------------------------------

    [Fact]
    public void Project_standard_uses_the_standard_diameter()
    {
        var display = WidgetGaugeHeroProjection.Project(Gauge(), null, compact: false);
        Assert.Equal(WidgetGaugeHeroProjection.StandardDiameter, display.GaugeDiameter);
        Assert.Equal(100d, display.GaugeDiameter);
        Assert.False(display.Compact);
    }

    [Fact]
    public void Project_compact_uses_the_compact_diameter()
    {
        var display = WidgetGaugeHeroProjection.Project(Gauge(), SampleStats(), compact: true);
        Assert.Equal(WidgetGaugeHeroProjection.CompactDiameter, display.GaugeDiameter);
        Assert.Equal(70d, display.GaugeDiameter);
        Assert.True(display.Compact);
    }

    // ---- Stats-row gate (web: !compact && stats && stats.length > 0) ---------------

    [Fact]
    public void Project_standard_with_stats_shows_and_projects_them()
    {
        var display = WidgetGaugeHeroProjection.Project(Gauge(), SampleStats(), compact: false);

        Assert.True(display.ShowStats);
        Assert.Equal(2, display.Stats.Count);
        Assert.Equal("Range", display.Stats[0].Label);
        Assert.Equal("250", display.Stats[0].Value);
        Assert.Equal("mi", display.Stats[0].Unit);
    }

    [Fact]
    public void Project_compact_never_shows_stats()
    {
        var display = WidgetGaugeHeroProjection.Project(Gauge(), SampleStats(), compact: true);

        Assert.False(display.ShowStats);
        Assert.Empty(display.Stats);
    }

    [Fact]
    public void Project_standard_with_empty_stats_hides_the_row()
    {
        var display = WidgetGaugeHeroProjection.Project(Gauge(), Array.Empty<GaugeHeroStat>(), compact: false);

        Assert.False(display.ShowStats);
        Assert.Empty(display.Stats);
    }

    [Fact]
    public void Project_standard_with_null_stats_hides_the_row()
    {
        var display = WidgetGaugeHeroProjection.Project(Gauge(), null, compact: false);

        Assert.False(display.ShowStats);
        Assert.Empty(display.Stats);
    }

    // ---- Children gate (web: !compact && children) ---------------------------------

    [Theory]
    [InlineData(false, true)]
    [InlineData(true, false)]
    public void Project_children_gate_follows_compact(bool compact, bool expectedShowChildren)
    {
        var display = WidgetGaugeHeroProjection.Project(Gauge(), null, compact);
        Assert.Equal(expectedShowChildren, display.ShowChildren);
    }

    // ---- Stat projection (label / value / optional unit + Narrator name) -----------

    [Fact]
    public void ProjectStat_passes_label_value_unit_and_composes_name()
    {
        var stat = WidgetGaugeHeroProjection.ProjectStat(new GaugeHeroStat("Range", "250", "mi"));

        Assert.Equal("Range", stat.Label);
        Assert.Equal("250", stat.Value);
        Assert.Equal("mi", stat.Unit);
        Assert.Equal("Range 250 mi", stat.AutomationName);
    }

    [Theory]
    [InlineData("")]
    [InlineData(null)]
    public void ProjectStat_treats_blank_unit_as_none(string? unit)
    {
        var stat = WidgetGaugeHeroProjection.ProjectStat(new GaugeHeroStat("Efficiency", "4.2", unit));

        Assert.Null(stat.Unit);
        Assert.Equal("Efficiency 4.2", stat.AutomationName);
    }

    [Fact]
    public void ProjectStat_is_null_tolerant_on_every_field()
    {
        var stat = WidgetGaugeHeroProjection.ProjectStat(new GaugeHeroStat(null!, null!, null));

        Assert.Equal(string.Empty, stat.Label);
        Assert.Equal(string.Empty, stat.Value);
        Assert.Null(stat.Unit);
        Assert.Equal(string.Empty, stat.AutomationName);
    }

    // ---- Gauge value clamp + formatting (web RadialGauge) ---------------------------

    [Theory]
    [InlineData(150, 100, 100)] // value above max clamps to max
    [InlineData(-5, 100, 0)]    // negative clamps to zero
    [InlineData(72, 100, 72)]   // in range passes through
    public void Project_clamps_value_into_range(double value, double max, double expected)
    {
        var display = WidgetGaugeHeroProjection.Project(Gauge(value, max), null, compact: false);
        Assert.Equal(expected, display.GaugeValue);
    }

    [Theory]
    [InlineData(double.NaN)]
    [InlineData(double.PositiveInfinity)]
    [InlineData(double.NegativeInfinity)]
    public void Project_sanitizes_non_finite_values_to_zero(double value)
    {
        var display = WidgetGaugeHeroProjection.Project(Gauge(value, 100), null, compact: false);
        Assert.Equal(0d, display.GaugeValue);
        Assert.Equal("0", display.GaugeValueText);
    }

    [Fact]
    public void Project_formats_integers_with_no_fraction_digits()
    {
        var display = WidgetGaugeHeroProjection.Project(Gauge(72, 100), null, compact: false);
        Assert.Equal(0, display.GaugeDecimals);
        Assert.Equal("72", display.GaugeValueText);
    }

    [Fact]
    public void Project_formats_non_integers_with_global_precision()
    {
        var display = WidgetGaugeHeroProjection.Project(Gauge(72.5, 100), null, compact: false);
        Assert.Equal(WidgetGaugeHeroProjection.GlobalPrecision, display.GaugeDecimals);
        Assert.Equal("72.50", display.GaugeValueText);
    }

    [Fact]
    public void Project_with_nonpositive_max_keeps_a_nonnegative_value()
    {
        var display = WidgetGaugeHeroProjection.Project(Gauge(42, 0), null, compact: false);
        Assert.Equal(42d, display.GaugeValue);
    }

    // ---- Gauge Narrator name (web RadialGauge readout: value + unit + label) -------

    [Fact]
    public void Project_composes_gauge_name_from_label_value_and_unit()
    {
        var display = WidgetGaugeHeroProjection.Project(Gauge(72, 100, "Battery", "%"), null, compact: false);
        Assert.Equal("Battery 72 %", display.GaugeAutomationName);
    }

    [Fact]
    public void Project_omits_blank_parts_from_the_gauge_name()
    {
        var noUnit = WidgetGaugeHeroProjection.Project(Gauge(72, 100, "Battery", ""), null, compact: false);
        Assert.Equal("Battery 72", noUnit.GaugeAutomationName);

        var noLabel = WidgetGaugeHeroProjection.Project(Gauge(72, 100, "", "%"), null, compact: false);
        Assert.Equal("72 %", noLabel.GaugeAutomationName);
    }

    [Fact]
    public void Project_zero_value_still_renders_a_named_gauge_never_blank()
    {
        // Web parity: the gauge always renders (even at 0) — the surface is never an empty box.
        var display = WidgetGaugeHeroProjection.Project(Gauge(0, 100, "Battery", "%"), null, compact: false);

        Assert.Equal("0", display.GaugeValueText);
        Assert.Equal("Battery 0 %", display.GaugeAutomationName);
        Assert.False(string.IsNullOrWhiteSpace(display.GaugeAutomationName));
    }

    // ---- Value-arc selectors (tokenized colour, not web hex) -----------------------

    [Fact]
    public void Project_passes_through_role_and_color_index()
    {
        var display = WidgetGaugeHeroProjection.Project(
            Gauge(role: ChartRole.Battery, colorIndex: 3), null, compact: false);

        Assert.Equal(ChartRole.Battery, display.GaugeRole);
        Assert.Equal(3, display.GaugeColorIndex);
    }

    [Fact]
    public void Project_throws_when_gauge_is_null()
    {
        Assert.Throws<ArgumentNullException>(() => WidgetGaugeHeroProjection.Project(null!, null, compact: false));
    }

    // ---- View-model state holder (re-projection on every input change) -------------

    [Fact]
    public void ViewModel_projects_on_construction()
    {
        var vm = new WidgetGaugeHeroViewModel(Gauge(), SampleStats());

        Assert.True(vm.Display.ShowStats);
        Assert.Equal(100d, vm.Display.GaugeDiameter);
        Assert.Equal(2, vm.Display.Stats.Count);
    }

    [Fact]
    public void ViewModel_reprojects_and_notifies_when_compact_toggles()
    {
        var vm = new WidgetGaugeHeroViewModel(Gauge(), SampleStats());
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.Compact = true;

        Assert.False(vm.Display.ShowStats);
        Assert.Equal(70d, vm.Display.GaugeDiameter);
        Assert.Contains(nameof(WidgetGaugeHeroViewModel.Display), changed);
        Assert.Contains(nameof(WidgetGaugeHeroViewModel.Compact), changed);
    }

    [Fact]
    public void ViewModel_reprojects_when_stats_change()
    {
        var vm = new WidgetGaugeHeroViewModel(Gauge());
        Assert.False(vm.Display.ShowStats);

        vm.Stats = SampleStats();

        Assert.True(vm.Display.ShowStats);
        Assert.Equal(2, vm.Display.Stats.Count);
    }

    [Fact]
    public void ViewModel_reprojects_when_gauge_changes()
    {
        var vm = new WidgetGaugeHeroViewModel(Gauge(10, 100));
        Assert.Equal("10", vm.Display.GaugeValueText);

        vm.Gauge = Gauge(80, 100);

        Assert.Equal("80", vm.Display.GaugeValueText);
    }

    [Fact]
    public void ViewModel_null_stats_collapse_to_empty()
    {
        var vm = new WidgetGaugeHeroViewModel(Gauge(), SampleStats());
        vm.Stats = null!;

        Assert.Empty(vm.Stats);
        Assert.False(vm.Display.ShowStats);
    }

    [Fact]
    public void ViewModel_throws_when_gauge_is_null()
    {
        Assert.Throws<ArgumentNullException>(() => new WidgetGaugeHeroViewModel(null!));
        var vm = new WidgetGaugeHeroViewModel(Gauge());
        Assert.Throws<ArgumentNullException>(() => vm.Gauge = null!);
    }

    // ---- Diagnostics (P1/S11 view.opened, PII-safe) --------------------------------

    [Fact]
    public void Diagnostics_record_emits_the_view_opened_event_with_the_slug()
    {
        var lines = new List<string>();
        var diagnostics = new WidgetGaugeHeroDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=WidgetGaugeHero", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_counts_every_open()
    {
        var diagnostics = new WidgetGaugeHeroDiagnostics();
        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();
        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    [Fact]
    public void Diagnostics_slug_is_the_surface_name()
    {
        Assert.Equal("WidgetGaugeHero", WidgetGaugeHeroDiagnostics.Slug);
    }
}
