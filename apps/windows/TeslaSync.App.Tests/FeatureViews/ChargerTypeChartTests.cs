using System.Linq;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>ChargerTypeChart</c> feature surface's UI-thread-free logic — the
/// charger-category grouping (web <c>getChargerLabel</c>), the per-group averages (web <c>avg</c> over
/// <c>peak_power_w</c> / <c>total_energy_added_wh</c> / <c>durationMinutes</c>), the branch projection
/// (loading / empty / ready), the kW / kWh / count / duration formatting (web <c>fmtNumber</c> / <c>fmtInt</c>),
/// the palette-by-position colour indices, the two composed bar series, the accessible table, the spoken
/// summary + accessible names, and the diagnostics. Mirrors the web spec
/// (web/src/features/charging/components/charging-curve/ChargerTypeChart.tsx). The WinUI view itself is
/// exercised by the app build.
/// </summary>
public sealed class ChargerTypeChartTests
{
    private const string MiddleDot = "\u00B7";
    private static readonly DateTimeOffset Start = new(2024, 1, 1, 0, 0, 0, TimeSpan.Zero);
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static ChargerTypeChartSession Session(
        string? chargerType = null,
        double? peakPowerW = 11_000,
        double energyWh = 40_000,
        double durationMinutes = 30) =>
        new(chargerType, peakPowerW, energyWh, Start, Start.AddMinutes(durationMinutes));

    private static ChargerTypeChartModel Loaded(params ChargerTypeChartSession[] sessions) =>
        new(false, sessions);

    private static ChargerTypeChartModel Loading(params ChargerTypeChartSession[] sessions) =>
        new(true, sessions);

    private static ChargerTypeChartDisplay Project(ChargerTypeChartModel model, int precision = 2) =>
        ChargerTypeChartProjection.Project(model, Localizer, precision);

    // ── Charger-category classification (web getChargerLabel) ─────────────────────────────────────────

    [Theory]
    [InlineData("Tesla", ChargerTypeChartProjection.LabelSupercharger)]
    [InlineData("Tesla Supercharger", ChargerTypeChartProjection.LabelSupercharger)]
    [InlineData("TESLA", ChargerTypeChartProjection.LabelSupercharger)]
    [InlineData("CCS", ChargerTypeChartProjection.LabelDcFast)]
    [InlineData("CHAdeMO", ChargerTypeChartProjection.LabelDcFast)]
    public void Charger_label_classifies_by_type(string chargerType, string expected) =>
        Assert.Equal(expected, ChargerTypeChartProjection.ChargerLabel(Session(chargerType: chargerType)));

    [Fact]
    public void Charger_label_uses_peak_power_when_type_is_blank()
    {
        // Web: empty/null charger_type is falsy, so the >20 kW peak decides DC fast vs home / AC.
        Assert.Equal(
            ChargerTypeChartProjection.LabelDcFast,
            ChargerTypeChartProjection.ChargerLabel(Session(chargerType: null, peakPowerW: 30_000)));
        Assert.Equal(
            ChargerTypeChartProjection.LabelDcFast,
            ChargerTypeChartProjection.ChargerLabel(Session(chargerType: string.Empty, peakPowerW: 30_000)));
        Assert.Equal(
            ChargerTypeChartProjection.LabelHomeAc,
            ChargerTypeChartProjection.ChargerLabel(Session(chargerType: null, peakPowerW: 5_000)));
        Assert.Equal(
            ChargerTypeChartProjection.LabelHomeAc,
            ChargerTypeChartProjection.ChargerLabel(Session(chargerType: null, peakPowerW: null)));
    }

    [Fact]
    public void Charger_label_threshold_is_strictly_above_twenty_kilowatts()
    {
        // Web parity: `s.peak_power_w > 20_000` — exactly 20 kW is NOT DC fast.
        Assert.Equal(
            ChargerTypeChartProjection.LabelHomeAc,
            ChargerTypeChartProjection.ChargerLabel(Session(chargerType: null, peakPowerW: 20_000)));
        Assert.Equal(
            ChargerTypeChartProjection.LabelDcFast,
            ChargerTypeChartProjection.ChargerLabel(Session(chargerType: null, peakPowerW: 20_001)));
    }

