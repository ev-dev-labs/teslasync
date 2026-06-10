using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>TemperatureTrendChart</c> feature surface's UI-thread-free logic — the branch
/// projection (loading / empty / ready against the web's pre-filter + <c>data.length &lt;= 1</c> gate), the
/// SI-Celsius → display-unit conversion of the line and both threshold markers, the recharts gap-on-null
/// behaviour, the semantic line/marker colour roles, the unit-suffix-free legend label (web parity), the
/// resolved i18n labels, the accessible data table, the Narrator names, and the PII-safe diagnostics. Mirrors
/// the web spec (web/src/features/driving/components/drivetrain-health/TemperatureTrendChart.tsx). The WinUI view
/// itself is exercised by the app build.
/// </summary>
public sealed class TemperatureTrendChartTests
{
    private const string EmDash = "\u2014";
    private const string DegC = "\u00B0C";
    private const string DegF = "\u00B0F";
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static TemperatureTrendSample Sample(string date, double? outside) => new(date, outside);

    private static TemperatureTrendChartModel Loaded(params TemperatureTrendSample[] samples) => new(false, samples);

    private static TemperatureTrendChartModel Loading(params TemperatureTrendSample[] samples) => new(true, samples);

    private static TemperatureTrendChartDisplay Project(TemperatureTrendChartModel model, UnitPref? units = null) =>
        TemperatureTrendChartProjection.Project(model, Localizer, units ?? UnitPref.Metric);

    private static TemperatureTrendChartModel TwoMetricSamples() => Loaded(
        Sample("Mar 01", 10),
        Sample("Mar 02", 20));

    // ── Branch precedence: loading → empty (web pre-filter + `data.length <= 1`) → ready ───────────────

    [Fact]
    public void Loading_when_model_is_loading() =>
        Assert.Equal(TemperatureTrendChartState.Loading, Project(TemperatureTrendChartModel.Pending).State);

    [Fact]
    public void Loading_takes_precedence_over_present_samples()
    {
        var display = Project(Loading(Sample("Mar 01", 10), Sample("Mar 02", 20)));

        Assert.Equal(TemperatureTrendChartState.Loading, display.State);
    }

    [Fact]
    public void Empty_when_resolved_with_no_samples()
    {
        var display = Project(TemperatureTrendChartModel.Empty);

        Assert.Equal(TemperatureTrendChartState.Empty, display.State);
        Assert.Empty(display.Rows);
    }

    [Fact]
    public void Empty_when_only_one_sample_matches_the_web_length_gate()
    {
        // Web parity: `if (data.length <= 1) return null;` — a lone point cannot draw a trend.
        var display = Project(Loaded(Sample("Mar 01", 20)));

        Assert.Equal(TemperatureTrendChartState.Empty, display.State);
    }

    [Fact]
    public void Empty_when_only_one_point_has_a_finite_reading()
    {
        // Web parity: the parent does `chartData.filter((d) => d.outsideTemp !== null)` BEFORE the length gate,
        // so a null-temperature drive is not a plottable point and cannot satisfy the >= 2 requirement.
        var display = Project(Loaded(Sample("Mar 01", 20), Sample("Mar 02", null)));

        Assert.Equal(TemperatureTrendChartState.Empty, display.State);
    }

    [Fact]
    public void Ready_when_two_or_more_finite_samples()
    {
        var display = Project(TwoMetricSamples());

        Assert.Equal(TemperatureTrendChartState.Ready, display.State);
        Assert.Equal(2, display.Rows.Count);
    }

    [Fact]
    public void Minimum_sample_count_matches_the_web_gate() =>
        Assert.Equal(2, TemperatureTrendChartProjection.MinimumSampleCount);

    // ── Series: one line, converted values, gap-on-null, semantic role, unit-free name ────────────────

    [Fact]
    public void Renders_a_single_outside_temperature_line()
    {
        var display = Project(TwoMetricSamples());

        Assert.Equal(2, display.Series.Points.Count);
        Assert.Equal(ChartSeriesKind.Line, display.Series.Kind);
    }

    [Fact]
    public void Series_carries_the_web_regen_colour_role() =>
        Assert.Equal(ChartRole.Regen, Project(TwoMetricSamples()).Series.Role); // web outside line #06b6d4

    [Fact]
    public void Series_name_is_the_bare_label_with_no_unit_suffix()
    {
        // Web parity: `name={t('drivetrain.outsideTemp', 'Outside Temp')}` — NO `(${tempUnit})` appended,
        // unlike the sibling StatorTempChart lines. The unit travels on Series.Unit and the column header.
        Assert.Equal("Outside Temp", Project(TwoMetricSamples()).Series.Name);
        Assert.Equal("Outside Temp", Project(TwoMetricSamples(), UnitPref.Imperial).Series.Name);
    }

