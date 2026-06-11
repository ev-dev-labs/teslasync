using System.ComponentModel;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the <c>MetricSwitcherChart</c> shared surface's UI-thread-free logic — the pure
/// projection (the data adapter: active-metric resolution, pill mapping, point projection, kind mapping, series
/// projection), the controlled-input source/store (seed / select / replace + change notification), the view-model's
/// empty (web <c>projected.length === 0</c>) vs populated states and metric switching, the localized pill-row
/// accessible name, the PII-safe diagnostics and the argument validation. Mirrors the web spec one-for-one
/// (web/src/components/charts/MetricSwitcherChart.tsx). The WinUI view itself (the chart container, pill bar and
/// composed chart) is exercised by the app build.
/// </summary>
public sealed class MetricSwitcherChartTests
{
    // ── Projection (the data adapter) ─────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(MetricChartKind.Bar, ChartSeriesKind.Bar)]
    [InlineData(MetricChartKind.Area, ChartSeriesKind.Area)]
    [InlineData(MetricChartKind.Line, ChartSeriesKind.Line)]
    public void ToSeriesKind_maps_each_web_chart_type(MetricChartKind kind, ChartSeriesKind expected) =>
        Assert.Equal(expected, MetricSwitcherChartProjection.ToSeriesKind(kind));

    [Fact]
    public void ResolveActive_returns_the_metric_whose_key_matches()
    {
        var metrics = new[] { Metric("drives", "Drives"), Metric("distance", "Distance") };

        var active = MetricSwitcherChartProjection.ResolveActive(metrics, "distance");

        Assert.NotNull(active);
        Assert.Equal("distance", active!.Key);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("unknown")]
    public void ResolveActive_falls_back_to_the_first_metric_when_the_key_is_missing(string? key)
    {
        // web: metrics.find(m => m.key === activeMetric) ?? metrics[0]
        var metrics = new[] { Metric("drives", "Drives"), Metric("distance", "Distance") };

        var active = MetricSwitcherChartProjection.ResolveActive(metrics, key);

        Assert.NotNull(active);
        Assert.Equal("drives", active!.Key);
    }

    [Fact]
    public void ResolveActive_of_no_metrics_is_null() =>
        Assert.Null(MetricSwitcherChartProjection.ResolveActive([], "drives"));

    [Fact]
    public void ProjectPills_maps_every_metric_to_key_and_label_preserving_order()
    {
        var pills = MetricSwitcherChartProjection.ProjectPills(
        [
            Metric("drives", "Drives"),
            Metric("distance", "Distance"),
            Metric("score", "Score"),
        ]);

        Assert.Equal(new[] { "drives", "distance", "score" }, pills.Select(p => p.Key));
        Assert.Equal(new[] { "Drives", "Distance", "Score" }, pills.Select(p => p.Label));
    }

    [Fact]
    public void ProjectPoints_carries_value_and_uses_an_ordinal_x_with_the_date_label()
    {
        // web: data.map((p, i) => ({ ...p, __value: get(p) })) over the canonical { date, value } shape.
        var points = new[]
        {
            new MetricPoint("2024-01-01", 5),
            new MetricPoint("2024-01-02", 8),
            new MetricPoint("2024-01-03", 3),
        };

        var projected = MetricSwitcherChartProjection.ProjectPoints(points);

        Assert.Equal(new ChartPoint(0, 5, "2024-01-01"), projected[0]);
        Assert.Equal(new ChartPoint(1, 8, "2024-01-02"), projected[1]);
        Assert.Equal(new ChartPoint(2, 3, "2024-01-03"), projected[2]);
    }

    [Fact]
    public void ProjectPoints_of_an_empty_series_yields_no_points() =>
        Assert.Empty(MetricSwitcherChartProjection.ProjectPoints([]));