    // ── Duration + average helpers (web durationMinutes / avg) ────────────────────────────────────────

    [Fact]
    public void Duration_is_zero_without_an_end_or_for_a_non_positive_span()
    {
        Assert.Equal(0, ChargerTypeChartProjection.DurationMinutes(Start, null));
        Assert.Equal(0, ChargerTypeChartProjection.DurationMinutes(Start, Start));
        Assert.Equal(0, ChargerTypeChartProjection.DurationMinutes(Start, Start.AddMinutes(-5)));
    }

    [Fact]
    public void Duration_rounds_whole_minutes_half_away_from_zero()
    {
        Assert.Equal(30, ChargerTypeChartProjection.DurationMinutes(Start, Start.AddMinutes(30)));
        Assert.Equal(2, ChargerTypeChartProjection.DurationMinutes(Start, Start.AddSeconds(90)));
    }

    [Fact]
    public void Average_is_zero_when_empty_else_the_mean()
    {
        Assert.Equal(0, ChargerTypeChartProjection.Average(Array.Empty<double>()));
        Assert.Equal(20, ChargerTypeChartProjection.Average(new double[] { 10, 20, 30 }));
    }

    // ── Branch precedence: loading → empty → ready (web source order) ─────────────────────────────────

    [Fact]
    public void Loading_when_model_is_loading()
    {
        var display = Project(Loading());

        Assert.Equal(ChargerTypeChartState.Loading, display.State);
        Assert.Empty(display.Series);
    }

    [Fact]
    public void Loading_takes_precedence_over_present_sessions()
    {
        var display = Project(Loading(Session(chargerType: "Tesla")));

        Assert.Equal(ChargerTypeChartState.Loading, display.State);
    }

    [Fact]
    public void Empty_when_resolved_with_no_sessions()
    {
        var display = Project(Loaded());

        Assert.Equal(ChargerTypeChartState.Empty, display.State);
        Assert.Empty(display.Slices);
        Assert.Empty(display.Series);
        Assert.Empty(display.Rows);
    }

    [Fact]
    public void Ready_when_sessions_present()
    {
        var display = Project(Loaded(Session(chargerType: "Tesla"), Session(chargerType: "CCS")));

        Assert.Equal(ChargerTypeChartState.Ready, display.State);
        Assert.Equal(2, display.Slices.Count);
    }

    // ── Grouping + order (web Map insertion order) ───────────────────────────────────────────────────

    [Fact]
    public void Sessions_group_by_charger_label_in_first_seen_order()
    {
        var display = Project(Loaded(
            Session(chargerType: "CCS"),
            Session(chargerType: "Tesla"),
            Session(chargerType: "CCS")));

        Assert.Collection(
            display.Slices,
            s => Assert.Equal(ChargerTypeChartProjection.LabelDcFast, s.Label),
            s => Assert.Equal(ChargerTypeChartProjection.LabelSupercharger, s.Label));
        Assert.Equal(2, display.Slices[0].Count);
        Assert.Equal(1, display.Slices[1].Count);
    }

    [Fact]
    public void Group_averages_divide_si_power_and_energy_by_one_thousand()
    {
        var display = Project(Loaded(
            Session(chargerType: "Tesla", peakPowerW: 150_000, energyWh: 40_000, durationMinutes: 20),
            Session(chargerType: "Tesla", peakPowerW: 250_000, energyWh: 60_000, durationMinutes: 40)));

        ChargerTypeChartSlice slice = Assert.Single(display.Slices);
        Assert.Equal(200, slice.AvgKw);   // (150 + 250) / 2 kW
        Assert.Equal(50, slice.AvgKwh);   // (40 + 60) / 2 kWh
        Assert.Equal(30, slice.AvgDuration);
    }