    [Fact]
    public void Series_unit_reflects_the_active_preference()
    {
        Assert.Equal(DegC, Project(TwoMetricSamples()).Series.Unit);
        Assert.Equal(DegF, Project(TwoMetricSamples(), UnitPref.Imperial).Series.Unit);
    }

    [Fact]
    public void Metric_keeps_celsius_readings_unchanged()
    {
        ChartSeries line = Project(TwoMetricSamples()).Series;

        Assert.Equal(10, line.Points[0].Y);
        Assert.Equal(20, line.Points[1].Y);
        Assert.Equal(0, line.Points[0].X);
        Assert.Equal(1, line.Points[1].X);
    }

    [Fact]
    public void Imperial_converts_each_reading_to_fahrenheit()
    {
        ChartSeries line = Project(TwoMetricSamples(), UnitPref.Imperial).Series;

        // 10°C → 50°F, 20°C → 68°F.
        Assert.Equal(50, line.Points[0].Y);
        Assert.Equal(68, line.Points[1].Y);
    }

    [Fact]
    public void Null_readings_leave_a_gap_in_the_line()
    {
        // The middle reading is absent; recharts simply skips it, so the line keeps only two points.
        var display = Project(Loaded(
            Sample("Mar 01", 10),
            Sample("Mar 02", null),
            Sample("Mar 03", 30)));

        ChartSeries line = display.Series;
        Assert.Equal(2, line.Points.Count);
        Assert.Equal(0, line.Points[0].X);
        Assert.Equal(2, line.Points[1].X); // index 1 skipped
    }

    [Fact]
    public void Point_label_carries_the_drive_date()
    {
        ChartSeries line = Project(TwoMetricSamples()).Series;

        Assert.Equal("Mar 01", line.Points[0].Label);
        Assert.Equal("Mar 02", line.Points[1].Label);
    }

    // ── Reference markers: converted thresholds, labels, roles, kind, order ───────────────────────────

    [Fact]
    public void Two_threshold_markers_are_drawn()
    {
        var display = Project(TwoMetricSamples());

        Assert.Equal(2, display.ReferenceLines.Count);
        Assert.All(display.ReferenceLines, a => Assert.Equal(ChartAnnotationKind.HorizontalLine, a.Kind));
    }

    [Fact]
    public void Metric_thresholds_sit_at_thirty_five_and_zero_celsius()
    {
        var display = Project(TwoMetricSamples());

        Assert.Equal(35, display.ReferenceLines[0].Value); // Warm Zone
        Assert.Equal(0, display.ReferenceLines[1].Value);  // Freezing
    }

    [Fact]
    public void Imperial_thresholds_convert_to_fahrenheit()
    {
        var display = Project(TwoMetricSamples(), UnitPref.Imperial);

        Assert.Equal(95, display.ReferenceLines[0].Value); // 35°C → 95°F
        Assert.Equal(32, display.ReferenceLines[1].Value); // 0°C → 32°F
    }

    [Fact]
    public void Thresholds_carry_the_web_roles_labels_and_order()
    {
        var display = Project(TwoMetricSamples());

        Assert.Equal(ChartRole.Energy, display.ReferenceLines[0].Role); // web #f59e0b amber
        Assert.Equal("Warm Zone", display.ReferenceLines[0].Label);
        Assert.Equal(ChartRole.Regen, display.ReferenceLines[1].Role);  // web #06b6d4 cyan
        Assert.Equal("Freezing", display.ReferenceLines[1].Label);
    }

    // ── Resolved labels (i18n facade fallbacks mirror the web `t(...)` defaults) ───────────────────────

    [Fact]
    public void Resolves_title_subtitle_and_aria_from_the_facade()
    {
        var display = Project(TwoMetricSamples());

        Assert.Equal("Temperature Trend", display.Title);
        Assert.Equal("Outside temperature recorded during recent drives", display.Subtitle);
        Assert.Equal("Outside temperature trend line chart per recent drive", display.AriaLabel);
    }

    [Fact]
    public void Column_headers_carry_the_active_unit_suffix()
    {
        var metric = Project(TwoMetricSamples());
        Assert.Equal("Date", metric.Columns.Date);
        Assert.Equal($"Outside ({DegC})", metric.Columns.Outside);

        var imperial = Project(TwoMetricSamples(), UnitPref.Imperial);
        Assert.Equal($"Outside ({DegF})", imperial.Columns.Outside);
    }

