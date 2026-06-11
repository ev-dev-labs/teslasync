using System.Collections.Generic;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces.AreaChartWrapperSurface;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the <c>AreaChartWrapper</c> shared surface's UI-thread-free logic — the branch
/// projection (loading / error / empty / ready / stale / offline), the draw gate (at least one row and one
/// series), the per-series area mapping (the web <c>SeriesConfig</c> → a tokenized
/// <see cref="ChartSeriesKind.Area"/> series with ordinal X, the row value on Y, the formatted X carried as
/// each point's label, the positional-or-explicit colour slot, the semantic role, and the unit / precision),
/// the chart height passthrough, the resolved chrome / per-state labels, the freshness chip, the per-state
/// accessible names and the PII-safe diagnostics. Mirrors the web spec
/// (<c>web/src/components/charts/AreaChartWrapper.tsx</c>). The WinUI view itself (AreaChartWrapper.cs) is
/// exercised by the app build.
/// </summary>
public sealed class AreaChartWrapperTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static AreaChartWrapperSeries Cfg(
        string key,
        string label,
        int? colorIndex = null,
        ChartRole role = ChartRole.None,
        string? unit = null,
        int? decimals = null) =>
        new(key, label) { ColorIndex = colorIndex, Role = role, Unit = unit, Decimals = decimals };

    private static AreaChartWrapperRow Row(string x, params (string Key, double Value)[] values)
    {
        var dict = new Dictionary<string, double>();
        foreach ((string key, double value) in values)
        {
            dict[key] = value;
        }

        return new AreaChartWrapperRow(x, dict);
    }

    private static AreaChartWrapperDisplay Project(AreaChartWrapperModel model) =>
        AreaChartWrapperProjection.Project(model, Localizer);

    private static AreaChartWrapperSeries[] OneSeries() => new[] { Cfg("energy", "Energy") };

    private static AreaChartWrapperRow[] TwoRows() => new[]
    {
        Row("2024-01", ("energy", 120)),
        Row("2024-02", ("energy", 90)),
    };

    private static AreaChartWrapperModel Loaded() =>
        AreaChartWrapperModel.Loaded(TwoRows(), OneSeries());

    // ── Branch precedence: phase wins (loading → error), then freshness over emptiness ───────────────

    [Fact]
    public void Loading_when_phase_is_loading()
    {
        Assert.Equal(AreaChartWrapperState.Loading, Project(AreaChartWrapperModel.Pending).State);
    }

    [Fact]
    public void Loading_takes_precedence_over_present_data()
    {
        var model = new AreaChartWrapperModel(AreaChartWrapperPhase.Loading, TwoRows(), OneSeries());

        Assert.Equal(AreaChartWrapperState.Loading, Project(model).State);
    }

    [Fact]
    public void Error_when_phase_is_error()
    {
        Assert.Equal(AreaChartWrapperState.Error, Project(AreaChartWrapperModel.Failed()).State);
    }

    [Fact]
    public void Ready_when_at_least_one_row_and_one_series()
    {
        var display = Project(Loaded());

        Assert.Equal(AreaChartWrapperState.Ready, display.State);
        Assert.True(display.HasData);
    }

    [Fact]
    public void Stale_when_ready_and_stale()
    {
        Assert.Equal(
            AreaChartWrapperState.Stale,
            Project(AreaChartWrapperModel.StaleSnapshot(TwoRows(), OneSeries())).State);
    }

    [Fact]
    public void Offline_when_ready_and_offline()
    {
        Assert.Equal(
            AreaChartWrapperState.Offline,
            Project(AreaChartWrapperModel.OfflineSnapshot(TwoRows(), OneSeries())).State);
    }

    [Fact]
    public void Offline_takes_precedence_over_stale()
    {
        var model = new AreaChartWrapperModel(
            AreaChartWrapperPhase.Ready, TwoRows(), OneSeries(), IsStale: true, IsOffline: true);

        Assert.Equal(AreaChartWrapperState.Offline, Project(model).State);
    }

    // ── Draw gate: at least one row AND one series, else the friendly empty surface ──────────────────

    [Fact]
    public void Empty_when_resolved_with_no_rows_and_no_series()
    {
        var display = Project(AreaChartWrapperModel.Empty);

        Assert.Equal(AreaChartWrapperState.Empty, display.State);
        Assert.False(display.HasData);
        Assert.Empty(display.Series);
    }

    [Fact]
    public void Empty_when_series_present_but_no_rows()
    {
        var display = Project(AreaChartWrapperModel.Loaded(
            System.Array.Empty<AreaChartWrapperRow>(), OneSeries()));

        Assert.Equal(AreaChartWrapperState.Empty, display.State);
        Assert.False(display.HasData);
        // The series still projects (it simply has no points) — the gate only governs which surface renders.
        Assert.Single(display.Series);
        Assert.Empty(display.Series[0].Points);
    }

    [Fact]
    public void Empty_when_rows_present_but_no_series()
    {
        var display = Project(AreaChartWrapperModel.Loaded(
            TwoRows(), System.Array.Empty<AreaChartWrapperSeries>()));

        Assert.Equal(AreaChartWrapperState.Empty, display.State);
        Assert.False(display.HasData);
        Assert.Empty(display.Series);
    }

    [Fact]
    public void One_row_one_series_clears_the_draw_gate()
    {
        var display = Project(AreaChartWrapperModel.Loaded(
            new[] { Row("2024-01", ("energy", 10)) }, OneSeries()));

        Assert.Equal(AreaChartWrapperState.Ready, display.State);
        Assert.True(display.HasData);
    }

    [Fact]
    public void Stale_with_no_rows_keeps_the_stale_state_but_empty_body()
    {
        var display = Project(AreaChartWrapperModel.StaleSnapshot(
            System.Array.Empty<AreaChartWrapperRow>(), OneSeries()));

        Assert.Equal(AreaChartWrapperState.Stale, display.State);
        Assert.Equal(ChartState.Empty, display.ContainerState);
        Assert.False(display.HasData);
        Assert.Equal("Stale", display.FreshnessChip);
    }

    // ── Container (visual-frame) state mapping ───────────────────────────────────────────────────────

    [Fact]
    public void Container_state_tracks_each_branch()
    {
        Assert.Equal(ChartState.Loading, Project(AreaChartWrapperModel.Pending).ContainerState);
        Assert.Equal(ChartState.Error, Project(AreaChartWrapperModel.Failed()).ContainerState);
        Assert.Equal(ChartState.Empty, Project(AreaChartWrapperModel.Empty).ContainerState);
        Assert.Equal(ChartState.Ready, Project(Loaded()).ContainerState);
    }

    [Fact]
    public void Stale_with_data_still_draws_the_chart()
    {
        Assert.Equal(
            ChartState.Ready,
            Project(AreaChartWrapperModel.StaleSnapshot(TwoRows(), OneSeries())).ContainerState);
    }

    [Fact]
    public void Offline_without_a_cached_trace_falls_back_to_empty_body()
    {
        var model = new AreaChartWrapperModel(
            AreaChartWrapperPhase.Ready,
            System.Array.Empty<AreaChartWrapperRow>(),
            OneSeries(),
            IsOffline: true);
        var display = Project(model);

        Assert.Equal(AreaChartWrapperState.Offline, display.State);
        Assert.Equal(ChartState.Empty, display.ContainerState);
        Assert.False(display.HasData);
    }

    // ── Series mapping: one tokenized area per web SeriesConfig ──────────────────────────────────────

    [Fact]
    public void Each_config_becomes_one_area_series_in_order()
    {
        var configs = new[] { Cfg("energy", "Energy"), Cfg("regen", "Regen") };
        var rows = new[]
        {
            Row("a", ("energy", 1), ("regen", 2)),
            Row("b", ("energy", 3), ("regen", 4)),
        };

        var series = Project(AreaChartWrapperModel.Loaded(rows, configs)).Series;

        Assert.Equal(2, series.Count);
        Assert.Equal("Energy", series[0].Name);
        Assert.Equal("Regen", series[1].Name);
        Assert.All(series, s => Assert.Equal(ChartSeriesKind.Area, s.Kind));
    }

    [Fact]
    public void Color_index_defaults_to_the_series_ordinal_position()
    {
        var configs = new[] { Cfg("a", "A"), Cfg("b", "B"), Cfg("c", "C") };
        var rows = new[] { Row("x", ("a", 1), ("b", 2), ("c", 3)) };

        var series = Project(AreaChartWrapperModel.Loaded(rows, configs)).Series;

        Assert.Equal(0, series[0].ColorIndex);
        Assert.Equal(1, series[1].ColorIndex);
        Assert.Equal(2, series[2].ColorIndex);
    }

    [Fact]
    public void Explicit_color_index_overrides_the_positional_default()
    {
        var configs = new[] { Cfg("a", "A", colorIndex: 5) };
        var rows = new[] { Row("x", ("a", 1)) };

        var series = Project(AreaChartWrapperModel.Loaded(rows, configs)).Series;

        Assert.Equal(5, series[0].ColorIndex);
    }

    [Fact]
    public void Semantic_role_unit_and_decimals_propagate_to_the_series()
    {
        var configs = new[] { Cfg("soc", "SOC", role: ChartRole.Battery, unit: "%", decimals: 0) };
        var rows = new[] { Row("x", ("soc", 80)) };

        var series = Project(AreaChartWrapperModel.Loaded(rows, configs)).Series[0];

        Assert.Equal(ChartRole.Battery, series.Role);
        Assert.Equal("%", series.Unit);
        Assert.Equal(0, series.Decimals);
    }

    [Fact]
    public void Points_use_ordinal_x_the_row_value_on_y_and_the_x_label()
    {
        var configs = OneSeries();
        var rows = new[]
        {
            Row("2024-01", ("energy", 120)),
            Row("2024-02", ("energy", 90.5)),
            Row("2024-03", ("energy", 75)),
        };

        var points = Project(AreaChartWrapperModel.Loaded(rows, configs)).Series[0].Points;

        Assert.Equal(3, points.Count);
        Assert.Equal(0, points[0].X);
        Assert.Equal(120, points[0].Y);
        Assert.Equal("2024-01", points[0].Label);
        Assert.Equal(1, points[1].X);
        Assert.Equal(90.5, points[1].Y, 4);
        Assert.Equal("2024-02", points[1].Label);
        Assert.Equal(2, points[2].X);
        Assert.Equal(75, points[2].Y);
    }

    [Fact]
    public void Missing_series_value_in_a_row_reads_as_zero()
    {
        // Web parity: `row[s.key]` is undefined for the missing key → the area gap, mapped to a zero point.
        var configs = new[] { Cfg("energy", "Energy"), Cfg("regen", "Regen") };
        var rows = new[] { Row("x", ("energy", 50)) }; // no "regen" value

        var series = Project(AreaChartWrapperModel.Loaded(rows, configs)).Series;

        Assert.Equal(50, series[0].Points[0].Y);
        Assert.Equal(0, series[1].Points[0].Y);
    }

    [Fact]
    public void X_formatter_shapes_the_point_label_when_supplied()
    {
        // Web parity: `xFormatter ? xFormatter(value) : value`.
        var rows = new[] { Row("2024-01", ("energy", 1)), Row("2024-02", ("energy", 2)) };
        var model = AreaChartWrapperModel.Loaded(rows, OneSeries(), xFormatter: x => $"M:{x}");

        var points = Project(model).Series[0].Points;

        Assert.Equal("M:2024-01", points[0].Label);
        Assert.Equal("M:2024-02", points[1].Label);
    }

    [Fact]
    public void X_label_is_the_raw_value_when_no_formatter_is_supplied()
    {
        var points = Project(Loaded()).Series[0].Points;

        Assert.Equal("2024-01", points[0].Label);
        Assert.Equal("2024-02", points[1].Label);
    }

    // ── Height passthrough (web height = 300) ────────────────────────────────────────────────────────

    [Fact]
    public void Height_defaults_to_the_web_default()
    {
        Assert.Equal(300, Project(Loaded()).Height);
        Assert.Equal(300, AreaChartWrapperProjection.DefaultHeight);
    }

    [Fact]
    public void Height_passes_through_a_custom_value()
    {
        Assert.Equal(240, Project(AreaChartWrapperModel.Loaded(TwoRows(), OneSeries(), height: 240)).Height);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-12)]
    [InlineData(double.NaN)]
    public void Non_positive_or_non_finite_height_falls_back_to_the_default(double bad)
    {
        var model = new AreaChartWrapperModel(AreaChartWrapperPhase.Ready, TwoRows(), OneSeries(), bad);

        Assert.Equal(300, Project(model).Height);
    }

    // ── Resolved labels (i18n facade fallbacks) ──────────────────────────────────────────────────────

    [Fact]
    public void Empty_message_uses_the_chart_no_data_string()
    {
        Assert.Equal("No data available", Project(AreaChartWrapperModel.Empty).EmptyMessage);
    }

    [Fact]
    public void Loading_and_retry_labels_resolve_from_the_shared_facade()
    {
        var display = Project(AreaChartWrapperModel.Failed());

        Assert.Equal("Loading", display.LoadingMessage);
        Assert.Equal("Retry", display.RetryLabel);
    }

    [Fact]
    public void Error_title_and_message_prefer_the_model_detail_then_fall_back()
    {
        Assert.Equal("Failed to load data", Project(AreaChartWrapperModel.Failed()).ErrorTitle);
        Assert.Equal(
            "Check your internet connection and try again.",
            Project(AreaChartWrapperModel.Failed()).ErrorMessage);
        Assert.Equal("You're offline", Project(AreaChartWrapperModel.Failed("You're offline")).ErrorMessage);
    }

    // ── Freshness chip ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Freshness_chip_is_absent_when_ready()
    {
        Assert.Null(Project(Loaded()).FreshnessChip);
    }

    [Fact]
    public void Freshness_chip_is_absent_in_loading_error_and_empty()
    {
        Assert.Null(Project(AreaChartWrapperModel.Pending).FreshnessChip);
        Assert.Null(Project(AreaChartWrapperModel.Failed()).FreshnessChip);
        Assert.Null(Project(AreaChartWrapperModel.Empty).FreshnessChip);
    }

    [Fact]
    public void Freshness_chip_labels_stale_and_offline_snapshots()
    {
        Assert.Equal(
            "Stale",
            Project(AreaChartWrapperModel.StaleSnapshot(TwoRows(), OneSeries())).FreshnessChip);
        Assert.Equal(
            "Offline",
            Project(AreaChartWrapperModel.OfflineSnapshot(TwoRows(), OneSeries())).FreshnessChip);
    }

    // ── Accessibility: aria label + every state exposes a descriptive Narrator name ──────────────────

    [Fact]
    public void Aria_label_joins_the_series_labels()
    {
        var configs = new[] { Cfg("energy", "Energy"), Cfg("regen", "Regen") };
        var rows = new[] { Row("x", ("energy", 1), ("regen", 2)) };

        Assert.Equal("Energy, Regen", Project(AreaChartWrapperModel.Loaded(rows, configs)).AriaLabel);
    }

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name()
    {
        Assert.All(
            new[]
            {
                Project(AreaChartWrapperModel.Pending),
                Project(AreaChartWrapperModel.Failed()),
                Project(AreaChartWrapperModel.Empty),
                Project(Loaded()),
                Project(AreaChartWrapperModel.StaleSnapshot(TwoRows(), OneSeries())),
                Project(AreaChartWrapperModel.OfflineSnapshot(TwoRows(), OneSeries())),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
    }

    [Fact]
    public void Ready_automation_name_carries_the_aria_label()
    {
        var display = Project(Loaded());

        Assert.Equal(display.AriaLabel, display.AutomationName);
    }

    [Fact]
    public void Empty_automation_name_carries_the_empty_message()
    {
        var display = Project(AreaChartWrapperModel.Empty);

        Assert.Contains(display.EmptyMessage, display.AutomationName, System.StringComparison.Ordinal);
    }

    [Fact]
    public void Error_automation_name_carries_the_error_message()
    {
        var display = Project(AreaChartWrapperModel.Failed());

        Assert.Contains(display.ErrorMessage, display.AutomationName, System.StringComparison.Ordinal);
    }

    [Fact]
    public void Loading_automation_name_carries_the_loading_message()
    {
        var display = Project(AreaChartWrapperModel.Pending);

        Assert.Contains(display.LoadingMessage, display.AutomationName, System.StringComparison.Ordinal);
    }

    [Fact]
    public void Stale_and_offline_automation_names_carry_the_chip_and_aria()
    {
        var stale = Project(AreaChartWrapperModel.StaleSnapshot(TwoRows(), OneSeries()));
        Assert.Contains("Stale", stale.AutomationName, System.StringComparison.Ordinal);
        Assert.Contains(stale.AriaLabel, stale.AutomationName, System.StringComparison.Ordinal);

        var offline = Project(AreaChartWrapperModel.OfflineSnapshot(TwoRows(), OneSeries()));
        Assert.Contains("Offline", offline.AutomationName, System.StringComparison.Ordinal);
        Assert.Contains(offline.AriaLabel, offline.AutomationName, System.StringComparison.Ordinal);
    }

    // ── Null safety ──────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Null_rows_are_treated_as_empty()
    {
        var model = new AreaChartWrapperModel(AreaChartWrapperPhase.Ready, null!, OneSeries());
        var display = Project(model);

        Assert.Equal(AreaChartWrapperState.Empty, display.State);
        Assert.False(display.HasData);
        Assert.Single(display.Series);
        Assert.Empty(display.Series[0].Points);
    }

    [Fact]
    public void Null_series_are_treated_as_empty()
    {
        var model = new AreaChartWrapperModel(AreaChartWrapperPhase.Ready, TwoRows(), null!);
        var display = Project(model);

        Assert.Equal(AreaChartWrapperState.Empty, display.State);
        Assert.False(display.HasData);
        Assert.Empty(display.Series);
    }

    [Fact]
    public void Null_row_values_dictionary_reads_every_series_as_zero()
    {
        var rows = new[] { new AreaChartWrapperRow("x", null!) };
        var series = Project(AreaChartWrapperModel.Loaded(rows, OneSeries())).Series[0];

        Assert.Single(series.Points);
        Assert.Equal(0, series.Points[0].Y);
        Assert.Equal("x", series.Points[0].Label);
    }

    [Fact]
    public void Project_rejects_a_null_model()
    {
        Assert.Throws<System.ArgumentNullException>(
            () => AreaChartWrapperProjection.Project(null!, Localizer));
    }

    [Fact]
    public void Project_rejects_a_null_localizer()
    {
        Assert.Throws<System.ArgumentNullException>(
            () => AreaChartWrapperProjection.Project(AreaChartWrapperModel.Empty, null!));
    }

    [Fact]
    public void Series_config_rejects_an_empty_key_or_label()
    {
        Assert.Throws<System.ArgumentException>(() => new AreaChartWrapperSeries("", "Label"));
        Assert.Throws<System.ArgumentException>(() => new AreaChartWrapperSeries("key", ""));
    }

    // ── Diagnostics (P1/S11): view.opened slug=AreaChartWrapper, PII-safe ────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new AreaChartWrapperDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=AreaChartWrapper", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_chart_values()
    {
        var captured = new List<string>();
        var diagnostics = new AreaChartWrapperDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.DoesNotContain("120", line, System.StringComparison.Ordinal);
        Assert.DoesNotContain("Energy", line, System.StringComparison.Ordinal);
        Assert.Equal("view.opened slug=AreaChartWrapper", line);
    }

    [Fact]
    public void Registration_slug_is_stable()
    {
        Assert.Equal("AreaChartWrapper", AreaChartWrapperRegistration.Slug);
    }
}