    // ── Per-row formatting (web fmtNumber / fmtInt) ──────────────────────────────────────────────────

    [Fact]
    public void Average_power_and_energy_render_at_one_decimal_with_grouping()
    {
        var display = Project(Loaded(
            Session(chargerType: "Tesla", peakPowerW: 1_234_500, energyWh: 2_345_600)));

        ChargerTypeChartSlice slice = Assert.Single(display.Slices);
        Assert.Equal("1,234.5", slice.AvgKwText);
        Assert.Equal("2,345.6", slice.AvgKwhText);
    }

    [Fact]
    public void Average_minutes_column_uses_fmt_int()
    {
        // avg of 30 and 45 minutes = 37.5 -> fmtInt rounds half away from zero -> "38".
        var display = Project(Loaded(
            Session(chargerType: "Tesla", durationMinutes: 30),
            Session(chargerType: "Tesla", durationMinutes: 45)));

        ChargerTypeChartSlice slice = Assert.Single(display.Slices);
        Assert.Equal("38", slice.AvgMinutesText);
    }

    [Fact]
    public void Count_cell_is_raw_string_while_legend_count_groups_thousands()
    {
        // Web table cell renders String(count) (no grouping); the legend uses fmtInt (grouped).
        var sessions = Enumerable.Range(0, 1234).Select(_ => Session(chargerType: "Tesla")).ToArray();
        var display = Project(Loaded(sessions));

        ChargerTypeChartSlice slice = Assert.Single(display.Slices);
        Assert.Equal(1234, slice.Count);
        Assert.Equal("1234", slice.CountCellText);
        Assert.Equal("1,234", slice.CountText);
    }

    [Fact]
    public void Legend_caption_joins_count_sessions_and_min_avg()
    {
        var display = Project(Loaded(
            Session(chargerType: "Tesla", durationMinutes: 30),
            Session(chargerType: "Tesla", durationMinutes: 30)));

        ChargerTypeChartSlice slice = Assert.Single(display.Slices);
        Assert.Equal($"2 sessions {MiddleDot} 30.00 min avg", slice.LegendCaption);
    }

    [Theory]
    [InlineData(0, "30")]
    [InlineData(1, "30.0")]
    [InlineData(2, "30.00")]
    public void Legend_min_avg_honours_decimal_precision(int precision, string expected)
    {
        var display = Project(
            Loaded(Session(chargerType: "Tesla", durationMinutes: 30)),
            precision);

        ChargerTypeChartSlice slice = Assert.Single(display.Slices);
        Assert.EndsWith($"{expected} min avg", slice.LegendCaption, StringComparison.Ordinal);
    }

    // ── Palette-by-position colour indices (legend dots) ─────────────────────────────────────────────

    [Fact]
    public void Color_index_follows_row_position()
    {
        var display = Project(Loaded(
            Session(chargerType: "Tesla"),
            Session(chargerType: "CCS"),
            Session(chargerType: null, peakPowerW: 5_000)));

        Assert.Collection(
            display.Slices,
            s => Assert.Equal(0, s.ColorIndex),
            s => Assert.Equal(1, s.ColorIndex),
            s => Assert.Equal(2, s.ColorIndex));
    }

    // ── Composed bar series (web <Bar> avgKw / avgKwh) ───────────────────────────────────────────────