    [Fact]
    public void Empty_and_loading_copy_use_the_shared_strings()
    {
        Assert.Equal("No data available", Project(TemperatureTrendChartModel.Empty).EmptyMessage);
        Assert.Equal("Loading", Project(TemperatureTrendChartModel.Pending).LoadingLabel);
    }

    [Fact]
    public void Unit_label_reflects_the_preference()
    {
        Assert.Equal(DegC, Project(TwoMetricSamples()).TemperatureUnitLabel);
        Assert.Equal(DegF, Project(TwoMetricSamples(), UnitPref.Imperial).TemperatureUnitLabel);
    }

    // ── Data table: one row per sample, formatted values, em dash for gaps ─────────────────────────────

    [Fact]
    public void Table_has_one_row_per_sample_with_formatted_values()
    {
        var display = Project(TwoMetricSamples());

        Assert.Equal(2, display.Rows.Count);
        TemperatureTrendTableRow first = display.Rows[0];
        Assert.Equal("Mar 01", first.Date);
        Assert.Equal("10.0", first.Outside);
    }

    [Fact]
    public void Table_cell_uses_an_em_dash_for_a_missing_reading()
    {
        var display = Project(Loaded(
            Sample("Mar 01", 10),
            Sample("Mar 02", 20),
            Sample("Mar 03", null)));

        Assert.Equal(EmDash, display.Rows[2].Outside);
    }

    [Fact]
    public void Table_renders_em_dash_for_a_blank_date()
    {
        var display = Project(Loaded(
            Sample("   ", 10),
            Sample("Mar 02", 20)));

        Assert.Equal(EmDash, display.Rows[0].Date);
    }

    [Fact]
    public void Imperial_table_values_are_converted()
    {
        var display = Project(TwoMetricSamples(), UnitPref.Imperial);

        Assert.Equal("50.0", display.Rows[0].Outside); // 10°C → 50°F
    }

    // ── Accessibility: meaningful Narrator names ───────────────────────────────────────────────────────

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name()
    {
        Assert.All(
            new[]
            {
                Project(TemperatureTrendChartModel.Pending),
                Project(TemperatureTrendChartModel.Empty),
                Project(TwoMetricSamples()),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
    }

    [Fact]
    public void Loading_automation_name_carries_the_title_and_loading_label()
    {
        var display = Project(TemperatureTrendChartModel.Pending);

        Assert.Contains(display.Title, display.AutomationName, StringComparison.Ordinal);
        Assert.Contains(display.LoadingLabel, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Empty_automation_name_carries_the_title_and_empty_message()
    {
        var display = Project(TemperatureTrendChartModel.Empty);

        Assert.Contains(display.Title, display.AutomationName, StringComparison.Ordinal);
        Assert.Contains(display.EmptyMessage, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Ready_automation_name_is_the_chart_aria_label() =>
        Assert.Equal(Project(TwoMetricSamples()).AriaLabel, Project(TwoMetricSamples()).AutomationName);

    [Fact]
    public void Each_table_row_exposes_a_descriptive_automation_name()
    {
        TemperatureTrendTableRow row = Project(TwoMetricSamples()).Rows[0];

        Assert.False(string.IsNullOrWhiteSpace(row.AutomationName));
        Assert.Contains("Mar 01", row.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Outside", row.AutomationName, StringComparison.Ordinal);
        Assert.Contains($"10.0{DegC}", row.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Row_automation_name_speaks_an_em_dash_for_a_gap()
    {
        var display = Project(Loaded(
            Sample("Mar 01", 10),
            Sample("Mar 02", 20),
            Sample("Mar 03", null)));

        Assert.Contains(EmDash, display.Rows[2].AutomationName, StringComparison.Ordinal);
    }

    // ── Diagnostics (P1/S11): view.opened slug=TemperatureTrendChart, PII-safe ─────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new TemperatureTrendChartDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=TemperatureTrendChart", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_temperature_or_date_data()
    {
        var captured = new List<string>();
        var diagnostics = new TemperatureTrendChartDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        string line = Assert.Single(captured);
        Assert.Equal("view.opened slug=TemperatureTrendChart", line);
        Assert.DoesNotContain(DegC, line, StringComparison.Ordinal);
    }

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("TemperatureTrendChart", TemperatureTrendChartRegistration.Slug);

    // ── Argument validation ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(
            () => TemperatureTrendChartProjection.Project(null!, Localizer, UnitPref.Metric));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(
            () => TemperatureTrendChartProjection.Project(TemperatureTrendChartModel.Pending, null!, UnitPref.Metric));

    [Fact]
    public void Project_rejects_a_null_unit_preference() =>
        Assert.Throws<ArgumentNullException>(
            () => TemperatureTrendChartProjection.Project(TemperatureTrendChartModel.Pending, Localizer, null!));
}