    [Fact]
    public void ProjectSeries_carries_the_metric_kind_color_unit_and_decimals()
    {
        var metric = new MetricDefinition
        {
            Key = "distance",
            Label = "Distance",
            Kind = MetricChartKind.Area,
            ColorIndex = 2,
            Role = ChartRole.Energy,
            Unit = " mi",
            Decimals = 1,
        };

        var series = MetricSwitcherChartProjection.ProjectSeries(
            metric, [new MetricPoint("2024-01-01", 12.3), new MetricPoint("2024-01-02", 4.5)]);

        Assert.Equal("Distance", series.Name);
        Assert.Equal(ChartSeriesKind.Area, series.Kind);
        Assert.Equal(2, series.ColorIndex);
        Assert.Equal(ChartRole.Energy, series.Role);
        Assert.Equal(" mi", series.Unit);
        Assert.Equal(1, series.Decimals);
        Assert.Equal(2, series.Points.Count);
        Assert.Equal(new ChartPoint(0, 12.3, "2024-01-01"), series.Points[0]);
    }

    [Fact]
    public void ProjectSeries_falls_back_to_the_key_when_the_label_is_empty()
    {
        var metric = new MetricDefinition { Key = "drives", Label = string.Empty };

        var series = MetricSwitcherChartProjection.ProjectSeries(metric, [new MetricPoint("2024-01-01", 1)]);

        Assert.Equal("drives", series.Name);
    }

    [Fact]
    public void Projection_rejects_null_input()
    {
        Assert.Throws<ArgumentNullException>(() => MetricSwitcherChartProjection.ResolveActive(null!, "x"));
        Assert.Throws<ArgumentNullException>(() => MetricSwitcherChartProjection.ProjectPills(null!));
        Assert.Throws<ArgumentNullException>(() => MetricSwitcherChartProjection.ProjectPoints(null!));
        Assert.Throws<ArgumentNullException>(() =>
            MetricSwitcherChartProjection.ProjectSeries(null!, []));
        Assert.Throws<ArgumentNullException>(() =>
            MetricSwitcherChartProjection.ProjectSeries(Metric("a", "A"), null!));
    }

    // ── Source / store (the P1/S8 seam) ──────────────────────────────────────────────────────────────────

    [Fact]
    public void Store_exposes_its_seeded_framing_strings_and_metrics()
    {
        var store = NewStore();

        Assert.Equal("Drive trends", store.Title);
        Assert.Equal("Drive trends over time", store.AccessibleName);
        Assert.Equal("No drives in range", store.EmptyMessage);
        Assert.Equal(MetricSwitcherChartStore.DefaultHeight, store.Height);
        Assert.Equal(new[] { "drives", "distance" }, store.Metrics.Select(m => m.Key));
    }

    [Fact]
    public void Store_defaults_the_active_key_to_the_first_metric()
    {
        // web: metrics[0] is the implicit initial active metric.
        var store = NewStore();

        Assert.Equal("drives", store.ActiveMetric);
    }

    [Fact]
    public void Store_honors_an_explicit_initial_active_key()
    {
        var store = NewStore(active: "distance");

        Assert.Equal("distance", store.ActiveMetric);
    }

    [Fact]
    public void Store_series_for_returns_points_and_empty_for_an_unknown_key()
    {
        var store = NewStore();

        Assert.Equal(2, store.SeriesFor("drives").Count);
        Assert.Empty(store.SeriesFor("distance"));
        Assert.Empty(store.SeriesFor("missing"));
        Assert.Empty(store.SeriesFor(string.Empty));
    }

    [Fact]
    public void Select_metric_changes_the_active_key_and_raises_changed()
    {
        var store = NewStore();
        int changes = 0;
        store.Changed += (_, _) => changes++;

        store.SelectMetric("distance");

        Assert.Equal("distance", store.ActiveMetric);
        Assert.Equal(1, changes);
    }