    [Fact]
    public void Ready_builds_two_named_bar_series_on_distinct_palette_colours()
    {
        var display = Project(Loaded(
            Session(chargerType: "Tesla", peakPowerW: 150_000, energyWh: 40_000),
            Session(chargerType: "CCS", peakPowerW: 50_000, energyWh: 30_000)));

        Assert.Equal(2, display.Series.Count);

        ChartSeries power = display.Series[0];
        ChartSeries energy = display.Series[1];
        Assert.Equal("Avg Power", power.Name);
        Assert.Equal("Avg Energy", energy.Name);
        Assert.Equal(ChartSeriesKind.Bar, power.Kind);
        Assert.Equal(ChartSeriesKind.Bar, energy.Kind);
        Assert.Equal(ChargerTypeChartProjection.PowerColorIndex, power.ColorIndex);
        Assert.Equal(ChargerTypeChartProjection.EnergyColorIndex, energy.ColorIndex);
        Assert.NotEqual(power.ColorIndex, energy.ColorIndex);
    }

    [Fact]
    public void Bar_points_carry_ordinal_x_the_average_value_and_the_category_label()
    {
        var display = Project(Loaded(
            Session(chargerType: "Tesla", peakPowerW: 150_000, energyWh: 40_000),
            Session(chargerType: "CCS", peakPowerW: 50_000, energyWh: 30_000)));

        ChartSeries power = display.Series[0];
        Assert.Collection(
            power.Points,
            p =>
            {
                Assert.Equal(0, p.X);
                Assert.Equal(150, p.Y);
                Assert.Equal(ChargerTypeChartProjection.LabelSupercharger, p.Label);
            },
            p =>
            {
                Assert.Equal(1, p.X);
                Assert.Equal(50, p.Y);
                Assert.Equal(ChargerTypeChartProjection.LabelDcFast, p.Label);
            });

        ChartSeries energy = display.Series[1];
        Assert.Equal(40, energy.Points[0].Y);
        Assert.Equal(30, energy.Points[1].Y);
    }

    // ── Accessible table (web dataColumns + String(value) rows) ──────────────────────────────────────

    [Fact]
    public void Columns_match_the_web_data_columns()
    {
        var display = Project(Loaded(Session(chargerType: "Tesla")));

        Assert.Collection(
            display.Columns,
            c => AssertColumn(c, ChargerTypeChartProjection.LabelKey, "Charger Type"),
            c => AssertColumn(c, ChargerTypeChartProjection.CountKey, "Sessions"),
            c => AssertColumn(c, ChargerTypeChartProjection.AvgKwKey, "Avg kW"),
            c => AssertColumn(c, ChargerTypeChartProjection.AvgKwhKey, "Avg kWh"),
            c => AssertColumn(c, ChargerTypeChartProjection.AvgDurationKey, "Avg minutes"));
    }

    [Fact]
    public void Each_row_addresses_its_cells_by_column_key()
    {
        var display = Project(Loaded(
            Session(chargerType: "Tesla", peakPowerW: 150_000, energyWh: 40_000, durationMinutes: 30)));

        ChargerTypeChartRow row = Assert.Single(display.Rows);
        Assert.Equal(ChargerTypeChartProjection.LabelSupercharger, row.RowKey);
        Assert.Equal(ChargerTypeChartProjection.LabelSupercharger, row.Cells[ChargerTypeChartProjection.LabelKey]);
        Assert.Equal("1", row.Cells[ChargerTypeChartProjection.CountKey]);
        Assert.Equal("150.0", row.Cells[ChargerTypeChartProjection.AvgKwKey]);
        Assert.Equal("40.0", row.Cells[ChargerTypeChartProjection.AvgKwhKey]);
        Assert.Equal("30", row.Cells[ChargerTypeChartProjection.AvgDurationKey]);
    }

    // ── Resolved labels (i18n facade fallbacks) ──────────────────────────────────────────────────────

    [Fact]
    public void Resolves_title_subtitle_aria_and_empty_message_from_the_facade()
    {
        var display = Project(Loaded());

        Assert.Equal("Charge Rate by Charger Type", display.Title);
        Assert.Equal("Average kW and kWh per charger category", display.Subtitle);
        Assert.Equal(
            "Composed bar/line chart of average power and energy per charger type",
            display.AriaLabel);
        Assert.Equal("No data available", display.EmptyMessage);
    }

