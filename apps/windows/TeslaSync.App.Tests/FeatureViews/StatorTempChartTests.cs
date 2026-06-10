using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>StatorTempChart</c> feature surface's UI-thread-free logic — the branch
/// projection (loading / empty / ready against the web <c>data.length &lt;= 1</c> gate), the SI-Celsius →
/// display-unit conversion of every line and threshold marker, the recharts gap-on-null behaviour, the
/// semantic line/marker colour roles, the resolved i18n labels, the accessible data table, the Narrator
/// names, and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/driving/components/drivetrain-health/StatorTempChart.tsx). The WinUI view itself is
/// exercised by the app build.
/// </summary>
public sealed class StatorTempChartTests
{
    private const string EmDash = "\u2014";
    private const string DegC = "\u00B0C";
    private const string DegF = "\u00B0F";
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static StatorTempSample Sample(string time, double? stator, double? rel, double? rer) =>
        new(time, stator, rel, rer);

    private static StatorTempChartModel Loaded(params StatorTempSample[] samples) => new(false, samples);

    private static StatorTempChartModel Loading(params StatorTempSample[] samples) => new(true, samples);

    private static StatorTempChartDisplay Project(StatorTempChartModel model, UnitPref? units = null) =>
        StatorTempChartProjection.Project(model, Localizer, units ?? UnitPref.Metric);

    private static StatorTempChartModel TwoMetricSamples() => Loaded(
        Sample("09:00", 50, 48, 46),
        Sample("09:01", 60, 58, 56));

    // ── Branch precedence: loading → empty (web `data.length <= 1`) → ready ───────────────────────────

    [Fact]
    public void Loading_when_model_is_loading() =>
        Assert.Equal(StatorTempChartState.Loading, Project(StatorTempChartModel.Pending).State);

    [Fact]
    public void Loading_takes_precedence_over_present_samples()
    {
        var display = Project(Loading(Sample("09:00", 50, 48, 46), Sample("09:01", 60, 58, 56)));

        Assert.Equal(StatorTempChartState.Loading, display.State);
    }

    [Fact]
    public void Empty_when_resolved_with_no_samples()
    {
        var display = Project(StatorTempChartModel.Empty);

        Assert.Equal(StatorTempChartState.Empty, display.State);
        Assert.Empty(display.Rows);
    }

    [Fact]
    public void Empty_when_only_one_sample_matches_the_web_length_gate()
    {
        // Web parity: `if (data.length <= 1) return null;` — a lone snapshot cannot draw a trend.
        var display = Project(Loaded(Sample("09:00", 60, 58, 56)));

        Assert.Equal(StatorTempChartState.Empty, display.State);
    }

    [Fact]
    public void Ready_when_two_or_more_samples()
    {
        var display = Project(TwoMetricSamples());

        Assert.Equal(StatorTempChartState.Ready, display.State);
        Assert.Equal(2, display.Rows.Count);
    }

    [Fact]
    public void Minimum_sample_count_matches_the_web_gate() =>
        Assert.Equal(2, StatorTempChartProjection.MinimumSampleCount);

    // ── Series: three lines, converted values, gap-on-null, semantic roles ───────────────────────────

    [Fact]
    public void Renders_three_lines_for_front_rear_and_inverter()
    {
        var display = Project(TwoMetricSamples());

        Assert.Equal(3, display.Series.Count);
    }

    [Fact]
    public void Series_carry_the_web_semantic_colour_roles()
    {
        var display = Project(TwoMetricSamples());

        Assert.Equal(ChartRole.Temperature, display.Series[0].Role); // web stator #ef4444
        Assert.Equal(ChartRole.Power, display.Series[1].Role);       // web statorRel #a855f7
        Assert.Equal(ChartRole.Regen, display.Series[2].Role);       // web statorRer #06b6d4
    }

    [Fact]
    public void Series_are_lines()
    {
        var display = Project(TwoMetricSamples());

        Assert.All(display.Series, s => Assert.Equal(ChartSeriesKind.Line, s.Kind));
    }

    [Fact]
    public void Metric_keeps_celsius_readings_unchanged()
    {
        var display = Project(TwoMetricSamples());

        ChartSeries stator = display.Series[0];
        Assert.Equal(2, stator.Points.Count);
        Assert.Equal(50, stator.Points[0].Y);
        Assert.Equal(60, stator.Points[1].Y);
        Assert.Equal(0, stator.Points[0].X);
        Assert.Equal(1, stator.Points[1].X);
    }

    [Fact]
    public void Imperial_converts_each_reading_to_fahrenheit()
    {
        var display = Project(TwoMetricSamples(), UnitPref.Imperial);

        // 50°C → 122°F, 60°C → 140°F.
        Assert.Equal(122, display.Series[0].Points[0].Y);
        Assert.Equal(140, display.Series[0].Points[1].Y);
    }