    [Theory]
    [InlineData("")]
    [InlineData(null)]
    public void Select_metric_with_an_empty_key_is_a_no_op(string? key)
    {
        var store = NewStore();
        int changes = 0;
        store.Changed += (_, _) => changes++;

        store.SelectMetric(key!);

        Assert.Equal("drives", store.ActiveMetric);
        Assert.Equal(0, changes);
    }

    [Fact]
    public void Select_metric_with_the_current_key_does_not_raise_changed()
    {
        var store = NewStore();
        int changes = 0;
        store.Changed += (_, _) => changes++;

        store.SelectMetric("drives");

        Assert.Equal(0, changes);
    }

    [Fact]
    public void Replace_series_swaps_a_metric_data_and_raises_changed()
    {
        var store = NewStore();
        int changes = 0;
        store.Changed += (_, _) => changes++;

        store.ReplaceSeries("distance", [new MetricPoint("2024-02-01", 99)]);

        Assert.Single(store.SeriesFor("distance"));
        Assert.Equal(99, store.SeriesFor("distance")[0].Value);
        Assert.Equal(1, changes);
    }

    [Fact]
    public void Replace_series_treats_null_points_as_empty()
    {
        var store = NewStore();

        store.ReplaceSeries("drives", null);

        Assert.Empty(store.SeriesFor("drives"));
    }

    [Fact]
    public void Replace_series_rejects_an_empty_key() =>
        Assert.Throws<ArgumentException>(() => NewStore().ReplaceSeries(string.Empty, []));

    [Fact]
    public void Store_rejects_null_dependencies()
    {
        Assert.Throws<ArgumentNullException>(() => new MetricSwitcherChartStore(null!, "a", "e", []));
        Assert.Throws<ArgumentNullException>(() => new MetricSwitcherChartStore("t", null!, "e", []));
        Assert.Throws<ArgumentNullException>(() => new MetricSwitcherChartStore("t", "a", null!, []));
        Assert.Throws<ArgumentNullException>(() => new MetricSwitcherChartStore("t", "a", "e", null!));
    }

    // ── View-model state: empty (web EmptyState) vs populated + switching ─────────────────────────────────

    [Fact]
    public void View_model_is_populated_for_a_metric_with_points()
    {
        using var vm = new MetricSwitcherChartViewModel(NewStore(), PassthroughLocalizer.Instance);

        Assert.False(vm.IsEmpty);
        Assert.True(vm.HasMetrics);
        Assert.Equal("drives", vm.ActiveMetric);
        Assert.Equal(MetricChartKind.Bar, vm.ActiveChartKind);
        var series = Assert.Single(vm.ActiveSeries);
        Assert.Equal("Drives", series.Name);
        Assert.Equal(2, series.Points.Count);
    }

    [Fact]
    public void View_model_is_empty_when_the_active_metric_has_no_points()
    {
        // web: projected.length === 0 → render EmptyState.
        using var vm = new MetricSwitcherChartViewModel(NewStore(active: "distance"), PassthroughLocalizer.Instance);

        Assert.True(vm.IsEmpty);
        Assert.Empty(vm.ActiveSeries);
    }

    [Fact]
    public void View_model_is_empty_when_there_are_no_metrics()
    {
        var store = new MetricSwitcherChartStore("t", "a", "e", []);
        using var vm = new MetricSwitcherChartViewModel(store, PassthroughLocalizer.Instance);

        Assert.True(vm.IsEmpty);
        Assert.False(vm.HasMetrics);
        Assert.Empty(vm.ActiveSeries);
        Assert.Equal(string.Empty, vm.ActiveMetric);
        Assert.Null(vm.ActiveDefinition);
    }

    [Fact]
    public void View_model_active_metric_falls_back_to_the_first_when_the_source_key_is_unknown()
    {
        var store = NewStore(active: "ghost");
        using var vm = new MetricSwitcherChartViewModel(store, PassthroughLocalizer.Instance);

        Assert.Equal("drives", vm.ActiveMetric);
    }