    [Fact]
    public void Every_source_i18n_key_flows_through_the_facade()
    {
        var recorder = new RecordingLocalizer();

        ChargerTypeChartProjection.Project(Loaded(Session(chargerType: "Tesla")), recorder);

        Assert.Superset(
            new HashSet<string>(StringComparer.Ordinal)
            {
                "charging.curve.chargerType",
                "charging.curve.chargerTypeDesc",
                "charging.curve.chargerType.aria",
                "charging.curve.col.charger",
                "charging.curve.col.sessions",
                "charging.curve.col.avgKw",
                "charging.curve.col.avgKwh",
                "charging.curve.col.avgMin",
                "charging.curve.avgPower",
                "charging.curve.avgEnergy",
                "charging.curve.sessions",
                "charging.curve.minAvg",
            },
            recorder.Keys);
    }

    // ── Spoken summary + accessible names ────────────────────────────────────────────────────────────

    [Fact]
    public void Chart_summary_lists_the_aria_label_and_each_category()
    {
        var display = Project(Loaded(
            Session(chargerType: "Tesla", peakPowerW: 150_000, energyWh: 40_000),
            Session(chargerType: "CCS", peakPowerW: 50_000, energyWh: 30_000)));

        Assert.StartsWith(display.AriaLabel, display.ChartSummary, StringComparison.Ordinal);
        Assert.Contains("Supercharger 150.0 kW, 40.0 kWh", display.ChartSummary, StringComparison.Ordinal);
        Assert.Contains("DC Fast 50.0 kW, 30.0 kWh", display.ChartSummary, StringComparison.Ordinal);
    }

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name()
    {
        Assert.All(
            new[]
            {
                Project(Loading()),
                Project(Loaded()),
                Project(Loaded(Session(chargerType: "Tesla"))),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
    }

    [Fact]
    public void Ready_automation_name_carries_the_chart_summary()
    {
        var display = Project(Loaded(Session(chargerType: "Tesla")));

        Assert.Contains(display.ChartSummary, display.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Empty_automation_name_carries_the_empty_message()
    {
        var display = Project(Loaded());

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
        var display = Project(Loaded(
            Session(chargerType: "Tesla", peakPowerW: 150_000, energyWh: 40_000, durationMinutes: 30)));

        ChargerTypeChartSlice slice = Assert.Single(display.Slices);
        Assert.Contains("Supercharger", slice.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Avg Power 150.0 kW", slice.AutomationName, StringComparison.Ordinal);
        Assert.Contains("Avg Energy 40.0 kWh", slice.AutomationName, StringComparison.Ordinal);
        Assert.Contains("1 sessions", slice.AutomationName, StringComparison.Ordinal);
        Assert.Contains("30.00 min avg", slice.AutomationName, StringComparison.Ordinal);
    }

    // ── Diagnostics (P1/S11): view.opened slug=ChargerTypeChart, PII-safe ────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new ChargerTypeChartDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ChargerTypeChart", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_charger_or_energy_data()
    {
        var captured = new List<string>();
        var diagnostics = new ChargerTypeChartDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        string line = Assert.Single(captured);
        Assert.DoesNotContain("Supercharger", line, StringComparison.Ordinal);
        Assert.DoesNotContain("kWh", line, StringComparison.Ordinal);
        Assert.Equal("view.opened slug=ChargerTypeChart", line);
    }

    [Fact]
    public void Registration_slug_is_stable()
    {
        Assert.Equal("ChargerTypeChart", ChargerTypeChartRegistration.Slug);
    }

    private static void AssertColumn(ChargerTypeChartColumn column, string key, string header)
    {
        Assert.Equal(key, column.Key);
        Assert.Equal(header, column.Header);
    }

    /// <summary>An <see cref="ILocalizer"/> that records every requested key and returns the English fallback.</summary>
    private sealed class RecordingLocalizer : ILocalizer
    {
        public HashSet<string> Keys { get; } = new(StringComparer.Ordinal);

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }
}