    [Fact]
    public void Null_readings_leave_a_gap_in_their_line()
    {
        // The middle inverter reading is absent; recharts simply skips it, so its line keeps only two points.
        var display = Project(Loaded(
            Sample("09:00", 50, 48, 46),
            Sample("09:01", 60, 58, null),
            Sample("09:02", 70, 68, 66)));

        ChartSeries inverter = display.Series[2];
        Assert.Equal(2, inverter.Points.Count);
        Assert.Equal(0, inverter.Points[0].X);
        Assert.Equal(2, inverter.Points[1].X); // index 1 skipped
    }

    [Fact]
    public void A_fully_absent_sensor_still_keeps_its_line_and_legend_entry()
    {
        var display = Project(Loaded(
            Sample("09:00", 50, 48, null),
            Sample("09:01", 60, 58, null)));

        Assert.Equal(3, display.Series.Count);
        Assert.Empty(display.Series[2].Points);
    }

    [Fact]
    public void Point_label_carries_the_snapshot_time()
    {
        var display = Project(TwoMetricSamples());

        Assert.Equal("09:00", display.Series[0].Points[0].Label);
        Assert.Equal("09:01", display.Series[0].Points[1].Label);
    }

    // ── Reference markers: converted thresholds, labels, roles, kind ─────────────────────────────────

    [Fact]
    public void Two_threshold_markers_are_drawn()
    {
        var display = Project(TwoMetricSamples());

        Assert.Equal(2, display.ReferenceLines.Count);
        Assert.All(display.ReferenceLines, a => Assert.Equal(ChartAnnotationKind.HorizontalLine, a.Kind));
    }

    [Fact]
    public void Metric_thresholds_sit_at_sixty_and_eighty_celsius()
    {
        var display = Project(TwoMetricSamples());

        Assert.Equal(60, display.ReferenceLines[0].Value);
        Assert.Equal(80, display.ReferenceLines[1].Value);
    }

    [Fact]
    public void Imperial_thresholds_convert_to_fahrenheit()
    {
        var display = Project(TwoMetricSamples(), UnitPref.Imperial);

        Assert.Equal(140, display.ReferenceLines[0].Value); // 60°C
        Assert.Equal(176, display.ReferenceLines[1].Value); // 80°C
    }

    [Fact]
    public void Thresholds_carry_green_and_amber_roles_and_labels()
    {
        var display = Project(TwoMetricSamples());

        Assert.Equal(ChartRole.Battery, display.ReferenceLines[0].Role); // web #4ade80 green
        Assert.Equal("Normal", display.ReferenceLines[0].Label);
        Assert.Equal(ChartRole.Energy, display.ReferenceLines[1].Role);  // web #fbbf24 amber
        Assert.Equal("Warm", display.ReferenceLines[1].Label);
    }

    // ── Resolved labels (i18n facade fallbacks mirror the web `t(...)` defaults) ──────────────────────

    [Fact]
    public void Resolves_title_subtitle_and_aria_from_the_facade()
    {
        var display = Project(TwoMetricSamples());

        Assert.Equal("Stator Temperature History", display.Title);
        Assert.Equal("Motor stator temperature over recent snapshots", display.Subtitle);
        Assert.Equal(
            "Front, rear-left and rear-right motor stator temperature history line chart",
            display.AriaLabel);
    }

    [Fact]
    public void Series_names_carry_the_active_unit_suffix()
    {
        var metric = Project(TwoMetricSamples());
        Assert.Equal($"Stator Temp ({DegC})", metric.Series[0].Name);
        Assert.Equal($"Rear-Left Stator Temp ({DegC})", metric.Series[1].Name);
        Assert.Equal($"Rear-Right Stator Temp ({DegC})", metric.Series[2].Name);

        var imperial = Project(TwoMetricSamples(), UnitPref.Imperial);
        Assert.Equal($"Stator Temp ({DegF})", imperial.Series[0].Name);
    }

    [Fact]
    public void Column_headers_carry_the_active_unit_suffix()
    {
        var display = Project(TwoMetricSamples());

        Assert.Equal("Time", display.Columns.Time);
        Assert.Equal($"Stator ({DegC})", display.Columns.Stator);
        Assert.Equal($"Rear-Left ({DegC})", display.Columns.StatorRel);
        Assert.Equal($"Rear-Right ({DegC})", display.Columns.StatorRer);
    }

    [Fact]
    public void Empty_and_loading_copy_use_the_shared_strings()
    {
        Assert.Equal("No data available", Project(StatorTempChartModel.Empty).EmptyMessage);
        Assert.Equal("Loading", Project(StatorTempChartModel.Pending).LoadingLabel);
    }