    [Fact]
    public void Selecting_a_metric_reprojects_the_active_series_and_notifies()
    {
        var store = NewStore();
        using var vm = new MetricSwitcherChartViewModel(store, PassthroughLocalizer.Instance);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        // Distance has no points → switching reaches the empty (EmptyState) branch.
        vm.Select("distance");

        Assert.Equal("distance", vm.ActiveMetric);
        Assert.True(vm.IsEmpty);
        Assert.Empty(vm.ActiveSeries);
        Assert.Contains(nameof(MetricSwitcherChartViewModel.IsEmpty), changed);
        Assert.Contains(nameof(MetricSwitcherChartViewModel.ActiveSeries), changed);
        Assert.Contains(nameof(MetricSwitcherChartViewModel.ActiveMetric), changed);
    }

    [Fact]
    public void Switching_between_two_populated_metrics_swaps_the_series_kind()
    {
        var store = new MetricSwitcherChartStore(
            "Trends",
            "Trends chart",
            "No data",
            [Metric("drives", "Drives", MetricChartKind.Bar), Metric("score", "Score", MetricChartKind.Line)],
            new Dictionary<string, IReadOnlyList<MetricPoint>>(StringComparer.Ordinal)
            {
                ["drives"] = [new MetricPoint("2024-01-01", 4)],
                ["score"] = [new MetricPoint("2024-01-01", 88)],
            });
        using var vm = new MetricSwitcherChartViewModel(store, PassthroughLocalizer.Instance);

        Assert.Equal(MetricChartKind.Bar, vm.ActiveChartKind);
        Assert.Equal(ChartSeriesKind.Bar, Assert.Single(vm.ActiveSeries).Kind);

        vm.Select("score");

        Assert.Equal(MetricChartKind.Line, vm.ActiveChartKind);
        Assert.Equal(ChartSeriesKind.Line, Assert.Single(vm.ActiveSeries).Kind);
    }

    [Fact]
    public void View_model_passes_through_the_framing_strings()
    {
        using var vm = new MetricSwitcherChartViewModel(NewStore(), PassthroughLocalizer.Instance);

        Assert.Equal("Drive trends", vm.Title);
        Assert.Equal("Drive trends over time", vm.AccessibleName);
        Assert.Equal("No drives in range", vm.EmptyMessage);
        Assert.Equal(MetricSwitcherChartStore.DefaultHeight, vm.Height);
        Assert.Equal(new[] { "drives", "distance" }, vm.Items.Select(p => p.Key));
    }

    // ── i18n / accessibility: the pill-row label resolves through the localizer ───────────────────────────

    [Fact]
    public void Switcher_label_resolves_through_the_localizer_with_the_title()
    {
        var localizer = new RecordingLocalizer();
        using var vm = new MetricSwitcherChartViewModel(NewStore(), localizer);

        // web: ariaLabel={`${title} metric`}
        Assert.Equal("Drive trends metric", vm.SwitcherLabel);
        Assert.Contains(("metricSwitcher.switcherLabel", "{0} metric"), localizer.Requests);
    }

    [Fact]
    public void Switcher_label_substitutes_the_title_into_the_positional_fallback()
    {
        Assert.Equal(
            "Score metric",
            MetricSwitcherChartRegistration.SwitcherLabel(PassthroughLocalizer.Instance, "Score"));
    }