    [Fact]
    public void Unit_label_reflects_the_preference()
    {
        Assert.Equal(DegC, Project(TwoMetricSamples()).TemperatureUnitLabel);
        Assert.Equal(DegF, Project(TwoMetricSamples(), UnitPref.Imperial).TemperatureUnitLabel);
    }

    // ── Data table: one row per snapshot, formatted values, em dash for gaps ──────────────────────────

    [Fact]
    public void Table_has_one_row_per_snapshot_with_formatted_values()
    {
        var display = Project(TwoMetricSamples());

        Assert.Equal(2, display.Rows.Count);
        StatorTempTableRow first = display.Rows[0];
        Assert.Equal("09:00", first.Time);
        Assert.Equal("50.0", first.Stator);
        Assert.Equal("48.0", first.StatorRel);
        Assert.Equal("46.0", first.StatorRer);
    }

    [Fact]
    public void Table_cell_uses_an_em_dash_for_a_missing_reading()
    {
        var display = Project(Loaded(
            Sample("09:00", 50, 48, 46),
            Sample("09:01", 60, null, 56)));

        Assert.Equal(EmDash, display.Rows[1].StatorRel);
    }

    [Fact]
    public void Table_renders_em_dash_for_a_blank_timestamp()
    {
        var display = Project(Loaded(
            Sample("   ", 50, 48, 46),
            Sample("09:01", 60, 58, 56)));

        Assert.Equal(EmDash, display.Rows[0].Time);
    }

    [Fact]
    public void Imperial_table_values_are_converted()
    {
        var display = Project(TwoMetricSamples(), UnitPref.Imperial);

        Assert.Equal("122.0", display.Rows[0].Stator); // 50°C → 122°F
    }

    // ── Accessibility: meaningful Narrator names ──────────────────────────────────────────────────────

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name()
    {
        Assert.All(
            new[]
            {
                Project(StatorTempChartModel.Pending),
                Project(StatorTempChartModel.Empty),
                Project(TwoMetricSamples()),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
    }

    [Fact]
    public void Loading_automation_name_carries_the_title_and_loading_label()
    {
        var display = Project(StatorTempChartModel.Pending);

        Assert.Contains(display.Title, display.AutomationName, StringComparison.Ordinal);
        Assert.Contains(display.LoadingLabel, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Empty_automation_name_carries_the_title_and_empty_message()
    {
        var display = Project(StatorTempChartModel.Empty);

        Assert.Contains(display.Title, display.AutomationName, StringComparison.Ordinal);
        Assert.Contains(display.EmptyMessage, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Ready_automation_name_is_the_chart_aria_label() =>
        Assert.Equal(Project(TwoMetricSamples()).AriaLabel, Project(TwoMetricSamples()).AutomationName);

    [Fact]
    public void Each_table_row_exposes_a_descriptive_automation_name()
    {
        StatorTempTableRow row = Assert.IsType<StatorTempTableRow>(Project(TwoMetricSamples()).Rows[0]);

        Assert.False(string.IsNullOrWhiteSpace(row.AutomationName));
        Assert.Contains("09:00", row.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Stator", row.AutomationName, StringComparison.Ordinal);
        Assert.Contains($"50.0{DegC}", row.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Row_automation_name_speaks_an_em_dash_for_a_gap()
    {
        var display = Project(Loaded(
            Sample("09:00", 50, 48, 46),
            Sample("09:01", 60, null, 56)));

        Assert.Contains(EmDash, display.Rows[1].AutomationName, StringComparison.Ordinal);
    }

    // ── Diagnostics (P1/S11): view.opened slug=StatorTempChart, PII-safe ──────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new StatorTempChartDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=StatorTempChart", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_temperature_or_timestamp_data()
    {
        var captured = new List<string>();
        var diagnostics = new StatorTempChartDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        string line = Assert.Single(captured);
        Assert.Equal("view.opened slug=StatorTempChart", line);
        Assert.DoesNotContain(DegC, line, StringComparison.Ordinal);
    }

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("StatorTempChart", StatorTempChartRegistration.Slug);

    // ── Argument validation ───────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(
            () => StatorTempChartProjection.Project(null!, Localizer, UnitPref.Metric));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(
            () => StatorTempChartProjection.Project(StatorTempChartModel.Pending, null!, UnitPref.Metric));

    [Fact]
    public void Project_rejects_a_null_unit_preference() =>
        Assert.Throws<ArgumentNullException>(
            () => StatorTempChartProjection.Project(StatorTempChartModel.Pending, Localizer, null!));
}