    [Fact]
    public void Switcher_label_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => MetricSwitcherChartRegistration.SwitcherLabel(null!, "x"));

    // ── Diagnostics (P1/S11): slug-only view.opened, never the chart content ──────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new MetricSwitcherChartDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=MetricSwitcherChart", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count_opens()
    {
        var diagnostics = new MetricSwitcherChartDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    [Fact]
    public void Notify_opened_emits_the_view_opened_event_once()
    {
        var lines = new List<string>();
        using var vm = new MetricSwitcherChartViewModel(
            NewStore(), PassthroughLocalizer.Instance, new MetricSwitcherChartDiagnostics(lines.Add));

        vm.NotifyOpened();
        vm.NotifyOpened();

        Assert.Equal("view.opened slug=MetricSwitcherChart", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_never_leak_the_chart_content()
    {
        var lines = new List<string>();
        var store = new MetricSwitcherChartStore(
            "VIN 5YJ-secret trends",
            "private chart",
            "no secret data",
            [Metric("private-key", "Secret label")],
            new Dictionary<string, IReadOnlyList<MetricPoint>>(StringComparer.Ordinal)
            {
                ["private-key"] = [new MetricPoint("2024-01-01", 123456)],
            });
        using var vm = new MetricSwitcherChartViewModel(
            store, PassthroughLocalizer.Instance, new MetricSwitcherChartDiagnostics(lines.Add));

        vm.NotifyOpened();
        vm.Select("private-key");

        Assert.All(lines, line =>
        {
            Assert.DoesNotContain("5YJ-secret", line, StringComparison.Ordinal);
            Assert.DoesNotContain("Secret label", line, StringComparison.Ordinal);
            Assert.DoesNotContain("123456", line, StringComparison.Ordinal);
        });
    }

    // ── Lifecycle + argument validation ──────────────────────────────────────────────────────────────────

    [Fact]
    public void Disposed_view_model_unsubscribes_and_ignores_further_selects()
    {
        var store = NewStore();
        var vm = new MetricSwitcherChartViewModel(store, PassthroughLocalizer.Instance);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.Dispose();
        vm.Select("distance");

        Assert.Equal("drives", store.ActiveMetric);
        Assert.Empty(changed);
    }

    [Fact]
    public void View_model_dispose_is_idempotent()
    {
        var vm = new MetricSwitcherChartViewModel(NewStore(), PassthroughLocalizer.Instance);

        vm.Dispose();
        var ex = Record.Exception(vm.Dispose);

        Assert.Null(ex);
    }

    [Fact]
    public void View_model_rejects_null_dependencies()
    {
        var store = NewStore();

        Assert.Throws<ArgumentNullException>(() =>
            new MetricSwitcherChartViewModel(null!, PassthroughLocalizer.Instance));
        Assert.Throws<ArgumentNullException>(() => new MetricSwitcherChartViewModel(store, null!));
    }

    // ── Registration metadata is stable ──────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_is_stable()
    {
        Assert.Equal("MetricSwitcherChart", MetricSwitcherChartRegistration.Slug);
        Assert.Equal("MetricSwitcherChart", MetricSwitcherChartViewModel.Slug);
    }

    [Fact]
    public void Registration_metadata_is_stable()
    {
        Assert.Equal("metric-switcher-chart-root", MetricSwitcherChartRegistration.RootAutomationId);
        Assert.Equal("metricSwitcher.switcherLabel", MetricSwitcherChartRegistration.SwitcherLabelKey);
        Assert.Equal("{0} metric", MetricSwitcherChartRegistration.SwitcherLabelFallback);
    }

    // ── Helpers / test doubles ───────────────────────────────────────────────────────────────────────────

    private static MetricDefinition Metric(string key, string label, MetricChartKind kind = MetricChartKind.Bar) =>
        new() { Key = key, Label = label, Kind = kind };

    private static MetricSwitcherChartStore NewStore(string? active = null) =>
        new(
            "Drive trends",
            "Drive trends over time",
            "No drives in range",
            [Metric("drives", "Drives"), Metric("distance", "Distance")],
            new Dictionary<string, IReadOnlyList<MetricPoint>>(StringComparer.Ordinal)
            {
                ["drives"] = [new MetricPoint("2024-01-01", 3), new MetricPoint("2024-01-02", 5)],
            },
            active);

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<(string Key, string Fallback)> Requests { get; } = [];

        public string GetString(string key, string fallback)
        {
            Requests.Add((key, fallback));
            return fallback;
        }
    }
}
